const db = require('./db');

const getAllStmt = db.prepare(
  'SELECT guild_id AS guildId, user_id AS userId, unban_at AS unbanAt FROM tempbans'
);
const addStmt = db.prepare(`
  INSERT INTO tempbans (guild_id, user_id, unban_at) VALUES (?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET unban_at = excluded.unban_at
`);
const removeStmt = db.prepare('DELETE FROM tempbans WHERE guild_id = ? AND user_id = ?');

function getAll() {
  return getAllStmt.all();
}

function addTempban(guildId, userId, unbanAt) {
  addStmt.run(guildId, userId, unbanAt);
}

function removeTempban(guildId, userId) {
  removeStmt.run(guildId, userId);
}

module.exports = { getAll, addTempban, removeTempban };
