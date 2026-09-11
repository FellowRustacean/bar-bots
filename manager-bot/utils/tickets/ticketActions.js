const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const { getLogChannel } = require('../../storage/guildConfig');
const { getTicketSettings, getNextTicketNumber } = require('../../storage/ticketSettings');
const {
  addTicket,
  getTicketByUserChannel,
  getTicketByEitherChannel,
  removeTicket,
  setLoggingEnabled,
  linkRelayedMessages,
  getRelayPartner,
  removeRelaysForChannels,
} = require('../../storage/tickets');
const { getGuildBindings } = require('../../storage/teamRoles');
const { TICKET_TYPES } = require('./ticketTypes');
const { getXpRow } = require('../../storage/xp');

function buildUserChannelButtons(loggingEnabled) {
  const closeButton = new ButtonBuilder()
    .setCustomId('ticket_close')
    .setLabel('Ticket Schließen')
    .setStyle(ButtonStyle.Danger);

  const toggleLoggingButton = new ButtonBuilder()
    .setCustomId('ticket_toggle_log')
    .setLabel(loggingEnabled ? 'Logging Deaktivieren' : 'Logging Aktivieren')
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(closeButton, toggleLoggingButton);
}

function buildTeamChannelButtons() {
  const closeButton = new ButtonBuilder()
    .setCustomId('ticket_close')
    .setLabel('Ticket Schließen')
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder().addComponents(closeButton);
}

