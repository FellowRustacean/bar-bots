const db = require('./db');

// Gleiche Tabelle (guild_settings) wie in manager bot/storage/roleSettings.js - die Member-Rolle
// wird dort per /config gesetzt, hier nur lesend gebraucht (siehe voicePrivacy.js).
const getStmt = db.prepare('SELECT member_role_id AS roleId FROM guild_settings WHERE guild_id = ?');

function getMemberRoleId(guildId) {
  return getStmt.get(guildId)?.roleId ?? null;
}

module.exports = { getMemberRoleId };
