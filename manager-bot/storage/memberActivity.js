const db = require('./db');

const touchStmt = db.prepare(`
  INSERT INTO member_activity (guild_id, user_id, last_active_at) VALUES (?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET last_active_at = excluded.last_active_at
`);
const getStmt = db.prepare('SELECT last_active_at AS lastActiveAt FROM member_activity WHERE guild_id = ? AND user_id = ?');
const getStaleStmt = db.prepare(
  'SELECT user_id AS userId, last_active_at AS lastActiveAt FROM member_activity WHERE guild_id = ? AND last_active_at < ?'
);
const getActiveCountStmt = db.prepare(
  'SELECT COUNT(*) AS count FROM member_activity WHERE guild_id = ? AND last_active_at >= ?'
);

function touchActivity(guildId, userId, timestamp = Date.now()) {
  touchStmt.run(guildId, userId, timestamp);
}

function getLastActive(guildId, userId) {
  return getStmt.get(guildId, userId)?.lastActiveAt ?? null;
}

// Nutzer mit bekannter, aber seit "beforeMs" nicht mehr aufgefrischter Aktivität. Nutzer ganz
// ohne Eintrag (noch nie erfasst) tauchen bewusst NICHT auf - fehlende Daten sind kein Beleg
// für Inaktivität.
function getStaleMembers(guildId, beforeMs) {
  return getStaleStmt.all(guildId, beforeMs);
}

// Anzahl Mitglieder mit Aktivitaet seit "sinceMs" - Proxy fuer "gerade praesente Gaeste" im
// LLM-Situationskontext (siehe chatOrchestrator.js), da echte Discord-Online-Praesenz einen
// privilegierten Intent (GuildPresences) braeuchte, den der Bot nicht hat.
function getActiveMemberCount(guildId, sinceMs) {
  return getActiveCountStmt.get(guildId, sinceMs).count;
}

module.exports = { touchActivity, getLastActive, getStaleMembers, getActiveMemberCount };