async function createTicket(interaction, typeKey) {
  const type = TICKET_TYPES[typeKey];

  // Bewerbungen erst ab einer Mindest-XP-Schwelle (siehe ticketTypes.js) - darunter wird gar kein
  // Ticket eroeffnet, nur ein Hinweis auf die noetige Aktivitaet.
  if (type.minXp) {
    const totalXp = getXpRow(interaction.guildId, interaction.user.id)?.total_xp ?? 0;
    if (totalXp < type.minXp) {
      await interaction.reply({
        content: `Um dich bewerben zu können, brauchst du **${type.minXp.toLocaleString('de-DE')} XP**, sodass wir bereits einen Eindruck von dir bekommen konnten und du die Bar auch etwas kennengelernt hast. Du hast aktuell **${totalXp.toLocaleString('de-DE')} XP**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  const settings = getTicketSettings(interaction.guildId);

  if (!settings.categoryId) {
    await interaction.reply({
      content: 'Es ist noch keine Ticket-Kategorie konfiguriert. Nutze `/config setcategory tickets <Kategorie>`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const bindings = getGuildBindings(interaction.guildId);
  const number = getNextTicketNumber(interaction.guildId);
  const paddedNumber = String(number).padStart(4, '0');

  // Bewerbungen: EIN Channel, Ersteller und Administrator-Rolle sehen sich direkt und
  // unterhalten sich normal - keine Anonymisierung, kein zweiter Channel, kein Relay.
  if (type.singleChannel) {
    const adminRoleId = bindings[type.teamTier];

    const channel = await interaction.guild.channels.create({
      name: `ticket-${paddedNumber}`,
      type: ChannelType.GuildText,
      parent: settings.categoryId,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        },
        ...(adminRoleId
          ? [
              {
                id: adminRoleId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
              },
            ]
          : []),
      ],
    });

    addTicket({
      channelId: channel.id,
      teamChannelId: null,
      guildId: interaction.guildId,
      userId: interaction.user.id,
      type: typeKey,
      number,
    });

    const pingContent = adminRoleId ? `<@&${adminRoleId}>` : '_Keine Rolle für Administrator verknüpft_';

    await channel.send({
      content: `${pingContent} ${interaction.user}\n**Ticket-Typ:** ${type.label}`,
      components: [buildUserChannelButtons(true)],
    });

    await interaction.reply({
      content: `Dein Ticket wurde erstellt: ${channel}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Support/Beschwerde: zwei Channels (Nutzer + Team), anonymisiert per Relay verbunden.
  // Zugriff auf den Team-Channel: bei 'team' alle Team-Stufen, bei 'admin' nur Administrator.
  const teamRoleIds = type.visibility === 'team' ? Object.values(bindings) : [bindings.Administrator].filter(Boolean);

  // Gepingt wird trotzdem nur die zum Ticket-Typ passende Stufe, nicht der gesamte Zugriffskreis.
  const pingRoleId = bindings[type.teamTier];

  const userChannel = await interaction.guild.channels.create({
    name: `ticket-${paddedNumber}`,
    type: ChannelType.GuildText,
    parent: settings.categoryId,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ],
  });

  const teamChannel = await interaction.guild.channels.create({
    name: `ticket-${paddedNumber}-team`,
    type: ChannelType.GuildText,
    parent: settings.categoryId,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...[...new Set(teamRoleIds)].map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      })),
    ],
  });

  addTicket({
    channelId: userChannel.id,
    teamChannelId: teamChannel.id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    type: typeKey,
    number,
  });

  await userChannel.send({
    content:
      `👋 ${interaction.user}, dein Ticket wurde erstellt.\n**Ticket-Typ:** ${type.label}\n\n` +
      'Schreib hier deine Nachricht - das Team antwortet dir in diesem Channel, ohne dass ihr euch gegenseitig seht.',
    components: [buildUserChannelButtons(true)],
  });

  const pingContent = pingRoleId ? `<@&${pingRoleId}>` : '_Keine Rolle für diese Stufe verknüpft_';

  await teamChannel.send({
    content: `${pingContent}\n**Neues Ticket** - Typ: ${type.label}`,
    components: [buildTeamChannelButtons()],
  });

  await interaction.reply({
    content: `Dein Ticket wurde erstellt: ${userChannel}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function fetchAllMessages(channel) {
  const messages = [];
  let lastId;

  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
    if (batch.size === 0) break;
    messages.push(...batch.values());
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }

  return messages.reverse();
}

// Baut eine Transkript-Zeile aus einer Nachricht. Bei anonymisierten Tickets (Support/Beschwerde)
// reicht das Auslesen allein des Team-Channels, da dort sowohl die gespiegelten (anonymen)
// Nutzer-Nachrichten als auch die echten Team-Antworten landen: gespiegelte Nachrichten -> "Nutzer",
// echte Team-Nachrichten -> echter Username. Da gespiegelte Nachrichten keinen sichtbaren Präfix
// tragen, werden sie stattdessen daran erkannt, dass sie vom Bot stammen, aber (anders als die
// Ticket-Eröffnungsnachricht) keine Buttons haben. Bei Bewerbungen (kein zweiter Channel, keine
// Anonymisierung) wird stattdessen immer der echte Autor gezeigt.
function formatTranscriptLine(message, { anonymize }) {
  const timestamp = new Date(message.createdTimestamp).toLocaleString('de-DE');

  if (anonymize && message.author.bot) {
    const label = message.components.length > 0 ? 'System' : 'Nutzer';
    return `[${timestamp}] ${label}: ${message.content}`;
  }

  return `[${timestamp}] ${message.author.tag}: ${message.content}`;
}

async function toggleTicketLogging(interaction) {
  const ticket = getTicketByUserChannel(interaction.channelId);
  if (!ticket) {
    await interaction.reply({ content: 'Dies ist kein Ticket-Kanal.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.user.id !== ticket.userId) {
    await interaction.reply({
      content: 'Nur der Ersteller des Tickets kann das Logging umschalten.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const newState = !ticket.loggingEnabled;
  setLoggingEnabled(ticket.channelId, newState);

  await interaction.update({ components: [buildUserChannelButtons(newState)] });
}

async function closeTicket(interaction) {
  const context = getTicketByEitherChannel(interaction.channelId);
  if (!context) {
    await interaction.reply({ content: 'Dies ist kein Ticket-Kanal.', flags: MessageFlags.Ephemeral });
    return;
  }

  const { ticket } = context;

  const logChannelId = ticket.loggingEnabled ? getLogChannel(ticket.guildId, 'tickets') : null;

  if (logChannelId) {
    // Bewerbungen (kein teamChannelId) werden direkt aus dem einen Ticket-Channel protokolliert -
    // dort steht schon die echte Identität jedes Autors, eine Anonymisierung ist hier nicht nötig.
    const transcriptChannelId = ticket.teamChannelId ?? ticket.channelId;
    const transcriptChannel = await interaction.guild.channels.fetch(transcriptChannelId).catch(() => null);

    if (transcriptChannel) {
      const messages = await fetchAllMessages(transcriptChannel);
      const anonymize = Boolean(ticket.teamChannelId);
      const transcript = messages.map((message) => formatTranscriptLine(message, { anonymize })).join('\n');

      const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
      if (logChannel?.isTextBased()) {
        const type = TICKET_TYPES[ticket.type];
        // Bei anonymisierten Tickets (teamChannelId gesetzt) schließt oft der Ersteller selbst -
        // ihn hier zu markieren würde die Anonymität sofort wieder aufheben. Schließt stattdessen
        // ein Teammitglied, ist dessen Identität kein Geheimnis, Markierung bleibt also erlaubt.
        const closedByOwnCreator = ticket.teamChannelId && interaction.user.id === ticket.userId;
        const closedByValue = closedByOwnCreator ? 'Nutzer' : `${interaction.user}`;

        const embed = new EmbedBuilder()
          .setTitle('Ticket geschlossen')
          .addFields(
            { name: 'Ticket-Typ', value: type?.label ?? ticket.type },
            { name: 'Ticket-Nummer', value: `#${String(ticket.number).padStart(4, '0')}` },
            { name: 'Geschlossen von', value: closedByValue },
            ...(ticket.teamChannelId ? [] : [{ name: 'Ersteller', value: `<@${ticket.userId}>` }])
          )
          .setTimestamp();

        const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), {
          name: `ticket-${String(ticket.number).padStart(4, '0')}.txt`,
        });

        await logChannel.send({ embeds: [embed], files: [attachment] });
      }
    }
  }

  await interaction.reply({ content: 'Ticket wird geschlossen …' });

  removeTicket(ticket.channelId);
  removeRelaysForChannels(ticket.channelId, ticket.teamChannelId);

  setTimeout(async () => {
    const userChannel = await interaction.guild.channels.fetch(ticket.channelId).catch(() => null);
    if (userChannel) await userChannel.delete().catch(() => {});

    if (ticket.teamChannelId) {
      const teamChannel = await interaction.guild.channels.fetch(ticket.teamChannelId).catch(() => null);
      if (teamChannel) await teamChannel.delete().catch(() => {});
    }
  }, 3000);
}

