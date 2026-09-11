// Fabrikfunktion statt fixem require('./db') - siehe botInteractions.js für die Begründung.
// Manager schreibt (/stammgast <user> silence:on|off), Türsteher liest (/silence prüft, ob das
// Recht entzogen wurde) - beide Bots nutzen dieselbe gemeinsame Tabelle.
function createStammgastSilenceStore(db) {
  const isRevokedStmt = db.prepare(
    'SELECT 1 FROM stammgast_silence_revoked WHERE guild_id = ? AND user_id = ?'
  );
  const revokeStmt = db.prepare(`
    INSERT INTO stammgast_silence_revoked (guild_id, user_id, revoked_at) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET revoked_at = excluded.revoked_at
  `);
  const restoreStmt = db.prepare(
    'DELETE FROM stammgast_silence_revoked WHERE guild_id = ? AND user_id = ?'
  );

  function isSilenceRevoked(guildId, userId) {
    return Boolean(isRevokedStmt.get(guildId, userId));
  }

  function revokeSilence(guildId, userId) {
    revokeStmt.run(guildId, userId, Date.now());
  }

  function restoreSilence(guildId, userId) {
    restoreStmt.run(guildId, userId);
  }

  return { isSilenceRevoked, revokeSilence, restoreSilence };
}

module.exports = createStammgastSilenceStore;
