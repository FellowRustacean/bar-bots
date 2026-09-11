const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { setLogChannel, getLogChannel } = require('../../storage/guildConfig');
const { setTicketChannel, setTicketCategory, setApplicationsEnabled, getTicketSettings } = require('../../storage/ticketSettings');
const { setAfkChannel, getAfkChannelId } = require('../../storage/afkSettings');
const { setMemberRole, getMemberRoleId, setStammgastRole, getStammgastRoleId } = require('../../storage/roleSettings');
const { setEntryMessage, getEntryMessage } = require('../../storage/entrySettings');
const { syncTicketPanel } = require('../../utils/tickets/ticketPanel');
const { buildEntryButtonRow } = require('../../utils/members/entryGate');
const { setVoiceChannel, setVoiceCategory, getVoiceSettings } = require('../../storage/voiceSettings');
const { setWerwolfCategory, getWerwolfCategoryId } = require('../../storage/werwolfSettings');
const { setBartresenChannel, getBartresenChannelId } = require('../../storage/barSettings');
const { setBandVoiceChannel, getBandVoiceChannelId } = require('../../storage/bandSettings');
const { setDevTicketsChannel, getDevTicketsChannelId } = require('../../storage/devTicketSettings');
const { setFlag, getChannelsWithFlag } = require('../../storage/channelFlags');
const { addLlmRole, removeLlmRole, getLlmRoleIds } = require('../../storage/llmRoles');

// selection -> { expectedType, apply(interaction, channel), get(guildId) }
const CHANNEL_SELECTIONS = {
  'log-moderation': {
    expectedType: ChannelType.GuildText,
    apply: (interaction, channel) => setLogChannel(interaction.guildId, 'moderation', channel.id),
    get: (guildId) => getLogChannel(guildId, 'moderation'),
  },
  'log-tickets': {
    expectedType: ChannelType.GuildText,
    apply: (interaction, channel) => setLogChannel(interaction.guildId, 'tickets', channel.id),
    get: (guildId) => getLogChannel(guildId, 'tickets'),
  },
  'log-commands': {
    expectedType: ChannelType.GuildText,
    apply: (interaction, channel) => setLogChannel(interaction.guildId, 'commands', channel.id),
    get: (guildId) => getLogChannel(guildId, 'commands'),
  },
  'log-messages': {
    expectedType: ChannelType.GuildText,
    apply: (interaction, channel) => setLogChannel(interaction.guildId, 'messages', channel.id),
    get: (guildId) => getLogChannel(guildId, 'messages'),
  },
  'log-errors': {
    expectedType: ChannelType.GuildText,
    apply: (interaction, channel) => setLogChannel(interaction.guildId, 'errors', channel.id),
    get: (guildId) => getLogChannel(guildId, 'errors'),
  },
  'log-voice': {
    expectedType: ChannelType.GuildText,
    apply: (interaction, channel) => setLogChannel(interaction.guildId, 'voice', channel.id),
    get: (guildId) => getLogChannel(guildId, 'voice'),
  },
  'log-llm': {
    expectedType: ChannelType.GuildText,
    apply: (interaction, channel) => setLogChannel(interaction.guildId, 'llm', channel.id),
    get: (guildId) => getLogChannel(guildId, 'llm'),
  },
  'dev-tickets': {
    expectedType: ChannelType.GuildText,
    apply: (interaction, channel) => setDevTicketsChannel(interaction.guildId, channel.id),
    get: (guildId) => getDevTicketsChannelId(guildId),
  },
  'tickets-panel': {
    expectedType: ChannelType.GuildText,
    apply: async (interaction, channel) => {
      setTicketChannel(interaction.guildId, channel.id);
      await syncTicketPanel(interaction.guild);
    },
    get: (guildId) => getTicketSettings(guildId).channelId,
  },
  afk: {
    expectedType: ChannelType.GuildVoice,
    apply: (interaction, channel) => setAfkChannel(interaction.guildId, channel.id),
    get: (guildId) => getAfkChannelId(guildId),
  },
  'voice-create': {
    expectedType: ChannelType.GuildVoice,
    apply: (interaction, channel) => setVoiceChannel(interaction.guildId, channel.id),
    get: (guildId) => getVoiceSettings(guildId)?.voiceChannelId ?? null,
  },
  bartresen: {
    expectedType: ChannelType.GuildText,
    apply: (interaction, channel) => setBartresenChannel(interaction.guildId, channel.id),
    get: (guildId) => getBartresenChannelId(guildId),
  },
  'band-voice': {
    // Sowohl normale Voice- als auch Stage-Channels erlaubt - band bot erkennt den Kanaltyp
    // selbst und ueberspringt die Stage-spezifische Logik (Stage-Instanz, Sprecher-Status)
    // automatisch bei einem normalen Voice-Channel (siehe utils/band/bandPlayer.js). Die
    // "Sprechen"-Sperre fuer @everyone wird hier SOFORT gesetzt (nicht erst wenn Band das
    // naechste Mal verbindet, kann bis zu 30s per syncBandChannel dauern) - bandPlayer.js setzt
    // sie beim Verbinden zusaetzlich als Selbstheilung erneut.
    expectedType: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
    apply: async (interaction, channel) => {
      setBandVoiceChannel(interaction.guildId, channel.id);
      if (channel.type === ChannelType.GuildVoice) {
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Speak: false });
      }
    },
    get: (guildId) => getBandVoiceChannelId(guildId),
  },
  automod: {
    expectedType: ChannelType.GuildText,
    apply: (interaction, channel) => setLogChannel(interaction.guildId, 'automod', channel.id),
    get: (guildId) => getLogChannel(guildId, 'automod'),
  },
  'log-stammgast': {
    expectedType: ChannelType.GuildText,
    apply: (interaction, channel) => setLogChannel(interaction.guildId, 'stammgast', channel.id),
    get: (guildId) => getLogChannel(guildId, 'stammgast'),
  },
  welcome: {
    expectedType: ChannelType.GuildText,
    apply: (interaction, channel) => setLogChannel(interaction.guildId, 'welcome', channel.id),
    get: (guildId) => getLogChannel(guildId, 'welcome'),
  },
  'dm-channel': {
    expectedType: ChannelType.GuildText,
    apply: (interaction, channel) => setLogChannel(interaction.guildId, 'dm-channel', channel.id),
    get: (guildId) => getLogChannel(guildId, 'dm-channel'),
  },
};

