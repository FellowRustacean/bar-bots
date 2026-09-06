const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { applySchema } = require('../../shared/lib/schema');

// Gemeinsame Datenbank für alle Bots (Barkeeper, Werwolf, Kellner, ...) - liegt bewusst
// außerhalb des einzelnen Bot-Ordners in einem gemeinsamen "shared"-Verzeichnis, das als
// Geschwister-Ordner neben allen Bot-Ordnern liegt (lokal wie auf dem Pi identisch aufgebaut).
const SHARED_DB_PATH = path.join(__dirname, '..', '..', 'shared', 'bot.db');
fs.mkdirSync(path.dirname(SHARED_DB_PATH), { recursive: true });

const db = new Database(SHARED_DB_PATH);
db.pragma('journal_mode = WAL');
// Mehrere Bot-Prozesse schreiben jetzt in dieselbe Datei - bei kurzzeitiger Sperre durch
// einen anderen Prozess lieber kurz warten als sofort mit "database is locked" zu scheitern.
db.pragma('busy_timeout = 5000');

applySchema(db);

// Einmalige Migration der alten JSON-Speicherdateien in die SQLite-Datenbank. Bewusst NICHT Teil
// des gemeinsamen Schemas (shared/lib/schema.js), da die JSON-Dateien im jeweils eigenen
// storage/-Ordner jedes Bots lagen (__dirname-abhängig, nicht bot-übergreifend austauschbar).
function migrateJsonFile(fileName, migrate) {
  const jsonPath = path.join(__dirname, fileName);
  if (!fs.existsSync(jsonPath)) return;

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  migrate(data);
  fs.renameSync(jsonPath, `${jsonPath}.migrated`);
}

migrateJsonFile('teamRoles.json', (data) => {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO team_roles (guild_id, tier, role_id) VALUES (?, ?, ?)'
  );
  for (const [guildId, tiers] of Object.entries(data)) {
    for (const [tier, roleId] of Object.entries(tiers)) {
      stmt.run(guildId, tier, roleId);
    }
  }
});

migrateJsonFile('guildConfig.json', (data) => {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO log_channels (guild_id, type, channel_id) VALUES (?, ?, ?)'
  );
  for (const [guildId, config] of Object.entries(data)) {
    for (const [type, channelId] of Object.entries(config.logChannels || {})) {
      stmt.run(guildId, type, channelId);
    }
  }
});

migrateJsonFile('tempbans.json', (data) => {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO tempbans (guild_id, user_id, unban_at) VALUES (?, ?, ?)'
  );
  for (const entry of data) {
    stmt.run(entry.guildId, entry.userId, entry.unbanAt);
  }
});

module.exports = db;
