const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTeam } = require('./roleDistribution');
const { openActionWindow, removeFromWindow } = require('./actionWindow');
const { muteAll, unmuteAll, setPlayerMute } = require('./voiceMute');
const { resolveDeathChains } = require('./deathChains');
const { checkWinCondition, checkNarrDayVoteWin, checkBountyHunterWin } = require('./winCondition');
const { removeGame, getGameByVoiceChannel } = require('./gameManager');
const { sendMainMessage, updateMainMessage, updateNarration, sendEndMessage } = require('./messaging');
const { createPausableTimer } = require('./pausableTimer');
const { joinGameVoiceChannel, leaveGameVoiceChannel, playVoiceline } = require('./voicelinePlayer');
const { MENTION_ME, MENTION_AUSWAHL, MENTION_NEXT } = require('./commandMentions');
const { logError } = require('../logs/errorLog');

// "Unendliche" Wartezeit im manuellen Modus - der Schritt geht erst über `/werwolf next`
// oder sobald alle Antworten vorliegen weiter.
const MANUAL_MAX_WAIT_MS = 24 * 60 * 60 * 1000;

// Voicelines werden erst so kurz vor Ablauf abgespielt, dass "Zeit läuft ab" noch stimmt.
const EILE_WARNING_MS = 20_000;

// Pausierbares Äquivalent zu `sleep()` - der Timer landet auf `game.activeTimer`,
// damit `/werwolf pause`/`continue`/`next` ihn steuern können.
function sleep(game, ms) {
  return new Promise((resolve) => {
    game.activeTimer = createPausableTimer(
      ms,
      () => {
        game.activeTimer = null;
        resolve();
      },
      { startPaused: game.paused }
    );
  });
}

// Unix-Sekunden für Discords `<t:...:R>`-Format - zeigt einen echt runterlaufenden,
// vom Discord-Client selbst gerenderten Countdown statt eines statischen Textes.
function relativeDeadline(durationMs) {
  return Math.floor((Date.now() + durationMs) / 1000);
}

// Im Auto-Modus läuft ein echter Timer mit Countdown-Anzeige. Im manuellen Modus (Standard)
// wartet der Schritt praktisch unbegrenzt und geht nur über `/werwolf next` oder vollständige
// Antworten weiter.
function resolveTimerConfig(game, durationMs) {
  if (game.mode === 'manual') {
    return { effectiveDurationMs: MANUAL_MAX_WAIT_MS, timerText: `*(weiter mit ${MENTION_NEXT})*` };
  }
  const deadline = relativeDeadline(durationMs);
  return { effectiveDurationMs: durationMs, timerText: `Zeit bis <t:${deadline}:R>.` };
}

// Sendet Text (optional mit Buttons) UND spielt optional eine Voiceline ab (fire-and-forget,
// verzögert den Spielablauf nicht - Voicelines sind rein kosmetisch).
async function narrate(client, game, text, voicelineName, components) {
  await updateNarration(client, game, text, components);
  if (voicelineName) playVoiceline(client, game, voicelineName).catch(() => {});
}

function buildSkipTurnRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('werwolf_skip_turn').setLabel('Zug überspringen').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function aliveWithRole(game, roleName) {
  return [...game.round.alive].filter((id) => game.assignments.get(id) === roleName);
}

async function removeDeadFromWerewolfChannel(guild, game, deadIds) {
  const channel = await guild.channels.fetch(game.werewolfChannelId).catch(() => null);
  if (!channel) return;
  for (const id of deadIds) {
    if (getTeam(game.assignments.get(id)) === 'werewolves') {
      await channel.permissionOverwrites.delete(id).catch(() => {});
    }
  }
}

