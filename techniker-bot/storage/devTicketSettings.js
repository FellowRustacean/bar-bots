const db = require('./db');

const getStmt = db.prepare('SELECT dev_tickets_channel_id AS channelId FROM guild_settings WHERE guild_id = ?');

function getDevTicketsChannelId(guildId) {
  return getStmt.get(guildId)?.channelId ?? null;
}

module.exports = { getDevTicketsChannelId };
