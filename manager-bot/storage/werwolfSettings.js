const db = require('./db');

const getStmt = db.prepare('SELECT werwolf_category_id AS categoryId FROM guild_settings WHERE guild_id = ?');
const setStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, werwolf_category_id) VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET werwolf_category_id = excluded.werwolf_category_id
`);

function getWerwolfCategoryId(guildId) {
  return getStmt.get(guildId)?.categoryId ?? null;
}

function setWerwolfCategory(guildId, categoryId) {
  setStmt.run(guildId, categoryId);
}

module.exports = { getWerwolfCategoryId, setWerwolfCategory };
