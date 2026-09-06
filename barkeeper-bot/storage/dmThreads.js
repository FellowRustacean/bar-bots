const db = require("./db");

const insertStmt = db.prepare(`
  INSERT INTO dm_threads (thread_id, guild_id, bot_name, target_user_id, created_at) VALUES (?, ?, ?, ?, ?)
`);
const getStmt = db.prepare("SELECT * FROM dm_threads WHERE thread_id = ?");
const getByTargetStmt = db.prepare(
  "SELECT * FROM dm_threads WHERE bot_name = ? AND target_user_id = ? ORDER BY created_at DESC LIMIT 1"
);

function createDmThread(threadId, guildId, botName, targetUserId) {
  insertStmt.run(threadId, guildId, botName, targetUserId, Date.now());
}

function rowToMapping(row) {
  if (!row) return null;
  return { threadId: row.thread_id, guildId: row.guild_id, botName: row.bot_name, targetUserId: row.target_user_id };
}

function getDmThread(threadId) {
  return rowToMapping(getStmt.get(threadId));
}

// Fuer eingehende DMs (der User schreibt zuerst) - prueft, ob fuer dieses Bot+User-Paar schon ein
// Thread existiert, bevor ein neuer angelegt wird (siehe handleIncomingUserDm in
// shared/lib/dmThreadFlow.js).
function getDmThreadByTarget(botName, targetUserId) {
  return rowToMapping(getByTargetStmt.get(botName, targetUserId));
}

// Verknuepft eine DM-Nachricht mit ihrer Thread-Kopie (und umgekehrt) fuer den Reaktions-Relay
// (siehe handleReactionAdd/-Remove in shared/lib/dmThreadFlow.js) - analog zu linkRelayedMessages
// fuer Tickets in storage/tickets.js, nur in einer eigenen Tabelle fuer den DM-Fluss.
const linkRelayStmt = db.prepare(
  "INSERT OR REPLACE INTO dm_message_relays (message_id, channel_id, paired_message_id, paired_channel_id) VALUES (?, ?, ?, ?)"
);
const getRelayPartnerStmt = db.prepare(
  "SELECT paired_message_id AS messageId, paired_channel_id AS channelId FROM dm_message_relays WHERE message_id = ?"
);

function linkDmRelay(messageIdA, channelIdA, messageIdB, channelIdB) {
  linkRelayStmt.run(messageIdA, channelIdA, messageIdB, channelIdB);
  linkRelayStmt.run(messageIdB, channelIdB, messageIdA, channelIdA);
}

function getDmRelayPartner(messageId) {
  return getRelayPartnerStmt.get(messageId) ?? null;
}

module.exports = { createDmThread, getDmThread, getDmThreadByTarget, linkDmRelay, getDmRelayPartner };
