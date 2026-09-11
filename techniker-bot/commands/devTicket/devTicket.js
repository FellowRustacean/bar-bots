const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { getDevTicketsChannelId } = require('../../storage/devTicketSettings');
const {
  STATUSES,
  createTicket,
  getTicket,
  setStatus,
  setControlMessageId,
  searchTicketsByTitle,
  listTickets,
  countTickets,
} = require('../../storage/devTickets');
const { buildDevTicketInfoPages, STATUS_LABELS, buildThreadName } = require('../../utils/devTickets/devTicketInfo');

const ARCHIVE_DURATION_MINUTES = 10080; // 7 Tage - längstmögliche Discord-Option

const STATUS_CHOICES = STATUSES.map((status) => ({ name: STATUS_LABELS[status], value: status }));
const LIST_PAGE_SIZE = 20;

function buildControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('devticket_status:done').setLabel('Fertiggestellt').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('devticket_status:open').setLabel('Wieder öffnen').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('devticket_status:postponed')
      .setLabel('Zurückstellen')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('devticket_status:closed').setLabel('Schließen').setStyle(ButtonStyle.Danger)
  );
}

function buildPaginationRow(threadId, mode, page, ephemeral, hasPrev, hasNext) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`devticket_page:${threadId}:${mode}:${page - 1}:${ephemeral ? 1 : 0}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasPrev),
    new ButtonBuilder()
      .setCustomId(`devticket_page:${threadId}:${mode}:${page + 1}:${ephemeral ? 1 : 0}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasNext)
  );
}

