// Fabrikfunktion statt fixem require('./db') - siehe botInteractions.js für die Begründung.
// Manager schreibt (/config channel <option> <channel> <on|off>), andere Bots lesen (z. B.
// Barkeeper für XP/Message-Log, Türsteher für Automod) - alle über dieselbe gemeinsame Tabelle.
function createChannelFlagsStore(db) {
  const setStmt = db.prepare(`
    INSERT INTO channel_flags (guild_id, channel_id, flag_key, set_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, channel_id, flag_key) DO NOTHING
  `);
  const clearStmt = db.prepare(
    'DELETE FROM channel_flags WHERE guild_id = ? AND channel_id = ? AND flag_key = ?'
  );
  const hasFlagStmt = db.prepare(
    'SELECT 1 FROM channel_flags WHERE guild_id = ? AND channel_id = ? AND flag_key = ?'
  );
  const channelsWithFlagStmt = db.prepare(
    'SELECT channel_id AS channelId FROM channel_flags WHERE guild_id = ? AND flag_key = ?'
  );

  function setFlag(guildId, channelId, flagKey, enabled) {
    if (enabled) {
      setStmt.run(guildId, channelId, flagKey, Date.now());
    } else {
      clearStmt.run(guildId, channelId, flagKey);
    }
  }

  function hasFlag(guildId, channelId, flagKey) {
    return Boolean(hasFlagStmt.get(guildId, channelId, flagKey));
  }

  function getChannelsWithFlag(guildId, flagKey) {
    return channelsWithFlagStmt.all(guildId, flagKey).map((row) => row.channelId);
  }

  return { setFlag, hasFlag, getChannelsWithFlag };
}

module.exports = createChannelFlagsStore;
