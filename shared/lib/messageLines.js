const fs = require('fs');
const path = require('path');

const MESSAGES_DIR = path.join(__dirname, '..', 'data', 'messages');

// Liest die JSON-Datei bei JEDEM Aufruf frisch von der Platte (kein require()-Cache) - eine
// Aenderung an den Textbausteinen greift sofort im laufenden Bot, ohne dass er neu gestartet
// werden muss. Auf Nutzerwunsch: alle "Sets an Nachrichten, aus denen zufaellig gewaehlt wird"
// (Bestellbestaetigungen, /calm-Zeilen, Tisch-Abwisch-Sprueche usw.) leben jetzt hier statt als
// hartkodiertes Array im jeweiligen Modul.
function loadLineSet(botName, key) {
  const filePath = path.join(MESSAGES_DIR, `${botName}.json`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  const lines = data[key];
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error(`Keine Nachrichten fuer "${botName}.${key}" gefunden (${filePath})`);
  }
  return lines;
}

function pickRandomLine(botName, key) {
  const lines = loadLineSet(botName, key);
  return lines[Math.floor(Math.random() * lines.length)];
}

module.exports = { pickRandomLine, loadLineSet };
