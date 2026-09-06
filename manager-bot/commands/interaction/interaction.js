const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const store = require('../../storage/botInteractions');
const { pickWeighted } = require('../../../shared/lib/weightedRandom');
const { runTeamBreak } = require('../../utils/botInteractions/teamBreak');
const teamMeetingStore = require('../../storage/teamMeeting');

const data = new SlashCommandBuilder()
  .setName('interaction')
  .setDescription('Steuert Bot-Interaktionen manuell')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName('trigger')
      .setDescription('Löst sofort eine Bot-Interaktion aus (zum Testen) und setzt den Zufallstakt neu')
      .addStringOption((opt) =>
        opt
          .setName('interaction')
          .setDescription('Bestimmte Interaktion auslösen (leer lassen für zufällig)')
          .setRequired(false)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('voice-start').setDescription('Startet das Team-Päuschen sofort (ignoriert die 10-22-Uhr-Grenze)')
  )
  .addSubcommand((sub) =>
    sub.setName('voice-stop').setDescription('Beendet ein laufendes Team-Päuschen vorzeitig')
  );

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();

  const matches = store
    .getEnabledInteractions()
    .filter((entry) => entry.key.toLowerCase().includes(focused) || entry.label.toLowerCase().includes(focused))
    .slice(0, 25);

  const suggestions = matches.map((entry) => ({
    name: `${entry.label} (${entry.botName}, Gewicht ${entry.weight})`,
    value: entry.key,
  }));

  // "next" ist ein eingebauter Sonderwert (keine echte Interaktion) - löst nichts aus, zeigt nur
  // die verbleibende Zeit bis zum nächsten automatischen Zufallslauf.
  if ('next'.includes(focused)) {
    suggestions.unshift({ name: '⏱️ Timer: Zeit bis zur nächsten automatischen Interaktion', value: 'next' });
  }

  await interaction.respond(suggestions.slice(0, 25));
}

// Wartet, bis der zuständige Bot-Prozess den Job abgearbeitet hat (dessen Poller läuft alle 5s),
// damit die Antwort das tatsächliche Ergebnis zeigt statt blind "ausgelöst" zu melden.
async function waitForJob(jobId, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = store.getInteractionJob(jobId);
    // 'running' ist noch kein Endzustand - manche Interaktionen (z. B. mehrere Tische mit 30-60s
    // Pause dazwischen) laufen länger als das Timeout hier, weiterpollen bringt also nichts.
    if (job && job.status !== 'pending' && job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return store.getInteractionJob(jobId);
}

async function executeVoiceStart(interaction) {
  const active = teamMeetingStore.getActiveParticipants(interaction.guildId);

  if (active.length > 0) {
    await interaction.reply({
      content: '❌ Es läuft bereits ein Team-Päuschen - erst mit `/interaction voice-stop` beenden.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Ruft die Trigger-Logik direkt auf (kein Umweg über die job queue/canRun) - dadurch gilt hier
  // bewusst NICHT die 10-22-Uhr-Grenze aus canRunTeamBreak, die nur den automatischen
  // Zufallstakt betrifft.
  await runTeamBreak(interaction.client);

  await interaction.editReply('☕ Team-Päuschen gestartet.');
}

async function executeVoiceStop(interaction) {
  const active = teamMeetingStore.getActiveParticipants(interaction.guildId);

  if (active.length === 0) {
    await interaction.reply({ content: 'ℹ️ Aktuell läuft kein Team-Päuschen.', flags: MessageFlags.Ephemeral });
    return;
  }

  for (const participant of active) {
    if (participant.joined) {
      teamMeetingStore.forceLeaveNow(participant.participantId);
    } else {
      teamMeetingStore.cancelParticipant(participant.participantId);
    }
  }

  await interaction.reply({
    content: '🛑 Team-Päuschen wird vorzeitig beendet - die Bots verlassen den Tisch innerhalb der nächsten Sekunden.',
    flags: MessageFlags.Ephemeral,
  });
}

async function executeTrigger(interaction) {
  const requestedKey = interaction.options.getString('interaction');

  if (requestedKey === 'next') {
    const nextRunAt = store.getNextRunAt();
    if (!nextRunAt) {
      await interaction.reply({
        content: 'Der Zufalls-Timer wurde noch nicht initialisiert - läuft nach dem ersten Tick automatisch an.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const seconds = Math.floor(nextRunAt / 1000);
    await interaction.reply({
      content: `Nächste automatische Bot-Interaktion: <t:${seconds}:R> (<t:${seconds}:f>)`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const catalog = store.getEnabledInteractions();

  if (catalog.length === 0) {
    await interaction.reply({
      content: 'Es sind noch keine Bot-Interaktionen registriert.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let chosen;
  if (requestedKey) {
    chosen = catalog.find((entry) => entry.key === requestedKey);
    if (!chosen) {
      await interaction.reply({
        content: `Unbekannte Interaktion: "${requestedKey}". Nutze die Vorschlagsliste.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } else {
    chosen = pickWeighted(catalog);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Verschiebt den nächsten regulären Zufallslauf, statt zusätzlich zu ihm aufzutreten - sonst
  // könnte kurz nach einem manuellen Test ungewollt sofort noch eine reguläre Interaktion folgen.
  store.resetSchedule();

  const jobId = store.enqueueInteractionJob(chosen.botName, chosen.key);
  const job = await waitForJob(jobId);

  if (!job || job.status === 'pending') {
    await interaction.editReply({
      content: `"${chosen.label}" (${chosen.botName}) wurde eingereiht, aber der Bot hat noch nicht reagiert - ist er online?`,
    });
    return;
  }

  if (job.status === 'running') {
    await interaction.editReply({
      content: `"${chosen.label}" (${chosen.botName}) läuft noch im Hintergrund weiter (dauert bei mehreren Schritten etwas länger).`,
    });
    return;
  }

  if (job.status === 'done') {
    await interaction.editReply({ content: `"${chosen.label}" (${chosen.botName}) wurde ausgeführt.` });
    return;
  }

  if (job.status === 'skipped') {
    await interaction.editReply({
      content: `"${chosen.label}" (${chosen.botName}) war gerade nicht ausführbar (canRun() hat abgelehnt).`,
    });
    return;
  }

  await interaction.editReply({
    content: `"${chosen.label}" (${chosen.botName}) ist fehlgeschlagen${job.error ? `: ${job.error}` : '.'}`,
  });
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'voice-start') {
    await executeVoiceStart(interaction);
    return;
  }

  if (subcommand === 'voice-stop') {
    await executeVoiceStop(interaction);
    return;
  }

  await executeTrigger(interaction);
}

module.exports = { data, execute, autocomplete };