async function processDeaths(client, game, initialDeaths, { announceDeaths = true } = {}) {
  const validInitial = initialDeaths.filter((id) => game.round.alive.has(id));
  if (validInitial.length === 0) {
    if (announceDeaths) await narrate(client, game, 'Niemand ist gestorben.', 'niemand_gestorben');
    return new Set();
  }

  const allDead = resolveDeathChains(game, validInitial);
  for (const id of allDead) game.round.alive.delete(id);

  // Gestorbene Spieler werden in der Haupt-Nachricht öffentlich aufgedeckt.
  for (const id of allDead) game.round.revealedRoles.add(id);

  const guild = await client.guilds.fetch(game.guildId).catch(() => null);
  if (guild) {
    for (const id of allDead) await setPlayerMute(guild, id, true, 'Werwolf: gestorben');
    await removeDeadFromWerewolfChannel(guild, game, allDead);
  }

  await updateMainMessage(client, game);

  if (announceDeaths) {
    const names = [...allDead].map((id) => `<@${id}>`).join(', ');
    await narrate(client, game, `💀 Gestorben: ${names}`, 'jemand_gestorben');
  }

  if (!game.winner) {
    for (const id of allDead) {
      const bountyWin = checkBountyHunterWin(game, id);
      if (bountyWin) {
        game.winner = bountyWin;
        break;
      }
    }
  }

  if (!game.winner) {
    const win = checkWinCondition(game);
    if (win) game.winner = win;
  }

  return allDead;
}

async function collectAction(
  client,
  game,
  {
    type,
    eligibleUserIds,
    picksPerUser = 1,
    durationMs,
    allowIgnite = false,
    announceText,
    sleepMessage,
    wakeVoiceline,
    eileVoiceline,
    sleepVoiceline,
    allowSkipButton = false,
  }
) {
  if (eligibleUserIds.length === 0) return new Map();

  const { effectiveDurationMs, timerText } = resolveTimerConfig(game, durationMs);
  const components = allowSkipButton ? buildSkipTurnRow() : undefined;
  await narrate(client, game, `${announceText} ${timerText}`, wakeVoiceline, components);

  // Die "Eile"-Erinnerung gibt es nur im Auto-Modus mit einem echten Countdown. Bewusst kein
  // pausierbarer Timer: sie ist rein kosmetisch, eine Pause verschiebt sie also nicht mit.
  let eileTimeout = null;
  if (game.mode === 'auto' && eileVoiceline && effectiveDurationMs > EILE_WARNING_MS) {
    eileTimeout = setTimeout(() => {
      playVoiceline(client, game, eileVoiceline).catch(() => {});
    }, effectiveDurationMs - EILE_WARNING_MS);
  }

  const responses = await openActionWindow(game, {
    type,
    eligibleUserIds,
    picksPerUser,
    durationMs: effectiveDurationMs,
    allowIgnite,
  });

  if (eileTimeout) clearTimeout(eileTimeout);

  if (game.phase === 'cancelled') throw new Error('WERWOLF_CANCELLED');

  if (sleepMessage) {
    await narrate(client, game, sleepMessage, sleepVoiceline);
    await sleep(game, 2000);
  }

  return responses;
}

// --- Erste Nacht: Amor, Jäger, Kopfgeldjäger -------------------------------------------------

async function runAmorAction(client, game) {
  const eligible = aliveWithRole(game, 'Amor');
  if (eligible.length === 0) return;

  const responses = await collectAction(client, game, {
    type: 'amor',
    eligibleUserIds: eligible,
    picksPerUser: 2,
    durationMs: 60_000,
    announceText:
      `Amor erwacht und wählt 2 Spieler aus, die sich verlieben. Nutze ${MENTION_AUSWAHL} \`<@User>\` zweimal auf verschiedene Spieler.`,
    sleepMessage: 'Amor schläft wieder ein...',
    wakeVoiceline: 'amor_erwacht',
    eileVoiceline: 'amor_eile',
    sleepVoiceline: 'amor_schlaeft_ein',
    allowSkipButton: true,
  });

  const picks = responses.get(eligible[0]);
  if (Array.isArray(picks) && picks.length === 2) {
    // Die Liebenden werden nicht per DM benachrichtigt - sie erfahren es über `/werwolf me`.
    game.round.lovers = [picks[0], picks[1]];
  }
}