const data = new SlashCommandBuilder()
  .setName('dev-ticket')
  .setDescription('Verwaltet persönliche Entwicklungs-Tickets')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Erstellt ein neues Dev-Ticket')
      .addStringOption((opt) => opt.setName('title').setDescription('Titel des Tickets').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('Listet Dev-Tickets auf')
      .addStringOption((opt) =>
        opt.setName('status').setDescription('Status-Filter (Standard: Offen)').setRequired(false).addChoices(...STATUS_CHOICES)
      )
      .addIntegerOption((opt) => opt.setName('page').setDescription('Seite (Standard: 1)').setRequired(false).setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub
      .setName('info')
      .setDescription('Zeigt Changelog/Comments eines Dev-Tickets')
      .addStringOption((opt) =>
        opt
          .setName('selection')
          .setDescription('Was soll angezeigt werden?')
          .setRequired(true)
          .addChoices(
            { name: 'updates', value: 'updates' },
            { name: 'changelog', value: 'changelog' },
            { name: 'comments', value: 'comments' }
          )
      )
      .addStringOption((opt) =>
        opt.setName('ticket').setDescription('Ticket (Titel)').setRequired(true).setAutocomplete(true)
      )
      .addIntegerOption((opt) => opt.setName('page').setDescription('Seite (Standard: 1)').setRequired(false).setMinValue(1))
      .addBooleanOption((opt) =>
        opt.setName('ephemeral').setDescription('Nur für dich sichtbar? (Standard: ja)').setRequired(false)
      )
  );

async function handleCreate(interaction) {
  const title = interaction.options.getString('title', true);
  const channelId = getDevTicketsChannelId(interaction.guildId);

  if (!channelId) {
    await interaction.reply({
      content: 'Es ist noch kein Dev-Tickets-Kanal konfiguriert (`/config setchannel dev-tickets` bei der Managerin).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    await interaction.reply({
      content: 'Der konfigurierte Dev-Tickets-Kanal existiert nicht mehr.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const thread = await channel.threads.create({
    name: buildThreadName('open', title),
    autoArchiveDuration: ARCHIVE_DURATION_MINUTES,
    reason: 'Neues Dev-Ticket',
  });

  const controlMessage = await thread.send({
    content: `**Status:** ${STATUS_LABELS.open}`,
    components: [buildControlRow()],
  });

  createTicket({ threadId: thread.id, guildId: interaction.guildId, title, createdAt: Date.now() });
  setControlMessageId(thread.id, controlMessage.id);

  await interaction.editReply({ content: `Ticket erstellt: <#${thread.id}>` });
}

async function handleList(interaction) {
  const status = interaction.options.getString('status') ?? 'open';
  const page = interaction.options.getInteger('page') ?? 1;

  const total = countTickets(interaction.guildId, status);
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const tickets = listTickets(interaction.guildId, status, (clampedPage - 1) * LIST_PAGE_SIZE, LIST_PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setTitle(`Dev-Tickets — ${STATUS_LABELS[status]}`)
    .setFooter({ text: `Seite ${clampedPage}/${totalPages} · ${total} Ticket(s)` });

  embed.setDescription(
    tickets.length > 0 ? tickets.map((ticket) => `• <#${ticket.threadId}> — ${ticket.title}`).join('\n') : 'Keine Tickets gefunden.'
  );

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// Baut Embed + Pagination-Buttons für /dev-ticket info - wird sowohl beim ursprünglichen Befehl
// als auch beim Klick auf einen Pagination-Button wiederverwendet, damit beide exakt dieselbe
// Seite erzeugen.
async function buildInfoView(guild, client, { threadId, mode, page, ephemeral }) {
  const ticket = getTicket(threadId);
  if (!ticket) return { error: 'Ticket wurde nicht gefunden.' };

  const thread = await guild.channels.fetch(threadId).catch(() => null);
  if (!thread) return { error: 'Der Ticket-Thread existiert nicht mehr.' };

  const { pages, statusLabel } = await buildDevTicketInfoPages({
    thread,
    ticket,
    botUserId: client.user.id,
    mode,
  });

  const clampedPage = Math.min(Math.max(page, 1), pages.length);
  const embed = new EmbedBuilder()
    .setDescription(pages[clampedPage - 1])
    .setFooter({ text: `Status: ${statusLabel} · Seite ${clampedPage}/${pages.length}` });

  const components =
    pages.length > 1
      ? [buildPaginationRow(threadId, mode, clampedPage, Boolean(ephemeral), clampedPage > 1, clampedPage < pages.length)]
      : [];

  return { embeds: [embed], components };
}

async function handleInfo(interaction) {
  const mode = interaction.options.getString('selection', true);
  const threadId = interaction.options.getString('ticket', true);
  const page = interaction.options.getInteger('page') ?? 1;
  const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

  const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
  await interaction.deferReply(flags ? { flags } : {});

  const view = await buildInfoView(interaction.guild, interaction.client, { threadId, mode, page, ephemeral });
  if (view.error) {
    await interaction.editReply({ content: view.error });
    return;
  }

  await interaction.editReply({ embeds: view.embeds, components: view.components });
}

// Wird von index.js für Klicks auf "devticket_page:<threadId>:<mode>:<page>:<ephemeral>" aufgerufen
// - interaction.update() bearbeitet die bestehende Nachricht direkt, egal ob sie ephemeral ist.
async function handlePageButton(interaction, threadId, mode, page, ephemeral) {
  const view = await buildInfoView(interaction.guild, interaction.client, {
    threadId,
    mode,
    page,
    ephemeral,
  });

  if (view.error) {
    await interaction.reply({ content: view.error, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.update({ embeds: view.embeds, components: view.components });
}

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'create') return handleCreate(interaction);
  if (subcommand === 'list') return handleList(interaction);
  if (subcommand === 'info') return handleInfo(interaction);
}

// Wird von index.js für Klicks auf "devticket_status:<status>" aufgerufen - der Button steckt
// in der Control-Nachricht des Ticket-Threads, also ist interaction.channelId bereits die
// Thread-ID.
async function handleStatusButton(interaction, status) {
  const threadId = interaction.channelId;
  const ticket = getTicket(threadId);

  if (!ticket) {
    await interaction.reply({ content: 'Ticket wurde nicht gefunden.', flags: MessageFlags.Ephemeral });
    return;
  }

  setStatus(threadId, status);

  await interaction.update({ content: `**Status:** ${STATUS_LABELS[status]}`, components: [buildControlRow()] });

  // Thread-Umbenennung ist Rate-Limit-behaftet (max. 2x/10min pro Kanal) und nicht kritisch für
  // die Interaktion selbst - läuft deshalb nach dem update() und wird bei Fehlschlag ignoriert.
  await interaction.channel.setName(buildThreadName(status, ticket.title)).catch(() => {});
}

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const matches = searchTicketsByTitle(interaction.guildId, focused);
  await interaction.respond(matches.map((match) => ({ name: match.title.slice(0, 100), value: match.threadId })));
}

module.exports = { data, execute, autocomplete, handleStatusButton, handlePageButton };
