const db = require('./db');

const addWarnStmt = db.prepare(`
  INSERT INTO warns (
    guild_id,
    user_id,
    moderator_id,
    warn_type,
    points,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?)
`);

const addUserPointsStmt = db.prepare(`
  INSERT INTO users (
    guild_id,
    user_id,
    warn_points
  )
  VALUES (?, ?, ?)
  ON CONFLICT(guild_id, user_id)
  DO UPDATE SET warn_points = warn_points + excluded.warn_points
`);

const getWarnsStmt = db.prepare(`
  SELECT
    id,
    guild_id AS guildId,
    user_id AS userId,
    moderator_id AS moderatorId,
    warn_type AS warnType,
    points,
    created_at AS createdAt
  FROM warns
  WHERE guild_id = ? AND user_id = ?
  ORDER BY created_at DESC
`);

const getUserPointsStmt = db.prepare(`
  SELECT warn_points AS points
  FROM users
  WHERE guild_id = ? AND user_id = ?
`);

const clearUserPointsStmt = db.prepare(`
  UPDATE users
  SET warn_points = 0
  WHERE guild_id = ? AND user_id = ?
`);

const getUsersWithPointsStmt = db.prepare(`
  SELECT
    guild_id AS guildId,
    user_id AS userId
  FROM users
  WHERE warn_points > 0
`);

const decayUserPointsStmt = db.prepare(`
  UPDATE users
  SET warn_points = MAX(0, warn_points - 1)
  WHERE guild_id = ?
    AND user_id = ?
`);

function addWarn(guildId, userId, moderatorId, warnType, points) {
  const transaction = db.transaction(() => {
    addWarnStmt.run(
      guildId,
      userId,
      moderatorId,
      warnType,
      points,
      Date.now()
    );

    addUserPointsStmt.run(
      guildId,
      userId,
      points
    );
  });

  transaction();
}

function getWarns(guildId, userId) {
  return getWarnsStmt.all(guildId, userId);
}

function getTotalPoints(guildId, userId) {
  const user = getUserPointsStmt.get(
    guildId,
    userId
  );

  return user?.points ?? 0;
}

function clearWarns(guildId, userId) {
  const transaction = db.transaction(() => {
    clearUserPointsStmt.run(guildId, userId);
  });

  transaction();
}

const getLastDecayDateStmt = db.prepare(
  'SELECT last_decay_date AS lastDecayDate FROM warn_decay_state WHERE id = 1'
);
const setLastDecayDateStmt = db.prepare(`
  INSERT INTO warn_decay_state (id, last_decay_date) VALUES (1, ?)
  ON CONFLICT(id) DO UPDATE SET last_decay_date = excluded.last_decay_date
`);

function getLastDecayDate() {
  return getLastDecayDateStmt.get()?.lastDecayDate ?? null;
}

function setLastDecayDate(dateString) {
  setLastDecayDateStmt.run(dateString);
}

function decayAllPoints() {
  const users = getUsersWithPointsStmt.all();

  const transaction = db.transaction(() => {
    for (const user of users) {
      decayUserPointsStmt.run(
        user.guildId,
        user.userId
      );
    }
  });

  transaction();
}

module.exports = {
  addWarn,
  getWarns,
  getTotalPoints,
  clearWarns,
  decayAllPoints,
  getLastDecayDate,
  setLastDecayDate,
};