const CATEGORY_SELECTIONS = {
  tickets: {
    apply: (interaction, category) => setTicketCategory(interaction.guildId, category.id),
    get: (guildId) => getTicketSettings(guildId).categoryId,
  },
  voice: {
    apply: (interaction, category) => setVoiceCategory(interaction.guildId, category.id),
    get: (guildId) => getVoiceSettings(guildId)?.voiceCategoryId ?? null,
  },
  werwolf: {
    apply: (interaction, category) => setWerwolfCategory(interaction.guildId, category.id),
    get: (guildId) => getWerwolfCategoryId(guildId),
  },
};

const ROLE_SELECTIONS = {
  member: {
    apply: (interaction, role) => setMemberRole(interaction.guildId, role.id),
    get: (guildId) => getMemberRoleId(guildId),
  },
  stammgast: {
    apply: (interaction, role) => setStammgastRole(interaction.guildId, role.id),
    get: (guildId) => getStammgastRoleId(guildId),
  },
};

// Generische pro-Channel-Verhaltens-Schalter (channel_flags-Tabelle) - "erst mal nur ignore-bots",
// weitere Optionen später einfach als neuer Eintrag hier, kein Schema-Update nötig (siehe
// shared/lib/channelFlags.js).
const CHANNEL_FLAG_OPTIONS = {
  'ignore-bots': {
    description:
      'Kanal wird von der passiven Bot-Verarbeitung ignoriert (keine XP, kein Automod, kein Message-Log, kein Befehls-Log) - Slash Commands funktionieren weiterhin normal.',
  },
  'check-llm': {
    description:
      'Nachrichten in diesem Kanal werden auf Erwähnung eines Charakters (Mary/Quinn/Benedict/Colt/Tony/Jacob) geprüft - bei Treffer entscheidet das lokale LLM, ob und wer antwortet.',
  },
};

// selection -> { apply(interaction, message) } - arbeitet auf einer bestehenden Bot-Nachricht
// im aktuellen Channel statt auf einer Discord-Option.
const MESSAGE_SELECTIONS = {
  anmeldung: {
    apply: async (interaction, message) => {
      await message.edit({ components: [buildEntryButtonRow()] });
      setEntryMessage(interaction.guildId, message.channelId, message.id);
    },
  },
};

