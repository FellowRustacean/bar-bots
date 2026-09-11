const BASE_XP = 500;
const GROWTH = 1.05;

// XP, die benötigt wird, um von Level n auf n+1 zu kommen.
function xpForLevel(n) {
  return Math.round(BASE_XP * Math.pow(GROWTH, n - 1));
}

// Ermittelt Level und Fortschritt innerhalb des aktuellen Levels aus der Gesamt-XP.
function getLevelProgress(totalXp) {
  let level = 1;
  let xpConsumed = 0;

  for (;;) {
    const needed = xpForLevel(level);
    if (xpConsumed + needed > totalXp) break;
    xpConsumed += needed;
    level++;
  }

  return {
    level,
    xpIntoLevel: totalXp - xpConsumed,
    xpForNextLevel: xpForLevel(level),
    totalXp,
  };
}

module.exports = { xpForLevel, getLevelProgress };
