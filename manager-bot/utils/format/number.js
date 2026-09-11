// Rundet auf eine Ganzzahl und formatiert mit "." als Tausender-Trennzeichen (z.B. 4959 -> "4.959").
function formatNumber(value) {
  return Math.round(value).toLocaleString('de-DE');
}

module.exports = { formatNumber };
