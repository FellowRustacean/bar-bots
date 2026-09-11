const fs = require('fs');
const path = require('path');

const SNACKS_PATH = path.join(__dirname, '..', '..', 'data', 'snacks.json');

// Bewusst kein require(...) der JSON-Datei - siehe utils/drinks/drinks.js für die Begründung
// (sonst würde Node sie cachen und Datei-Änderungen blieben bis zum nächsten Neustart unsichtbar).
function getSnacks() {
  const raw = fs.readFileSync(SNACKS_PATH, 'utf8');
  return JSON.parse(raw);
}

module.exports = { getSnacks };
