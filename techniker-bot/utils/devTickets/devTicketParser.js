// Erkennt Überschriften der Form "# Description", "## Changelog", "### Comment" (beliebig viele
// "#", Groß-/Kleinschreibung egal, "Comment"/"Comments" werden auf denselben Typ gemappt). Alles
// zwischen einer solchen Überschrift und der nächsten gehört zu diesem Abschnitt - Text vor der
// ersten Überschrift einer Nachricht gehört zu keinem Abschnitt und wird ignoriert.
const HEADER_RE = /^#+\s*(description|changelog|comments?)\s*$/i;

function normalizeType(rawType) {
  const lower = rawType.toLowerCase();
  if (lower === 'description') return 'description';
  if (lower === 'changelog') return 'changelog';
  return 'comment';
}

// Zerlegt den Inhalt einer einzelnen Nachricht in ihre Abschnitte (eine Nachricht kann mehrere
// Überschriften enthalten). Gibt eine Liste von { type, text } zurück, in Reihenfolge des
// Vorkommens in der Nachricht.
function parseSections(content) {
  const lines = (content ?? '').split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    const match = HEADER_RE.exec(line.trim());
    if (match) {
      if (current) sections.push(current);
      current = { type: normalizeType(match[1]), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);

  return sections.map((section) => ({
    type: section.type,
    text: section.lines.join('\n').trim(),
  }));
}

module.exports = { parseSections };
