// Erweitert eine Menge frisch Verstorbener um Kettentode durch Liebespaar- und
// Jäger-Verbindungen (rekursiv, bis kein neuer Tod mehr ausgelöst wird).
function resolveDeathChains(game, initialDeaths) {
  const toProcess = [...initialDeaths];
  const allDead = new Set(initialDeaths);

  while (toProcess.length > 0) {
    const deadId = toProcess.pop();

    // Liebespaar: stirbt einer, stirbt der andere.
    if (game.round.lovers) {
      const [l1, l2] = game.round.lovers;
      const partner = deadId === l1 ? l2 : deadId === l2 ? l1 : null;
      if (partner && game.round.alive.has(partner) && !allDead.has(partner)) {
        allDead.add(partner);
        toProcess.push(partner);
      }
    }

    // Jäger: stirbt der Jäger, stirbt sein verbundenes Ziel (nicht umgekehrt).
    const hunterTarget = game.round.hunterLinks.get(deadId);
    if (hunterTarget && game.round.alive.has(hunterTarget) && !allDead.has(hunterTarget)) {
      allDead.add(hunterTarget);
      toProcess.push(hunterTarget);
    }
  }

  return allDead;
}

module.exports = { resolveDeathChains };
