const db = require('./db');

const ensureStmt = db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)');
const getStmt = db.prepare('SELECT member_role_id AS roleId FROM guild_settings WHERE guild_id = ?');
const setStmt = db.prepare('UPDATE guild_settings SET member_role_id = ? WHERE guild_id = ?');

const getStammgastStmt = db.prepare('SELECT stammgast_role_id AS roleId FROM guild_settings WHERE guild_id = ?');
const setStammgastStmt = db.prepare('UPDATE guild_settings SET stammgast_role_id = ? WHERE guild_id = ?');

function getMemberRoleId(guildId) {
  return getStmt.get(guildId)?.roleId ?? null;
}

function setMemberRole(guildId, roleId) {
  ensureStmt.run(guildId);
  setStmt.run(roleId, guildId);
}

function getStammgastRoleId(guildId) {
  return getStammgastStmt.get(guildId)?.roleId ?? null;
}

function setStammgastRole(guildId, roleId) {
  ensureStmt.run(guildId);
  setStammgastStmt.run(roleId, guildId);
}

module.exports = { getMemberRoleId, setMemberRole, getStammgastRoleId, setStammgastRole };