async function runJägerAction(client, game) {
  const eligible = aliveWithRole(game, 'Jäger');
  if (eligible.length === 0) return;

  const responses = await collectAction(client, game, {
    type: 'jäger',
    eligibleUserIds: eligible,
    durationMs: 60_000,
    announceText: `Der Jäger erwacht und wählt sein verbundenes Ziel. Nutze ${MENTION_AUSWAHL} \`<@User>\`.`,
    sleepMessage: 'Der Jäger schläft wieder ein...',
    wakeVoiceline: 'jaeger_erwacht',
    eileVoiceline: 'jaeger_eile',
    sleepVoiceline: 'jaeger_schlaeft_ein',
    allowSkipButton: true,
  });

  for (const hunterId of eligible) {
    const picks = responses.get(hunterId);
    if (Array.isArray(picks) && picks[0]) game.round.hunterLinks.set(hunterId, picks[0]);
  }
}

function assignBountyTarget(game) {
  const hunterId = [...game.round.alive].find((id) => game.assignments.get(id) === 'Kopfgeldjäger');
  if (!hunterId) return;

  const candidates = [...game.round.alive].filter((id) => id !== hunterId);
  if (candidates.length === 0) return;

  const targetId = candidates[Math.floor(Math.random() * candidates.length)];
  game.round.bountyTarget = { hunterId, targetId };
}

// --- Jede Nacht: Werwölfe, Schamane, Doktor, Seher, Aura-Seher, Hexe, Priester, Schütze, Brandstifter ---

async function runWerewolfAction(client, game) {
  const eligible = [...aliveWithRole(game, 'Werwolf'), ...aliveWithRole(game, 'Werwolf Schamane')];
  if (eligible.length === 0) return;

  const responses = await collectAction(client, game, {
    type: 'werewolves',
    eligibleUserIds: eligible,
    durationMs: 90_000,
    announceText: `Die Werwölfe erwachen. Nutzt <#${game.werewolfChannelId}>, um euch abzusprechen. Stimmt per ${MENTION_AUSWAHL} \`<@User>\` für ein Opfer. Bei einem Unentschieden wird eins der Ziele per Zufall ausgewählt.`,
    sleepMessage: 'Die Werwölfe schlafen wieder ein...',
    wakeVoiceline: 'werwoelfe_erwachen',
    eileVoiceline: 'werwoelfe_eile',
    sleepVoiceline: 'werwoelfe_schlafen_ein',
  });

  const votes = eligible
    .map((id) => responses.get(id))
    .filter((r) => Array.isArray(r) && r[0])
    .map((r) => r[0]);
  if (votes.length === 0) return;

  const counts = new Map();
  for (const v of votes) counts.set(v, (counts.get(v) || 0) + 1);
  const maxVotes = Math.max(...counts.values());
  const topChoices = [...counts.entries()].filter(([, c]) => c === maxVotes).map(([id]) => id);

  game.round.werewolfVictim = topChoices[Math.floor(Math.random() * topChoices.length)];
}

async function runSchamaneAction(client, game) {
  const eligible = aliveWithRole(game, 'Werwolf Schamane');
  if (eligible.length === 0) return;

  const responses = await collectAction(client, game, {
    type: 'schamane',
    eligibleUserIds: eligible,
    durationMs: 60_000,
    announceText:
      `Der Werwolf-Schamane kann einen Spieler bestimmen, der Sehern in dieser Nacht fälschlich als Werwolf angezeigt wird. Nutze ${MENTION_AUSWAHL} \`<@User>\` oder \`/werwolf skip\`.`,
    sleepMessage: 'Der Schamane schläft wieder ein...',
    wakeVoiceline: 'schamane_erwacht',
    eileVoiceline: 'schamane_eile',
    sleepVoiceline: 'schamane_schlaeft_ein',
    allowSkipButton: true,
  });

  const picks = responses.get(eligible[0]);
  if (Array.isArray(picks) && picks[0]) game.round.schamaneDecoy = picks[0];
}