function truncateForDiscord(content) {
  return content.length > 2000 ? `${content.slice(0, 1997)}...` : content;
}

async function relayMessage(message, targetChannel) {
  const content = truncateForDiscord(message.content ?? '');
  const files = [...message.attachments.values()].map((attachment) => attachment.url);

  // Nichts zu übertragen (z. B. eine reine Sticker-Nachricht ohne Text/Anhang) - Discord
  // verlangt mindestens eins von content/files/embeds, sonst still überspringen.
  if (!content && files.length === 0) return;

  const relayed = await targetChannel
    .send({ content: content || undefined, files: files.length > 0 ? files : undefined })
    .catch(() => null);

  // Verknüpfung merken, damit Reaktionen auf einer Seite später auf die passende Nachricht der
  // anderen Seite übertragen werden können (siehe relayTicketReactionAdd/-Remove).
  if (relayed) linkRelayedMessages(message.id, message.channelId, relayed.id, relayed.channelId);
}

// Spiegelt eine Nachricht aus dem Nutzer- oder Team-Channel eines Tickets anonymisiert in den
// jeweils anderen Channel. Muss bei jedem messageCreate aufgerufen werden; tut bei allen
// Nachrichten außerhalb von Ticket-Channels und bei Bot-Nachrichten (inkl. der eigenen
// Relay-Kopien, verhindert Endlosschleifen) still nichts.
async function relayTicketMessage(message) {
  if (message.author.bot || !message.guild) return;

  const context = getTicketByEitherChannel(message.channelId);
  if (!context) return;

  const { ticket, side } = context;

  if (side === 'user') {
    if (!ticket.teamChannelId) return;
    const teamChannel = await message.guild.channels.fetch(ticket.teamChannelId).catch(() => null);
    if (teamChannel) await relayMessage(message, teamChannel);
    return;
  }

  const userChannel = await message.guild.channels.fetch(ticket.channelId).catch(() => null);
  if (userChannel) await relayMessage(message, userChannel);
}

