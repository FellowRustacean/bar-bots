const db = require('./db');

const addSkipVoteStmt = db.prepare(
  'INSERT OR IGNORE INTO band_skip_votes (guild_id, user_id) VALUES (?, ?)'
);
const removeSkipVoteStmt = db.prepare('DELETE FROM band_skip_votes WHERE guild_id = ? AND user_id = ?');
const hasSkipVoteStmt = db.prepare(
  'SELECT 1 FROM band_skip_votes WHERE guild_id = ? AND user_id = ? LIMIT 1'
);
const getSkipVoteCountStmt = db.prepare('SELECT COUNT(*) AS count FROM band_skip_votes WHERE guild_id = ?');
const getSkipVoterIdsStmt = db.prepare('SELECT user_id AS userId FROM band_skip_votes WHERE guild_id = ?');
const clearSkipVotesStmt = db.prepare('DELETE FROM band_skip_votes WHERE guild_id = ?');

function addSkipVote(guildId, userId) {
  addSkipVoteStmt.run(guildId, userId);
}

function removeSkipVote(guildId, userId) {
  removeSkipVoteStmt.run(guildId, userId);
}

function hasSkipVote(guildId, userId) {
  return Boolean(hasSkipVoteStmt.get(guildId, userId));
}

function getSkipVoteCount(guildId) {
  return getSkipVoteCountStmt.get(guildId).count;
}

// Fuer den Selbstheil-Abgleich: Skip-Stimmen von Nutzern entfernen, die (mehr) nicht im
// gegebenen Set aktuell anwesender User-IDs sind.
function removeSkipVotesNotIn(guildId, presentUserIds) {
  const voterIds = getSkipVoterIdsStmt.all(guildId).map((row) => row.userId);
  const presentSet = new Set(presentUserIds);
  for (const userId of voterIds) {
    if (!presentSet.has(userId)) removeSkipVoteStmt.run(guildId, userId);
  }
}

// Wird bei jedem Titelwechsel aufgerufen (siehe bandPlayer.js onTrackChange) - die Skip-
// Abstimmung gilt immer nur fuer den GERADE laufenden Titel.
function clearSkipVotes(guildId) {
  clearSkipVotesStmt.run(guildId);
}

module.exports = {
  addSkipVote,
  removeSkipVote,
  hasSkipVote,
  getSkipVoteCount,
  removeSkipVotesNotIn,
  clearSkipVotes,
};
