require('dotenv').config();
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  MessageFlags,
  Options,
} = require('discord.js');

const { loadCommandFiles } = require('./utils/loadCommandFiles');
const {
  createTicket,
  closeTicket,
  toggleTicketLogging,
  relayTicketMessage,
  relayTicketReactionAdd,
  relayTicketReactionRemove,
} = require('./utils/tickets/ticketActions');
const { registerClient, logError } = require('./utils/logs/errorLog');
const { ENTRY_BUTTON_ID, handleEntryButtonClick, startInactivityChecker } = require('./utils/members/entryGate');
const { startOutboxPoller } = require('./utils/outbox/outboxPoller');
const { handlePollModalSubmit, handlePollVote, handlePollClose, checkExpiredPolls } = require('./utils/polls/pollActions');
const { startMemberSnapshotTimer } = require('./utils/members/memberSnapshot');
const { startInteractionScheduler } = require('./utils/botInteractions/scheduler');
const { startStatusRotator } = require('../shared/lib/statusRotator');
const statusMessages = require('./utils/status/messages');
const { createClientCacheOptions } = require('../shared/lib/clientCacheOptions');
const { startStammgastChecker } = require('./utils/stammgast/stammgastChecker');
const { handleChatMessage } = require('./utils/llm/chatOrchestrator');
const badgeRegistry = require('./utils/badges/badgeRegistry');
const { ensureBadgeCatalog } = require('./storage/badges');
const {
  handleMessage: handleActivityMessage,
  handleBumpConfirmation,
  handleVoiceStateUpdate: handleActivityVoiceStateUpdate,
  initializeVoiceSessions,
  startHourlyTick,
} = require('./utils/activity/activityTracker');
const { hasFlag } = require('./storage/channelFlags');
const { logCommandUsage } = require('./utils/logs/commandLog');
const {
  logMessageDelete,
  logMessageEdit,
  mirrorVoiceChannelMessage,
  markVoiceChannelDeleted,
  startMessageLogCleanup,
} = require('./utils/logs/messageLog');
const { recordMessageContent } = require('./storage/recentMessageContent');
const {
  initializeInviteCache,
  handleInviteCreate,
  handleInviteDelete,
  handleGuildMemberAdd,
} = require('./utils/referrals/inviteTracker');
const { handleMemberRoleChange } = require('./utils/members/welcomeMessage');
const { createDmThreadFlow } = require('../shared/lib/dmThreadFlow');
const { getDmThread, getDmThreadByTarget, createDmThread, linkDmRelay, getDmRelayPartner } = require('./storage/dmThreads');
const { enqueueOutboxMessage, getOutboxJob } = require('./storage/outbox');
const { getLogChannel } = require('./storage/guildConfig');
const { startTeamMeetingPoller } = require('./utils/teamMeeting/teamMeetingPoller');

const dmThreadFlow = createDmThreadFlow({
  botName: 'manager',
  label: 'Mary (Manager)',
  getDmThread,
  getDmThreadByTarget,
  createDmThread,
  getLogChannel,
  enqueueOutboxMessage,
  getOutboxJob,
  linkDmRelay,
  getDmRelayPartner,
});

// Kanäle mit diesem Flag werden von jeglicher passiver Bot-Verarbeitung ausgenommen (kein XP,
// kein Automod, kein Message-/Befehls-Log) - Slash Commands selbst laufen trotzdem normal weiter.
const IGNORE_BOTS_FLAG = 'ignore-bots';
function isIgnoredChannel(guildId, channelId) {
  return Boolean(guildId) && hasFlag(guildId, channelId, IGNORE_BOTS_FLAG);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    // Fuer den DM-Thread-Fluss (siehe /dm) - eingehende DMs von Nutzern + Reaktions-Relay.
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  ...createClientCacheOptions(Options),
});

registerClient(client);

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');

for (const filePath of loadCommandFiles(commandsPath)) {
  const command = require(filePath);
  client.commands.set(command.data.name, command);
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);

  startInactivityChecker(client);
  startOutboxPoller(client, 'manager');
  startMemberSnapshotTimer(client);
  startInteractionScheduler(client, 'manager');
  startStatusRotator(client, statusMessages);
  startStammgastChecker(client);
  ensureBadgeCatalog(badgeRegistry);
  initializeVoiceSessions(client);
  startHourlyTick(client);
  startMessageLogCleanup(client);
  initializeInviteCache(client).catch((err) => logError(err, { context: 'Referral: Invite-Cache aufbauen (Start)' }));
  startTeamMeetingPoller(client, 'manager');

  checkExpiredPolls(client).catch((err) => logError(err, { context: 'Umfrage: automatisches Schließen (Start)' }));
  setInterval(() => {
    checkExpiredPolls(client).catch((err) => logError(err, { context: 'Umfrage: automatisches Schließen' }));
  }, 60 * 1000);
});

