// Ein Timer, der pausiert und mit der verbleibenden Restzeit fortgesetzt werden kann
// (statt bei Fortsetzung wieder von vorne zu laufen), und der per `trigger()` auch
// sofort ausgelöst werden kann (für `/werwolf next` im manuellen Modus).
function createPausableTimer(ms, onComplete, { startPaused = false } = {}) {
  let remaining = ms;
  let handle = null;
  let running = false;
  let lastStart = null;
  let done = false;

  function complete() {
    if (done) return;
    done = true;
    if (handle) clearTimeout(handle);
    running = false;
    onComplete();
  }

  function start() {
    if (running || done) return;
    running = true;
    lastStart = Date.now();
    handle = setTimeout(complete, remaining);
  }

  function pause() {
    if (!running) return;
    clearTimeout(handle);
    remaining -= Date.now() - lastStart;
    if (remaining < 0) remaining = 0;
    running = false;
  }

  // Bricht den Timer ab, OHNE onComplete auszulösen (interner Gebrauch, z. B. wenn
  // ein Aktionsfenster bereits auf anderem Weg abgeschlossen wurde).
  function cancel() {
    done = true;
    if (handle) clearTimeout(handle);
    running = false;
  }

  // Löst den Timer sofort aus, als wäre die Zeit abgelaufen (für `/werwolf next`).
  function trigger() {
    complete();
  }

  function getRemaining() {
    return running ? remaining - (Date.now() - lastStart) : remaining;
  }

  if (!startPaused) start();

  return { pause, resume: start, cancel, trigger, getRemaining };
}

module.exports = { createPausableTimer };
