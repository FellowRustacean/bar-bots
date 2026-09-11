const db = require('./db');

const ensureStmt = db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)');
const getStmt = db.prepare('SELECT entry_channel_id AS channelId, entry_message_id AS messageId FROM guild_settings WHERE guild_id = ?');
const setStmt = db.prepare('UPDATE guild_settings SET entry_channel_id = ?, entry_message_id = ? WHERE guild_id = ?');

function getEntryMessage(guildId) {
  const row = getStmt.get(guildId);
  if (!row?.channelId || !row?.messageId) return null;
  return row;
}

function setEntryMessage(guildId, channelId, messageId) {
  ensureStmt.run(guildId);
  setStmt.run(channelId, messageId, guildId);
}

module.exports = { getEntryMessage, setEntryMessage };
