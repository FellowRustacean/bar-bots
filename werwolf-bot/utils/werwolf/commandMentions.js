// Discords klickbare Slash-Command-Erwähnungen (`</command:id>`). Die ID ist die
// Application-Command-ID von `/werwolf` (bleibt bei erneutem Deploy stabil, solange der
// Befehl nicht gelöscht und neu erstellt wird).
const WERWOLF_COMMAND_ID = '1540518139610267678';

const MENTION_JOIN = `</werwolf join:${WERWOLF_COMMAND_ID}>`;
const MENTION_ME = `</werwolf me:${WERWOLF_COMMAND_ID}>`;
const MENTION_AUSWAHL = `</werwolf auswahl:${WERWOLF_COMMAND_ID}>`;
const MENTION_NEXT = `</werwolf next:${WERWOLF_COMMAND_ID}>`;

module.exports = { MENTION_JOIN, MENTION_ME, MENTION_AUSWAHL, MENTION_NEXT };
