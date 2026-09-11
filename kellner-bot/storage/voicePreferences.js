const db = require('./db');

const getPreferencesStmt = db.prepare(`
  SELECT
    remembered,
    user_limit AS userLimit,
    locked,
    is_private AS isPrivate
  FROM voice_preferences
  WHERE guild_id = ? AND user_id = ?
`);

const ensurePreferencesStmt = db.prepare(`
  INSERT OR IGNORE INTO voice_preferences (
    guild_id,
    user_id
  )
  VALUES (?, ?)
`);

const setRememberedStmt = db.prepare(`
  INSERT INTO voice_preferences (
    guild_id,
    user_id,
    remembered
  )
  VALUES (?, ?, ?)
  ON CONFLICT(guild_id, user_id)
  DO UPDATE SET remembered = excluded.remembered
`);

const setUserLimitStmt = db.prepare(`
  INSERT INTO voice_preferences (
    guild_id,
    user_id,
    user_limit
  )
  VALUES (?, ?, ?)
  ON CONFLICT(guild_id, user_id)
  DO UPDATE SET user_limit = excluded.user_limit
`);

const setLockedStmt = db.prepare(`
  INSERT INTO voice_preferences (
    guild_id,
    user_id,
    locked
  )
  VALUES (?, ?, ?)
  ON CONFLICT(guild_id, user_id)
  DO UPDATE SET locked = excluded.locked
`);

const getBansStmt = db.prepare(`
  SELECT user_id AS userId
  FROM voice_bans
  WHERE guild_id = ? AND owner_id = ?
`);

const addBanStmt = db.prepare(`
  INSERT OR IGNORE INTO voice_bans (
    guild_id,
    owner_id,
    user_id
  )
  VALUES (?, ?, ?)
`);

const removeBanStmt = db.prepare(`
  DELETE FROM voice_bans
  WHERE guild_id = ? AND owner_id = ? AND user_id = ?
`);

const setPrivateStmt = db.prepare(`
  INSERT INTO voice_preferences (
    guild_id,
    user_id,
    is_private
  )
  VALUES (?, ?, ?)
  ON CONFLICT(guild_id, user_id)
  DO UPDATE SET is_private = excluded.is_private
`);

const getInvitesStmt = db.prepare(`
  SELECT user_id AS userId
  FROM voice_invites
  WHERE guild_id = ? AND owner_id = ?
`);

const addInviteStmt = db.prepare(`
  INSERT OR IGNORE INTO voice_invites (
    guild_id,
    owner_id,
    user_id
  )
  VALUES (?, ?, ?)
`);

const removeInviteStmt = db.prepare(`
  DELETE FROM voice_invites
  WHERE guild_id = ? AND owner_id = ? AND user_id = ?
`);

function ensurePreferences(guildId, userId) {
  ensurePreferencesStmt.run(guildId, userId);
}

function getPreferences(guildId, userId) {
  return getPreferencesStmt.get(guildId, userId);
}

function setRemembered(guildId, userId, remembered) {
  setRememberedStmt.run(guildId, userId, remembered ? 1 : 0);
}

function setUserLimit(guildId, userId, userLimit) {
  setUserLimitStmt.run(guildId, userId, userLimit);
}

function setLocked(guildId, userId, locked) {
  setLockedStmt.run(guildId, userId, locked ? 1 : 0);
}

function setPrivate(guildId, userId, isPrivate) {
  setPrivateStmt.run(guildId, userId, isPrivate ? 1 : 0);
}

function getBans(guildId, ownerId) {
  return getBansStmt.all(guildId, ownerId);
}

function addBan(guildId, ownerId, userId) {
  addBanStmt.run(guildId, ownerId, userId);
}

function removeBan(guildId, ownerId, userId) {
  removeBanStmt.run(guildId, ownerId, userId);
}

function getInvites(guildId, ownerId) {
  return getInvitesStmt.all(guildId, ownerId);
}

function addInvite(guildId, ownerId, userId) {
  addInviteStmt.run(guildId, ownerId, userId);
}

function removeInvite(guildId, ownerId, userId) {
  removeInviteStmt.run(guildId, ownerId, userId);
}

module.exports = {
  ensurePreferences,
  getPreferences,
  setRemembered,
  setUserLimit,
  setLocked,
  setPrivate,
  getBans,
  addBan,
  removeBan,
  getInvites,
  addInvite,
  removeInvite,
};