async function replyWithError(interaction, err) {
  await logError(err, { context: `Interaktion: ${interaction.customId ?? interaction.commandName ?? 'unbekannt'}`, guildId: interaction.guildId });

  const errorReply = {
    content: 'Bei der Ausführung ist ein Fehler aufgetreten.',
    flags: MessageFlags.Ephemeral,
  };

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorReply);
    } else {
      await interaction.reply(errorReply);
    }
  } catch (replyErr) {
    // Interaktion ist bereits abgelaufen/ungültig
    await logError(replyErr, { context: 'Konnte Fehlermeldung nicht an Nutzer senden', guildId: interaction.guildId });
  }
}

// Zweite Sicherheitsnetz-Ebene neben den try/catch-Blöcken in jedem Event-Handler: fängt
// wirklich ALLES ab, was sonst irgendwo durchrutscht. Der Bot läuft danach bewusst weiter
// statt sich zu beenden (bevorzugt Verfügbarkeit über die übliche Node-Empfehlung, den
// Prozess nach einer uncaughtException zu beenden).
process.on('uncaughtException', (err) => {
  logError(err, { context: 'uncaughtException' }).catch(() => {});
});

process.on('unhandledRejection', (err) => {
  logError(err, { context: 'unhandledRejection' }).catch(() => {});
});

client.on('messageCreate', async (message) => {
  if (!isIgnoredChannel(message.guild?.id, message.channelId)) {
    try {
      handleActivityMessage(message);
    } catch (err) {
      await logError(err, { context: 'XP/Statistik-Tracking (Nachricht)', guildId: message.guild?.id });
    }

    try {
      await mirrorVoiceChannelMessage(message);
    } catch (err) {
      await logError(err, { context: 'Voice-Channel-Chat-Mitschnitt', guildId: message.guild?.id });
    }

    // Eigene kurzlebige Kopie fuer den Loeschungs-Log, unabhaengig vom RAM-Nachrichten-Cache -
    // siehe Kommentar bei recent_message_content in shared/lib/schema.js.
    if (message.guild && message.author && !message.author.bot) {
      try {
        recordMessageContent(message);
      } catch (err) {
        await logError(err, { context: 'Nachrichteninhalt zwischenspeichern', guildId: message.guild?.id });
      }
    }
  }

  try {
    handleBumpConfirmation(message);
  } catch (err) {
    await logError(err, { context: 'Bump-XP', guildId: message.guild?.id });
  }

  try {
    await relayTicketMessage(message);
  } catch (err) {
    await logError(err, { context: 'Ticket-Relay', guildId: message.guild?.id });
  }

  try {
    await handleChatMessage(message, logError);
  } catch (err) {
    await logError(err, { context: 'LLM-Chat', guildId: message.guild?.id });
  }

  try {
    await dmThreadFlow.handlePotentialDmDraft(message);
  } catch (err) {
    await logError(err, { context: 'DM-Thread: Bestätigung anbieten', guildId: message.guild?.id });
  }

  try {
    await dmThreadFlow.handleIncomingUserDm(message);
  } catch (err) {
    await logError(err, { context: 'DM-Thread: eingehende DM spiegeln' });
  }
});

client.on('messageDelete', async (message) => {
  if (isIgnoredChannel(message.guild?.id, message.channelId)) return;

  try {
    await logMessageDelete(message);
  } catch (err) {
    await logError(err, { context: 'Loggen einer gelöschten Nachricht', guildId: message.guild?.id });
  }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (isIgnoredChannel(newMessage.guild?.id, newMessage.channelId)) return;

  try {
    await logMessageEdit(oldMessage, newMessage);
  } catch (err) {
    await logError(err, { context: 'Loggen einer bearbeiteten Nachricht', guildId: newMessage.guild?.id });
  }

  // Zwischenspeicherte Kopie auf den neuesten Stand bringen, damit ein spaeterer Loeschungs-Log
  // (falls die Nachricht inzwischen aus dem RAM-Cache gefallen ist) den aktuellen Inhalt zeigt.
  if (newMessage.guild && newMessage.author && !newMessage.author.bot) {
    try {
      recordMessageContent(newMessage);
    } catch (err) {
      await logError(err, { context: 'Nachrichteninhalt zwischenspeichern (Bearbeitung)', guildId: newMessage.guild?.id });
    }
  }
});

