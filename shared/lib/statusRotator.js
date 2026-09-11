// Kein require('discord.js') hier - shared/lib-Dateien haben bewusst keine eigenen npm-
// Abhängigkeiten (node_modules liegt nur in den einzelnen Bot-Ordnern, nicht in shared/), siehe
// z. B. botInteractions.js. ActivityType.Custom entspricht laut discord.js-Enum stabil dem
// Discord-API-Wert 4 ("Custom Status").
const ACTIVITY_TYPE_CUSTOM = 4;

const MIN_INTERVAL_MS = 10 * 60 * 1000;
const MAX_INTERVAL_MS = 20 * 60 * 1000;

function randomIntervalMs() {
  return MIN_INTERVAL_MS + Math.floor(Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS));
}

// getMessages ist eine Funktion (kein statisches Array) - wird bei jedem Wechsel frisch
// aufgerufen, damit eine Änderung an der zugrunde liegenden Datei (siehe utils/status/messages.js
// in jedem Bot) ohne Neustart wirkt, statt beim Start einmalig eingefroren zu werden.
//
// Setzt einen zufälligen Custom-Status (reiner Text, kein "Spielt .../Schaut ..."-Präfix) und
// wechselt ihn danach alle 10-20 Minuten (jedes Mal neu ausgewürfelt) - bewusst per rekursivem
// setTimeout statt setInterval, damit jedes Intervall unabhängig zufällig ist statt fix.
function startStatusRotator(client, getMessages) {
  let lastIndex = -1;

  function applyRandomStatus() {
    const messages = getMessages();
    if (!messages || messages.length === 0) return;

    let index;
    do {
      index = Math.floor(Math.random() * messages.length);
    } while (messages.length > 1 && index === lastIndex);
    lastIndex = index;

    client.user.setPresence({
      activities: [{ name: messages[index], type: ACTIVITY_TYPE_CUSTOM, state: messages[index] }],
    });
  }

  function scheduleNext() {
    setTimeout(() => {
      applyRandomStatus();
      scheduleNext();
    }, randomIntervalMs());
  }

  applyRandomStatus();
  scheduleNext();
}

module.exports = { startStatusRotator };
