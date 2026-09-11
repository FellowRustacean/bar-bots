// Einfache In-Memory-Warteschlange pro Channel (kein DB-Table nötig - überlebt bewusst keinen
// Neustart, das ist für eine "nicht zwei Getränke gleichzeitig zubereiten"-Reihenfolge
// unproblematisch). Ein Channel verarbeitet immer nur EINE Bestellung gleichzeitig, in der
// Reihenfolge, in der sie eingereiht wurden.
const channelQueues = new Map(); // channelId -> { tasks: Array<() => Promise>, processing: boolean }

function getState(channelId) {
  let state = channelQueues.get(channelId);
  if (!state) {
    state = { tasks: [], processing: false };
    channelQueues.set(channelId, state);
  }
  return state;
}

function runNext(channelId) {
  const state = getState(channelId);
  if (state.processing) return;

  const next = state.tasks.shift();
  if (!next) {
    // Leer und untätig - Eintrag entfernen statt ihn für immer im Speicher zu behalten (sonst ein
    // kleines Objekt pro je genutztem Channel, das nie wieder verschwindet).
    channelQueues.delete(channelId);
    return;
  }

  state.processing = true;
  Promise.resolve()
    .then(next)
    .catch(() => {}) // eine einzelne fehlschlagende Bestellung darf die Warteschlange nicht blockieren
    .then(() => {
      state.processing = false;
      runNext(channelId);
    });
}

// Reiht eine Bestellung (async-Funktion ohne Argumente) für den angegebenen Channel ein. Läuft
// erst, sobald alle zuvor eingereihten Bestellungen desselben Channels fertig sind.
function enqueueOrder(channelId, task) {
  const state = getState(channelId);
  state.tasks.push(task);
  runNext(channelId);
}

// Wie viele Bestellungen vor einer NEUEN Bestellung noch dran wären (0 = würde sofort starten).
function pendingCount(channelId) {
  const state = channelQueues.get(channelId);
  if (!state) return 0;
  return state.tasks.length + (state.processing ? 1 : 0);
}

module.exports = { enqueueOrder, pendingCount };
