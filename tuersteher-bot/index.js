require('dotenv').config();
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Collection,
  MessageFlags,
  RESTJSONErrorCodes,
  Partials,
  Options,
} = require('discord.js');

const { loadCommandFiles } = require('./utils/loadCommandFiles');
const { getAll: getAllTempbans, removeTempban } = require('./storage/tempbans');
const { removeBanRecord } = require('./storage/bans');
const { startWarnDecayTimer } = require('./utils/moderation/warnDecay');
const { registerClient, logError } = require('./utils/logs/errorLog');
const { startOutboxPoller } = require('./utils/outbox/outboxPoller');
const { startInteractionScheduler } = require('./utils/botInteractions/scheduler');
const { startStatusRotator } = require('../shared/lib/statusRotator');
const statusMessages = require('./utils/status/messages');
const {
  handleManualBan,
  handleManualUnban,
  handleManualKick,
  handleManualTimeoutChange,
} = require('./utils/moderation/auditLogSync');
const { createClientCacheOptions } = require('../shared/lib/clientCacheOptions');
const { checkMessage } = require('./utils/moderation/automod');
const { hasFlag } = require('./storage/channelFlags');
const { logCommandUsage } = require('./utils/logs/commandLog');
const { startTeamMeetingPoller } = require('./utils/teamMeeting/teamMeetingPoller');
const { createDmThreadFlow } = require('../shared/lib/dmThreadFlow');
const { getDmThread, getDmThreadByTarget, createDmThread, linkDmRelay, getDmRelayPartner } = require('./storage/dmThreads');
const { enqueueOutboxMessage, getOutboxJob } = require('./storage/outbox');
const { getLogChannel } = require('./storage/guildConfig');

const dmThreadFlow = createDmThreadFlow({
  botName: 'tuersteher',
  label: 'Colt (Türsteher)',
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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    // Für Automod (Wortstamm-Prüfung, siehe utils/moderation/automod.js) - MessageContent-Intent
    // im Dev Portal für diese Anwendung (Colt/Türsteher) ist jetzt aktiviert.
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    // Fuer den DM-Thread-Fluss (siehe /dm bei Manager) - Partials.Channel noetig, da DM-Channels
    // standardmaessig nicht gecacht sind, bevor eine erste Nachricht ankommt.
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

// Fehlercodes, bei denen ein erneuter Versuch im nächsten Durchlauf Sinn ergibt (z. B. dem Bot
// wurde vorübergehend die Bann-Berechtigung entzogen) - der Eintrag bleibt dafür bestehen. Bei
// jedem anderen Fehler (Server nicht mehr erreichbar, Nutzer bereits entbannt, ...) gibt es
// nichts mehr zu tun, der Eintrag wird wie bisher aufgeräumt.
const RETRYABLE_UNBAN_ERROR_CODES = new Set([RESTJSONErrorCodes.MissingPermissions, RESTJSONErrorCodes.MissingAccess]);

async function checkTempbans() {
  const now = Date.now();

  for (const entry of getAllTempbans()) {
    if (entry.unbanAt > now) continue;

    let shouldCleanUp = true;

    try {
      const guild = await client.guilds.fetch(entry.guildId);
      await guild.members.unban(entry.userId, 'Tempban abgelaufen');
    } catch (err) {
      if (RETRYABLE_UNBAN_ERROR_CODES.has(err.code)) {
        shouldCleanUp = false;
        await logError(err, { context: 'Tempban: automatisches Aufheben fehlgeschlagen', guildId: entry.guildId });
      }
    }

    if (shouldCleanUp) {
      removeTempban(entry.guildId, entry.userId);
      removeBanRecord(entry.guildId, entry.userId);
    }
  }
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);

  checkTempbans();
  setInterval(checkTempbans, 60 * 1000);

  startWarnDecayTimer();

  startOutboxPoller(client, 'tuersteher');
  startInteractionScheduler(client, 'tuersteher');
  startStatusRotator(client, statusMessages);
  startTeamMeetingPoller(client, 'tuersteher');
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

client.on('guildBanAdd', (ban) => {
  handleManualBan(ban);
});

client.on('guildBanRemove', (ban) => {
  handleManualUnban(ban);
});

client.on('guildMemberRemove', (member) => {
  handleManualKick(member);
});

client.on('guildMemberUpdate', (oldMember, newMember) => {
  handleManualTimeoutChange(oldMember, newMember);
});

client.on('messageCreate', async (message) => {
  if (isIgnoredChannel(message.guild?.id, message.channelId)) return;

  try {
    await checkMessage(message);
  } catch (err) {
    await logError(err, { context: 'Automod-Pruefung', guildId: message.guild?.id });
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
    if (interaction.customId.startsWith('warn_confirm:') || interaction.customId.startsWith('warn_cancel:')) {
      try {
        await client.commands.get('warns').handleButton(interaction);
      } catch (err) {
        await replyWithError(interaction, err);
      }
    } else if (interaction.customId.startsWith('silence_confirm:') || interaction.customId.startsWith('silence_cancel:')) {
      try {
        await client.commands.get('silence').handleButton(interaction);
      } catch (err) {
        await replyWithError(interaction, err);
      }
    } else if (interaction.customId.startsWith('dm_confirm:') || interaction.customId.startsWith('dm_cancel:')) {
      try {
        await dmThreadFlow.handleButton(interaction);
      } catch (err) {
        await replyWithError(interaction, err);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
