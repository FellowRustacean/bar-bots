const { chatWithTarget, resolveTarget, DEFAULT_MODEL, getCachedSystemBaseline, measureAndCacheSystemBaseline } = require('./ollamaClient');
const { LLM_PERSONAS, findLlmPersonaByDisplayName } = require('./personas');
const { MODEL_PROMPT_PROFILES } = require('./modelPrompts');
const { getActiveLlmModel } = require('../../storage/llmSettings');
const { enqueueOutboxMessage } = require('../../storage/outbox');
const { hasFlag } = require('../../storage/channelFlags');
const { logLlmCall, logLlmClassification } = require('../logs/llmLog');
const { getActiveMemberCount } = require('../../storage/memberActivity');
const { getLlmRoleIds } = require('../../storage/llmRoles');
const { getBartresenChannelId } = require('../../storage/barSettings');
const fs = require('fs');
const path = require('path');

const CHECK_LLM_FLAG = 'check-llm';
// Auf 5 reduziert (vorher 10) - Tests auf dem Pi zeigten, dass das 3B-Modell bei 10 Verlaufszeilen
// dazu neigte, sich an einem Stil-Beispiel festzubeissen und es woertlich zu wiederholen statt auf
// die eigentliche Frage einzugehen. Weniger Verlauf war bei gleichen Testfaellen zuverlaessiger
// UND kuerzer/schneller.
const HISTORY_LENGTH = 5;
// Harter Deckel NUR fuer den User-Prompt (Verlauf+Trigger+Geruest), NICHT das System-Prompt - auf
// Nutzerwunsch, um die pro Anfrage garantiert neu zu prefillende Tokenmenge auf dem Pi zu begrenzen
// (siehe buildUserPrompt).
const USER_PROMPT_MAX_TOKENS = 160;
const COOLDOWN_MS = 5000;
const MAX_QUEUE_SIZE = 3;
const NONE_MODEL = 'none';
const TOKEN_BUDGET = 4096;
// Fenster fuer "gerade aktive Gaeste" im Situationskontext (siehe buildSituationalContext) -
// nutzt die ohnehin schon gepflegte member_activity-Tabelle (siehe activityTracker.js) als Proxy
// fuer echte Discord-Praesenz, da der Bot keinen GuildPresences-Intent hat.
const ACTIVITY_WINDOW_MS = 30 * 60 * 1000;
const WEEKDAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
// Gleiche Datei wie utils/drinks/drinks.js im Barkeeper-Bot (liegt in shared/data).
const DRINKS_PATH = path.join(__dirname, '..', '..', '..', 'shared', 'data', 'drinks.json');

function getDrinkNames() {
  const raw = fs.readFileSync(DRINKS_PATH, 'utf8');
  return Object.keys(JSON.parse(raw));
}

// Strukturierte Attribut-Notation (person/stil/hobbys/beziehung) statt ausformulierter Prosa - nach
// A/B-Testreihe (lokal, Qwen2.5:7b, ~100 Testfaelle/Variante, siehe scratchpad/prompt_compress)
// ersetzt: spart ~45% System-Prompt-Tokens gegenueber der alten Prosa-Version bei GLEICHER oder
// besserer gemessener Zuverlaessigkeit (97% vs. 93% Baseline). "stil" enthaelt bewusst auch
// Schreibstil-Hinweise (Satzlaenge/-muster), nicht nur lose Adjektive - das hat sich in den Tests
// als der groesste Hebel fuer glaubwuerdigere Chat-Antworten erwiesen. KEINE Pro-Charakter-Samples
// mehr - ein einziges gemeinsames Beispiel (SHARED_EXAMPLE) demonstriert Ton+Format fuer alle.
const CHARACTER_ROSTER = {
  manager:
    'person(34 Jahre, Ex-Eventplanerin große Hotelkette, Rolle zu unpersönlich), stil(organisiert, effizient, sachlich, trockener Humor, nie kalt, perfektionistisch, hasst Chaos; spricht knapp in klaren Aussagesätzen, stellt selten Rückfragen), hobbys(joggt früh, führt akribisch Buch), beziehung(Quinn:schätzt Menschenkenntnis, Benedict:verlässt sich auf ihn, Colt:vertraut blind, Tony:braucht Technikwissen, Jacob:hält im Zaum)',
  barkeeper:
    'person(29 Jahre, mit 19 von zuhause weg, Dutzend Bars drei Länder), stil(warmherzig, scharfzüngig, frech, direkt, duzt sofort, trockener Witz; kurze lockere Sätze, oft mit Augenzwinkern, springt schnell zum Punkt), hobbys(sammelt Vinyl, redet stundenlang Cocktail-Geschichte), beziehung(Benedict:neckt liebevoll, Mary:zieht auf, Colt:harmoniert mit ihm, Tony:amüsiert über seine Rants, Jacob:liebt seine Dramatik)',
  kellner:
    'person(41 Jahre, Ex-Butler 15 Jahre wohlhabende Familie, Anwesen verkauft), stil(förmlich, höflich, altmodisch, gestelzt, trockener Humor, merkt Altern; formuliert in vollständigen, leicht geschraubten Sätzen, vermeidet Umgangssprache), hobbys(Taschenuhren, Klassiker vor 1900), beziehung(Quinn:neckt trocken, Mary:schätzt sie, Colt:respektiert ihn, Tony:amüsiert insgeheim über sein Chaos, Jacob:findet ihn übertrieben)',
  tuersteher:
    'person(34 Jahre, Sicherheitsdienst Konzerte/Häfen), stil(ruhig, bestimmt, wortkarg, fair, trockener Humor selten; kurze knappe Saetze, oft nur ein Halbsatz, keine unnoetigen Worte), hobbys(boxt regelmäßig, repariert Motorräder), beziehung(Mary:vertraut ihr, Quinn:mag ihre Energie, Benedict:respektiert ihn, Tony:wenig Geduld für sein Chaos, Jacob:findet ihn übertrieben)',
  techniker:
    'person(26 Jahre, Autodidakt, Foren+Ausprobieren), stil(technikbegeistert, Fachjargon, hilfsbereit, übereifrig, chaotisch-nerdig; redet schnell und abschweifend, wechselt mitten im Satz das Thema), hobbys(baut Roboter, viele kaputte Prototypen), beziehung(Mary:bewundert ihre Struktur, Colt:respektiert seine Ruhe, Benedict:ahmt ihn scherzhaft nach, Jacob:liebt seine Werwolf-Runden)',
  werwolf:
    'person(46 Jahre, Ex-Straßenkünstler+Theater, Ensemble zu eng), stil(theatralisch, liebt Spannung/Mysteriöses, dramatische Pausen, Showman; formuliert blumig und ausschmückend, auch bei Alltäglichem), hobbys(sammelt seit Jahrzehnten Gruselgeschichten/Aberglauben), beziehung(Mary:mag ihre Nüchternheit als Gegenpol, Quinn:spielt ihr kleine Szenen vor, Colt:bewundert seine Ruhe, Tony:nennt ihn seinen Zauberer, Benedict:schätzt seinen Stil)',
};

