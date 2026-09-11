const db = require('./db');

const getBindingsStmt = db.prepare('SELECT tier, role_id AS roleId FROM team_roles WHERE guild_id = ?');
const setBindingStmt = db.prepare(`
  INSERT INTO team_roles (guild_id, tier, role_id) VALUES (?, ?, ?)
  ON CONFLICT(guild_id, tier) DO UPDATE SET role_id = excluded.role_id
`);

function getGuildBindings(guildId) {
  const bindings = {};
  for (const row of getBindingsStmt.all(guildId)) {
    bindings[row.tier] = row.roleId;
  }
  return bindings;
}

function setBinding(guildId, tier, roleId) {
  setBindingStmt.run(guildId, tier, roleId);
}

module.exports = { getGuildBindings, setBinding };