async function runDoktorAction(client, game) {
  const eligible = aliveWithRole(game, 'Doktor');
  if (eligible.length === 0) return;

  const responses = await collectAction(client, game, {
    type: 'doktor',
    eligibleUserIds: eligible,
    durationMs: 60_000,
    announceText: `Der Doktor erwacht und wählt einen Spieler zum Schutz. Nutze ${MENTION_AUSWAHL} \`<@User>\`.`,
    sleepMessage: 'Der Doktor schläft wieder ein...',
    wakeVoiceline: 'doktor_erwacht',
    eileVoiceline: 'doktor_eile',
    sleepVoiceline: 'doktor_schlaeft_ein',
    allowSkipButton: true,
  });

  const picks = responses.get(eligible[0]);
  if (Array.isArray(picks) && picks[0]) game.round.doctorProtect = picks[0];
}

// Die Rolle-/Aura-Enthüllung passiert nicht per DM, sondern direkt als ephemere Antwort
// auf den `/werwolf auswahl`-Befehl (siehe commands/werwolf/werwolf.js) - hier wird nur das
// Zeitfenster für die Aktion geöffnet, ohne die Antwort weiterzuverarbeiten.
async function runSeherAction(client, game) {
  const eligible = aliveWithRole(game, 'Seher');
  if (eligible.length === 0) return;

  await collectAction(client, game, {
    type: 'seher',
    eligibleUserIds: eligible,
    durationMs: 60_000,
    announceText: `Der Seher erwacht und darf die Rolle eines Spielers ansehen. Nutze ${MENTION_AUSWAHL} \`<@User>\`.`,
    sleepMessage: 'Der Seher schläft wieder ein...',
    wakeVoiceline: 'seher_erwacht',
    eileVoiceline: 'seher_eile',
    sleepVoiceline: 'seher_schlaeft_ein',
    allowSkipButton: true,
  });
}

async function runAuraSeherAction(client, game) {
  const eligible = aliveWithRole(game, 'Aura-Seher');
  if (eligible.length === 0) return;

  await collectAction(client, game, {
    type: 'aura-seher',
    eligibleUserIds: eligible,
    durationMs: 60_000,
    announceText: `Der Aura-Seher erwacht und darf sehen, ob ein Spieler gut oder böse ist. Nutze ${MENTION_AUSWAHL} \`<@User>\`.`,
    sleepMessage: 'Der Aura-Seher schläft wieder ein...',
    wakeVoiceline: 'auraseher_erwacht',
    eileVoiceline: 'auraseher_eile',
    sleepVoiceline: 'auraseher_schlaeft_ein',
    allowSkipButton: true,
  });
}

// Die Hexe sieht das Werwolf-Opfer nicht mehr in der öffentlichen Ansage (das wäre ein
// Spoiler für alle) - sie erfährt es privat über `/werwolf opfer`, das ihr einen
// "Opfer schützen"-Button zeigt (siehe commands/werwolf/werwolf.js).
async function runHexeHealAction(client, game, eligible) {
  const victim = game.round.werewolfVictim;

  const responses = await collectAction(client, game, {
    type: 'hexe-heal',
    eligibleUserIds: eligible,
    durationMs: 60_000,
    announceText:
      'Die Hexe kann ihren Heiltrank einsetzen. Nutze `/werwolf opfer`, um das Opfer der Werwölfe zu sehen und ggf. zu retten, oder `/werwolf skip`.',
    eileVoiceline: 'hexe_eile',
    wakeVoiceline: 'hexe_heiltrank',
    allowSkipButton: true,
  });

  const picks = responses.get(eligible[0]);
  if (Array.isArray(picks) && picks[0] === victim) {
    game.round.witchPotions.heal = false;
    game.round.witchHealUsedTonight = true;
  }
}

async function runHexePoisonAction(client, game, eligible) {
  const responses = await collectAction(client, game, {
    type: 'hexe-poison',
    eligibleUserIds: eligible,
    durationMs: 60_000,
    announceText: `Die Hexe kann ihren Gifttrank einsetzen. Nutze ${MENTION_AUSWAHL} \`<@User>\` oder \`/werwolf skip\`.`,
    eileVoiceline: 'hexe_eile',
    wakeVoiceline: 'hexe_gifttrank',
    allowSkipButton: true,
  });

  const picks = responses.get(eligible[0]);
  if (Array.isArray(picks) && picks[0]) {
    game.round.pendingKills.add(picks[0]);
    game.round.witchPotions.poison = false;
  }
}

