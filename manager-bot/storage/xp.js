const db = require('./db');

const DAILY_CAP = 1_000;

const ensureStmt = db.prepare('INSERT OR IGNORE INTO xp (guild_id, user_id) VALUES (?, ?)');
const getStmt = db.prepare('SELECT * FROM xp WHERE guild_id = ? AND user_id = ?');

// Nachrichten- und Voice-XP werden getrennt in message_xp/voice_xp geführt; für Level,
// Rang und Leaderboard wird überall die Summe (message_xp + voice_xp + bonus_xp) verwendet.
const updateMessageStmt = db.prepare(`
  UPDATE xp
  SET message_xp = ?, daily_xp = ?, daily_date = ?, monthly_xp = ?, monthly_month = ?
  WHERE guild_id = ? AND user_id = ?
`);
const updateVoiceStmt = db.prepare(`
  UPDATE xp
  SET voice_xp = ?, daily_xp = ?, daily_date = ?, monthly_xp = ?, monthly_month = ?
  WHERE guild_id = ? AND user_id = ?
`);
const setBonusStmt = db.prepare('UPDATE xp SET bonus_xp = ? WHERE guild_id = ? AND user_id = ?');

const TOTAL_XP_EXPR = '(message_xp + voice_xp + bonus_xp)';

const getRankStmt = db.prepare(`
  SELECT COUNT(*) + 1 AS rank FROM xp
  WHERE guild_id = ? AND ${TOTAL_XP_EXPR} > (
    SELECT ${TOTAL_XP_EXPR} FROM xp WHERE guild_id = ? AND user_id = ?
  )
`);
const getRankedUserCountStmt = db.prepare('SELECT COUNT(*) AS count FROM xp WHERE guild_id = ?');

const getTotalLeaderboardStmt = db.prepare(
  `SELECT user_id AS userId, ${TOTAL_XP_EXPR} AS xp FROM xp WHERE guild_id = ? ORDER BY xp DESC LIMIT 10`
);
const getMonthlyLeaderboardStmt = db.prepare(`
  SELECT user_id AS userId, CASE WHEN monthly_month = ? THEN monthly_xp ELSE 0 END AS xp
  FROM xp WHERE guild_id = ?
  ORDER BY xp DESC LIMIT 10
`);
const getUsersAtOrAboveXpStmt = db.prepare(
  `SELECT user_id AS userId FROM xp WHERE guild_id = ? AND ${TOTAL_XP_EXPR} >= ?`
);

function today() {
  return new Date().toISOString().slice(0, 10);
}

function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

// Gibt die Zeile inkl. berechneter Gesamt-XP zurück (message_xp + voice_xp + bonus_xp).
function getXpRow(guildId, userId) {
  const row = getStmt.get(guildId, userId);
  if (!row) return row;
  return { ...row, total_xp: row.message_xp + row.voice_xp + row.bonus_xp };
}

// Setzt daily/monthly Zähler zurück, falls ein neuer Tag/Monat begonnen hat.
function normalizeRow(row) {
  const date = today();
  const month = thisMonth();
  return {
    ...row,
    daily_xp: row.daily_date === date ? row.daily_xp : 0,
    daily_date: date,
    monthly_xp: row.monthly_month === month ? row.monthly_xp : 0,
    monthly_month: month,
  };
}

// Fügt XP aus einer bestimmten Quelle hinzu (source: 'message' | 'voice'), begrenzt durch
// das gemeinsame Tageslimit. Gibt {gained, totalXp} zurück.
function addXp(guildId, userId, amount, source) {
  ensureStmt.run(guildId, userId);
  const row = normalizeRow(getStmt.get(guildId, userId));

  const gainable = Math.max(0, Math.min(amount, DAILY_CAP - row.daily_xp));
  const newDaily = row.daily_xp + gainable;
  const newMonthly = row.monthly_xp + gainable;

  if (source === 'voice') {
    const newVoice = row.voice_xp + gainable;
    updateVoiceStmt.run(newVoice, newDaily, row.daily_date, newMonthly, row.monthly_month, guildId, userId);
  } else {
    const newMessage = row.message_xp + gainable;
    updateMessageStmt.run(newMessage, newDaily, row.daily_date, newMonthly, row.monthly_month, guildId, userId);
  }

  const updated = getStmt.get(guildId, userId);
  return { gained: gainable, totalXp: updated.message_xp + updated.voice_xp + updated.bonus_xp };
}

// Admin-Anpassung: verändert nur bonus_xp (nie message_xp/voice_xp), ohne Tages-/Monatszähler
// zu berühren. Die Gesamt-XP wird dabei nie unter 0 gedrückt.
function adjustTotalXp(guildId, userId, delta) {
  ensureStmt.run(guildId, userId);
  const row = getStmt.get(guildId, userId);
  const earned = row.message_xp + row.voice_xp;
  const newBonus = Math.max(-earned, row.bonus_xp + delta);
  setBonusStmt.run(newBonus, guildId, userId);
  return earned + newBonus;
}

function setTotalXp(guildId, userId, value) {
  ensureStmt.run(guildId, userId);
  const row = getStmt.get(guildId, userId);
  const earned = row.message_xp + row.voice_xp;
  const target = Math.max(0, value);
  const newBonus = target - earned;
  setBonusStmt.run(newBonus, guildId, userId);
  return target;
}

function getRank(guildId, userId) {
  return getRankStmt.get(guildId, guildId, userId).rank;
}

function getRankedUserCount(guildId) {
  return getRankedUserCountStmt.get(guildId).count;
}

function getLeaderboard(guildId, type) {
  if (type === 'total') return getTotalLeaderboardStmt.all(guildId);
  return getMonthlyLeaderboardStmt.all(thisMonth(), guildId);
}

function getUserIdsAtOrAboveXp(guildId, threshold) {
  return getUsersAtOrAboveXpStmt.all(guildId, threshold).map((row) => row.userId);
}

// Wie viel XP der Nutzer heute noch sammeln kann, bevor das Tageslimit (DAILY_CAP) greift. Der
// gespeicherte daily_xp-Wert wird dabei wie in addXp() erst auf "gilt das noch für heute?"
// geprüft (daily_date), statt ihn ungeprüft zu übernehmen - sonst würde ein Wert vom Vortag
// fälschlich als "heute schon verbraucht" gelten, bis der Nutzer selbst wieder aktiv wird.
function getRemainingDailyXp(guildId, userId) {
  const row = getStmt.get(guildId, userId);
  if (!row || row.daily_date !== today()) return DAILY_CAP;
  return Math.max(0, DAILY_CAP - row.daily_xp);
}

module.exports = {
  DAILY_CAP,
  getXpRow,
  addXp,
  adjustTotalXp,
  setTotalXp,
  getRank,
  getRankedUserCount,
  getLeaderboard,
  getUserIdsAtOrAboveXp,
  getRemainingDailyXp,
};
