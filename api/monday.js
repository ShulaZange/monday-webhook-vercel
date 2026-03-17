// ---------------------------------------------------------------
//  Vercel serverless function – Monday.com webhook receiver (Board-Agnostic)
// ---------------------------------------------------------------

// ---- CONFIG ----
const MONDAY_API_KEY   = process.env.MONDAY_API_KEY;
const IN_PROGRESS_LABEL = process.env.IN_PROGRESS_LABEL || "In Bearbeitung";
const UPDATE_TEXT      = process.env.UPDATE_TEXT || "I’ve started working on this ticket.";
const STATUS_COL_TITLE = process.env.STATUS_COL_TITLE || "Status"; // Look for this column name dynamically
// -----------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const payload = req.body || {};

  // ---- 1️⃣ Handle Monday’s webhook registration challenge (POST) ----
  if (payload.challenge) {
    console.log('🔔 Received webhook challenge:', payload.challenge);
    return res.status(200).json({ challenge: payload.challenge });
  }

  console.log('🔔 Monday webhook payload received');

  // ---- 2️⃣ Extract IDs we need (create_item event) ----
  const event   = payload.event || {};
  const itemId  = event.pulseId || payload.data?.id || event.pulseId;
  const boardId = event.boardId || payload.data?.boardId;

  if (!itemId || !boardId) {
    console.warn('⚠️ Missing itemId/boardId – nothing to do.');
    return res.status(200).json({ received: true });
  }

  // ---- 3️⃣ Fetch the exact Status column ID for this specific board ----
  const getColumnsQuery = `query { boards(ids: [${boardId}]) { columns { id title } } }`;
  const colsResp = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': MONDAY_API_KEY,
    },
    body: JSON.stringify({ query: getColumnsQuery }),
  });

  const colsData = await colsResp.json();
  let statusColId = null;

  try {
     const columns = colsData.data.boards[0].columns;
     // Find a column matching the title (case-insensitive fallback)
     const statusCol = columns.find(c => c.title === STATUS_COL_TITLE || c.title.toLowerCase() === 'status');
     if (statusCol) {
        statusColId = statusCol.id;
     }
  } catch (err) {
     console.error('❌ Failed to parse columns for board', boardId, err);
  }

  if (!statusColId) {
     console.log(`⚠️ No Status column found for board ${boardId}. Skipping status update.`);
  } else {
     // ---- 4️⃣ Update the Status column ----
     console.log(`✅ Found Status column (${statusColId}) for board ${boardId}. Updating...`);
     const updateStatusQuery = `
       mutation {
         change_simple_column_value(
           board_id: ${boardId}
           item_id: "${itemId}"
           column_id: "${statusColId}"
           value: ${JSON.stringify(IN_PROGRESS_LABEL)}
         ) { id }
       }
     `;

     const statusResp = await fetch('https://api.monday.com/v2', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_API_KEY },
       body: JSON.stringify({ query: updateStatusQuery }),
     });
     const statusResult = await statusResp.json();
     if (statusResult.errors) console.error('❌ Failed to update status:', statusResult.errors);
  }

  // ---- 5️⃣ Post an update/comment to the item ----
  const safeUpdate = UPDATE_TEXT.replace(/"/g, '\\"'); // escape double quotes for GraphQL
  const addUpdateQuery = `
    mutation {
      create_update(
        item_id: "${itemId}"
        body: "${safeUpdate}"
      ) { id }
    }
  `;

  const updateResp = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_API_KEY },
    body: JSON.stringify({ query: addUpdateQuery }),
  });

  const updateResult = await updateResp.json();
  if (updateResult.errors) {
    console.error('❌ Failed to create update:', updateResult.errors);
  } else {
    console.log('✅ Update posted for item', itemId);
  }

  // ---- 6️⃣ Respond to Monday.com ----
  return res.status(200).json({ received: true, itemId });
}