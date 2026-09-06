const db = require('./db');

const addStmt = db.prepare('INSERT OR IGNORE INTO llm_allowed_roles (guild_id, role_id) VALUES (?, ?)');
const removeStmt = db.prepare('DELETE FROM llm_allowed_roles WHERE guild_id = ? AND role_id = ?');
const getStmt = db.prepare('SELECT role_id AS roleId FROM llm_allowed_roles WHERE guild_id = ?');

function addLlmRole(guildId, roleId) {
  addStmt.run(guildId, roleId);
}

function removeLlmRole(guildId, roleId) {
  removeStmt.run(guildId, roleId);
}

// Leere Liste heisst "keine Einschraenkung" (alle duerfen triggern) - siehe chatOrchestrator.js.
function getLlmRoleIds(guildId) {
  return getStmt.all(guildId).map((row) => row.roleId);
}

module.exports = { addLlmRole, removeLlmRole, getLlmRoleIds };
