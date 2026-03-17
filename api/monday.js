// ---------------------------------------------------------------
//  Vercel serverless function – Monday.com webhook receiver
//  Queues tasks into GitHub Issues AND alerts Discord immediately
// ---------------------------------------------------------------

const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || "").trim();
const GITHUB_REPO  = (process.env.GITHUB_REPO || "ShulaZange/monday-webhook-vercel").trim();
const DISCORD_WEBHOOK_URL = (process.env.DISCORD_WEBHOOK_URL || "").trim();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const payload = req.body || {};

  // ---- 1️⃣ Handle Monday’s webhook registration challenge ----
  if (payload.challenge) {
    return res.status(200).json({ challenge: payload.challenge });
  }

  // ---- 2️⃣ Extract info ----
  const event   = payload.event || {};
  const itemId  = event.pulseId || payload.data?.id || event.pulseId;
  const boardId = event.boardId || payload.data?.boardId;

  if (!itemId || !boardId) {
    return res.status(200).json({ received: true });
  }

  console.log(`🔔 Webhook received! Queueing to GitHub -> Board: ${boardId}, Item: ${itemId}`);

  // ---- 3️⃣ Push this info to GitHub Issues (as a permanent queue) ----
  if (GITHUB_TOKEN) {
    const issueTitle = `Process Monday Item: ${itemId}`;
    const issueBody  = `**Board ID:** ${boardId}\n**Item ID:** ${itemId}\n**Event Type:** ${event.type || 'create_item'}\n\n*This issue serves as a queue item. The local agent should process this item and then close this issue.*`;

    try {
      const githubResp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: issueTitle,
          body: issueBody,
          labels: ['monday-webhook', 'pending']
        }),
      });

      if (!githubResp.ok) {
        console.error('❌ Failed to create GitHub Issue:', await githubResp.text());
      } else {
        const issueData = await githubResp.json();
        console.log(`✅ Successfully queued info to GitHub Issue #${issueData.number}`);
      }
    } catch (err) {
      console.error('❌ Error hitting GitHub API:', err);
    }
  }

  // ---- 4️⃣ Ping Discord IMMEDIATELY to wake up the local agent ----
  if (DISCORD_WEBHOOK_URL) {
    const message = `🚨 **New Monday.com Ticket Queued!**\nHey Shula, please process this item immediately:\n**Board ID:** ${boardId}\n**Item ID:** ${itemId}\n(I also created a GitHub issue as a backup queue.)`;

    try {
      const discordResp = await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message }),
      });

      if (!discordResp.ok) {
        console.error('❌ Failed to push to Discord:', await discordResp.text());
      } else {
        console.log(`✅ Successfully pinged Discord to wake up agent`);
      }
    } catch (err) {
      console.error('❌ Error hitting Discord API:', err);
    }
  }

  return res.status(200).json({ 
    received: true, 
    message: "Info queued in GitHub and pinged to Discord", 
    boardId, 
    itemId 
  });
}