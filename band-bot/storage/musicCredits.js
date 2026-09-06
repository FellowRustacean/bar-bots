const db = require('./db');

const getStmt = db.prepare(
  'SELECT filename, genre, title, credit_name AS creditName, credit_url AS creditUrl, license FROM music_credits WHERE filename = ?'
);
const upsertStmt = db.prepare(`
  INSERT INTO music_credits (filename, genre, title, credit_name, credit_url, license)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(filename) DO UPDATE SET
    genre = excluded.genre,
    title = excluded.title,
    credit_name = excluded.credit_name,
    credit_url = excluded.credit_url,
    license = excluded.license
`);

// filename ist der Pfad relativ zu shared/music, z. B. "funk/Aces High.mp3" - genau das, was
// bandPlayer.js intern als Track-Bezeichner verwendet (siehe getCurrentTrack()).
function getCredit(filename) {
  return getStmt.get(filename) ?? null;
}

function upsertCredit(filename, genre, title, creditName, creditUrl, license) {
  upsertStmt.run(filename, genre, title, creditName, creditUrl, license);
}

module.exports = { getCredit, upsertCredit };