// EIN gemeinsames Beispiel (nicht pro Charakter) - 3 Zeilen Chatverlauf (auch von anderen
// Charakteren) + Trigger + volle JSON-Antwort, demonstriert Ton UND Ausgabeformat gleichzeitig.
// Getestet: mehr/laengere Beispiele oder Pro-Charakter-Samples brachten in der A/B-Reihe KEINE
// messbare Verbesserung mehr gegenueber diesem einen Beispiel.
const SHARED_EXAMPLE = {
  history: ['Mary: Der Laden ist heute richtig voll.', '{user1}: Ja, kaum noch Platz an der Bar.', 'Quinn: Ich komm kaum hinterher mit den Bestellungen.'],
  trigger: 'Kannst du kurz nachschauen, ob an der Tür alles ruhig ist, Colt?',
  speaker: 'Colt',
  answer: { getraenk: null, antwort: 'Mach ich, war eh grad unruhig da vorne.' },
};

// Vorher per /model context (general) editierbar - jetzt ebenfalls fest, siehe CHARACTER_ROSTER.
// "Beziehe dich auf konkrete Fakten..."-Satz aus der A/B-Testreihe ergaenzt (verbesserte in JEDER
// gemessenen Kategorie, nicht nur beim allgemeinen Chat, siehe scratchpad/prompt_compress).
const GENERAL_CONTEXT =
  '1920er Bar, Chat wie Tresen-Gespräch. Kurz antworten (meist 1 Satz), direkt Inhalt, keine Anrede, keine Rückfrage, eigene Meinung statt Angebot. Beziehe dich auf konkrete Fakten aus deiner eigenen Beschreibung und auf den Chatverlauf, wenn es passt - widersprich nicht deinen eigenen Fakten. Kollegen: Quinn (Bar), Mary (Mgmt), Colt (Tür), Benedict (Kellner), Jacob (Erzähler), Tony (Technik) - sonst niemand bekannt.';

// Grobe Schaetzung (kein echter Tokenizer verfuegbar) - ~4 Zeichen/Token ist eine uebliche
// Faustregel und fuer ein Zeichen-basiertes Budget genau genug (Sicherheitsmarge durch DEFAULT_NUM_CTX
// in ollamaClient.js, das groesser ist als dieses Budget).
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// Cooldown gegen Doppel-Trigger bei schnell aufeinanderfolgenden Nachrichten.
const lastReplyAt = new Map();

// EINE gemeinsame Warteschlange ueber alle 6 Charaktere hinweg (nicht pro Charakter) - der Pi hat
// ohnehin nur einen Ollama-Slot gleichzeitig frei. Ist die Schlange voll, wird ein neuer Trigger
// still ignoriert (kein Queue-Eintrag, keine Antwort, kein Error-Log - das ist erwartetes
// Verhalten bei Ueberlastung, kein Fehler).
const queue = [];
let processingQueue = false;

async function processQueue() {
  processingQueue = true;
  while (queue.length > 0) {
    const job = queue.shift();
    if (job.type === 'classify') {
      await runShadowClassification(job);
    } else {
      await runJob(job);
    }
  }
  processingQueue = false;
}

// Fisher-Yates - fuer die zufaellige Reihenfolge der antwortenden Charaktere pro Runde.
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Statt EINES Gruppen-Calls: pro erkanntem Charakter ein EIGENER, sequenzieller LLM-Aufruf, in
// zufaelliger Reihenfolge. Jeder nachfolgende Aufruf bekommt die Antworten der vorherigen
// Charaktere DIESER Runde mit ("roundReplies") - so kann z.B. Benedict auf das reagieren, was
// Quinn gerade eben (noch in derselben Runde) gesagt hat. Jede fertige Antwort wird SOFORT
// gesendet, nicht erst am Ende gesammelt - Reihenfolge der Nachrichten = Reihenfolge der Calls.
async function runJob({ message, content, authorName, candidatePersonas, model, logError }) {
  const order = shuffle(candidatePersonas);
  const roundReplies = [];
  // Einmal pro Trigger geholt (nicht pro Charakter) - alle Charaktere dieser Runde sehen denselben
  // Verlaufs-Stand.
  const target = await resolveTarget(model);
  const historyLines = await fetchRecentHistory(message.channel, message.id, HISTORY_LENGTH).catch(() => []);

  for (const persona of order) {
    const sendTyping = () =>
      enqueueOutboxMessage({
        botName: persona.botName,
        action: 'typing',
        guildId: message.guildId,
        channelId: message.channelId,
      });
    sendTyping();

    // Siehe Kommentar weiter unten (frueher bei runJob insgesamt) - Discords Typing-Indikator
    // laeuft nach ~10s ab, deshalb periodisch auffrischen, solange DIESER Charakter dran ist.
    const typingInterval = setInterval(sendTyping, 8000);

    try {
      // Getraenke-Bestellung ist fest im System-Prompt verankert (siehe buildOrderInstructions) -
      // JEDER Charakter antwortet im selben JSON-Format, respondAsSinglePersona wertet
      // bestellung/getraenk aber nur bei Quinn im Tresen-Kanal aus (siehe dort).
      const result = await respondAsSinglePersona({
        guildId: message.guildId,
        channelId: message.channelId,
        persona,
        historyLines,
        triggerAuthor: authorName,
        triggerContent: content,
        roundReplies,
        target,
      });

      console.log(`[llm-chat] ${persona.displayName} -> roh: ${JSON.stringify(result.raw)} | text: ${JSON.stringify(result.text)}`);

      // Eigenes try/catch, bewusst getrennt vom Rest: ein Fehler beim Log-Channel (fehlende
      // Berechtigung, geloeschter Kanal, ...) darf niemals das eigentliche Senden der Antwort
      // verhindern.
      try {
        await logLlmCall(message.guild, {
          message,
          persona,
          promptText: result.promptText,
          responseText: result.raw,
          usedModel: result.usedModel,
          isPc: result.isPc,
          ms: result.ms,
          promptEvalMs: result.promptEvalMs,
          evalMs: result.evalMs,
          systemTokenEstimate: result.systemTokenEstimate,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });
      } catch (logErr) {
        await logError(logErr, { context: 'LLM-Log-Channel', guildId: message.guildId });
      }

      // Bestellung erkannt: der bestehende /getraenk-Bestell-Flow (Barkeeper-Bots order_drink-
      // Outbox-Handler) uebernimmt die Zubereitung/Bestaetigung - keine zusaetzliche Chat-Antwort.
      if (result.isOrder) {
        enqueueOutboxMessage({
          botName: persona.botName,
          action: 'order_drink',
          guildId: message.guildId,
          channelId: message.channelId,
          content: result.drinkName,
          title: authorName,
        });
        continue;
      }

      if (!result.text) continue;

      enqueueOutboxMessage({
        botName: persona.botName,
        action: 'send',
        guildId: message.guildId,
        channelId: message.channelId,
        content: result.text,
      });
      roundReplies.push({ displayName: persona.displayName, text: result.text });
    } catch (err) {
      // Echter Fehler (Ollama nicht erreichbar, kaputte Antwort, ...) - das WIRD geloggt, im
      // Unterschied zu einer vollen Warteschlange. Bricht diesen EINEN Charakter ab, die
      // uebrigen in der Reihenfolge werden trotzdem noch versucht.
      await logError(err, { context: `LLM-Chat-Antwort (${persona.displayName})`, guildId: message.guildId });
    } finally {
      clearInterval(typingInterval);
    }
  }
}

