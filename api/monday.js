// ---------------------------------------------------------------
//  Vercel serverless function – Monday.com webhook receiver (Board-Agnostic)
// ---------------------------------------------------------------

// ---- CONFIG ----
const MONDAY_API_KEY    = (process.env.MONDAY_API_KEY || "").trim();
const IN_PROGRESS_LABEL = (process.env.IN_PROGRESS_LABEL || "In Bearbeitung").trim();
const UPDATE_TEXT       = (process.env.UPDATE_TEXT || "I’ve started working on this ticket.").trim();
// -----------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const payload = req.body || {};

  if (payload.challenge) {
    return res.status(200).json({ challenge: payload.challenge });
  }

  const event   = payload.event || {};
  const itemId  = event.pulseId || payload.data?.id || event.pulseId;
  const boardId = event.boardId || payload.data?.boardId;

  if (!itemId || !boardId) {
    return res.status(200).json({ received: true });
  }

  // ---- Fetch all columns and their settings to safely find the correct Status column ----
  const getColumnsQuery = `query { boards(ids: [${boardId}]) { columns { id title type settings_str } } }`;
  const colsResp = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_API_KEY },
    body: JSON.stringify({ query: getColumnsQuery }),
  });

  const colsData = await colsResp.json();
  let statusColId = null;
  let labelToUse = IN_PROGRESS_LABEL;

  try {
     const columns = colsData.data.boards[0].columns;
     
     // 1. Look for a 'color' (status) column that explicitly has our IN_PROGRESS_LABEL
     const statusCols = columns.filter(c => c.type === 'color' || c.title.toLowerCase().includes('status'));
     
     for (const col of statusCols) {
        if (col.settings_str) {
            const settings = JSON.parse(col.settings_str);
            const labels = Object.values(settings.labels || {});
            
            if (labels.includes(IN_PROGRESS_LABEL)) {
                statusColId = col.id;
                labelToUse = IN_PROGRESS_LABEL;
                break;
            } else if (labels.includes("Working on it")) {
                statusColId = col.id;
                labelToUse = "Working on it";
            }
        }
     }

     // Fallback: Just grab the first status column if we couldn't find an exact match
     if (!statusColId && statusCols.length > 0) {
         statusColId = statusCols[0].id;
     }
  } catch (err) {
     console.error('❌ Failed to parse columns for board', boardId, err);
  }

  if (statusColId) {
     const updateStatusQuery = `
       mutation {
         change_simple_column_value(
           board_id: ${boardId}
           item_id: "${itemId}"
           column_id: "${statusColId}"
           value: ${JSON.stringify(labelToUse)}
         ) { id }
       }
     `;
     await fetch('https://api.monday.com/v2', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_API_KEY },
       body: JSON.stringify({ query: updateStatusQuery }),
     });
  }

  // ---- Post update/comment ----
  const safeUpdate = UPDATE_TEXT.replace(/"/g, '\\"');
  const addUpdateQuery = `
    mutation {
      create_update(
        item_id: "${itemId}"
        body: "${safeUpdate}"
      ) { id }
    }
  `;

  await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_API_KEY },
    body: JSON.stringify({ query: addUpdateQuery }),
  });

  return res.status(200).json({ received: true, itemId });
}