async function runHexeAction(client, game) {
  const eligible = aliveWithRole(game, 'Hexe');
  if (eligible.length === 0) return;

  const canHeal = game.round.witchPotions.heal && !!game.round.werewolfVictim;
  const canPoison = game.round.witchPotions.poison;
  if (!canHeal && !canPoison) return;

  await narrate(client, game, 'Die Hexe erwacht.', 'hexe_erwacht');

  if (canHeal) await runHexeHealAction(client, game, eligible);
  if (canPoison) await runHexePoisonAction(client, game, eligible);

  await narrate(client, game, 'Die Hexe schläft wieder ein...', 'hexe_schlaeft_ein');
  await sleep(game, 2000);
}

async function runPriesterAction(client, game) {
  const eligible = aliveWithRole(game, 'Priester');
  if (eligible.length === 0 || game.round.priesterUsed) return;

  const responses = await collectAction(client, game, {
    type: 'priester',
    eligibleUserIds: eligible,
    durationMs: 60_000,
    announceText: `Der Priester kann sein heiliges Wasser einsetzen. Nutze ${MENTION_AUSWAHL} \`<@User>\` oder \`/werwolf skip\`.`,
    sleepMessage: 'Der Priester schläft wieder ein...',
    wakeVoiceline: 'priester_erwacht',
    eileVoiceline: 'priester_eile',
    sleepVoiceline: 'priester_schlaeft_ein',
    allowSkipButton: true,
  });

  const picks = responses.get(eligible[0]);
  if (Array.isArray(picks) && picks[0]) {
    const targetId = picks[0];
    game.round.priesterUsed = true;

    if (getTeam(game.assignments.get(targetId)) === 'werewolves') {
      game.round.pendingKills.add(targetId);
    } else {
      game.round.pendingKills.add(eligible[0]);
    }
  }
}

async function runSchützeAction(client, game) {
  const eligible = aliveWithRole(game, 'Schütze');
  if (eligible.length === 0 || game.round.shooterShotsLeft <= 0) return;

  const responses = await collectAction(client, game, {
    type: 'schütze',
    eligibleUserIds: eligible,
    durationMs: 60_000,
    announceText: `Der Schütze kann schießen (${game.round.shooterShotsLeft} Schuss übrig). Nutze ${MENTION_AUSWAHL} \`<@User>\` oder \`/werwolf skip\`.`,
    sleepMessage: 'Der Schütze schläft wieder ein...',
    wakeVoiceline: 'schuetze_erwacht',
    eileVoiceline: 'schuetze_eile',
    sleepVoiceline: 'schuetze_schlaeft_ein',
    allowSkipButton: true,
  });

  const picks = responses.get(eligible[0]);
  if (Array.isArray(picks) && picks[0]) {
    game.round.pendingKills.add(picks[0]);
    game.round.shooterShotsLeft -= 1;
    game.round.revealedRoles.add(eligible[0]);
    await updateMainMessage(client, game);
  }
}

async function runBrandstifterAction(client, game) {
  const eligible = aliveWithRole(game, 'Brandstifter');
  if (eligible.length === 0) return;

  const responses = await collectAction(client, game, {
    type: 'brandstifter',
    eligibleUserIds: eligible,
    picksPerUser: 2,
    durationMs: 60_000,
    allowIgnite: true,
    announceText:
      `Der Brandstifter kann 2 Spieler markieren (${MENTION_AUSWAHL} \`<@User>\` zweimal), alle Markierten anzünden (\`/werwolf ignite\`) oder nichts tun (\`/werwolf skip\`).`,
    sleepMessage: 'Der Brandstifter schläft wieder ein...',
    wakeVoiceline: 'brandstifter_erwacht',
    eileVoiceline: 'brandstifter_eile',
    sleepVoiceline: 'brandstifter_schlaeft_ein',
    allowSkipButton: true,
  });

  const response = responses.get(eligible[0]);
  if (response === 'ignite') {
    for (const markedId of game.round.arsonistMarked) game.round.pendingKills.add(markedId);
    game.round.arsonistMarked.clear();
  } else if (Array.isArray(response)) {
    for (const id of response) game.round.arsonistMarked.add(id);
  }
}

