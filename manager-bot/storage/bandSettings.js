const db = require('./db');

const getStmt = db.prepare('SELECT band_voice_channel_id AS channelId FROM guild_settings WHERE guild_id = ?');
const setStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, band_voice_channel_id) VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET band_voice_channel_id = excluded.band_voice_channel_id
`);

function getBandVoiceChannelId(guildId) {
  return getStmt.get(guildId)?.channelId ?? null;
}

function setBandVoiceChannel(guildId, channelId) {
  setStmt.run(guildId, channelId);
}

module.exports = { getBandVoiceChannelId, setBandVoiceChannel };
