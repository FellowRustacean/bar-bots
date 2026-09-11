const db = require('./db');

const getModeratorsStmt = db.prepare(`
  SELECT user_id AS userId
  FROM voice_moderators
  WHERE guild_id = ? AND owner_id = ?
`);

const isModeratorStmt = db.prepare(`
  SELECT 1
  FROM voice_moderators
  WHERE guild_id = ? AND owner_id = ? AND user_id = ?
`);

const addModeratorStmt = db.prepare(`
  INSERT OR IGNORE INTO voice_moderators (
    guild_id,
    owner_id,
    user_id
  )
  VALUES (?, ?, ?)
`);

const removeModeratorStmt = db.prepare(`
  DELETE FROM voice_moderators
  WHERE guild_id = ? AND owner_id = ? AND user_id = ?
`);

function getModerators(guildId, ownerId) {
  return getModeratorsStmt.all(guildId, ownerId);
}

function isModerator(guildId, ownerId, userId) {
  return Boolean(isModeratorStmt.get(guildId, ownerId, userId));
}

function addModerator(guildId, ownerId, userId) {
  addModeratorStmt.run(guildId, ownerId, userId);
}

function removeModerator(guildId, ownerId, userId) {
  removeModeratorStmt.run(guildId, ownerId, userId);
}

module.exports = {
  getModerators,
  isModerator,
  addModerator,
  removeModerator,
};