client.on('channelDelete', async (channel) => {
  if (!channel.isVoiceBased?.()) return;

  try {
    markVoiceChannelDeleted(channel.id);
  } catch (err) {
    await logError(err, { context: 'Voice-Channel-Thread: Löschung vermerken', guildId: channel.guild?.id });
  }
});

client.on('inviteCreate', (invite) => {
  try {
    handleInviteCreate(invite);
  } catch (err) {
    logError(err, { context: 'Referral: Invite-Cache aktualisieren (erstellt)', guildId: invite.guild?.id }).catch(() => {});
  }
});

client.on('inviteDelete', (invite) => {
  try {
    handleInviteDelete(invite);
  } catch (err) {
    logError(err, { context: 'Referral: Invite-Cache aktualisieren (gelöscht)', guildId: invite.guild?.id }).catch(() => {});
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    await handleGuildMemberAdd(member);
  } catch (err) {
    await logError(err, { context: 'Referral: Beitritt verarbeiten', guildId: member.guild?.id });
  }
});

// Willkommensnachricht haengt NICHT an guildMemberAdd (roher Server-Beitritt), sondern an der
// Vergabe der "Gast"-Rolle (siehe welcomeMessage.js) - passt inhaltlich besser zum tatsaechlichen
// Eintritt in die Bar statt dem rohen Discord-Beitritt.
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    await handleMemberRoleChange(oldMember, newMember);
  } catch (err) {
    await logError(err, { context: 'Willkommensnachricht senden', guildId: newMember.guild?.id });
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guildId = newState.guild?.id ?? oldState.guild?.id;

  try {
    handleActivityVoiceStateUpdate(oldState, newState);
  } catch (err) {
    await logError(err, { context: 'XP/Statistik-Tracking (Voice)', guildId });
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    await relayTicketReactionAdd(reaction, user);
  } catch (err) {
    await logError(err, { context: 'Ticket-Relay (Reaktion hinzugefügt)', guildId: reaction.message.guild?.id });
  }

  try {
    await dmThreadFlow.handleReactionAdd(reaction, user);
  } catch (err) {
    await logError(err, { context: 'DM-Thread: Reaktion spiegeln (hinzugefügt)' });
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  try {
    await relayTicketReactionRemove(reaction, user);
  } catch (err) {
    await logError(err, { context: 'Ticket-Relay (Reaktion entfernt)', guildId: reaction.message.guild?.id });
  }

  try {
    await dmThreadFlow.handleReactionRemove(reaction, user);
  } catch (err) {
    await logError(err, { context: 'DM-Thread: Reaktion spiegeln (entfernt)' });
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);

    if (!command?.autocomplete) return;

    try {
      await command.autocomplete(interaction);
    } catch (err) {
      await logError(err, { context: `Autocomplete: ${interaction.commandName}`, guildId: interaction.guildId });
    }

    return;
  }

  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    // Nur das passive Befehls-Log wird uebersprungen - der Befehl selbst laeuft in jedem Channel
    // normal weiter (siehe Anforderung: "Slash Commands sollten gehen").
    if (!isIgnoredChannel(interaction.guildId, interaction.channelId)) {
      await logCommandUsage(interaction);
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      await replyWithError(interaction, err);
    }

    return;
  }

  if (interaction.isButton()) {
    try {
      if (interaction.customId.startsWith('ticket_open_')) {
        const type = interaction.customId.replace('ticket_open_', '');
        await createTicket(interaction, type);
      } else if (interaction.customId === 'ticket_close') {
        await closeTicket(interaction);
      } else if (interaction.customId === 'ticket_toggle_log') {
        await toggleTicketLogging(interaction);
      } else if (interaction.customId === ENTRY_BUTTON_ID) {
        await handleEntryButtonClick(interaction);
      } else if (interaction.customId.startsWith('poll_vote:')) {
        const [, pollId, optionId] = interaction.customId.split(':');
        await handlePollVote(interaction, Number(pollId), Number(optionId));
      } else if (interaction.customId.startsWith('poll_close:')) {
        const [, pollId] = interaction.customId.split(':');
        await handlePollClose(interaction, Number(pollId));
      } else if (interaction.customId.startsWith('dm_confirm:') || interaction.customId.startsWith('dm_cancel:')) {
        await dmThreadFlow.handleButton(interaction);
      }
    } catch (err) {
      await replyWithError(interaction, err);
    }

    return;
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('message_')) {
      try {
        await client.commands.get('message').handleModalSubmit(interaction);
      } catch (err) {
        await replyWithError(interaction, err);
      }
    } else if (interaction.customId === 'poll_create_modal') {
      try {
        await handlePollModalSubmit(interaction);
      } catch (err) {
        await replyWithError(interaction, err);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
