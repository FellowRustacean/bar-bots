const db = require('./db');

// Nur lesend - gesetzt wird das aktive Modell über /model set bei Techniker (dort liegt auch die
// Ollama-Verwaltung/-Anbindung), beide lesen/schreiben aber dieselbe guild_settings-Spalte in der
// gemeinsamen DB.
const getStmt = db.prepare('SELECT active_llm_model AS model FROM guild_settings WHERE guild_id = ?');

function getActiveLlmModel(guildId) {
  return getStmt.get(guildId)?.model ?? null;
}

module.exports = { getActiveLlmModel };
