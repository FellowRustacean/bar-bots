require('dotenv').config();
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Collection,
  MessageFlags,
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
const { startBandSync, setTrackWeightProvider } = require('./utils/band/bandPlayer');
const { VOTE_BUTTON_PREFIX, handleVoteButton, handleVoiceLeave, startVoteSync } = require('./utils/band/genreVoting');
const {
  RATE_BUTTON_PREFIX,
  SKIP_BUTTON_ID,
  handleRateButton,
  handleSkipButton,
  handleVoiceLeave: handleNowPlayingVoiceLeave,
  startNowPlayingSync,
} = require('./utils/band/nowPlaying');
const { createTrackWeightProvider } = require('./utils/band/trackWeighting');
const { startArtistNicknameSync } = require('./utils/band/artistNickname');

const IGNORE_BOTS_FLAG = 'ignore-bots';
function isIgnoredChannel(guildId, channelId) {
  return Boolean(guildId) && hasFlag(guildId, channelId, IGNORE_BOTS_FLAG);
}

const client = new Client({
  // GuildMembers noetig, damit der Member-Cache nach einem Neustart befuellt wird - ohne ihn kann
  // discord.js eingehende Voice-States (GuildVoiceStates) keinem gecachten Member zuordnen, wodurch
  // Nutzer aus channel.members rausfallen (0/0-Anzeige, faelschlich geloeschte Genre-Votes beim
  // periodischen Sync). Erfordert den "Server Members Intent" als privilegierten Intent im Discord
  // Developer Portal fuer diese Bot-Application.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
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

  startOutboxPoller(client, 'band');
  startInteractionScheduler(client, 'band');
  startStatusRotator(client, statusMessages);
  setTrackWeightProvider(createTrackWeightProvider(client));
  startBandSync(client);
  startVoteSync(client);
  startNowPlayingSync(client);
  startArtistNicknameSync(client);
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

  if (interaction.isButton() && interaction.customId.startsWith(VOTE_BUTTON_PREFIX)) {
    try {
      await handleVoteButton(interaction);
    } catch (err) {
      await replyWithError(interaction, err);
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith(RATE_BUTTON_PREFIX)) {
    try {
      await handleRateButton(interaction);
    } catch (err) {
      await replyWithError(interaction, err);
    }
    return;
  }

  if (interaction.isButton() && interaction.customId === SKIP_BUTTON_ID) {
    try {
      await handleSkipButton(interaction);
    } catch (err) {
      await replyWithError(interaction, err);
    }
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guildId = newState.guild?.id ?? oldState.guild?.id;

  try {
    await handleVoiceLeave(oldState, newState);
  } catch (err) {
    await logError(err, { context: 'Genre-Abstimmung: Stimme entfernen', guildId });
  }

  try {
    await handleNowPlayingVoiceLeave(oldState, newState);
  } catch (err) {
    await logError(err, { context: 'Skip-Abstimmung: Stimme entfernen', guildId });
  }
});

client.login(process.env.DISCORD_TOKEN);
