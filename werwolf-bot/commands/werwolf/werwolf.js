const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const {
  createGame,
  getGameByVoiceChannel,
  getGameByCreator,
  getGameForPlayer,
  getActiveGameForGuild,
  removeGame,
  getNextTableNumber,
} = require('../../utils/werwolf/gameManager');
const { assignRoles, getTeam, MIN_PLAYERS, MAX_PLAYERS } = require('../../utils/werwolf/roleDistribution');
const { getWerwolfCategoryId } = require('../../storage/werwolfSettings');
const { startGame, pauseGame, resumeGame, advanceGame } = require('../../utils/werwolf/gameRunner');
const { submitTarget, submitSkip, submitIgnite } = require('../../utils/werwolf/actionWindow');
const { MENTION_JOIN } = require('../../utils/werwolf/commandMentions');

const ROLES_PATH = path.join(__dirname, '../../data/werwolf_roles.json');
const ROLES = JSON.parse(fs.readFileSync(ROLES_PATH, 'utf8'));
const ROLE_NAMES = Object.keys(ROLES);

const TEAM_LABELS = { dorf: 'Das Dorf', werewolves: 'Werwölfe', solo: 'Solo-/Sub-Teams' };

const data = new SlashCommandBuilder()
  .setName('werwolf')
  .setDescription('Werwolf-Spiel verwalten')
  .addSubcommand((sub) => sub.setName('create').setDescription('Erstellt eine neue Werwolf-Lobby in deinem Voice-Channel'))
  .addSubcommand((sub) => sub.setName('join').setDescription('Tritt der Werwolf-Lobby in deinem Voice-Channel bei'))
  .addSubcommand((sub) => sub.setName('leave').setDescription('Verlässt die Werwolf-Lobby'))
  .addSubcommand((sub) => sub.setName('start').setDescription('Startet das Werwolf-Spiel'))
  .addSubcommand((sub) => sub.setName('cancel').setDescription('Bricht das aktuelle Werwolf-Spiel ab'))
  .addSubcommand((sub) =>
    sub
      .setName('role')
      .setDescription('Zeigt die Beschreibung einer Werwolf-Rolle')
      .addStringOption((opt) =>
        opt.setName('role').setDescription('Rolle').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((sub) => sub.setName('status').setDescription('Zeigt den aktuellen Spielstatus'))
  .addSubcommand((sub) => sub.setName('pause').setDescription('Pausiert die Timer des laufenden Spiels'))
  .addSubcommand((sub) => sub.setName('continue').setDescription('Setzt ein pausiertes Spiel fort'))
  .addSubcommand((sub) =>
    sub
      .setName('spiel')
      .setDescription('Legt fest, ob Schritte per Timer (auto) oder manuell per /werwolf next ablaufen')
      .addStringOption((opt) =>
        opt
          .setName('modus')
          .setDescription('auto oder manuell')
          .setRequired(true)
          .addChoices({ name: 'auto', value: 'auto' }, { name: 'manuell', value: 'manuell' })
      )
  )
  .addSubcommand((sub) => sub.setName('next').setDescription('Manueller Modus: springt zum nächsten Schritt'))
  .addSubcommand((sub) => sub.setName('me').setDescription('Zeigt dir deine eigene Rolle (nur für dich sichtbar)'))
  .addSubcommand((sub) =>
    sub
      .setName('auswahl')
      .setDescription('Wählt ein Ziel für deine aktuelle Aktion')
      .addUserOption((opt) => opt.setName('user').setDescription('Zielspieler').setRequired(true))
  )
  .addSubcommand((sub) => sub.setName('skip').setDescription('Überspringt deine aktuelle Aktion'))
  .addSubcommand((sub) => sub.setName('ignite').setDescription('Brandstifter: zündet alle markierten Spieler an'))
  .addSubcommand((sub) => sub.setName('opfer').setDescription('Hexe: zeigt das Werwolf-Opfer der Nacht (nur für dich sichtbar)'));

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const matches = ROLE_NAMES.filter((name) => name.toLowerCase().includes(focused)).slice(0, 25);
  await interaction.respond(matches.map((name) => ({ name, value: name })));
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'create') {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      await interaction.reply({ content: 'Du musst dich in einem Voice-Channel befinden.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (getActiveGameForGuild(interaction.guildId)) {
      await interaction.reply({
        content: 'Auf diesem Server läuft bereits eine Werwolf-Runde. Warte, bis sie beendet oder abgebrochen wurde.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    createGame(interaction.guildId, voiceChannel.id, interaction.user.id);
    await interaction.reply(
      `🐺 Werwolf-Lobby in ${voiceChannel} erstellt! Andere Spieler im Channel können mit ${MENTION_JOIN} beitreten (${MIN_PLAYERS}-${MAX_PLAYERS} Spieler). ${interaction.user} kann das Spiel mit \`/werwolf start\` starten.`
    );
    return;
  }

  if (subcommand === 'join') {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      await interaction.reply({ content: 'Du musst dich in einem Voice-Channel befinden.', flags: MessageFlags.Ephemeral });
      return;
    }

    const game = getGameByVoiceChannel(voiceChannel.id);
    if (!game || game.phase !== 'lobby') {
      await interaction.reply({ content: 'In diesem Voice-Channel läuft keine offene Lobby.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.players.includes(interaction.user.id)) {
      await interaction.reply({ content: 'Du bist bereits in der Lobby.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.players.length >= MAX_PLAYERS) {
      await interaction.reply({ content: `Die Lobby ist bereits voll (max. ${MAX_PLAYERS} Spieler).`, flags: MessageFlags.Ephemeral });
      return;
    }

    game.players.push(interaction.user.id);
    await interaction.reply(`${interaction.user} ist der Lobby beigetreten. (${game.players.length}/${MAX_PLAYERS})`);
    return;
  }

  if (subcommand === 'leave') {
    const game = getGameForPlayer(interaction.user.id);
    if (!game || game.phase !== 'lobby') {
      await interaction.reply({ content: 'Du bist in keiner offenen Werwolf-Lobby.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.creatorId === interaction.user.id) {
      await interaction.reply({
        content: 'Als Ersteller kannst du die Lobby nicht verlassen. Nutze `/werwolf cancel`, um sie abzubrechen.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    game.players = game.players.filter((id) => id !== interaction.user.id);
    await interaction.reply(`${interaction.user} hat die Lobby verlassen. (${game.players.length}/${MAX_PLAYERS})`);
    return;
  }

  if (subcommand === 'start') {
    const game = getGameByCreator(interaction.user.id);
    if (!game || game.phase !== 'lobby') {
      await interaction.reply({ content: 'Du leitest keine offene Werwolf-Lobby.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.players.length < MIN_PLAYERS || game.players.length > MAX_PLAYERS) {
      await interaction.reply({
        content: `Es werden ${MIN_PLAYERS}-${MAX_PLAYERS} Spieler benötigt. Aktuell: ${game.players.length}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const categoryId = getWerwolfCategoryId(interaction.guildId);
    if (!categoryId) {
      await interaction.reply({
        content: 'Es ist noch keine Werwolf-Kategorie konfiguriert. Nutze `/config setcategory werwolf <Kategorie>`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    const assignments = assignRoles(game.players);
    const werewolfPlayers = [...assignments.entries()]
      .filter(([, role]) => getTeam(role) === 'werewolves')
      .map(([userId]) => userId);

    const tableNumber = getNextTableNumber(interaction.guildId);
    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...werewolfPlayers.map((userId) => ({
        id: userId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      })),
    ];

    const werewolfChannel = await interaction.guild.channels.create({
      name: `werwolf-tisch-${tableNumber}`,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: overwrites,
    });

    game.assignments = assignments;
    game.werewolfChannelId = werewolfChannel.id;

    await interaction.editReply('🐺 Das Spiel wurde gestartet! Rollenübersicht und Spielverlauf folgen.');

    startGame(interaction.client, game, interaction.channelId);
    return;
  }

  if (subcommand === 'cancel') {
    const game = getGameByCreator(interaction.user.id);
    if (!game || game.phase === 'cancelled' || game.phase === 'ended') {
      await interaction.reply({ content: 'Du leitest kein aktives Werwolf-Spiel.', flags: MessageFlags.Ephemeral });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`werwolf_cancel_modal:${game.voiceChannelId}`)
      .setTitle('Spiel abbrechen')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('confirmation')
            .setLabel('Tippe "cancel" zur Bestätigung')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

    await interaction.showModal(modal);
    return;
  }

  if (subcommand === 'role') {
    const roleName = interaction.options.getString('role', true);
    const role = ROLES[roleName];

    if (!role) {
      await interaction.reply({ content: `Unbekannte Rolle: **${roleName}**.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${roleName} (${role.team})`)
      .setDescription(role.description);

    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (subcommand === 'pause') {
    const game = getGameByCreator(interaction.user.id);
    if (!game || (game.phase !== 'starting' && game.phase !== 'night' && game.phase !== 'day')) {
      await interaction.reply({ content: 'Du leitest kein laufendes Werwolf-Spiel.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.paused) {
      await interaction.reply({ content: 'Das Spiel ist bereits pausiert.', flags: MessageFlags.Ephemeral });
      return;
    }

    await pauseGame(interaction.client, game);
    await interaction.reply('⏸️ Das Spiel wurde pausiert.');
    return;
  }

  if (subcommand === 'continue') {
    const game = getGameByCreator(interaction.user.id);
    if (!game || (game.phase !== 'starting' && game.phase !== 'night' && game.phase !== 'day')) {
      await interaction.reply({ content: 'Du leitest kein laufendes Werwolf-Spiel.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (!game.paused) {
      await interaction.reply({ content: 'Das Spiel ist nicht pausiert.', flags: MessageFlags.Ephemeral });
      return;
    }

    await resumeGame(interaction.client, game);
    await interaction.reply('▶️ Das Spiel wird fortgesetzt.');
    return;
  }

  if (subcommand === 'spiel') {
    const game = getGameByCreator(interaction.user.id);
    if (!game || game.phase === 'cancelled' || game.phase === 'ended') {
      await interaction.reply({ content: 'Du leitest kein aktives Werwolf-Spiel.', flags: MessageFlags.Ephemeral });
      return;
    }

    const modus = interaction.options.getString('modus', true);
    game.mode = modus === 'auto' ? 'auto' : 'manual';
    await interaction.reply(`Der Spielmodus ist jetzt **${modus}**.`);
    return;
  }

  if (subcommand === 'next') {
    const game = getGameByCreator(interaction.user.id);
    if (!game || (game.phase !== 'starting' && game.phase !== 'night' && game.phase !== 'day')) {
      await interaction.reply({ content: 'Du leitest kein laufendes Werwolf-Spiel.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.mode !== 'manual') {
      await interaction.reply({ content: 'Dieser Befehl ist nur im manuellen Modus verfügbar (`/werwolf spiel manuell`).', flags: MessageFlags.Ephemeral });
      return;
    }

    const advanced = await advanceGame(interaction.client, game);
    if (advanced) {
      await interaction.reply('⏭️ Weiter zum nächsten Schritt.');
    } else {
      await interaction.reply({
        content: 'Aktuell läuft kein Schritt, der übersprungen werden kann.',
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (subcommand === 'status') {
    const voiceChannel = interaction.member.voice.channel;
    const game = (voiceChannel && getGameByVoiceChannel(voiceChannel.id)) ?? getGameForPlayer(interaction.user.id);

    if (!game) {
      await interaction.reply({ content: 'Du bist in keinem aktiven Werwolf-Spiel.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.phase === 'lobby') {
      await interaction.reply(
        `🐺 **Lobby** (${game.players.length}/${MAX_PLAYERS} Spieler)\n${game.players.map((id) => `<@${id}>`).join(', ')}`
      );
      return;
    }

    const alive = [...(game.round?.alive ?? [])];
    const counts = { dorf: 0, werewolves: 0, solo: 0 };
    for (const id of alive) counts[getTeam(game.assignments.get(id))]++;

    const baseLabel =
      game.phase === 'starting'
        ? '🕐 Vorbereitung'
        : game.phase === 'night'
          ? `🌙 Nacht ${game.round?.nightNumber ?? '?'}`
          : game.phase === 'day'
            ? '☀️ Tag'
            : game.phase;
    const phaseLabel = baseLabel + (game.paused ? ' (⏸️ pausiert)' : '');

    await interaction.reply(
      `🐺 **${phaseLabel}** - ${alive.length}/${game.players.length} Spieler leben noch\n` +
        `${TEAM_LABELS.dorf}: **${counts.dorf}**\n` +
        `${TEAM_LABELS.werewolves}: **${counts.werewolves}**\n` +
        `${TEAM_LABELS.solo}: **${counts.solo}**`
    );
    return;
  }

  if (subcommand === 'me') {
    const game = getGameForPlayer(interaction.user.id);
    if (!game || game.phase === 'lobby' || game.phase === 'cancelled' || game.phase === 'ended') {
      await interaction.reply({ content: 'Du bist in keinem laufenden Werwolf-Spiel.', flags: MessageFlags.Ephemeral });
      return;
    }

    const roleName = game.assignments.get(interaction.user.id);
    const role = ROLES[roleName];
    const alive = game.round.alive.has(interaction.user.id);

    let extra = '';
    if (roleName === 'Kopfgeldjäger' && game.round.bountyTarget?.hunterId === interaction.user.id) {
      extra = `\n🎯 Dein Ziel: <@${game.round.bountyTarget.targetId}>`;
    }

    if (game.round.lovers?.includes(interaction.user.id)) {
      const partnerId = game.round.lovers.find((id) => id !== interaction.user.id);
      extra += `\n💞 Du bist mit <@${partnerId}> verliebt! Stirbt einer von euch, stirbt der andere auch.`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Deine Rolle: ${roleName} (${role.team})`)
      .setDescription(`${role.description}${extra}\n\nStatus: ${alive ? '🟢 Lebt' : '💀 Gestorben'}`);

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === 'auswahl') {
    const game = getGameForPlayer(interaction.user.id);
    if (!game?.pendingAction) {
      await interaction.reply({ content: 'Aktuell ist keine Aktion für dich offen.', flags: MessageFlags.Ephemeral });
      return;
    }

    const target = interaction.options.getUser('user', true);
    const actionType = game.pendingAction.type;
    const result = submitTarget(game, interaction.user.id, target.id);

    if (!result.ok) {
      const messages = {
        'no-action': 'Aktuell ist keine Aktion für dich offen.',
        'not-eligible': 'Du bist für die aktuelle Aktion nicht berechtigt.',
        'already-done': 'Du hast bereits alle nötigen Ziele gewählt.',
        'duplicate-target': 'Dieses Ziel hast du schon gewählt.',
      };
      await interaction.reply({ content: messages[result.reason] ?? 'Aktion nicht möglich.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Seher/Aura-Seher erhalten ihre Enthüllung direkt hier als ephemere Antwort (keine DMs).
    if (result.complete && actionType === 'seher') {
      const revealedRole = target.id === game.round.schamaneDecoy ? 'Werwolf' : game.assignments.get(target.id);
      await interaction.reply({
        content: `🔮 Du hast ${target} gesehen. Rolle: **${revealedRole}**`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (result.complete && actionType === 'aura-seher') {
      const team = target.id === game.round.schamaneDecoy ? 'werewolves' : getTeam(game.assignments.get(target.id));
      const alignment = team === 'werewolves' ? 'Böse' : 'Gut';
      await interaction.reply({
        content: `👁️ Die Aura von ${target} ist: **${alignment}**`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: result.remaining > 0 ? `${target} gewählt. Noch ${result.remaining} weitere Wahl(en).` : `${target} gewählt.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'skip') {
    const game = getGameForPlayer(interaction.user.id);
    if (!game?.pendingAction) {
      await interaction.reply({ content: 'Aktuell ist keine Aktion für dich offen.', flags: MessageFlags.Ephemeral });
      return;
    }

    const result = submitSkip(game, interaction.user.id);
    await interaction.reply({
      content: result.ok ? 'Aktion übersprungen.' : 'Du bist für die aktuelle Aktion nicht berechtigt.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'ignite') {
    const game = getGameForPlayer(interaction.user.id);
    if (!game?.pendingAction) {
      await interaction.reply({ content: 'Aktuell ist keine Aktion für dich offen.', flags: MessageFlags.Ephemeral });
      return;
    }

    const result = submitIgnite(game, interaction.user.id);
    const messages = {
      'no-action': 'Aktuell ist keine Aktion für dich offen.',
      'not-eligible': 'Du bist für die aktuelle Aktion nicht berechtigt.',
      'not-allowed': 'Diese Aktion erlaubt kein Anzünden.',
    };
    await interaction.reply({
      content: result.ok ? 'Alle markierten Spieler werden angezündet.' : messages[result.reason] ?? 'Aktion nicht möglich.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'opfer') {
    const game = getGameForPlayer(interaction.user.id);
    if (!game?.pendingAction || game.pendingAction.type !== 'hexe-heal' || !game.pendingAction.eligibleUserIds.has(interaction.user.id)) {
      await interaction.reply({ content: 'Aktuell ist keine Aktion für dich offen.', flags: MessageFlags.Ephemeral });
      return;
    }

    const victim = game.round.werewolfVictim;
    if (!victim) {
      await interaction.reply({ content: 'In dieser Nacht gibt es kein Opfer der Werwölfe.', flags: MessageFlags.Ephemeral });
      return;
    }

    const button = new ButtonBuilder()
      .setCustomId('werwolf_hexe_protect')
      .setLabel('Opfer schützen')
      .setStyle(ButtonStyle.Success);

    await interaction.reply({
      content: `🧪 Die Werwölfe haben <@${victim}> gewählt. Nutze den Button, um deinen Heiltrank einzusetzen und sie/ihn zu retten - oder \`/werwolf skip\`, um es zu lassen.`,
      components: [new ActionRowBuilder().addComponents(button)],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleHexeProtectButton(interaction) {
  const game = getGameForPlayer(interaction.user.id);
  if (!game?.pendingAction || game.pendingAction.type !== 'hexe-heal' || !game.pendingAction.eligibleUserIds.has(interaction.user.id)) {
    await interaction.update({ content: 'Diese Aktion ist nicht mehr verfügbar.', components: [] });
    return;
  }

  const victim = game.round.werewolfVictim;
  const result = submitTarget(game, interaction.user.id, victim);

  if (!result.ok) {
    await interaction.update({ content: 'Diese Aktion ist nicht mehr verfügbar.', components: [] });
    return;
  }

  await interaction.update({
    content: `✅ Du hast <@${victim}> geschützt. Dein Heiltrank ist aufgebraucht.`,
    components: [],
  });
}

// Sitzt auf einer öffentlichen Nachricht (z. B. "Der Jäger erwacht..."), an der bei manchen
// Rollen mehrere Spieler gleichzeitig berechtigt sein können (z. B. 2 Jäger). Antwortet daher
// immer ephemer an die klickende Person, statt die geteilte Nachricht zu verändern - `submitSkip`
// prüft ohnehin schon pro Nutzer, ob die Person aktuell berechtigt ist.
async function handleSkipTurnButton(interaction) {
  const game = getGameForPlayer(interaction.user.id);
  if (!game?.pendingAction) {
    await interaction.reply({ content: 'Aktuell ist keine Aktion für dich offen.', flags: MessageFlags.Ephemeral });
    return;
  }

  const result = submitSkip(game, interaction.user.id);
  await interaction.reply({
    content: result.ok ? 'Zug übersprungen.' : 'Diese Aktion ist nicht für dich.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleCancelModalSubmit(interaction) {
  const voiceChannelId = interaction.customId.split(':')[1];
  const game = getGameByVoiceChannel(voiceChannelId);

  if (!game || game.creatorId !== interaction.user.id) {
    await interaction.reply({ content: 'Dieses Spiel kann nicht mehr abgebrochen werden.', flags: MessageFlags.Ephemeral });
    return;
  }

  const confirmation = interaction.fields.getTextInputValue('confirmation').trim().toLowerCase();
  if (confirmation !== 'cancel') {
    await interaction.reply({ content: 'Abbruch nicht bestätigt - das Spiel läuft weiter.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (game.phase === 'lobby') {
    removeGame(voiceChannelId);
    await interaction.reply('🐺 Die Werwolf-Lobby wurde abgebrochen.');
    return;
  }

  // Für gestartete Spiele übernimmt die laufende Spielschleife das vollständige Aufräumen
  // (Entmuten, Werwolf-Channel löschen, Spiel entfernen), sobald sie den Abbruch bemerkt.
  game.phase = 'cancelled';
  game.pendingAction?.finish();

  await interaction.reply('🐺 Das Werwolf-Spiel wird abgebrochen...');
}

module.exports = { data, execute, autocomplete, handleCancelModalSubmit, handleHexeProtectButton, handleSkipTurnButton };