// Holt zu einer Reaktion die per relayMessage() verknüpfte Partner-Nachricht (falls vorhanden).
// Löst dabei Partials auf, da Reaktionen auf ältere/ungecachte Nachrichten teilweise befüllt
// ankommen (Partials.Message/Partials.Reaction sind im Client konfiguriert).
async function resolveRelayPartnerMessage(reaction) {
  if (reaction.partial) {
    reaction = await reaction.fetch().catch(() => null);
    if (!reaction) return null;
  }

  if (reaction.message.partial) {
    const fullMessage = await reaction.message.fetch().catch(() => null);
    if (!fullMessage) return null;
  }

  const partner = getRelayPartner(reaction.message.id);
  if (!partner) return null;

  const partnerChannel = await reaction.message.guild.channels.fetch(partner.channelId).catch(() => null);
  if (!partnerChannel) return null;

  const partnerMessage = await partnerChannel.messages.fetch(partner.messageId).catch(() => null);
  return partnerMessage ? { reaction, partnerMessage } : null;
}

// Spiegelt eine hinzugefügte Reaktion auf die verknüpfte Nachricht der jeweils anderen Seite.
// Reagieren mehrere Team-Mitglieder mit demselben Emoji, bleibt es auf der Nutzerseite bei einer
// einzigen (unserer eigenen) Reaktion - react() auf ein bereits vorhandenes Emoji ist ein No-op.
async function relayTicketReactionAdd(reaction, user) {
  if (user.bot || !reaction.message.guild) return;

  const resolved = await resolveRelayPartnerMessage(reaction);
  if (!resolved) return;

  await resolved.partnerMessage.react(resolved.reaction.emoji.identifier).catch(() => {});
}

// Entfernt die gespiegelte Reaktion auf der Gegenseite nur, wenn auf der Quellseite jetzt
// niemand mehr mit diesem Emoji reagiert - sonst würde das Entfernen einer einzelnen Team-
// Reaktion die gespiegelte Reaktion für alle anderen Team-Mitglieder mit verschwinden lassen.
async function relayTicketReactionRemove(reaction, user) {
  if (user.bot || !reaction.message.guild) return;

  const resolved = await resolveRelayPartnerMessage(reaction);
  if (!resolved) return;

  if ((resolved.reaction.count ?? 0) > 0) return;

  const emojiKey = resolved.reaction.emoji.id ?? resolved.reaction.emoji.name;
  const partnerReaction = resolved.partnerMessage.reactions.cache.get(emojiKey);
  if (partnerReaction) await partnerReaction.users.remove(resolved.partnerMessage.client.user.id).catch(() => {});
}

module.exports = {
  createTicket,
  closeTicket,
  toggleTicketLogging,
  relayTicketMessage,
  relayTicketReactionAdd,
  relayTicketReactionRemove,
};
