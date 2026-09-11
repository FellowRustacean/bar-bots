const db = require('./db');

const getStmt = db.prepare('SELECT afk_channel_id AS afkChannelId FROM guild_settings WHERE guild_id = ?');
const setStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, afk_channel_id) VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET afk_channel_id = excluded.afk_channel_id
`);

function getAfkChannelId(guildId) {
  return getStmt.get(guildId)?.afkChannelId ?? null;
}

function setAfkChannel(guildId, channelId) {
  setStmt.run(guildId, channelId);
}

module.exports = { getAfkChannelId, setAfkChannel };
