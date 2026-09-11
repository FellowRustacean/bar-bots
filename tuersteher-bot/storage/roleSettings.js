const db = require('./db');

const getStammgastStmt = db.prepare('SELECT stammgast_role_id AS roleId FROM guild_settings WHERE guild_id = ?');

function getStammgastRoleId(guildId) {
  return getStammgastStmt.get(guildId)?.roleId ?? null;
}

module.exports = { getStammgastRoleId };
