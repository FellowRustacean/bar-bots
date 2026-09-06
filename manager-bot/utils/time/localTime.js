const TIMEZONE = 'Europe/Berlin';
const DAY_MS = 24 * 60 * 60 * 1000;

// Ermittelt den Offset (in ms) zwischen UTC und der Zielzeitzone für einen bestimmten
// Zeitpunkt - berücksichtigt automatisch Sommer-/Winterzeit statt einen festen Wert
// (z. B. "+2") anzunehmen, der im Winter falsch wäre.
function getTimezoneOffsetMs(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );

  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

// Parst "YYYY-MM-DD" als Mitternacht in der lokalen Zeitzone (nicht UTC) und gibt den
// entsprechenden UTC-Zeitstempel in ms zurück.
function parseLocalDate(dateStr) {
  const guessed = new Date(`${dateStr}T00:00:00.000Z`);
  const offset = getTimezoneOffsetMs(guessed);
  return guessed.getTime() - offset;
}

// Formatiert einen Zeitstempel als "YYYY-MM-DD" in der lokalen Zeitzone.
function formatLocalDate(ms) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

// Liefert den UTC-Zeitstempel der lokalen Mitternacht des Tages, in den ms fällt.
function localDayBucketStart(ms) {
  return parseLocalDate(formatLocalDate(ms));
}

// Addiert Kalendertage (nicht einfach DAY_MS) - an Zeitumstellungstagen hat ein lokaler
// Tag nur 23 bzw. 25 Stunden, ein fixes +DAY_MS würde dort einen Tag verschieben.
function addLocalDays(ms, days) {
  const [year, month, day] = formatLocalDate(ms).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return parseLocalDate(shifted.toISOString().slice(0, 10));
}

module.exports = { TIMEZONE, DAY_MS, parseLocalDate, formatLocalDate, localDayBucketStart, addLocalDays };
