const db = require('./db');

const getLogChannelStmt = db.prepare(
  'SELECT channel_id AS channelId FROM log_channels WHERE guild_id = ? AND type = ?'
);
const setLogChannelStmt = db.prepare(`
  INSERT INTO log_channels (guild_id, type, channel_id) VALUES (?, ?, ?)
  ON CONFLICT(guild_id, type) DO UPDATE SET channel_id = excluded.channel_id
`);

function getLogChannel(guildId, type) {
  return getLogChannelStmt.get(guildId, type)?.channelId;
}

function setLogChannel(guildId, type, channelId) {
  setLogChannelStmt.run(guildId, type, channelId);
}

module.exports = { getLogChannel, setLogChannel };