// Schluessel ist "channelId:authorId", NICHT nur channelId - sonst wuerde eine zweite Person, die
// kurz nach einer ersten im selben Kanal etwas Auslösendes schreibt (z.B. beide bestellen kurz
// hintereinander ein Getraenk), komplett ignoriert, noch bevor die Nachricht ueberhaupt beim LLM
// ankommt. Pro-Person-Cooldown verhindert weiterhin, dass EINE Person durch schnelles Nachtriggern
// spammt, blockiert aber nicht mehr faelschlich unterschiedliche Personen gegenseitig.
function cooldownKey(channelId, authorId) {
  return `${channelId}:${authorId}`;
}

function isOnCooldown(channelId, authorId) {
  const last = lastReplyAt.get(cooldownKey(channelId, authorId));
  return last && Date.now() - last < COOLDOWN_MS;
}

// Discord liefert @-Erwaehnungen im Nachrichtentext als rohe "<@ID>"/"<@!ID>"-Tokens - das Modell
// sieht davon nur eine bedeutungslose Zahlenfolge, nicht den Namen. Ersetzt jede Erwaehnung durch
// den Klarnamen (bei den 6 Charakteren den Chat-Namen, sonst den Server-Nick/Username), BEVOR der
// Text irgendwo (Verlauf, Trigger-Nachricht) verwendet wird.
function replaceMentionsWithNames(message) {
  let content = message.content;
  for (const [id, user] of message.mentions.users) {
    const persona = Object.values(LLM_PERSONAS).find((p) => p.clientId === id);
    const name = persona ? persona.displayName : message.mentions.members?.get(id)?.displayName ?? user.username;
    content = content.replaceAll(`<@${id}>`, name).replaceAll(`<@!${id}>`, name);
  }
  return content;
}

// Rein kursive Zeilen ("Name: *Text*") sind reiner Ambiente-/Aktionstext OHNE Gespraechswert -
// Konvention im gesamten Bot-Oekosystem (Getraenke-Zubereitungsschritte, Tisch abwischen,
// Snack-Lieferung, Kaffeemaschine-Reinigung laufen alle so, siehe drinks.json/serving.js/
// tableWiping.js/scheduler.js/supply.js). Werden aus dem fuers LLM sichtbaren Verlauf entfernt:
// A/B-getestet direkt gegen einen Live-Vorfall (Nutzer bedankt sich nach einer Bestellung, Quinn
// serviert das Getraenk faelschlich nochmal) - der Filter allein hob die Trefferquote von 2/12 auf
// 9/12, mehr als jede reine Prompt-Anpassung (siehe scratchpad/prompt_compress). Grund: eine echte
// Bestellung erzeugt 4-5 Verlaufszeilen mit demselben Getraenkenamen (Bestaetigung+Zubereitung),
// was das Modell staerker zu einer erneuten "Bestellung erkannt"-Fehleinschaetzung verleitet, je
// mehr davon im (kurzen, nur 5 Zeilen fassenden) Verlaufsfenster stehen.
function isAmbientLine(historyLine) {
  const colonIdx = historyLine.indexOf(': ');
  const content = colonIdx === -1 ? historyLine : historyLine.slice(colonIdx + 2);
  return /^\*.*\*$/.test(content.trim());
}

// Holt den echten Kanal-Verlauf direkt von Discord statt selbst mitzuschreiben - immer korrekt
// (auch wenn der Bot zwischenzeitlich offline war), zeigt auch die eigenen vorherigen Antworten
// der Charaktere (die als Bot-Nachrichten sonst nirgends erfasst wuerden), und braucht keine
// eigene DB-Tabelle. "before: beforeMessageId" schliesst die triggernde Nachricht selbst aus -
// die wird separat als "X hat gerade geschrieben" praesentiert. Kein Gateway-Intent noetig (REST-
// Fetch, keine Echtzeit-Events).
async function fetchRecentHistory(channel, beforeMessageId, limit = HISTORY_LENGTH) {
  const fetched = await channel.messages.fetch({ limit, before: beforeMessageId }).catch(() => null);
  if (!fetched) return [];

  return [...fetched.values()]
    .reverse() // Discord liefert neueste zuerst, wir wollen chronologisch (aelteste zuerst)
    .map((m) => {
      // Fuer eigene Charakter-Nachrichten den Chat-Namen ("Benedict") statt des Discord-
      // Anzeigenamens des Bot-Accounts ("Kellner") nutzen - sonst wirkt es im Verlauf wie zwei
      // verschiedene Entitaeten, obwohl es derselbe Charakter ist (der System-Prompt spricht
      // durchgehend vom Chat-Namen).
      const persona = Object.values(LLM_PERSONAS).find((p) => p.clientId === m.author.id);
      const authorName = persona ? persona.displayName : m.member?.displayName ?? m.author.username;
      return `${authorName}: ${replaceMentionsWithNames(m)}`;
    })
    .filter((line) => !isAmbientLine(line));
}

