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

module.exports = db;