function resetNightlyState(game) {
  game.round.werewolfVictim = null;
  game.round.doctorProtect = null;
  game.round.schamaneDecoy = null;
  game.round.witchHealUsedTonight = false;
  game.round.pendingKills = new Set();
}

async function resolveNightDeaths(client, game) {
  if (game.round.werewolfVictim) {
    const victim = game.round.werewolfVictim;
    const protectedByDoctor = game.round.doctorProtect === victim;
    const healedByWitch = game.round.witchHealUsedTonight;
    const isArsonist = game.assignments.get(victim) === 'Brandstifter';
    if (!protectedByDoctor && !healedByWitch && !isArsonist) {
      game.round.pendingKills.add(victim);
    }
  }

  await narrate(client, game, '☀️ Die Sonne geht auf...', 'tag_beginnt');
  await sleep(game, 2000);

  await processDeaths(client, game, [...game.round.pendingKills]);

  const guild = await client.guilds.fetch(game.guildId).catch(() => null);
  if (guild) await unmuteAll(guild, game.round.alive, 'Werwolf-Tag');
}

async function runNight(client, game, isFirstNight) {
  if (game.phase === 'cancelled') throw new Error('WERWOLF_CANCELLED');

  game.phase = 'night';
  game.round.nightNumber += 1;
  resetNightlyState(game);

  const guild = await client.guilds.fetch(game.guildId);
  await muteAll(guild, game.round.alive, 'Werwolf-Nacht');

  await narrate(client, game, `🌙 **Nacht ${game.round.nightNumber}**\nDas Dorf schläft ein...`, 'nacht_beginnt');
  await sleep(game, 2000);

  const steps = [];
  if (isFirstNight) {
    steps.push(() => runAmorAction(client, game));
    steps.push(() => runJägerAction(client, game));
    steps.push(async () => assignBountyTarget(game));
  }
  steps.push(() => runWerewolfAction(client, game));
  steps.push(() => runSchamaneAction(client, game));
  steps.push(() => runDoktorAction(client, game));
  steps.push(() => runSeherAction(client, game));
  steps.push(() => runAuraSeherAction(client, game));
  steps.push(() => runHexeAction(client, game));
  steps.push(() => runPriesterAction(client, game));
  steps.push(() => runSchützeAction(client, game));
  steps.push(() => runBrandstifterAction(client, game));

  for (const step of steps) {
    if (game.phase === 'cancelled') throw new Error('WERWOLF_CANCELLED');
    if (game.winner) return;
    await step();
  }

  if (game.winner) return;
  await resolveNightDeaths(client, game);
}

async function runDay(client, game) {
  if (game.phase === 'cancelled') throw new Error('WERWOLF_CANCELLED');

  game.phase = 'day';

  const eligible = [...game.round.alive];
  const responses = await collectAction(client, game, {
    type: 'dorfvote',
    eligibleUserIds: eligible,
    durationMs: 120_000,
    announceText:
      `Das Dorf kann jetzt diskutieren, wer gelyncht werden soll. Abstimmen könnt ihr per ${MENTION_AUSWAHL} \`<@User>\`. Bei einem Unentschieden stirbt niemand.`,
    wakeVoiceline: 'abstimmung_beginnt',
    eileVoiceline: 'abstimmung_eile',
  });

  if (game.phase === 'cancelled') throw new Error('WERWOLF_CANCELLED');

  const votes = eligible
    .map((id) => responses.get(id))
    .filter((r) => Array.isArray(r) && r[0])
    .map((r) => r[0]);

  if (votes.length === 0) {
    await narrate(client, game, 'Niemand wurde gelyncht.', 'niemand_gelyncht');
    return;
  }

  const counts = new Map();
  for (const v of votes) counts.set(v, (counts.get(v) || 0) + 1);
  const maxVotes = Math.max(...counts.values());
  const topChoices = [...counts.entries()].filter(([, c]) => c === maxVotes).map(([id]) => id);

  if (topChoices.length > 1) {
    await narrate(client, game, 'Unentschieden - niemand wird gelyncht.', 'unentschieden');
    return;
  }

  const lynchedId = topChoices[0];
  const narrWin = checkNarrDayVoteWin(game, lynchedId);

  if (narrWin) {
    game.round.alive.delete(lynchedId);
    game.round.revealedRoles.add(lynchedId);
    await updateMainMessage(client, game);

    const guild = await client.guilds.fetch(game.guildId).catch(() => null);
    if (guild) await setPlayerMute(guild, lynchedId, true, 'Werwolf: gestorben');

    await narrate(client, game, `💀 <@${lynchedId}> wurde vom Dorf gelyncht.`, 'gelyncht');
    game.winner = narrWin;
    return;
  }

  await narrate(client, game, `⚖️ Das Dorf hat entschieden: <@${lynchedId}> wird gelyncht.`, 'gelyncht');
  await processDeaths(client, game, [lynchedId], { announceDeaths: false });
}