// Guenstiger lokaler Vorab-Check (kein LLM-Aufruf): welche Charakternamen kommen ueberhaupt als
// eigenstaendiges Wort im Text vor? Nur bei mindestens einem Treffer wird ans LLM weitergegeben -
// die Treffer bestimmen direkt (zusammen mit echten @-Erwaehnungen), welche Charaktere ueberhaupt
// als Kandidaten in Frage kommen (siehe resolveCandidatePersonas).
function matchedPersonaNames(content) {
  return Object.values(LLM_PERSONAS)
    .filter((p) => new RegExp(`\\b${p.displayName}\\b`, 'i').test(content))
    .map((p) => p.displayName);
}

// Fasst echte @-Erwaehnungen und Namens-Treffer im Text zu EINER Kandidatenliste zusammen (ohne
// Duplikate, falls jemand sowohl @-erwaehnt als auch namentlich genannt wird) - genau diese
// Charaktere (und nur diese) kommen fuers Roster/die Antwort infrage.
function resolveCandidatePersonas(explicitPersonas, textMentions) {
  const map = new Map(explicitPersonas.map((p) => [p.botName, p]));
  for (const name of textMentions) {
    const persona = findLlmPersonaByDisplayName(name);
    if (persona) map.set(persona.botName, persona);
  }
  return [...map.values()];
}

// Behaelt so viele der NEUESTEN Verlaufszeilen wie ins verbleibende Token-Budget passen (aeltere
// zuerst weggeworfen), gedeckelt bei HISTORY_LENGTH (weiterhin max. 10 Nachrichten, unabhaengig
// vom Budget).
function trimHistoryToBudget(historyLines, remainingBudget, historyLimit = HISTORY_LENGTH) {
  const capped = historyLines.slice(-historyLimit);
  const kept = [];
  let used = 0;
  for (let i = capped.length - 1; i >= 0; i--) {
    const lineTokens = estimateTokens(capped[i]) + 1; // +1 fuer den Zeilenumbruch
    if (used + lineTokens > remainingBudget) break;
    kept.unshift(capped[i]);
    used += lineTokens;
  }
  return kept;
}

// Das Modell haengt trotz Anweisung gelegentlich eine Meta-Praeambel vor die eigentliche Antwort
// ("Ich werde es kurz halten:", "Hier ist eine passende Antwort:") - reines Prompting konnte das
// ueber mehrere getestete Formulierungen hinweg NICHT zuverlaessig verhindern (siehe ".llm-test"-
// Protokolle). Solche Praeambeln enden aber verlaesslich mit einem Doppelpunkt + Leerzeile vor dem
// eigentlichen (oft in Anfuehrungszeichen gesetzten) Antworttext - das laesst sich robust per Code
// abschneiden, indem nur der Teil NACH der letzten Leerzeile behalten wird. Bei normalen (einzeiligen)
// Antworten ohne Praeambel greift das nicht (kein "\n\n" vorhanden), reines No-Op.
function cleanPersonaReply(text, displayName) {
  let result = text.trim();
  const lastBlankLine = result.lastIndexOf('\n\n');
  if (lastBlankLine !== -1) {
    result = result.slice(lastBlankLine + 2).trim();
  }

  // Optionales "@"/"**"/"Name:"-Praefix tolerieren - das Modell haengt das manchmal trotz
  // Anweisung an (z.B. "Benedict: Na dann..." statt nur "Na dann...").
  return result
    .replace(new RegExp(`^[@*]*${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[@*]*\\s*:\\s*`, 'i'), '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

// Discord-Usernamen sind fuer das 3B-Modell teils kryptische Tokens, die es gelegentlich beim
// Wiederholen verballhornt (beobachtet: "mrmentrix" -> "mrmentionix" in Tests). Ersetzt jeden
// ECHTEN Nutzernamen (nicht die 6 Charakter-Namen wie "Quinn"/"Mary" - die sollen dem Modell als
// bekannte Kollegen erhalten bleiben) durch ein einfaches {user1}/{user2}/...-Token, bevor der
// Prompt gebaut wird - danach wird jedes Token in der fertigen Antwort wieder zum echten Namen
// zurueckuebersetzt (siehe resolvePlaceholders).
function buildUserPlaceholderMap(triggerAuthor, historyLines) {
  const personaNames = new Set(Object.values(LLM_PERSONAS).map((p) => p.displayName));
  const names = [triggerAuthor];
  for (const line of historyLines) {
    const colonIdx = line.indexOf(': ');
    if (colonIdx === -1) continue;
    const name = line.slice(0, colonIdx);
    if (!personaNames.has(name) && !names.includes(name)) names.push(name);
  }

  const map = new Map();
  names
    .filter((name) => !personaNames.has(name))
    .forEach((name, i) => map.set(name, `{user${i + 1}}`));
  return map;
}

// Laengste Namen zuerst ersetzen, damit ein Name, der Teilstring eines anderen ist, nicht schon
// vorher kaputt ersetzt wird.
function applyPlaceholders(text, placeholderMap) {
  let result = text;
  const sortedNames = [...placeholderMap.keys()].sort((a, b) => b.length - a.length);
  for (const name of sortedNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), placeholderMap.get(name));
  }
  return result;
}

function resolvePlaceholders(text, placeholderMap) {
  let result = text;
  for (const [name, token] of placeholderMap) {
    result = result.split(token).join(name);
  }
  return result;
}