const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Konfiguriert den Bot für diesen Server')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName('setchannel')
      .setDescription('Legt einen Kanal für eine bestimmte Funktion fest')
      .addStringOption((opt) =>
        opt
          .setName('selection')
          .setDescription('Welcher Kanal soll gesetzt werden?')
          .setRequired(true)
          .addChoices(...Object.keys(CHANNEL_SELECTIONS).map((key) => ({ name: key, value: key })))
      )
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Kanal')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('setcategory')
      .setDescription('Legt eine Kategorie für eine bestimmte Funktion fest')
      .addStringOption((opt) =>
        opt
          .setName('selection')
          .setDescription('Welche Kategorie soll gesetzt werden?')
          .setRequired(true)
          .addChoices(...Object.keys(CATEGORY_SELECTIONS).map((key) => ({ name: key, value: key })))
      )
      .addChannelOption((opt) =>
        opt
          .setName('category')
          .setDescription('Kategorie')
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('setrole')
      .setDescription('Legt eine Rolle für eine bestimmte Funktion fest')
      .addStringOption((opt) =>
        opt
          .setName('selection')
          .setDescription('Welche Rolle soll gesetzt werden?')
          .setRequired(true)
          .addChoices(...Object.keys(ROLE_SELECTIONS).map((key) => ({ name: key, value: key })))
      )
      .addRoleOption((opt) => opt.setName('role').setDescription('Rolle').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('setmessage')
      .setDescription('Verknüpft eine bestehende Bot-Nachricht im aktuellen Channel mit einer Funktion')
      .addStringOption((opt) =>
        opt
          .setName('selection')
          .setDescription('Welche Nachricht soll gesetzt werden?')
          .setRequired(true)
          .addChoices(...Object.keys(MESSAGE_SELECTIONS).map((key) => ({ name: key, value: key })))
      )
      .addStringOption((opt) =>
        opt.setName('message_id').setDescription('ID der Nachricht (im aktuellen Channel)').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('applications')
      .setDescription('Blendet den "Bewerbung"-Button im Ticket-Panel ein oder aus')
      .addStringOption((opt) =>
        opt
          .setName('status')
          .setDescription('An- oder ausschalten')
          .setRequired(true)
          .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('channel')
      .setDescription('Schaltet ein Bot-Verhalten für einen bestimmten Kanal an oder aus')
      .addStringOption((opt) =>
        opt
          .setName('option')
          .setDescription('Welches Verhalten?')
          .setRequired(true)
          .addChoices(...Object.keys(CHANNEL_FLAG_OPTIONS).map((key) => ({ name: key, value: key })))
      )
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Kanal')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('status')
          .setDescription('An- oder ausschalten')
          .setRequired(true)
          .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('llmrole')
      .setDescription('Beschränkt, welche Rollen das LLM (Charakter-Antworten) triggern dürfen')
      .addStringOption((opt) =>
        opt
          .setName('action')
          .setDescription('Rolle hinzufügen, entfernen oder aktuelle Liste anzeigen')
          .setRequired(true)
          .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'list', value: 'list' })
      )
      .addRoleOption((opt) => opt.setName('role').setDescription('Rolle (bei add/remove erforderlich)').setRequired(false))
  )
  .addSubcommand((sub) => sub.setName('show').setDescription('Zeigt alle aktuellen Server-Einstellungen'));

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'show') {
    const guildId = interaction.guildId;

    const channelLines = Object.entries(CHANNEL_SELECTIONS).map(([key, config]) => {
      const id = config.get(guildId);
      return `**${key}:** ${id ? `<#${id}>` : '_nicht gesetzt_'}`;
    });

    const categoryLines = Object.entries(CATEGORY_SELECTIONS).map(([key, config]) => {
      const id = config.get(guildId);
      return `**${key}:** ${id ? `<#${id}>` : '_nicht gesetzt_'}`;
    });

    const roleLines = Object.entries(ROLE_SELECTIONS).map(([key, config]) => {
      const id = config.get(guildId);
      return `**${key}:** ${id ? `<@&${id}>` : '_nicht gesetzt_'}`;
    });

    const entryMessage = getEntryMessage(guildId);
    const messageLines = Object.keys(MESSAGE_SELECTIONS).map((key) => {
      if (key !== 'anmeldung') return `**${key}:** _nicht gesetzt_`;
      return `**${key}:** ${
        entryMessage ? `[Nachricht](https://discord.com/channels/${guildId}/${entryMessage.channelId}/${entryMessage.messageId})` : '_nicht gesetzt_'
      }`;
    });

    const applicationsEnabled = getTicketSettings(guildId).applicationsEnabled;
    const llmRoleIds = getLlmRoleIds(guildId);
    const llmRoleLine =
      llmRoleIds.length > 0 ? llmRoleIds.map((id) => `<@&${id}>`).join(', ') : '_keine - alle Nutzer dürfen triggern_';

    const flagLines = Object.keys(CHANNEL_FLAG_OPTIONS).map((key) => {
      const channelIds = getChannelsWithFlag(guildId, key);
      const value = channelIds.length > 0 ? channelIds.map((id) => `<#${id}>`).join(', ') : '_kein Kanal_';
      return `**${key}:** ${value}`;
    });

    await interaction.reply({
      content:
        '### ⚙️ Aktuelle Konfiguration\n\n' +
        `**Kanäle**\n${channelLines.join('\n')}\n\n` +
        `**Kategorien**\n${categoryLines.join('\n')}\n\n` +
        `**Rollen**\n${roleLines.join('\n')}\n\n` +
        `**Nachrichten**\n${messageLines.join('\n')}\n\n` +
        `**Kanal-Verhalten**\n${flagLines.join('\n')}\n\n` +
        `**Sonstiges**\n**applications:** ${applicationsEnabled ? 'an' : 'aus'}\n**llmrole:** ${llmRoleLine}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'setchannel') {
    const selection = interaction.options.getString('selection', true);
    const channel = interaction.options.getChannel('channel', true);
    const config = CHANNEL_SELECTIONS[selection];

    const expectedTypes = Array.isArray(config.expectedType) ? config.expectedType : [config.expectedType];

    if (!expectedTypes.includes(channel.type)) {
      const EXPECTED_TYPE_NAMES = {
        [ChannelType.GuildVoice]: 'Voice-Channel',
        [ChannelType.GuildStageVoice]: 'Stage-Channel',
        [ChannelType.GuildText]: 'Text-Channel',
      };
      const expectedName = expectedTypes
        .map((type) => EXPECTED_TYPE_NAMES[type] ?? 'anderen Kanaltyp')
        .join(' oder ');
      await interaction.reply({
        content: `**${selection}** benötigt einen ${expectedName}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await config.apply(interaction, channel);
    await interaction.reply({
      content: `**${selection}** wurde auf ${channel} gesetzt.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'setcategory') {
    const selection = interaction.options.getString('selection', true);
    const category = interaction.options.getChannel('category', true);
    const config = CATEGORY_SELECTIONS[selection];

    await config.apply(interaction, category);
    await interaction.reply({
      content: `**${selection}** wurde auf die Kategorie **${category.name}** gesetzt.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'setrole') {
    const selection = interaction.options.getString('selection', true);
    const role = interaction.options.getRole('role', true);
    const config = ROLE_SELECTIONS[selection];

    await config.apply(interaction, role);
    await interaction.reply({
      content: `**${selection}** wurde auf die Rolle ${role} gesetzt.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'setmessage') {
    const selection = interaction.options.getString('selection', true);
    const messageId = interaction.options.getString('message_id', true);
    const config = MESSAGE_SELECTIONS[selection];

    const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
    if (!message) {
      await interaction.reply({
        content: 'Nachricht wurde nicht gefunden. Sie muss im aktuellen Channel liegen.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (message.author.id !== interaction.client.user.id) {
      await interaction.reply({
        content: 'Ich kann nur eigene Nachrichten bearbeiten (z. B. per `/message send` erstellt).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await config.apply(interaction, message);
    await interaction.reply({
      content: `**${selection}** wurde mit dieser Nachricht verknüpft.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'applications') {
    const status = interaction.options.getString('status', true);
    const enabled = status === 'on';
    setApplicationsEnabled(interaction.guildId, enabled);
    await syncTicketPanel(interaction.guild);
    await interaction.reply({
      content: `Der "Bewerbung"-Button ist jetzt **${enabled ? 'eingeblendet' : 'ausgeblendet'}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'llmrole') {
    const action = interaction.options.getString('action', true);
    const role = interaction.options.getRole('role');

    if (action === 'list') {
      const roleIds = getLlmRoleIds(interaction.guildId);
      const content =
        roleIds.length > 0
          ? `Das LLM kann aktuell nur von folgenden Rollen getriggert werden:\n${roleIds.map((id) => `<@&${id}>`).join('\n')}`
          : 'Keine Rolle hinterlegt - aktuell können alle Nutzer das LLM triggern.';
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }

    if (!role) {
      await interaction.reply({ content: 'Für `add`/`remove` muss eine Rolle angegeben werden.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (action === 'add') {
      addLlmRole(interaction.guildId, role.id);
      await interaction.reply({ content: `${role} kann das LLM jetzt triggern.`, flags: MessageFlags.Ephemeral });
    } else {
      removeLlmRole(interaction.guildId, role.id);
      const remaining = getLlmRoleIds(interaction.guildId);
      const note =
        remaining.length === 0 ? ' Keine Rolle mehr hinterlegt - jetzt können wieder alle Nutzer das LLM triggern.' : '';
      await interaction.reply({ content: `${role} wurde entfernt.${note}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (subcommand === 'channel') {
    const option = interaction.options.getString('option', true);
    const channel = interaction.options.getChannel('channel', true);
    const status = interaction.options.getString('status', true);
    const enabled = status === 'on';

    setFlag(interaction.guildId, channel.id, option, enabled);
    await interaction.reply({
      content: `**${option}** ist für ${channel} jetzt **${enabled ? 'an' : 'aus'}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { data, execute };
