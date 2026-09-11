const db = require('./db');

const getStmt = db.prepare('SELECT active_llm_model AS model FROM guild_settings WHERE guild_id = ?');
const setStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, active_llm_model) VALUES (?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET active_llm_model = excluded.active_llm_model
`);

function getActiveLlmModel(guildId) {
  return getStmt.get(guildId)?.model ?? null;
}

function setActiveLlmModel(guildId, model) {
  setStmt.run(guildId, model);
}

module.exports = { getActiveLlmModel, setActiveLlmModel };