const WIN_VOICELINES = {
  dorf: 'sieg_dorf',
  werewolves: 'sieg_werwoelfe',
  lovers: 'sieg_liebespaar',
  narr: 'sieg_narr',
  kopfgeldjäger: 'sieg_kopfgeldjaeger',
  brandstifter: 'sieg_brandstifter',
};

async function cleanupGame(client, game, finalMessage, voicelineName) {
  // Am Spielende werden alle verbliebenen Rollen in der Haupt-Nachricht aufgedeckt.
  if (game.round) {
    for (const userId of game.assignments.keys()) game.round.revealedRoles.add(userId);
    await updateMainMessage(client, game);
  }

  if (finalMessage) await sendEndMessage(client, game, finalMessage);
  if (voicelineName) await playVoiceline(client, game, voicelineName);

  const guild = await client.guilds.fetch(game.guildId).catch(() => null);
  if (guild) {
    await unmuteAll(guild, game.players, 'Werwolf: Spielende').catch(() => {});
    if (game.werewolfChannelId) {
      const channel = await guild.channels.fetch(game.werewolfChannelId).catch(() => null);
      if (channel) await channel.delete('Werwolf-Spiel beendet').catch(() => {});
    }
  }

  // Kurze Nachwirkzeit, bevor der Bot den Channel verlässt (z. B. damit die letzte
  // Voiceline/Stimmung noch nachklingen kann).
  await new Promise((resolve) => setTimeout(resolve, 30_000));

  leaveGameVoiceChannel(game);

  // Nur entfernen, falls in der Zwischenzeit nicht bereits eine neue Runde im selben
  // Voice-Channel erstellt wurde (sonst würde deren Eintrag hier überschrieben/gelöscht).
  if (getGameByVoiceChannel(game.voiceChannelId) === game) {
    removeGame(game.voiceChannelId);
  }
}

async function endGame(client, game, winner) {
  game.phase = 'ended';
  const voicelineName = winner ? WIN_VOICELINES[winner.winner] : null;
  await cleanupGame(client, game, winner ? winner.message : 'Das Spiel ist beendet.', voicelineName);
}