// Prompt-Struktur nach ausfuehrlichem Testen mehrerer Varianten gegen das lokale 3B (Prosa statt
// GROSSSCHRIFT-Header/Abschnitte - letztere korrelierten mit Antwortverweigerung bei Sachfragen;
// kein explizites ❌/✅-Beispielpaar im System-Prompt - das fuehrte dazu, dass das Modell die
// Antwort als "Erklaerung + Beispiel"-Struktur statt als direkte Rede ausgibt, siehe
// ".llm-test"-Protokolle). Ausserdem KEINE Skip-Option mehr (frueher "NICHTS") - das Modell hat
// sich diese Option viel zu haeufig "ausgesucht", selbst bei voellig harmlosen Fragen. Bewusst
// SCHLANK gehalten (kurze Antwortlaenge erzwungen, wenig Nuance verlangt) - das 3B degradiert bei
// laengeren/komplexeren Anweisungen sichtbar (Meta-Leaks, Verweigerung, Ausschweifen).
// Jahreszeit rein nach Monat (Nordhalbkugel/DE), keine Tag-genaue Berechnung noetig - fuer
// beilaeufige Atmosphaere im Prompt reicht das.
function getSeason(month) {
  if (month === 12 || month <= 2) return 'Winter';
  if (month <= 5) return 'Frühling';
  if (month <= 8) return 'Sommer';
  return 'Herbst';
}

// Kurzer, dynamischer Situationskontext (Datum/Uhrzeit/Jahreszeit + grob wie viele Gaeste gerade
// aktiv sind) - wird PRO AUFRUF frisch berechnet (nie gecacht), da genau das der Witz ist. Bewusst
// als beilaeufige Zusatzinfo formuliert (siehe Prompt-Anweisung unten), nicht als Frage/Aufgabe -
// das Modell soll es nur nutzen, wenn es zur Antwort passt, nicht jedes Mal referenzieren.
function buildSituationalContext(guildId) {
  const now = new Date();
  const weekday = WEEKDAY_NAMES[now.getDay()];
  // Jahr - 100 fuers 1920er-Bar-Setting (Wochentag/Tag/Monat bleiben real, nur die angezeigte
  // Jahreszahl wird in die fiktive Zeit verschoben) - auf Nutzerwunsch, statt des echten Jahres.
  const date = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear() - 100}`;
  const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const season = getSeason(now.getMonth() + 1);
  const activeGuests = getActiveMemberCount(guildId, Date.now() - ACTIVITY_WINDOW_MS);

  return `${weekday}, ${date}, ${time} Uhr, ${season}. Gerade aktive Gäste in der Bar: ${activeGuests}.`;
}

// Baut EINEN Block mit ALLEN Charakteren (strukturierte Attribut-Notation, siehe CHARACTER_ROSTER)
// - aus CHARACTER_ROSTER, nicht mehr aus der DB. Bewusst ALLE Charaktere, nicht nur der gerade
// antwortende: der System-Prompt soll fuer JEDEN Charakter und JEDEN Call byte-identisch sein,
// damit Ollamas Prompt-Praefix-Cache beim Wechsel zwischen Charakteren (z.B. erst Quinn, dann
// Benedict antwortet) nicht jedes Mal neu prefillen muss. KEIN "(Rolle)" mehr nach dem Namen - die
// getestete Variante hatte das nicht, und die Rolle steht ohnehin implizit im "person()"-Teil.
function buildCharacterRoster() {
  return Object.values(LLM_PERSONAS)
    .map((p) => `[${p.displayName}: ${CHARACTER_ROSTER[p.botName]}]`)
    .join('\n');
}

// Zeigt Verlauf+Trigger+die EXAKTE JSON-Antwort fuer das eine gemeinsame Beispiel (SHARED_EXAMPLE)
// - demonstriert Ton und Ausgabeformat gleichzeitig, ohne Pro-Charakter-Samples.
function buildSharedExampleBlock() {
  const ex = SHARED_EXAMPLE;
  const historyText = ex.history.join('\n');
  const answerJson = JSON.stringify(ex.answer);
  return `Beispiele (Ton und Format, nicht wörtlich wiederholen):\nVerlauf:\n${historyText}\n{user1} schreibt: "${ex.trigger}"\n${ex.speaker} antwortet:\n${answerJson}`;
}

// Getraenke-Bestell-Anweisung fest im (statischen) System-Prompt verankert, NICHT als separater
// Klassifizierungs-Call (siehe Session-Historie: das kostete frueher einen kompletten zweiten
// LLM-Aufruf mit eigenem Prompt und hat den Cache jedes Mal invalidiert). Jetzt beantwortet JEDER
// Charakter immer im selben (schlanken, 2-Felder-) JSON-Format - "getraenk" ist nur bei Quinn im
// Tresen-Kanal relevant (siehe respondAsSinglePersona), wird bei allen anderen Charakteren
// ignoriert. KEINE Getraenkeliste mehr im Prompt (spart ~200 Tokens, A/B-getestet ohne
// Zuverlaessigkeitsverlust) - das Modell nennt den Namen frei, matchDrink() gleicht danach per
// Fuzzy-Match gegen drinks.json ab.
function buildOrderInstructions() {
  return `Antworte IMMER mit GENAU EINEM validen JSON-Objekt in exakt diesem Format - nichts davor, nichts danach, kein Fließtext, keine Erklärung:
{"getraenk": "<Getränkename>" oder null, "antwort": "<Satz>"}

antwort: Pflichtfeld, immer 1-2 kurze deutsche Sätze, echte inhaltliche Reaktion. Kein Name davor, keine Sternchen, keine Erklärung was du tust.
getraenk: Prüfe NUR die AKTUELLE Nachricht: Enthält sie eine ausdrückliche NEUE Bitte um ein Getränk (z.B. "kannst du mir... machen", "ich hätte gern...", "einmal... bitte")? Nur dann den Namen setzen. WICHTIG: Eine bereits servierte Bestellung erzeugt im Verlauf mehrere Zeilen mit dem Getränkenamen (Bestätigung + Zubereitungsschritte) - das sind KEINE neuen Bestellwünsche, auch wenn der Name dort mehrfach steht. Dank, Kommentare oder Fragen zu einem bereits servierten Getränk zählen NICHT als neue Bestellung.
Sonst (anderer Charakter oder keine ausdrückliche neue Bitte): getraenk ist null.`;
}

// Bildet den geplanten externen Nachbearbeitungsschritt nach (LLM nennt den Getraenkenamen frei,
// kein Listen-Abgleich mehr im Prompt, siehe buildOrderInstructions): normalisieren, Artikel
// strippen, exakter Vergleich, dann Teilstring-Abgleich (kuerzeste Laengendifferenz gewinnt bei
// Mehrdeutigkeit, z.B. "Mojito" vs. "Virgin Mojito"). A/B-getestet: 0 Fehlzuordnungen ueber 48
// echte Bestellungen im Testlauf, siehe scratchpad/prompt_compress/runner.js (matchDrink).
function matchDrink(text, drinkNames) {
  if (!text) return null;
  const norm = text.trim().toLowerCase();
  const stripped = norm.replace(/^(einen?|eine)\s+/, '');
  const exact = drinkNames.find((d) => d.toLowerCase() === norm || d.toLowerCase() === stripped);
  if (exact) return exact;
  const candidates = drinkNames.filter((d) => stripped.includes(d.toLowerCase()) || d.toLowerCase().includes(stripped));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(a.length - stripped.length) - Math.abs(b.length - stripped.length));
  return candidates[0];
}

// Kein persona-/situationalContext-Parameter - wer gerade antwortet UND der Situationskontext
// (Uhrzeit etc., aendert sich jede Anfrage) stehen im User-Prompt (siehe gatherPersonaPromptContext),
// damit dieser System-Prompt fuer alle Charaktere und Calls identisch bleibt. Komplett statisch
// (kein DB-Zugriff mehr, siehe CHARACTER_ROSTER/GENERAL_CONTEXT) - wird deshalb EINMAL beim Start
// gebaut (siehe SYSTEM_PROMPT weiter unten), nicht bei jedem Call neu.
function buildSystemPrompt() {
  return `Du spielst EINEN von 6 Charakteren, 1920er Bar (Discord-Chat). Wer genau: Ende der Anfrage ("Du antwortest jetzt als ...").

