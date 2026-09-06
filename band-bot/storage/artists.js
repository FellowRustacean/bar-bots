const db = require('./db');

const insertStmt = db.prepare(
  'INSERT INTO artists (guild_id, user_id, name, folder_name, created_at) VALUES (?, ?, ?, ?, ?)'
);
const updateStmt = db.prepare('UPDATE artists SET name = ?, folder_name = ? WHERE guild_id = ? AND user_id = ?');
const setCreditUrlStmt = db.prepare('UPDATE artists SET credit_url = ? WHERE guild_id = ? AND user_id = ?');
const deleteStmt = db.prepare('DELETE FROM artists WHERE guild_id = ? AND user_id = ?');
const getByUserStmt = db.prepare('SELECT * FROM artists WHERE guild_id = ? AND user_id = ?');
const getByFolderStmt = db.prepare('SELECT * FROM artists WHERE guild_id = ? AND folder_name = ?');
const getAllStmt = db.prepare('SELECT * FROM artists WHERE guild_id = ? ORDER BY name');

function normalize(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    name: row.name,
    folderName: row.folder_name,
    creditUrl: row.credit_url,
  };
}

function addArtist(guildId, userId, name, folderName) {
  insertStmt.run(guildId, userId, name, folderName, Date.now());
}

function updateArtist(guildId, userId, name, folderName) {
  updateStmt.run(name, folderName, guildId, userId);
}

function removeArtist(guildId, userId) {
  deleteStmt.run(guildId, userId);
}

function setArtistCreditUrl(guildId, userId, url) {
  setCreditUrlStmt.run(url, guildId, userId);
}

function getArtistByUser(guildId, userId) {
  return normalize(getByUserStmt.get(guildId, userId));
}

// Fuer die Bot-Umbenennung beim Titelwechsel (siehe artistNickname.js) - track ist z.B.
// "Johnny & The Pimps/Digga.mp3", der oberste Ordnername ist der Schluessel hier.
function getArtistByFolder(guildId, folderName) {
  return normalize(getByFolderStmt.get(guildId, folderName));
}

function getAllArtists(guildId) {
  return getAllStmt.all(guildId).map(normalize);
}

module.exports = {
  addArtist,
  updateArtist,
  removeArtist,
  setArtistCreditUrl,
  getArtistByUser,
  getArtistByFolder,
  getAllArtists,
};
