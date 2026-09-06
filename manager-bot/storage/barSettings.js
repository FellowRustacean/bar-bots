const db = require('./db');

const getStmt = db.prepare('SELECT bartresen_channel_id AS channelId FROM guild_settings WHERE guild_id = ?');
const setStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, bartresen_channel_id) VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET bartresen_channel_id = excluded.bartresen_channel_id
`);

function getBartresenChannelId(guildId) {
  return getStmt.get(guildId)?.channelId ?? null;
}

function setBartresenChannel(guildId, channelId) {
  setStmt.run(guildId, channelId);
}

module.exports = { getBartresenChannelId, setBartresenChannel };
