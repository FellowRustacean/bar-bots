// Standardisierter "einmal täglich, um Mitternacht, mit Nachhol-Logik falls der Bot über Nacht
// offline war"-Scheduler - vorher fast identisch dupliziert in warnDecay.js (Türsteher) und
// memberSnapshot.js (Manager). Bewusst kein require(...) der jeweiligen Speicher-Funktionen hier
// (siehe botInteractions.js für die Begründung) - der Aufrufer reicht seine eigenen
// getLastRunDate()/setLastRunDate()-Funktionen rein.
function getDateString(date) {
  return date.toLocaleDateString('sv-SE'); // YYYY-MM-DD, lokale Zeitzone
}

// Startet den Tages-Takt: holt beim Aufruf sofort einen verpassten Tag nach (falls der Bot über
// Mitternacht offline war), plant dann die nächste Ausführung auf die kommende lokale Mitternacht
// und läuft danach alle 24h weiter.
function startDailyTicker({ task, getLastRunDate, setLastRunDate }) {
  function runAndRecord() {
    task();
    setLastRunDate(getDateString(new Date()));
  }

  function catchUpIfMissed() {
    const lastRunDate = getLastRunDate();
    const today = getDateString(new Date());

    if (lastRunDate === null) {
      // Erster Start überhaupt - kein Vergleichswert vorhanden, nichts nachzuholen.
      setLastRunDate(today);
      return;
    }

    if (lastRunDate !== today) {
      runAndRecord();
    }
  }

  catchUpIfMissed();

  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  const delay = nextMidnight.getTime() - now.getTime();

  setTimeout(() => {
    runAndRecord();
    setInterval(runAndRecord, 24 * 60 * 60 * 1000);
  }, delay);

  return nextMidnight;
}

module.exports = { startDailyTicker };
