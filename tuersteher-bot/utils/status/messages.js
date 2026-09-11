const fs = require('fs');
const path = require('path');

const STATUS_MESSAGES_PATH = path.join(__dirname, '..', '..', 'data', 'statusMessages.json');

// Bewusst kein require(...) der JSON-Datei - das würde von Node gecacht und Änderungen an der
// Datei blieben bis zum nächsten Bot-Neustart unsichtbar. Stattdessen bei jedem Aufruf frisch von
// der Platte lesen (siehe statusRotator.js, ruft das bei jedem Statuswechsel neu auf), damit sich
// die Status-Texte live per Datei-Edit pflegen lassen.
function getStatusMessages() {
  const raw = fs.readFileSync(STATUS_MESSAGES_PATH, 'utf8');
  return JSON.parse(raw);
}

module.exports = getStatusMessages;
