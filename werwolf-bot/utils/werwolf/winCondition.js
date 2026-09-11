const { getTeam } = require('./roleDistribution');

// Generische, aus dem aktuellen "alive"-Zustand ableitbare Siegbedingungen.
// Ereignisbezogene Sonderfälle (Narr durch Dorf-Abstimmung, Kopfgeldjäger-Ziel gestorben)
// werden separat direkt beim auslösenden Ereignis geprüft (siehe checkNarrDayVoteWin /
// checkBountyHunterWin).
function checkWinCondition(game) {
  const alive = [...game.round.alive];
  if (alive.length === 0) return { winner: 'niemand', message: 'Alle Spieler sind gestorben. Niemand gewinnt.' };

  const aliveRoles = alive.map((id) => ({ id, role: game.assignments.get(id) }));
  const werewolves = aliveRoles.filter((p) => getTeam(p.role) === 'werewolves');
  const villagers = aliveRoles.filter((p) => getTeam(p.role) === 'dorf');
  const brandstifter = aliveRoles.find((p) => p.role === 'Brandstifter');

  // Brandstifter gewinnt, wenn er der letzte lebende Spieler ist.
  if (brandstifter && alive.length === 1) {
    return { winner: 'brandstifter', message: `🔥 <@${brandstifter.id}> (Brandstifter) ist der letzte Überlebende und gewinnt!` };
  }

  // Liebespaar (+ Amor) gewinnt, wenn sie zu zweit bzw. zu dritt (mit Amor) übrig sind.
  if (game.round.lovers) {
    const [l1, l2] = game.round.lovers;
    const loversAlive = game.round.alive.has(l1) && game.round.alive.has(l2);
    if (loversAlive) {
      const amorId = alive.find((id) => game.assignments.get(id) === 'Amor');
      const others = alive.filter((id) => id !== l1 && id !== l2 && id !== amorId);
      if (others.length === 0) {
        const names = [l1, l2, amorId].filter(Boolean).map((id) => `<@${id}>`).join(', ');
        return { winner: 'lovers', message: `💞 Das Liebespaar gewinnt! (${names})` };
      }
    }
  }

  if (werewolves.length === 0) {
    return { winner: 'dorf', message: '🌞 Alle Werwölfe sind tot. Das Dorf gewinnt!' };
  }

  if (werewolves.length >= villagers.length) {
    return { winner: 'werewolves', message: '🐺 Die Werwölfe sind in der Überzahl. Die Werwölfe gewinnen!' };
  }

  return null;
}

function checkNarrDayVoteWin(game, killedUserId) {
  if (game.assignments.get(killedUserId) === 'Narr') {
    return { winner: 'narr', message: `🤡 <@${killedUserId}> war der Narr und wurde vom Dorf gelyncht - der Narr gewinnt!` };
  }
  return null;
}

function checkBountyHunterWin(game, deadUserId) {
  const bounty = game.round.bountyTarget;
  if (bounty && bounty.targetId === deadUserId && game.round.alive.has(bounty.hunterId)) {
    return { winner: 'kopfgeldjäger', message: `💰 <@${bounty.hunterId}> (Kopfgeldjäger) hat sein Ziel eliminiert und gewinnt!` };
  }
  return null;
}

module.exports = { checkWinCondition, checkNarrDayVoteWin, checkBountyHunterWin };
