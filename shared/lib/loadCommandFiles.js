const fs = require('fs');
const path = require('path');

// Fehlt das Verzeichnis (z. B. ein Bot ganz ohne eigene Commands, dessen leerer commands/-Ordner
// von git nicht mitversioniert wird und nach einem frischen Checkout/Deploy fehlt), gibt es
// einfach keine Befehle zurück statt mit ENOENT abzustürzen.
function loadCommandFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...loadCommandFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }
  return files;
}

module.exports = { loadCommandFiles };
