require('dotenv').config();
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Collection,
  MessageFlags,
  Partials,
  Options,
} = require('discord.js');

const { loadCommandFiles } = require('./utils/loadCommandFiles');
const { registerClient, logError } = require('./utils/logs/errorLog');
const { startOutboxPoller } = require('./utils/outbox/outboxPoller');
const { startInteractionScheduler } = require('./utils/botInteractions/scheduler');
const { startStatusRotator } = require('../shared/lib/statusRotator');
const statusMessages = require('./utils/status/messages');
const { createClientCacheOptions } = require('../shared/lib/clientCacheOptions');
const { hasFlag } = require('./storage/channelFlags');
const { logCommandUsage } = require('./utils/logs/commandLog');
const { startTeamMeetingPoller } = require('./utils/teamMeeting/teamMeetingPoller');
const { createDmThreadFlow } = require('../shared/lib/dmThreadFlow');
const { getDmThread, getDmThreadByTarget, createDmThread, linkDmRelay, getDmRelayPartner } = require('./storage/dmThreads');
const { enqueueOutboxMessage, getOutboxJob } = require('./storage/outbox');
const { getLogChannel } = require('./storage/guildConfig');

const dmThreadFlow = createDmThreadFlow({
  botName: 'techniker',
  label: 'Tony (Techniker)',
  getDmThread,
  getDmThreadByTarget,
  createDmThread,
  getLogChannel,
  enqueueOutboxMessage,
  getOutboxJob,
  linkDmRelay,
  getDmRelayPartner,
});

const IGNORE_BOTS_FLAG = 'ignore-bots';
function isIgnoredChannel(guildId, channelId) {
  return Boolean(guildId) && hasFlag(guildId, channelId, IGNORE_BOTS_FLAG);
}

const client = new Client({
  // GuildMessages/MessageContent/DirectMessages nur fuer den DM-Thread-Fluss (siehe /dm bei
  // Manager) - erfordert "Message Content Intent" im Dev Portal fuer diese Anwendung. Partials.Channel
  // noetig, da DM-Channels standardmaessig nicht gecacht sind, bevor eine erste Nachricht ankommt.
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    // Fuer den Reaktions-Relay im DM-Thread-Fluss (Bilder/Dateien/Reaktionen spiegeln).
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
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

  startOutboxPoller(client, 'techniker');
  startInteractionScheduler(client, 'techniker');
  startStatusRotator(client, statusMessages);
  startTeamMeetingPoller(client, 'techniker');
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

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    await dmThreadFlow.handleReactionAdd(reaction, user);
  } catch (err) {
    await logError(err, { context: 'DM-Thread: Reaktion spiegeln (hinzugefügt)' });
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
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
      if (interaction.customId.startsWith('devticket_status:')) {
        const [, status] = interaction.customId.split(':');
        await client.commands.get('dev-ticket').handleStatusButton(interaction, status);
      } else if (interaction.customId.startsWith('devticket_page:')) {
        const [, threadId, mode, page, ephemeral] = interaction.customId.split(':');
        await client.commands.get('dev-ticket').handlePageButton(interaction, threadId, mode, Number(page), ephemeral === '1');
      } else if (interaction.customId.startsWith('dm_confirm:') || interaction.customId.startsWith('dm_cancel:')) {
        await dmThreadFlow.handleButton(interaction);
      }
    } catch (err) {
      await replyWithError(interaction, err);
    }

    return;
  }

});

client.login(process.env.DISCORD_TOKEN);
