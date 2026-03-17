// ---------------------------------------------------------------
//  Vercel serverless function – Monday.com webhook receiver (Board-Agnostic)
// ---------------------------------------------------------------

// ---- CONFIG ----
// Trim values to remove trailing newlines accidentally added by echo
const MONDAY_API_KEY    = (process.env.MONDAY_API_KEY || "").trim();
const IN_PROGRESS_LABEL = (process.env.IN_PROGRESS_LABEL || "In Bearbeitung").trim();
const UPDATE_TEXT       = (process.env.UPDATE_TEXT || "I’ve started working on this ticket.").trim();
const STATUS_COL_TITLE  = (process.env.STATUS_COL_TITLE || "Status").trim(); 
// -----------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const payload = req.body || {};

  if (payload.challenge) {
    console.log('🔔 Received webhook challenge:', payload.challenge);
    return res.status(200).json({ challenge: payload.challenge });
  }

  console.log('🔔 Monday webhook payload received');

  const event   = payload.event || {};
  const itemId  = event.pulseId || payload.data?.id || event.pulseId;
  const boardId = event.boardId || payload.data?.boardId;

  if (!itemId || !boardId) {
    console.warn('⚠️ Missing itemId/boardId – nothing to do.');
    return res.status(200).json({ received: true });
  }

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

  return res.status(200).json({ received: true, itemId });
}