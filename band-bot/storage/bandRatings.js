const db = require('./db');

const upsertRatingStmt = db.prepare(`
  INSERT INTO band_ratings (guild_id, user_id, track, rating) VALUES (?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id, track) DO UPDATE SET rating = excluded.rating
`);
const getUserRatingStmt = db.prepare(
  'SELECT rating FROM band_ratings WHERE guild_id = ? AND user_id = ? AND track = ?'
);
const getRatingsForTrackStmt = db.prepare(
  'SELECT user_id AS userId, rating FROM band_ratings WHERE guild_id = ? AND track = ?'
);

function setRating(guildId, userId, track, rating) {
  upsertRatingStmt.run(guildId, userId, track, rating);
}

function getUserRating(guildId, userId, track) {
  return getUserRatingStmt.get(guildId, userId, track)?.rating ?? null;
}

// Rohdaten statt fertigem Durchschnitt - der Aufrufer (Gewichtung fuer die Zufallswiedergabe,
// Anzeige im Player-Embed) filtert je nach Bedarf auf aktuell anwesende Nutzer.
function getRatingsForTrack(guildId, track) {
  return getRatingsForTrackStmt.all(guildId, track);
}

module.exports = { setRating, getUserRating, getRatingsForTrack };
