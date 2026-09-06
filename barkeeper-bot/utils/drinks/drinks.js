const fs = require('fs');
const path = require('path');

// Liegt in shared/data statt im eigenen data-Ordner, seit Manager (chatOrchestrator.js /
// drinkOrderDetector.js) dieselbe Liste fuer die LLM-Bestellerkennung braucht - beide Bots lesen
// dieselbe Datei, keine Duplizierung/Drift zwischen zwei Getraenkelisten.
const DRINKS_PATH = path.join(__dirname, '..', '..', '..', 'shared', 'data', 'drinks.json');

// Bewusst kein require(...) der JSON-Datei - das würde von Node gecacht und Änderungen an der
// Datei blieben bis zum nächsten Bot-Neustart unsichtbar. Stattdessen bei jedem Aufruf frisch von
// der Platte lesen, damit die Getränkeliste sich live per Datei-Edit pflegen lässt.
function getDrinks() {
  const raw = fs.readFileSync(DRINKS_PATH, 'utf8');
  return JSON.parse(raw);
}

module.exports = { getDrinks };