Charaktere:
${buildCharacterRoster()}

${GENERAL_CONTEXT}

${buildOrderInstructions()}

${buildSharedExampleBlock()}`;
}

// Einmal berechnet statt bei jedem Call neu - der Prompt ist jetzt vollstaendig statisch (keine
// DB-Werte mehr, siehe CHARACTER_ROSTER/GENERAL_CONTEXT), es gibt also nichts, was sich zur
// Laufzeit noch aendern koennte.
const SYSTEM_PROMPT = buildSystemPrompt();

// Profil fuer JEDES Modell, das NICHT in MODEL_PROMPT_PROFILES steht (siehe modelPrompts.js) -
// exakt das bisherige, unveraenderte Verhalten. LoRA-Adapter mit eigens trainiertem Prompt+Format
// bekommen dort einen eigenen Eintrag; alles andere (qwen2.5:7b-instruct, qwen2.5:3b-instruct,
// zukuenftige Testmodelle) laeuft automatisch ueber dieses Default-Profil, ohne Codeaenderung.
const DEFAULT_PROFILE = {
  systemPrompt: SYSTEM_PROMPT,
  format: 'json',
  buildUserPrompt: (ctx) => buildUserPrompt(ctx),
  parseReply: (raw) => {
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    // Fallback: falls das JSON mal nicht parsbar ist (sollte mit format:'json' praktisch nie
    // passieren), den Rohtext direkt als Antwort nehmen statt komplett zu schweigen.
    const antwort = typeof parsed?.antwort === 'string' ? parsed.antwort : raw;
    const getraenk = typeof parsed?.getraenk === 'string' ? parsed.getraenk.trim() : null;
    return { antwort, getraenk };
  },
};

// EIN LLM-Aufruf fuer GENAU EINEN Charakter - wird pro Charakter in runJob() sequenziell
// aufgerufen. roundReplies enthaelt die Antworten der vorherigen Charaktere DIESER Runde
// (chronologisch), damit z.B. Benedict auf das reagieren kann, was Quinn gerade eben schon
// gesagt hat, statt unabhaengig davon zu antworten.
// Platzhalter/Verlauf/Situationskontext fuer den User-Prompt-Teil - der System-Prompt ist jetzt
// komplett statisch (siehe SYSTEM_PROMPT), diese Funktion befasst sich nur noch mit dem dynamischen
// Teil.
function gatherPersonaPromptContext({ guildId, persona, historyLines, triggerAuthor, triggerContent, roundReplies }) {
  const placeholderMap = buildUserPlaceholderMap(triggerAuthor, historyLines);
  const phAuthor = placeholderMap.get(triggerAuthor) ?? triggerAuthor;
  const phContent = applyPlaceholders(triggerContent, placeholderMap);
  const phHistoryLines = historyLines.map((line) => applyPlaceholders(line, placeholderMap));

  const situationalContext = buildSituationalContext(guildId);

  // Kein "Technischer Hinweis" mehr - der ergab nur Sinn, solange das Modell zwischen mehreren
  // Kandidaten im selben Prompt auswaehlen und sich fuer/gegen eine Reaktion entscheiden musste.
  // Jetzt ist persona bereits VORHER als einziger Kandidat feststehend (siehe
  // resolveCandidatePersonas) und antwortet immer - der Hinweis haette keine Wirkung mehr.
  const roundText =
    roundReplies.length > 0
      ? `\n\nBereits geantwortet:\n${roundReplies.map((r) => `${r.displayName}: ${r.text}`).join('\n')}`
      : '';
  // "Wer antwortet gerade" UND der Situationskontext (Uhrzeit etc., aendert sich jede Anfrage)
  // stehen bewusst im User-Prompt, nicht im System-Prompt - der ist ohnehin bei jedem Call neu
  // (Verlauf+Trigger), kostet also keinen zusaetzlichen Cache-Verlust. Rolle NICHT nochmal genannt -
  // steht schon im Roster im System-Prompt, wuerde hier nur Tokens ohne neue Information kosten.
  // Alle Formulierungen hier bewusst knapp gehalten (siehe Session-Debugging: dieser Teil ist NIE
  // cachebar, jedes gesparte Token zaehlt direkt als weniger Prefill).
  const speakerNote = `\n\nDu antwortest jetzt als ${persona.displayName}.`;
  const situationalNote = `\n\nSituation (Randinfo, nur bei Bedarf nutzen): ${situationalContext}`;
  const question = `\n\nWie antwortet ${persona.displayName} darauf?`;

  return {
    placeholderMap,
    phAuthor,
    phContent,
    roundText,
    speakerNote,
    situationalNote,
    question,
    phHistoryLines,
  };
}

// Schneidet Text auf hoechstens maxTokens ab (gleiche ~4-Zeichen/Token-Heuristik wie estimateTokens).
function truncateToTokens(text, maxTokens) {
  const maxChars = Math.max(0, maxTokens) * 4;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

// Baut aus den gesammelten Teilen den finalen userPrompt. Harter Deckel bei USER_PROMPT_MAX_TOKENS
// NUR fuer den User-Prompt selbst (System zaehlt NICHT mit, der ist ja gecacht, siehe SYSTEM_PROMPT)
// - der User-Prompt muss bei JEDER Anfrage neu prefillt werden (~114ms/Token auf dem Pi, siehe
// Session-Debugging). Reicht der Verlauf allein nicht aus, wird er komplett weggelassen; reicht
// selbst das dann noch nicht (sehr lange Trigger-Nachricht), wird die Trigger-Nachricht SELBST
// gekuerzt, statt das Budget zu ueberschreiten.
function buildUserPrompt(ctx) {
  const scaffoldTokens = estimateTokens(
    `${ctx.phAuthor} schreibt: ""${ctx.roundText}${ctx.speakerNote}${ctx.situationalNote}${ctx.question}`
  );
  const maxContentTokens = Math.max(10, USER_PROMPT_MAX_TOKENS - scaffoldTokens);
  const phContent =
    estimateTokens(ctx.phContent) > maxContentTokens ? truncateToTokens(ctx.phContent, maxContentTokens) : ctx.phContent;

  const fixedSuffix = `${ctx.phAuthor} schreibt: "${phContent}"${ctx.roundText}${ctx.speakerNote}${ctx.situationalNote}${ctx.question}`;
  const remainingForHistory = Math.max(0, USER_PROMPT_MAX_TOKENS - estimateTokens(fixedSuffix));
  const trimmedHistory = trimHistoryToBudget(ctx.phHistoryLines, remainingForHistory, HISTORY_LENGTH);
  const background = trimmedHistory.length > 0 ? `Chatverlauf:\n${trimmedHistory.join('\n')}\n\n` : '';
  return `${background}${fixedSuffix}`;
}

async function respondAsSinglePersona({
  guildId,
  channelId,
  persona,
  historyLines,
  triggerAuthor,
  triggerContent,
  roundReplies,
  target,
}) {
  // Profil haengt vom AKTIVEN Modell ab (target.model, siehe /model set) - LoRA-Adapter brauchen
  // ihren eigenen, trainierten System-/User-Prompt und Ausgabe-Parser (siehe modelPrompts.js).
  // Jedes nicht dort eingetragene Modell laeuft unveraendert ueber DEFAULT_PROFILE.
  const profile = MODEL_PROMPT_PROFILES[target.model] ?? DEFAULT_PROFILE;
  const ctx = gatherPersonaPromptContext({ guildId, persona, historyLines, triggerAuthor, triggerContent, roundReplies });
  const userPrompt = profile.buildUserPrompt(ctx, persona, roundReplies, guildId);
  const { data, ms, promptEvalMs, evalMs, inputTokens, outputTokens, model: usedModel, isPc } = await chatWithTarget(
    profile.systemPrompt,
    userPrompt,
    target,
    { format: profile.format, temperature: 0.3 }
  );
  const raw = data.message.content.trim();

  // Echte System-Prompt-Tokenzahl (statt Zeichen/4-Schaetzung) per Differenzmessung gegen Ollamas
  // eigenen Tokenizer - siehe measureAndCacheSystemBaseline in ollamaClient.js. Cache-Key ist der
  // Prompt-TEXT selbst (siehe ollamaClient.js) - pro Modell/Profil mit eigenem System-Prompt
  // entsteht also automatisch ein eigener Cache-Eintrag, einmal pro Neustart gefuellt. NICHT
  // fire-and-forget: der Messungs-Call teilt sich die "busy"-Sperre in ollamaClient.js mit echten
  // Anfragen - liefe er unbeobachtet im Hintergrund weiter, waehrend runJob() schon den naechsten
  // Charakter derselben Runde aufruft, wuerde dessen echter Call auf die Sperre treffen und
  // fehlschlagen. Kostet dadurch nur beim ALLERERSTEN Call nach einem Neustart/Modellwechsel
  // einmalig etwas mehr Zeit - danach liefert der Cache die echte Zahl sofort.
  let systemTokenEstimate = getCachedSystemBaseline(profile.systemPrompt);
  if (systemTokenEstimate == null) {
    systemTokenEstimate =
      (await measureAndCacheSystemBaseline(profile.systemPrompt, target).catch(() => null)) ?? estimateTokens(profile.systemPrompt);
  }

  // Fallback falls die Antwort nicht im erwarteten Format des Profils steht (z.B. Pipe-Format
  // ohne "|", oder kaputtes JSON): Rohtext direkt als Antwort nehmen statt komplett zu schweigen.
  const { antwort, getraenk } = profile.parseReply(raw) ?? { antwort: raw, getraenk: null };
  const cleaned = cleanPersonaReply(antwort ?? raw, persona.displayName);
  const withoutPrefix = resolvePlaceholders(cleaned, ctx.placeholderMap);

  // Bestellung nur relevant bei Quinn (Barkeeper) im konfigurierten Tresen-Kanal - bei allen
  // anderen Charakteren/Kanaelen wird getraenk ignoriert, auch falls das Modell es (fehlerhaft)
  // gesetzt haette. Kein "bestellung"-Feld mehr (schlankes 2-Felder-JSON, siehe
  // buildOrderInstructions) - ein erfolgreich gematchtes Getraenk IST die Bestellung.
  let isOrder = false;
  let drinkName = null;
  if (persona.botName === 'barkeeper' && channelId === getBartresenChannelId(guildId)) {
    const validDrink = matchDrink(getraenk, getDrinkNames());
    isOrder = Boolean(validDrink);
    drinkName = validDrink;
  }

  // promptText = System- und User-Prompt zusammen, klar getrennt - roh fuers LLM-Log (siehe
  // logLlmCall), damit dort der komplette tatsaechlich gesendete Prompt nachvollziehbar ist.
  const promptText = `[SYSTEM]\n${profile.systemPrompt}\n\n[USER]\n${userPrompt}`;

  return {
    text: withoutPrefix,
    raw,
    isOrder,
    drinkName,
    ms,
    promptEvalMs,
    evalMs,
    systemTokenEstimate,
    inputTokens,
    outputTokens,
    promptText,
    usedModel,
    isPc,
  };
}

// ===== SCHATTEN-KLASSIFIZIERUNG (Testphase, auf Nutzeranfrage) =====
// Eigener, separater LLM-Gate-Ansatz: EIN JA/NEIN-Klassifizierungs-Call NUR ueber die neueste
// Nachricht (kein Chatverlauf mehr, auf Nutzeranfrage - urspruenglich mit den letzten 10 Nachrichten
// getestet) statt der bestehenden Namens-Regex (siehe matchedPersonaNames). Laeuft PARALLEL zur
// bestehenden Erkennung her - beeinflusst NICHT, ob tatsaechlich geantwortet wird, dient erstmal
// nur dazu, im LLM-Log zu sehen, wie sich beide Ansaetze im echten Betrieb unterscheiden (faengt
// das Gate z.B. "Kann man hier was trinken?" ohne Namensnennung, was die Regex verpassen wuerde?).
// Wird ueber dieselbe Warteschlange wie die echten Antwort-Jobs eingereiht (siehe handleChatMessage/
// processQueue) - Pi hat ohnehin nur einen Ollama-Slot gleichzeitig frei, gemeinsame Queue
// verhindert, dass sich Klassifizierung und echte Antwort gegenseitig mit "beschaeftigt"-Fehlern
// blockieren.
function buildClassificationPrompt(triggerAuthor, triggerContent) {
  const placeholderMap = buildUserPlaceholderMap(triggerAuthor, []);
  const phAuthor = placeholderMap.get(triggerAuthor) ?? triggerAuthor;
  const phContent = applyPlaceholders(triggerContent, placeholderMap);

  return `NACHRICHT:
${phAuthor}: ${phContent}

AUFGABE:
Identifiziere, ob Personal antworten sollte. Personal sollte antworten wenn:
- Charaktere [Mary, Quinn, Tony, Jacob, Benedict, Colt] indirekt angesprochen wurden
- Generelle Frage gestellt wird wie "Wo bekommt man hier einen Drink?"

ANTWORT FORMAT:
"JA" oder "NEIN"`;
}

function parseClassification(raw) {
  const upper = raw.toUpperCase();
  const hasJa = /\bJA\b/.test(upper);
  const hasNein = /\bNEIN\b/.test(upper);
  if (hasJa && !hasNein) return 'JA';
  if (hasNein && !hasJa) return 'NEIN';
  return 'UNKLAR';
}

async function runShadowClassification({ message, content, authorName, model, logError }) {
  try {
    const target = await resolveTarget(model);
    const userPrompt = buildClassificationPrompt(authorName, content);
    const { data, ms, model: usedModel, isPc } = await chatWithTarget('', userPrompt, target, { numCtx: 2048 });
    const raw = data.message.content.trim();
    const classification = parseClassification(raw);

    console.log(`[llm-gate-test] "${content}" -> ${classification} (${ms}ms, roh: ${JSON.stringify(raw)})`);

    await logLlmClassification(message.guild, {
      message,
      promptText: `[SYSTEM]\n(kein System-Prompt, siehe Testansatz)\n\n[USER]\n${userPrompt}`,
      responseText: raw,
      classification,
      durationMs: ms,
      usedModel,
      isPc,
    });
  } catch (err) {
    await logError(err, { context: 'LLM-Gate-Test (Schattenlauf)', guildId: message.guildId }).catch(() => {});
  }
}

// Haupt-Einstiegspunkt, aus dem messageCreate-Handler in index.js aufgerufen. Macht selbst nichts,
// wenn der Kanal nicht per /config channel check-llm on aktiviert ist, das aktive Modell auf "none"
// steht (LLM-Funktion global deaktiviert, siehe /model set none), oder wenn kein Charaktername im
// Text vorkommt (spart den teuren LLM-Aufruf).
async function handleChatMessage(message, logError) {
  if (message.author.bot || !message.guildId) return;
  if (!hasFlag(message.guildId, message.channelId, CHECK_LLM_FLAG)) return;

  const activeModel = getActiveLlmModel(message.guildId);
  if (activeModel === NONE_MODEL) return;

  // Ist mindestens eine Rolle unter /config llmrole hinterlegt, darf nur triggern, wer (mindestens)
  // eine davon hat - ist die Liste leer, gilt weiterhin keine Einschraenkung (alle duerfen).
  const allowedRoleIds = getLlmRoleIds(message.guildId);
  if (allowedRoleIds.length > 0) {
    const memberRoleIds = message.member?.roles.cache;
    if (!memberRoleIds || !allowedRoleIds.some((roleId) => memberRoleIds.has(roleId))) return;
  }

  const authorName = message.member?.displayName ?? message.author.username;
  const content = replaceMentionsWithNames(message);
  const model = activeModel ?? DEFAULT_MODEL;

  // Schatten-Klassifizierung (runShadowClassification) ist erstmal wieder AUSGESCHALTET (auf
  // Nutzeranfrage - lief testweise auf JEDER Nachricht im Kanal, das soll erstmal wieder raus).
  // Funktion + Queue-Unterstuetzung (siehe processQueue, job.type === 'classify') bleiben bestehen,
  // nur der Einreih-Aufruf hier ist entfernt - einfach wieder reaktivierbar.

  const explicitPersonas = Object.values(LLM_PERSONAS).filter((p) => message.mentions.has(p.clientId));
  const explicitMentions = explicitPersonas.map((p) => p.displayName);
  const textMentions = matchedPersonaNames(content);

  if (explicitMentions.length === 0 && textMentions.length === 0) return;
  if (isOnCooldown(message.channelId, message.author.id)) return;
  // "bis zu 3" zaehlt wartende UND den gerade laufenden Job zusammen, nicht nur die Warteschlange
  // fuer sich - sonst waeren de facto bis zu 4 gleichzeitig im System.
  const inFlight = queue.length + (processingQueue ? 1 : 0);
  if (inFlight >= MAX_QUEUE_SIZE) return; // voll - Trigger wird bewusst stillschweigend ignoriert

  lastReplyAt.set(cooldownKey(message.channelId, message.author.id), Date.now());

  const candidatePersonas = resolveCandidatePersonas(explicitPersonas, textMentions);

  // historyLines wird NICHT hier geholt (waere ein zusaetzlicher Discord-API-Roundtrip vor jedem
  // Queue-Eintrag) sondern erst in runJob() kurz bevor der erste Charakter drankommt - siehe
  // fetchRecentHistory().
  queue.push({ type: 'respond', message, content, authorName, candidatePersonas, model, logError });
  if (!processingQueue) processQueue();
}

module.exports = { handleChatMessage, respondAsSinglePersona };
[exit=0]