async function runGameLoop(client, game) {
  try {
    game.phase = 'starting';
    // Der Bot joint sofort, sobald /werwolf start genutzt wird - noch vor dem Aufbau der
    // Haupt-Nachricht, damit er möglichst früh im Voice-Channel steht.
    await joinGameVoiceChannel(client, game);
    await sendMainMessage(client, game);

    const { effectiveDurationMs, timerText } = resolveTimerConfig(game, 60_000);
    await narrate(
      client,
      game,
      `🐺 **Willkommen bei Werwolf!** Schaut euch in Ruhe eure Rolle per ${MENTION_ME} an. ${timerText}\n**Bitte stellt die Lautstärke des Bots auf 100%!**`,
      'intro_willkommen'
    );

    let introTimeout = null;
    if (game.mode === 'auto' && effectiveDurationMs > EILE_WARNING_MS) {
      introTimeout = setTimeout(() => {
        playVoiceline(client, game, 'intro_start_bald').catch(() => {});
      }, effectiveDurationMs - EILE_WARNING_MS);
    }

    await sleep(game, effectiveDurationMs);
    if (introTimeout) clearTimeout(introTimeout);
    if (game.phase === 'cancelled') throw new Error('WERWOLF_CANCELLED');

    await runNight(client, game, true);
    if (game.winner) return endGame(client, game, game.winner);

    for (;;) {
      await runDay(client, game);
      if (game.winner) return endGame(client, game, game.winner);
      if (game.phase === 'cancelled') break;

      await runNight(client, game, false);
      if (game.winner) return endGame(client, game, game.winner);
      if (game.phase === 'cancelled') break;
    }

    if (game.phase === 'cancelled') {
      await cleanupGame(client, game, 'Das Werwolf-Spiel wurde abgebrochen.', 'spiel_abgebrochen');
    }
  } catch (err) {
    if (err?.message === 'WERWOLF_CANCELLED') {
      await cleanupGame(client, game, 'Das Werwolf-Spiel wurde abgebrochen.', 'spiel_abgebrochen');
      return;
    }

    await logError(err, { context: 'Werwolf-Spielablauf', guildId: game.guildId });
    await cleanupGame(client, game, 'Im Spielablauf ist ein Fehler aufgetreten. Das Spiel wurde beendet.');
  }
}

function initializeRound(game) {
  game.round = {
    nightNumber: 0,
    alive: new Set(game.players),
    lovers: null,
    hunterLinks: new Map(),
    bountyTarget: null,
    witchPotions: { heal: true, poison: true },
    priesterUsed: false,
    shooterShotsLeft: 2,
    revealedRoles: new Set(),
    arsonistMarked: new Set(),
    werewolfVictim: null,
    doctorProtect: null,
    schamaneDecoy: null,
    witchHealUsedTonight: false,
    pendingKills: new Set(),
  };
  game.winner = null;
  game.paused = false;
  game.activeTimer = null;
}

// Pausiert den aktuell laufenden Timer (Aktionsfenster oder Übergangs-Pause).
async function pauseGame(client, game) {
  if (game.paused) return;

  game.paused = true;
  game.activeTimer?.pause();
  await narrate(client, game, '⏸️ Das Spiel wurde pausiert. Nutze `/werwolf continue`, um fortzufahren.', 'pause');
}

// Setzt einen pausierten Timer mit der verbleibenden Restzeit fort.
async function resumeGame(client, game) {
  if (!game.paused) return;

  game.paused = false;
  const remaining = game.activeTimer?.getRemaining() ?? 0;
  game.activeTimer?.resume();

  if (remaining > 0) {
    const deadline = Math.floor((Date.now() + remaining) / 1000);
    await narrate(client, game, `▶️ Das Spiel wird fortgesetzt. Zeit bis <t:${deadline}:R>.`, 'fortsetzen');
  } else {
    await narrate(client, game, '▶️ Das Spiel wird fortgesetzt.', 'fortsetzen');
  }
}

// Löst den aktuell laufenden Schritt sofort aus (für `/werwolf next` im manuellen Modus).
async function advanceGame(client, game) {
  if (!game.activeTimer) return false;

  game.activeTimer.trigger();
  return true;
}

function startGame(client, game, channelId) {
  game.narratorChannelId = channelId;
  game.mainMessageChannelId = channelId;
  initializeRound(game);

  runGameLoop(client, game).catch((err) => {
    logError(err, { context: 'Werwolf-Spiel (unerwartet)', guildId: game.guildId }).catch(() => {});
  });
}

async function handlePlayerLeftVoice(client, game, userId) {
  if (!game.round || !game.round.alive.has(userId)) return;

  removeFromWindow(game, userId);
  await narrate(client, game, `🚪 <@${userId}> hat den Voice-Channel verlassen und gilt als gestorben.`, 'spieler_verlaesst');
  await processDeaths(client, game, [userId], { announceDeaths: false });
}

module.exports = { startGame, handlePlayerLeftVoice, pauseGame, resumeGame, advanceGame };
