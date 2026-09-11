// Gemeinsame Helfer fuer LoRA-Modell-Profile mit strukturiertem JSON-Eingabeformat (siehe
// lora/v2/prompts.py im PC-Repo, Case.user_prompt fmt="json" - character/chatverlauf/uhrzeit/
// datum/gäste). Wird von den einzelnen Modell-Dateien in diesem Ordner importiert - jede
// Modell-Datei bleibt sonst komplett eigenstaendig (eigener System-Prompt, eigener Parser,
// eigenes Ausgabeformat), damit sich neue LoRA-Iterationen unabhaengig voneinander aendern
// lassen, ohne gemeinsamen Code zu duplizieren.

const { getActiveMemberCount } = require('../../../storage/memberActivity');

// Gleiches Fenster wie ACTIVITY_WINDOW_MS in chatOrchestrator.js - eigene Konstante, damit
// dieser Ordner unabhaengig bleibt.
const ACTIVITY_WINDOW_MS = 30 * 60 * 1000;

const WEEKDAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

// Tageszeit-Bucket wie in den LoRA-Trainingsdaten (lora/v2/build_*.py auf dem PC) - grobe
// Stundenbereiche, konsistent mit den dort beobachteten Werten ("Abends", "Nachts",
// "Nachmittags").
function timeOfDayBucket(hour) {
  if (hour >= 6 && hour < 11) return 'Morgens';
  if (hour >= 11 && hour < 14) return 'Mittags';
  if (hour >= 14 && hour < 18) return 'Nachmittags';
  if (hour >= 18 && hour < 23) return 'Abends';
  return 'Nachts';
}

// Baut uhrzeit/datum/gaeste GENAU im Feld-Format, auf das die LoRA-Adapter trainiert wurden -
// strukturell anders als buildSituationalContext() in chatOrchestrator.js (dort EIN
// Fliesstext-Satz), deshalb eigene, unabhaengige Implementierung statt Wiederverwendung.
function buildLoraContext(guildId) {
  const now = new Date();
  const hour = now.getHours();
  const uhrzeit = `${String(hour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}, ${timeOfDayBucket(hour)}`;
  // Jahr -100 wie in buildSituationalContext (1920er-Setting), Monat als Name statt Zahl - siehe
  // Trainingsbeispiele ("Freitag, 8. Mai, 1926").
  const datum = `${WEEKDAY_NAMES[now.getDay()]}, ${now.getDate()}. ${MONTH_NAMES[now.getMonth()]}, ${now.getFullYear() - 100}`;
  const gaeste = getActiveMemberCount(guildId, Date.now() - ACTIVITY_WINDOW_MS);
  return { uhrzeit, datum, gaeste };
}

// Gemeinsamer User-Prompt-Aufbau fuer Modelle mit JSON-Eingabeformat. ctx kommt aus
// gatherPersonaPromptContext() in chatOrchestrator.js (phAuthor/phContent/phHistoryLines sind
// dort bereits platzhalter-aufgeloest). roundReplies wird als zusaetzliche Verlaufszeilen
// angehaengt (nicht als separater Block wie im Standardprofil) - entspricht damit direkter der
// Trainingsdatenform (multi_character-Faelle hatten vorherige Charakterantworten als normale
// chatverlauf-Zeilen).
function buildLoraJsonUserPrompt(ctx, persona, roundReplies, guildId) {
  const { uhrzeit, datum, gaeste } = buildLoraContext(guildId);
  const roundLines = (roundReplies || []).map((r) => `${r.displayName}: ${r.text}`);
  const chatverlauf = [...ctx.phHistoryLines, ...roundLines, `${ctx.phAuthor}: ${ctx.phContent}`];
  return JSON.stringify({
    character: persona.displayName,
    chatverlauf,
    uhrzeit,
    datum,
    gäste: gaeste,
  });
}

module.exports = { buildLoraContext, buildLoraJsonUserPrompt };
