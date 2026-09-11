const db = require('./db');

const getVoiceSettingsStmt = db.prepare(`
  SELECT
    voice_channel_id AS voiceChannelId,
    voice_category_id AS voiceCategoryId
  FROM guild_settings
  WHERE guild_id = ?
`);

const setVoiceChannelStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, voice_channel_id)
  VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET voice_channel_id = excluded.voice_channel_id
`);

const setVoiceCategoryStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, voice_category_id)
  VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET voice_category_id = excluded.voice_category_id
`);

function getVoiceSettings(guildId) {
  return getVoiceSettingsStmt.get(guildId);
}

function setVoiceChannel(guildId, channelId) {
  setVoiceChannelStmt.run(guildId, channelId);
}

function setVoiceCategory(guildId, categoryId) {
  setVoiceCategoryStmt.run(guildId, categoryId);
}

module.exports = {
  getVoiceSettings,
  setVoiceChannel,
  setVoiceCategory,
};