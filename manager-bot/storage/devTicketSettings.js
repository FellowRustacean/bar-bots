const db = require('./db');

const getStmt = db.prepare('SELECT dev_tickets_channel_id AS channelId FROM guild_settings WHERE guild_id = ?');
const setStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, dev_tickets_channel_id) VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET dev_tickets_channel_id = excluded.dev_tickets_channel_id
`);

function getDevTicketsChannelId(guildId) {
  return getStmt.get(guildId)?.channelId ?? null;
}

function setDevTicketsChannel(guildId, channelId) {
  setStmt.run(guildId, channelId);
}

module.exports = { getDevTicketsChannelId, setDevTicketsChannel };
