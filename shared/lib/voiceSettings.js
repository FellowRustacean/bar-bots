// Fabrikfunktion statt fixem require('./db') - siehe botInteractions.js für die Begründung.
// Ursprünglich nur in Kellner (Tisch-Erkennung für /interaction), jetzt auch von Barkeeper
// genutzt (/snack prüft, ob der Bestellende an einem Tisch sitzt) - deshalb hierher verschoben,
// statt die Lese-Logik in beiden Bot-Ordnern zu duplizieren.
function createVoiceSettingsStore(db) {
  const getStmt = db.prepare(`
    SELECT
      voice_channel_id AS voiceChannelId,
      voice_category_id AS voiceCategoryId
    FROM guild_settings
    WHERE guild_id = ?
  `);
  const setChannelStmt = db.prepare(`
    INSERT INTO guild_settings (guild_id, voice_channel_id)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET voice_channel_id = excluded.voice_channel_id
  `);
  const setCategoryStmt = db.prepare(`
    INSERT INTO guild_settings (guild_id, voice_category_id)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET voice_category_id = excluded.voice_category_id
  `);

  function getVoiceSettings(guildId) {
    return getStmt.get(guildId);
  }

  function setVoiceChannel(guildId, channelId) {
    setChannelStmt.run(guildId, channelId);
  }

  function setVoiceCategory(guildId, categoryId) {
    setCategoryStmt.run(guildId, categoryId);
  }

  // Ein "Tisch" ist ein Voice-Channel in der konfigurierten Kategorie, der nicht der
  // Erstellungs-Channel selbst ist (siehe kellner bot/utils/customVoice/customVoice.js) - dieselbe
  // Bedingung wie in tableWiping.js's findAllTables(), hier als gemeinsamer Baustein für alles,
  // was für EINEN bestimmten Channel prüfen muss "ist das gerade ein Tisch?".
  function isTableChannel(channel, guildId) {
    if (!channel) return false;
    const settings = getVoiceSettings(guildId);
    if (!settings?.voiceCategoryId) return false;
    return channel.parentId === settings.voiceCategoryId && channel.id !== settings.voiceChannelId;
  }

  return { getVoiceSettings, setVoiceChannel, setVoiceCategory, isTableChannel };
}

module.exports = createVoiceSettingsStore;
