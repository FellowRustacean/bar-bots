const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
} = require('@discordjs/voice');

const { logError } = require('../logs/errorLog');

const VOICELINES_DIR = path.join(process.cwd(), 'werwolf', 'voicelines');

const connections = new Map(); // voiceChannelId -> { connection, player, ffmpeg }

// Findet alle Dateien zu einer Voiceline: entweder die exakte Datei (`name.mp3`) oder
// nummerierte Varianten für Abwechslung (`name_1.mp3`, `name_2.mp3`, ...).
function getVoicelineCandidates(name) {
  if (!name) return [];

  let files;
  try {
    files = fs.readdirSync(VOICELINES_DIR);
  } catch {
    return [];
  }

  const pattern = new RegExp(`^${name}(_\\d+)?\\.mp3$`, 'i');
  return files.filter((file) => pattern.test(file)).map((file) => path.join(VOICELINES_DIR, file));
}

function getVoicelinePath(name) {
  const candidates = getVoicelineCandidates(name);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Reagiert auf ungewollte Trennung (z. B. rausgekickt oder kurzer Netzwerk-Hänger):
// discord.js versucht selbst zu reconnecten; klappt das nicht, wird die Verbindung
// verworfen und der Bot tritt dem Channel aktiv erneut bei. Bei einem gewollten
// `leaveGameVoiceChannel()` (Spielende) wird das über `state.leaving` unterdrückt.
function attachReconnectHandling(client, game, state) {
  state.connection.on(VoiceConnectionStatus.Disconnected, async () => {
    if (state.leaving) return;

    try {
      await Promise.race([
        entersState(state.connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(state.connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Kurzer Hänger - discord.js verbindet selbst wieder, nichts weiter nötig.
    } catch {
      if (state.leaving) return;

      console.warn('[Werwolf Voicelines] Voice-Verbindung verloren (z. B. gekickt) - versuche erneut beizutreten.');
      state.connection.destroy();
      connections.delete(game.voiceChannelId);
      await joinGameVoiceChannel(client, game);
    }
  });
}

async function joinGameVoiceChannel(client, game) {
  const existing = connections.get(game.voiceChannelId);
  if (existing) return existing;

  const guild = await client.guilds.fetch(game.guildId).catch(() => null);
  if (!guild) return null;

  try {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    const connection = joinVoiceChannel({
      channelId: game.voiceChannelId,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
    });
    connection.subscribe(player);

    const state = { connection, player, ffmpeg: null, leaving: false, queue: [], playing: false };
    connections.set(game.voiceChannelId, state);
    attachReconnectHandling(client, game, state);
    return state;
  } catch (err) {
    await logError(err, { context: 'Werwolf Voicelines: Voice-Channel-Beitritt', guildId: game.guildId });
    return null;
  }
}

function leaveGameVoiceChannel(game) {
  const state = connections.get(game.voiceChannelId);
  if (!state) return;

  state.leaving = true;
  state.queue = []; // ausstehende, noch nicht gestartete Voicelines verwerfen
  if (state.ffmpeg) state.ffmpeg.kill();
  state.connection.destroy();
  connections.delete(game.voiceChannelId);
}

function playFileNow(state, filePath) {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      // '-re' liest die Datei in Echtzeit statt sie komplett auf einmal in die Pipe zu
      // schreiben - verhindert abgehacktes/ruckelndes Abspielen durch Buffer-Überlauf.
      '-re',
      '-i',
      filePath,
      '-map',
      '0:a:0',
      '-filter:a',
      'volume=0.6',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-c:a',
      'libopus',
      '-b:a',
      '128k',
      '-f',
      'ogg',
      'pipe:1',
    ]);

    state.ffmpeg = ffmpeg;

    // Fertig ist die Voiceline erst, wenn der Player wirklich in Idle wechselt - nicht schon,
    // wenn ffmpeg fertig encodiert hat. Der AudioPlayer puffert Opus-Frames intern und gibt sie
    // getaktet aus; wird direkt nach ffmpeg-close() die nächste Datei gestartet, schneidet das
    // noch gepufferte Restaudio der aktuellen Voiceline ab.
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      state.player.off('stateChange', onStateChange);
      state.player.off('error', onError);
      resolve();
    };

    const onStateChange = (oldState, newState) => {
      if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
        finish();
      }
    };

    const onError = (err) => {
      console.error('[Werwolf Voicelines] AudioPlayer-Fehler:', err);
      finish();
    };

    state.player.on('stateChange', onStateChange);
    state.player.on('error', onError);

    const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus });
    state.player.play(resource);

    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('error', (err) => {
      console.error('[Werwolf Voicelines] FFmpeg-Fehler:', err);
      if (state.ffmpeg === ffmpeg) state.ffmpeg = null;
      finish();
    });
    ffmpeg.on('close', () => {
      if (state.ffmpeg === ffmpeg) state.ffmpeg = null;
    });
  });
}

// Verhindert, dass sich Voicelines gegenseitig abschneiden: Läuft bereits eine, wird die
// nächste angehängt und automatisch danach abgespielt, statt die laufende zu unterbrechen.
function processQueue(state) {
  if (state.playing || state.queue.length === 0) return;

  state.playing = true;
  const { filePath, resolve } = state.queue.shift();

  playFileNow(state, filePath).then(() => {
    state.playing = false;
    resolve();
    processQueue(state);
  });
}

function enqueueFile(state, filePath) {
  return new Promise((resolve) => {
    state.queue.push({ filePath, resolve });
    processQueue(state);
  });
}

// Spielt eine Voiceline ab (wartet ggf., bis eine gerade laufende fertig ist). Tut still
// nichts, wenn die Datei (noch) nicht aufgenommen wurde oder der Voice-Beitritt fehlschlägt -
// Voicelines sind rein kosmetisch, nie spielentscheidend.
async function playVoiceline(client, game, name) {
  const filePath = getVoicelinePath(name);
  if (!filePath) return;

  const state = await joinGameVoiceChannel(client, game);
  if (!state) return;

  await enqueueFile(state, filePath);
}

module.exports = { joinGameVoiceChannel, leaveGameVoiceChannel, playVoiceline };
