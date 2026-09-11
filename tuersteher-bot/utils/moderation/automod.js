const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { getLogChannel } = require('../../storage/guildConfig');

const STEMS_PATH = path.join(__dirname, '..', '..', 'data', 'automodStems.json');
const EMBED_COLOR = 0xed4245;

// Drei Kategorien mit unterschiedlicher Matching-Strategie (siehe buildPatterns unten) - alles
// andere in der JSON-Datei (z. B. "_comment_..."-Schlüssel für Begründungen) wird ignoriert.
const TEXT_KEYS = ['beleidigungen', 'diskriminierung', 'ns_bezuege', 'rechtsextremismus_international'];
const CODE_KEY = 'codes';
const SYMBOL_KEY = 'symbole';

// Bewusst kein require(...) der JSON-Datei - siehe utils/drinks/drinks.js (Barkeeper) für die
// Begründung: Änderungen an der Wortstamm-Liste sollen ohne Neustart wirksam werden. Stämme
// liegen als ASCII (ue/oe/ae/ss statt ü/ö/ä/ß) vor, siehe DIGRAPHS unten.
function loadStemCategories() {
  const raw = fs.readFileSync(STEMS_PATH, 'utf8');
  const data = JSON.parse(raw);
  return {
    textStems: TEXT_KEYS.flatMap((key) => data[key] ?? []),
    codes: data[CODE_KEY] ?? [],
    symbols: data[SYMBOL_KEY] ?? [],
  };
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Buchstaben-Äquivalenzklassen für Leetspeak (4/@ -> a, 3 -> e, 1/!/| -> i, 0 -> o, 5/$ -> s,
// 7 -> t) - wird direkt IN die Regex eingebaut (statt den Text vorher zu normalisieren), damit die
// Trefferposition exakt im Original-Text bleibt und der erkannte Ausschnitt später fett markiert
// werden kann (siehe flagMessage).
const LETTER_CLASSES = {
  a: '[a4@]',
  e: '[e3]',
  i: '[i1!|]',
  o: '[o0]',
  s: '[s5$]',
  t: '[t7]',
};

// Ein Stamm-Digraph wie "ue" (ASCII-Form von ü) muss entweder als "u"+"e" ODER als der einzelne
// Umlaut selbst matchen - beides über eine Alternation im selben Regex-Fragment.
const DIGRAPHS = { ue: 'ü', oe: 'ö', ae: 'ä', ss: 'ß' };

// Erlaubt bis zu 3 "Füllzeichen" (Leerzeichen, Punkte, Unterstriche, Sternchen, ...) zwischen den
// Buchstaben eines Stamms, damit auseinandergezogene Schreibweisen wie "w i c h s" oder
// "w.i.c.h.s" trotzdem erkannt werden - ohne dafür Leerzeichen aus der GESAMTEN Nachricht zu
// entfernen (das würde Wörter über Wortgrenzen hinweg verschmelzen und die False-Positive-Rate
// unnötig erhöhen). Leerzeichen innerhalb eines mehrteiligen Stamms wie "heil hitler" werden dabei
// genauso behandelt wie jede andere Buchstabenlücke, matcht also auch "heilhitler" ohne Leerzeichen.
const FILLER_PATTERN = '[\\s\\W_]{0,3}';

function stemToOriginalTextPattern(stem) {
  const letters = stem.toLowerCase().replace(/\s+/g, '');
  const parts = [];
  let i = 0;

  while (i < letters.length) {
    const pair = letters.slice(i, i + 2);
    if (DIGRAPHS[pair]) {
      const first = LETTER_CLASSES[pair[0]] ?? escapeRegex(pair[0]);
      const second = LETTER_CLASSES[pair[1]] ?? escapeRegex(pair[1]);
      parts.push(`(?:${first}${FILLER_PATTERN}${second}|${DIGRAPHS[pair]})`);
      i += 2;
    } else {
      const ch = letters[i];
      parts.push(LETTER_CLASSES[ch] ?? escapeRegex(ch));
      i += 1;
    }
  }

  return parts.join(FILLER_PATTERN);
}

// Codes (z. B. "88" für "Heil Hitler") NIE als Substring prüfen - sonst schlägt "88" in jedem
// Preis, jeder Jahreszahl oder jedem Punktestand an. Nur als eigenständiges Token (Wortgrenze auf
// beiden Seiten) - "1988" oder "88€" lösen also nicht aus, eine Nachricht, die nur "88" enthält
// (oder "88" umgeben von Leerzeichen/Satzzeichen), schon. Das bleibt trotzdem mehrdeutiger als die
// Text-Stämme (z. B. Trikotnummern, Highscores) - bewusst in Kauf genommen, da nur geflaggt statt
// gelöscht wird.
function codeToPattern(code) {
  return `\\b${escapeRegex(code)}\\b`;
}

// Eine gemeinsame Regex für Text-Stämme + Codes + Symbole - alle drei matchen direkt gegen den nur
// klein geschriebenen Original-Text (keine Ersetzungs-Normalisierung mehr nötig), Trefferindex/
// -länge landen dadurch automatisch an der richtigen Stelle im Original-Text.
function buildPattern() {
  const { textStems, codes, symbols } = loadStemCategories();
  const fragments = [
    ...textStems.map(stemToOriginalTextPattern),
    ...codes.map(codeToPattern),
    ...symbols.map(escapeRegex),
  ];

  if (fragments.length === 0) return null;
  return new RegExp(fragments.join('|'), 'iu');
}

// Prüft eine Nachricht gegen die Wortstamm-/Code-/Symbol-Liste - reine Muster-Prüfung (kein
// Kontextverständnis, siehe Konversation: kann ein Zitat der Regel nicht von einem tatsächlichen
// Verstoß unterscheiden). Gibt { text, index, length } zurück (Position im Original-Text, für die
// Fett-Markierung in flagMessage) oder null. Wird bei jedem Aufruf frisch aus der aktuellen Liste
// gebaut, damit Datei-Änderungen sofort greifen.
function findMatch(content) {
  if (!content) return null;

  const pattern = buildPattern();
  if (!pattern) return null;

  const match = pattern.exec(content.toLowerCase());
  if (!match) return null;

  return { text: match[0], index: match.index, length: match[0].length };
}

async function getAutomodChannel(guild) {
  const channelId = getLogChannel(guild.id, 'automod');
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel && channel.isTextBased() ? channel : null;
}

// Markiert den erkannten Ausschnitt im Original-Text fett - toLowerCase() ändert bei deutschem
// Text nie die Zeichenlänge/-position, die Indizes aus findMatch() passen also 1:1 auf den
// (groß-/kleinschreibungserhaltenen) Original-Text.
function highlightMatch(content, match) {
  const before = content.slice(0, match.index);
  const matched = content.slice(match.index, match.index + match.length);
  const after = content.slice(match.index + match.length);
  return `${before}**${matched}**${after}`;
}

// Löscht/bestraft NICHT automatisch (siehe Konversation: reine Substring-Prüfung erkennt kein
// Zitat/Meta-Diskussion) - markiert einen Treffer nur für ein Team-Mitglied zur manuellen Prüfung,
// mit Absender und vollständigem Original-Text (erkannter Ausschnitt fett hervorgehoben).
async function flagMessage(message, match) {
  const channel = await getAutomodChannel(message.guild);
  if (!channel) return;

  const highlighted = message.content ? highlightMatch(message.content, match) : '*Kein Textinhalt*';

  const embed = new EmbedBuilder()
    .setTitle('Automod: möglicher Verstoß')
    .addFields(
      { name: 'Nutzer', value: `${message.author} (${message.author.tag})` },
      { name: 'Kanal', value: `${message.channel}` },
      { name: 'Erkannt wegen', value: `\`${match.text}\`` },
      { name: 'Nachricht', value: highlighted.slice(0, 1000) },
      { name: 'Link', value: message.url }
    )
    .setColor(EMBED_COLOR)
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function checkMessage(message) {
  if (!message.guild || !message.author || message.author.bot) return;

  const match = findMatch(message.content);
  if (!match) return;

  await flagMessage(message, match);
}

module.exports = { checkMessage, findMatch };
