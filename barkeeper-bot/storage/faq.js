const db = require('./db');

const addStmt = db.prepare(`
  INSERT INTO faq (guild_id, question, answer, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
`);

const getStmt = db.prepare(`
  SELECT id, question, answer
  FROM faq
  WHERE id = ? AND guild_id = ?
`);

const getAllStmt = db.prepare(`
  SELECT id, question, answer
  FROM faq
  WHERE guild_id = ?
  ORDER BY question COLLATE NOCASE ASC
`);

const updateStmt = db.prepare(`
  UPDATE faq
  SET question = ?, answer = ?, updated_at = ?
  WHERE id = ? AND guild_id = ?
`);

const removeStmt = db.prepare(`
  DELETE FROM faq
  WHERE id = ? AND guild_id = ?
`);

function addFaq(guildId, question, answer) {
  const now = Date.now();
  const result = addStmt.run(guildId, question, answer, now, now);
  return result.lastInsertRowid;
}

function getFaq(id, guildId) {
  return getStmt.get(id, guildId) ?? null;
}

function getAllFaqs(guildId) {
  return getAllStmt.all(guildId);
}

function updateFaq(id, guildId, question, answer) {
  const result = updateStmt.run(question, answer, Date.now(), id, guildId);
  return result.changes > 0;
}

function removeFaq(id, guildId) {
  const result = removeStmt.run(id, guildId);
  return result.changes > 0;
}

module.exports = {
  addFaq,
  getFaq,
  getAllFaqs,
  updateFaq,
  removeFaq,
};
