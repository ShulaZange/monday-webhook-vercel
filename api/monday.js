// ---------------------------------------------------------------
//  Vercel serverless function – Monday.com webhook receiver
// ---------------------------------------------------------------

// ---- CONFIG (set in Vercel -> Settings -> Environment Variables) ----
const MONDAY_API_KEY   = process.env.MONDAY_API_KEY;
const STATUS_COL_ID    = process.env.STATUS_COL_ID;      // e.g. "color_mm1gczff"
const IN_PROGRESS_LABEL = process.env.IN_PROGRESS_LABEL || "In Bearbeitung";
const UPDATE_TEXT      = process.env.UPDATE_TEXT || "I’ve started working on this ticket.";
// -----------------------------------------------------------------

export default async function handler(req, res) {
  // ---- 1️⃣ Handle Monday’s webhook registration challenge (GET) ----
  if (req.method === 'GET' && req.query.challenge) {
    return res.status(200).json({ challenge: req.query.challenge });
  }

  // ---- 2️⃣ Only accept POSTs – real event payloads ----
  if (req.method !== 'POST') {
    return res.status(405).end(); // Method Not Allowed
  }

  const payload = req.body; // Vercel already parses JSON
  console.log('🔔 Monday webhook payload:', JSON.stringify(payload, null, 2));

  // ---- 3️⃣ Extract IDs we need (create_item event) ----
  const event   = payload.event || '';
  const data    = payload.data || {};
  const itemId  = data.id;
  const boardId = data.boardId;

  if (!itemId || !boardId) {
    console.warn('⚠️ Missing itemId/boardId – nothing to do.');
    return res.status(200).end(); // still acknowledge receipt
  }

  // ---- 4️⃣ Update the Status column to "In Progress" ----
  const updateStatusQuery = `
    mutation {
      change_simple_column_value(
        board_id: ${boardId}
        item_id: "${itemId}"
        column_id: "${STATUS_COL_ID}"
        value: ${JSON.stringify(JSON.stringify(IN_PROGRESS_LABEL))} 
      ) { id }
    }
  `;

  // Note: For change_simple_column_value, value must be a string containing a JSON string.
  // Example: value: "\"In Bearbeitung\""

  const statusResp = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': MONDAY_API_KEY,
    },
    body: JSON.stringify({ query: updateStatusQuery }),
  });

  const statusResult = await statusResp.json();
  if (statusResult.errors) {
    console.error('❌ Failed to update status:', statusResult.errors);
  } else {
    console.log('✅ Status updated to In Progress for item', itemId);
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
    headers: {
      'Content-Type': 'application/json',
      'Authorization': MONDAY_API_KEY,
    },
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