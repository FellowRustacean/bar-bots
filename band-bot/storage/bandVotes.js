const db = require('./db');

const upsertVoteStmt = db.prepare(`
  INSERT INTO band_votes (guild_id, user_id, genre) VALUES (?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET genre = excluded.genre
`);
const removeVoteStmt = db.prepare('DELETE FROM band_votes WHERE guild_id = ? AND user_id = ?');
const getVoteCountsStmt = db.prepare(
  'SELECT genre, COUNT(*) AS count FROM band_votes WHERE guild_id = ? GROUP BY genre'
);
const getVotedUserIdsStmt = db.prepare('SELECT user_id AS userId FROM band_votes WHERE guild_id = ?');
const clearAllVotesStmt = db.prepare('DELETE FROM band_votes WHERE guild_id = ?');

function setVote(guildId, userId, genre) {
  upsertVoteStmt.run(guildId, userId, genre);
}

function removeVote(guildId, userId) {
  removeVoteStmt.run(guildId, userId);
}

function getVoteCounts(guildId) {
  return getVoteCountsStmt.all(guildId);
}

function getVotedUserIds(guildId) {
  return getVotedUserIdsStmt.all(guildId).map((row) => row.userId);
}

// Fuer /refresh: Stimmen fuer Genres, die es als Ordner nicht mehr gibt, sind ungueltig - werden
// hier verworfen, statt fuer immer als Karteileiche stehen zu bleiben.
function clearVotesForGenresNotIn(guildId, validGenres) {
  if (validGenres.length === 0) {
    clearAllVotesStmt.run(guildId);
    return;
  }
  const placeholders = validGenres.map(() => '?').join(',');
  db.prepare(`DELETE FROM band_votes WHERE guild_id = ? AND genre NOT IN (${placeholders})`).run(
    guildId,
    ...validGenres
  );
}

// Fuer die periodische Abgleich-Selbstheilung: entfernt Stimmen von Nutzern, die (mehr) nicht im
// gegebenen Set aktuell anwesender User-IDs sind - faengt verpasste voiceStateUpdate-Events ab
// (z. B. durch einen Bot-Neustart mitten in einer Sitzung).
function removeVotesNotIn(guildId, presentUserIds) {
  const votedUserIds = getVotedUserIds(guildId);
  const presentSet = new Set(presentUserIds);
  for (const userId of votedUserIds) {
    if (!presentSet.has(userId)) removeVoteStmt.run(guildId, userId);
  }
}

module.exports = {
  setVote,
  removeVote,
  getVoteCounts,
  getVotedUserIds,
  clearVotesForGenresNotIn,
  removeVotesNotIn,
};
