const db = require('./db');

const addStmt = db.prepare(`
  INSERT INTO ban_records (guild_id, user_id, username, banned_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET username = excluded.username, banned_at = excluded.banned_at
`);
const removeStmt = db.prepare('DELETE FROM ban_records WHERE guild_id = ? AND user_id = ?');
const getByIdStmt = db.prepare('SELECT user_id AS userId, username FROM ban_records WHERE guild_id = ? AND user_id = ?');
const getByUsernameStmt = db.prepare(
  'SELECT user_id AS userId, username FROM ban_records WHERE guild_id = ? AND LOWER(username) = LOWER(?)'
);
const searchStmt = db.prepare(`
  SELECT user_id AS userId, username FROM ban_records
  WHERE guild_id = ? AND (username LIKE ? OR user_id LIKE ?)
  ORDER BY banned_at DESC
  LIMIT ?
`);

function addBanRecord(guildId, userId, username) {
  addStmt.run(guildId, userId, username, Date.now());
}

function removeBanRecord(guildId, userId) {
  removeStmt.run(guildId, userId);
}

function findBanRecordById(guildId, userId) {
  return getByIdStmt.get(guildId, userId) ?? null;
}

function findBanRecordByUsername(guildId, username) {
  return getByUsernameStmt.get(guildId, username) ?? null;
}

function searchBanRecords(guildId, query, limit = 25) {
  const like = `%${query}%`;
  return searchStmt.all(guildId, like, like, limit);
}

module.exports = {
  addBanRecord,
  removeBanRecord,
  findBanRecordById,
  findBanRecordByUsername,
  searchBanRecords,
};
