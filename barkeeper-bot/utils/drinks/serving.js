const { ensureSupply } = require('./supply');
const { pickRandomLine } = require('../../../shared/lib/messageLines');

function randomDelay() {
  return 2000 + Math.floor(Math.random() * 3000); // 2-5s
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// "die Cola" -> deine Cola, "der/das X" -> dein X.
function possessiveFor(artikel) {
  return artikel === 'die' ? 'deine' : 'dein';
}

// "die Cola" -> eine Cola, "der Kaffee" -> einen Kaffee, "das Wasser" -> ein Wasser.
function indefiniteArticleFor(artikel) {
  if (artikel === 'der') return 'einen';
  if (artikel === 'die') return 'eine';
  return 'ein';
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// Alle Platzhalter nutzen bewusst nur den Nominativ (dein/deine als Subjekt, nie als Akkusativ-
// Objekt wie "deinen Kaffee") - so bleibt die Grammatik unabhängig vom Artikel des Getränks immer
// korrekt, ohne für jeden Fall (der/die/das) eine eigene Formulierung zu brauchen.
// Bewusst KEINE Formulierung wie "kommt sofort dran"/"ist schon vorgemerkt" - impliziert eine
// Warteschlange, die es im Regelfall (keine andere Bestellung gleichzeitig) gar nicht gibt. Der
// tatsaechliche Warteschlangen-Hinweis kommt separat und nur bei Bedarf dazu (siehe pendingCount
// in getraenk.js/outboxPoller.js) - diese Zeilen hier gelten fuer die sofortige Zubereitung.
// Die Textbausteine selbst liegen in shared/data/messages/barkeeper.json (Key "orderComing") -
// wird bei JEDEM Aufruf frisch von der Platte gelesen, eine Aenderung dort greift sofort, ohne
// dass der Bot neu gestartet werden muss (siehe messageLines.js).

function renderTemplate(template, displayName, drinkName, artikel) {
  const possessive = possessiveFor(artikel);
  return template
    .replace(/\{possessiveCap\}/g, capitalize(possessive))
    .replace(/\{possessive\}/g, possessive)
    .replace(/\{drink\}/g, `**${drinkName}**`)
    .replace(/\{user\}/g, displayName);
}

// displayName ist bewusst ein reiner Text-String (kein Mention-Objekt) - der Nutzer wird
// namentlich erwähnt, aber nicht angepingt.
function randomOrderComingLine(displayName, drinkName, artikel) {
  const template = pickRandomLine('barkeeper', 'orderComing');
  return renderTemplate(template, displayName, drinkName, artikel);
}

// Schickt die Zubereitungsschritte eines Getränks in den angegebenen Channel - die gemeinsame
// Logik hinter /getränk UND automatischen Bot-Bestellungen (Bot-Interaktionen). Bewusst KEINE
// abschließende "hier ist dein Getränk"-Zeile mehr - der letzte Zubereitungsschritt erwähnt
// {user} schon als Empfänger, eine zusätzliche Ready-Zeile war redundant.
async function sendPreparationSteps(channel, displayName, drinkName, entry) {
  await ensureSupply(channel, entry.vorrat);

  for (const step of entry.steps) {
    await sleep(randomDelay());
    await channel.send(step.replace(/\{user\}/g, displayName));
  }
}

module.exports = {
  possessiveFor,
  indefiniteArticleFor,
  randomOrderComingLine,
  sendPreparationSteps,
};
