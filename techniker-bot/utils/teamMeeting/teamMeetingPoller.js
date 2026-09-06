const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { OverwriteType, Routes } = require('discord.js');
const teamMeetingStore = require('../../storage/teamMeeting');
const db = require('../../storage/db');
const BOT_CLIENT_IDS = require('../../../shared/lib/botClientIds');
const { logError } = require('../logs/errorLog');

const POLL_INTERVAL_MS = 5 * 1000;
const TABLE_WAIT_RETRY_MS = 1000;
const TABLE_WAIT_MAX_TRIES = 15;

const STATUS_TEXTS = [
  'Päuschen',
  'Teambesprechung',
  'Kaffeepause',
  'Kurze Absprache',
  'Dienstbesprechung',
  'Schichtübergabe',
  'Kurz weg',
  'Personal-Meeting',
];

// guildId -> VoiceConnection - nur die eigenen, gerade aktiven Verbindungen dieses Bot-Prozesses.
const connections = new Map();

// Findet den Tisch, den DIESER Bot gerade zugewiesen bekommen hat (owner_id = eigene Bot-User-ID,
// siehe kellner bot/utils/customVoice/customVoice.js) - Channel-IDs sind Discord-Snowflakes und
// damit von Natur aus zeitlich aufsteigend sortierbar, ORDER BY DESC liefert daher zuverlässig
// den zuletzt erstellten Tisch.
const getLatestOwnedChannelStmt = db.prepare(
  'SELECT channel_id AS channelId FROM voice_channels WHERE guild_id = ? AND owner_id = ? ORDER BY channel_id DESC LIMIT 1'
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function joinChannel(guild, channelId) {
  const connection = joinVoiceChannel({
    channelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 5000).catch(() => {});
  connections.set(guild.id, connection);
  return connection;
}

function leaveChannel(guildId) {
  const connection = connections.get(guildId);
  if (connection) {
    connection.destroy();
    connections.delete(guildId);
  }
}

// Der Leader betritt zunächst "Tisch bestellen" - Kellner erkennt den Beitritt genau wie bei
// einem menschlichen Mitglied und erstellt+verschiebt in einen neuen Tisch (siehe kellner bot/
// utils/customVoice/customVoice.js). Hier wird kurz gewartet und dann nachgeschaut, welcher Tisch
// dabei entstanden ist, bevor Sperre/Status/Freigaben für die anderen Teilnehmer gesetzt werden.
async function runAsLeader(client, job) {
  const guild = client.guilds.cache.get(job.guildId);
  if (!guild) {
    teamMeetingStore.markJoined(job.participantId);
    return;
  }

  await joinChannel(guild, job.triggerChannelId);

  let tableChannelId = null;
  for (let i = 0; i < TABLE_WAIT_MAX_TRIES && !tableChannelId; i++) {
    await sleep(TABLE_WAIT_RETRY_MS);
    tableChannelId = getLatestOwnedChannelStmt.get(job.guildId, client.user.id)?.channelId ?? null;
  }

  if (!tableChannelId) {
    await logError(new Error('Kein Tisch zugewiesen bekommen'), {
      context: 'Team-Päuschen: Leader wartete vergeblich auf einen Tisch',
      guildId: job.guildId,
    });
    leaveChannel(job.guildId);
    teamMeetingStore.markJoined(job.participantId);
    return;
  }

  const channel = await guild.channels.fetch(tableChannelId).catch(() => null);
  if (!channel) {
    teamMeetingStore.markJoined(job.participantId);
    return;
  }

  const followerNames = teamMeetingStore.getFollowerNames(job.meetingId);
  const participantNames = [job.botName, ...followerNames];

  try {
    // Jeder teilnehmende Bot bekommt ein eigenes Connect-Overwrite, BEVOR @everyone gesperrt
    // wird - sonst könnten die Follower gleich danach gar nicht erst beitreten.
    for (const botName of participantNames) {
      const clientId = BOT_CLIENT_IDS[botName];
      if (!clientId) continue;
      await channel.permissionOverwrites.edit(
        clientId,
        { ViewChannel: true, Connect: true },
        { type: OverwriteType.Member }
      );
    }

    // Wie /lock: nur Connect wird gesperrt, ViewChannel bleibt unangetastet - der Tisch bleibt
    // für alle sichtbar, ist aber nicht betretbar.
    await channel.permissionOverwrites.edit(guild.roles.everyone, { Connect: false });

    const status = STATUS_TEXTS[Math.floor(Math.random() * STATUS_TEXTS.length)];
    await client.rest.put(Routes.channelVoiceStatus(channel.id), { body: { status } });
  } catch (err) {
    await logError(err, {
      context: 'Team-Päuschen: Tisch einrichten (Sperre/Status/Freigaben)',
      guildId: job.guildId,
    });
  }

  teamMeetingStore.setMeetingChannel(job.meetingId, tableChannelId);
  teamMeetingStore.markJoined(job.participantId);
}

async function runAsFollower(client, job) {
  const guild = client.guilds.cache.get(job.guildId);
  if (!guild || !job.channelId) return;

  try {
    await joinChannel(guild, job.channelId);
  } catch (err) {
    await logError(err, { context: 'Team-Päuschen: Tisch betreten (Follower)', guildId: job.guildId });
  }

  teamMeetingStore.markJoined(job.participantId);
}

async function processDueJoins(client, botName) {
  const dueJoins = teamMeetingStore.getDueJoins(botName);

  for (const job of dueJoins) {
    try {
      if (job.role === 'leader') {
        await runAsLeader(client, job);
      } else {
        await runAsFollower(client, job);
      }
    } catch (err) {
      await logError(err, { context: 'Team-Päuschen: Beitritt', guildId: job.guildId });
      teamMeetingStore.markJoined(job.participantId);
    }
  }
}

async function processDueLeaves(botName) {
  const dueLeaves = teamMeetingStore.getDueLeaves(botName);

  for (const job of dueLeaves) {
    leaveChannel(job.guildId);
    teamMeetingStore.markLeft(job.participantId);
  }
}

function startTeamMeetingPoller(client, botName) {
  setInterval(() => {
    processDueJoins(client, botName).catch((err) =>
      logError(err, { context: 'Team-Päuschen-Poller (Beitritte)' })
    );
    processDueLeaves(botName).catch((err) =>
      logError(err, { context: 'Team-Päuschen-Poller (Verlassen)' })
    );
  }, POLL_INTERVAL_MS);
}

module.exports = { startTeamMeetingPoller };
