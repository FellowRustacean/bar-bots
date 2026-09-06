const { createPausableTimer } = require('./pausableTimer');

// Primitive zum Einsammeln von `/werwolf auswahl` / `/werwolf skip` / `/werwolf ignite`
// Eingaben einer Gruppe berechtigter Spieler innerhalb eines Zeitlimits.

// Öffnet ein Aktionsfenster und löst das zurückgegebene Promise auf, sobald entweder
// alle Berechtigten geantwortet haben oder die Zeit abgelaufen ist. Der Timer wird auf
// `game.activeTimer` abgelegt, damit `/werwolf pause`/`continue` ihn steuern können.
function openActionWindow(game, { type, eligibleUserIds, picksPerUser = 1, durationMs, allowIgnite = false }) {
  const eligible = new Set(eligibleUserIds);

  return new Promise((resolve) => {
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      game.activeTimer?.cancel();
      game.activeTimer = null;
      const responses = game.pendingAction.responses;
      game.pendingAction = null;
      resolve(responses);
    };

    game.pendingAction = {
      type,
      eligibleUserIds: eligible,
      picksPerUser,
      allowIgnite,
      responses: new Map(), // userId -> string[] targetIds | 'skip' | 'ignite'
      finish,
    };

    // Niemand berechtigt (z. B. Rolle bereits tot) -> sofort abschließen.
    if (eligible.size === 0) {
      finish();
      return;
    }

    game.activeTimer = createPausableTimer(durationMs, finish, { startPaused: game.paused });
  });
}

function isAllDone(action) {
  for (const userId of action.eligibleUserIds) {
    const r = action.responses.get(userId);
    if (r === undefined) return false;
    if (r === 'skip' || r === 'ignite') continue;
    if (r.length < action.picksPerUser) return false;
  }
  return true;
}

function submitTarget(game, userId, targetId) {
  const action = game.pendingAction;
  if (!action) return { ok: false, reason: 'no-action' };
  if (!action.eligibleUserIds.has(userId)) return { ok: false, reason: 'not-eligible' };

  const existing = action.responses.get(userId);
  const list = Array.isArray(existing) ? existing : [];

  if (list.length >= action.picksPerUser) return { ok: false, reason: 'already-done' };
  if (list.includes(targetId)) return { ok: false, reason: 'duplicate-target' };

  list.push(targetId);
  action.responses.set(userId, list);

  const complete = list.length >= action.picksPerUser;
  if (isAllDone(action)) action.finish();

  return { ok: true, complete, remaining: action.picksPerUser - list.length };
}

function submitSkip(game, userId) {
  const action = game.pendingAction;
  if (!action) return { ok: false, reason: 'no-action' };
  if (!action.eligibleUserIds.has(userId)) return { ok: false, reason: 'not-eligible' };

  action.responses.set(userId, 'skip');
  if (isAllDone(action)) action.finish();

  return { ok: true };
}

function submitIgnite(game, userId) {
  const action = game.pendingAction;
  if (!action) return { ok: false, reason: 'no-action' };
  if (!action.eligibleUserIds.has(userId)) return { ok: false, reason: 'not-eligible' };
  if (!action.allowIgnite) return { ok: false, reason: 'not-allowed' };

  action.responses.set(userId, 'ignite');
  if (isAllDone(action)) action.finish();

  return { ok: true };
}

// Entfernt einen Spieler aus dem aktuell offenen Fenster (z. B. weil er gestorben ist)
// und prüft, ob das Fenster dadurch abgeschlossen werden kann.
function removeFromWindow(game, userId) {
  const action = game.pendingAction;
  if (!action || !action.eligibleUserIds.has(userId)) return;

  action.eligibleUserIds.delete(userId);
  if (isAllDone(action)) action.finish();
}

module.exports = { openActionWindow, submitTarget, submitSkip, submitIgnite, removeFromWindow };
