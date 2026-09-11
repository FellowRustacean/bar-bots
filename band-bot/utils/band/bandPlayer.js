const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType,
} = require('@discordjs/voice');
const { ChannelType, StageInstancePrivacyLevel, Routes, OverwriteType } = require('discord.js');
const { getBandVoiceChannelId } = require('../../storage/bandSettings');
const { logError } = require('../logs/errorLog');

// Gemeinsamer Text fuer den Stage-Topic (Stage-Channel) UND die Voice-Channel-Statuszeile
// (normaler Voice-Channel) - je nach Kanaltyp wird nur der jeweils passende Mechanismus benutzt.
const STATUS_TEXT = '24/7 Music | Study & Work & Chill';

// Gemeinsamer Musikordner (wie shared/bot.db) - jede Audiodatei darin gilt als Titel im Repertoire.
// Bewusst live von der Platte gelesen (nicht einmalig beim Start gecacht), damit neue Dateien ohne
// Neustart des Bots auftauchen - wie bei drinks.json/snacks.json in den anderen Bots.
const MUSIC_DIR = path.join(__dirname, '..', '..', '..', 'shared', 'music');
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|m4a)$/i;

const SYNC_INTERVAL_MS = 30 * 1000;
const RECONNECT_TIMEOUT_MS = 5000;

let player = null;
let connection = null;
let ffmpeg = null;
let currentChannelId = null;
let lastTrack = null;
let activeFolder = null; // null = alle Unterordner gemischt; sonst Name eines Unterordners von shared/music
let trackStartedAt = null;
let currentTrackDurationSeconds = null; // null bis ffprobe fertig ist (siehe fetchTrackDuration)
let currentResource = null; // fuer resource.playbackDuration - genauer als Date.now() - trackStartedAt

// Vom Player-/Bewertungs-Embed injizierte Gewichtungsfunktion (track) => Zahl > 0, z. B. der
// Durchschnitts-Sternewert unter den aktuell im Lounge Anwesenden. Absichtlich als Callback statt
// eines direkten require() der Bewertungs-Speicherung - haelt bandPlayer.js unabhaengig davon,
// ob/wie Bewertungen ueberhaupt existieren (kein zirkulaerer Require noetig).
let trackWeightProvider = null;

function setTrackWeightProvider(fn) {
  trackWeightProvider = fn;
}

// Fuer die Skip-Abstimmung und das Player-Embed: wird bei jedem Titelwechsel aufgerufen (egal ob
// natuerliches Ende, /skip, oder Genre-Wechsel), damit Skip-Stimmen geleert und die Anzeige
// aktualisiert werden koennen.
const trackChangeListeners = [];

function onTrackChange(listener) {
  trackChangeListeners.push(listener);
}

function notifyTrackChange(track) {
  for (const listener of trackChangeListeners) {
    try {
      listener(track);
    } catch (err) {
      logError(err, { context: 'Band: onTrackChange-Listener' }).catch(() => {});
    }
  }
}

// Fuer das Player-Embed: fragt die Laenge des Titels per ffprobe ab (async, blockiert die
// Wiedergabe selbst nicht) - currentTrackDurationSeconds bleibt bis dahin null, das Embed zeigt
// dann einfach noch keine Dauer an und holt sie beim naechsten periodischen Refresh nach.
function fetchTrackDuration(track) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path.join(MUSIC_DIR, track),
    ]);
    let output = '';
    proc.stdout.on('data', (chunk) => { output += chunk; });
    proc.on('close', () => {
      const seconds = parseFloat(output);
      resolve(Number.isFinite(seconds) ? Math.round(seconds) : null);
    });
    proc.on('error', () => resolve(null));
  });
}

function getTrackStartedAt() {
  return trackStartedAt;
}

function getTrackDurationSeconds() {
  return currentTrackDurationSeconds;
}

// Tatsaechlich vom Player verarbeitete Zeit (Millisekunden) - genauer als Date.now() -
// trackStartedAt, da @discordjs/voice das direkt am Stream mitzaehlt (beruecksichtigt z. B.
// kurze Puffer-Haenger, nicht nur reine Wanduhrzeit seit Start).
function getPlaybackDurationMs() {
  return currentResource?.playbackDuration ?? null;
}

// Listet die Unterordner von shared/music (= die auswaehlbaren "Genres" fuer /play) - bewusst
// live von der Platte gelesen, kein Neustart noetig, wenn ein Ordner dazukommt/verschwindet.
function getFolders() {
  if (!fs.existsSync(MUSIC_DIR)) return [];
  return fs
    .readdirSync(MUSIC_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// Durchsucht ein Verzeichnis rekursiv nach Audiodateien und gibt deren Pfad relativ zu
// shared/music zurueck (z. B. "swing/Datei.m4a") - so bleibt path.join(MUSIC_DIR, track) in
// playTrack() unabhaengig davon korrekt, ob gerade ein bestimmter Ordner oder alles gemischt
// abgespielt wird.
function walkAudioFiles(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walkAudioFiles(fullPath));
    } else if (AUDIO_EXTENSIONS.test(entry.name)) {
      results.push(path.relative(MUSIC_DIR, fullPath));
    }
  }
  return results;
}

// Ohne ausgewaehlten Ordner (activeFolder === null) wird ueber ALLE Unterordner hinweg gemischt -
// erst /play schraenkt auf ein einzelnes Genre ein (siehe setActiveFolder).
function getTracks() {
  const root = activeFolder ? path.join(MUSIC_DIR, activeFolder) : MUSIC_DIR;
  if (!fs.existsSync(root)) return [];
  return walkAudioFiles(root);
}

// Fuer /play: wechselt den aktiven Ordner (oder setzt ihn auf "alle gemischt" zurueck, wenn
// folderName null ist) und schaltet - falls gerade etwas laeuft - sofort auf einen Titel aus dem
// neuen Ordner um, statt bis zum Ende des aktuellen Titels zu warten.
function setActiveFolder(folderName) {
  if (folderName !== null && !getFolders().includes(folderName)) {
    return { ok: false, message: `Ordner "${folderName}" wurde nicht gefunden.` };
  }

  activeFolder = folderName;
  lastTrack = null;

  if (player && connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
    playTrack();
  }

  return { ok: true };
}

// Zufällige Auswahl, die denselben Titel nicht zweimal hintereinander wiederholt - außer es gibt
// nur einen einzigen Titel im Ordner, dann bleibt keine andere Wahl. Ist eine Gewichtungsfunktion
// gesetzt (siehe setTrackWeightProvider), wird nicht mehr gleichverteilt, sondern proportional zum
// jeweiligen Gewicht gewuerfelt - z. B. 5 Sterne = 5x so wahrscheinlich wie 1 Stern.
function pickNextTrack() {
  const tracks = getTracks();
  if (tracks.length === 0) return null;
  if (tracks.length === 1) return tracks[0];

  const candidates = tracks.filter((track) => track !== lastTrack);
  const pool = candidates.length > 0 ? candidates : tracks;

  if (!trackWeightProvider) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Mindestgewicht statt 0, damit ein Titel nie komplett unwaehlbar wird, egal wie schlecht
  // bewertet.
  const weights = pool.map((track) => Math.max(0.01, trackWeightProvider(track)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = Math.random() * total;

  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }

  return pool[pool.length - 1];
}

function stopFfmpeg() {
  if (ffmpeg) {
    ffmpeg.kill();
    ffmpeg = null;
  }
}

// Startet einen zufällig gewählten Titel - wird sowohl beim ersten Verbinden als auch jedes Mal
// aufgerufen, wenn der Player nach Ende eines Titels wieder in den Idle-Zustand geht (siehe
// ensurePlayer), wodurch sich ganz natürlich eine endlose, zufällig gemischte Wiedergabe ergibt.
function playTrack() {
  const track = pickNextTrack();
  if (!track) {
    // Ordner ist (noch) leer - beim naechsten Sync-Intervall bzw. sobald der Player wieder idle
    // wird, wird erneut versucht (kein Absturz, einfach kurz Stille).
    return;
  }

  lastTrack = track;
  trackStartedAt = Date.now();
  currentTrackDurationSeconds = null;
  notifyTrackChange(track);
  stopFfmpeg();

  fetchTrackDuration(track).then((seconds) => {
    // Nur uebernehmen, wenn zwischenzeitlich nicht schon der naechste Titel gestartet wurde.
    if (lastTrack === track) {
      currentTrackDurationSeconds = seconds;
      notifyTrackChange(track);
    }
  });

  const spawned = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-re',
    '-i', path.join(MUSIC_DIR, track),
    '-map', '0:a:0',
    // Testweise auf volle Lautstaerke (1.0) - ggf. wieder runterregeln, falls das clippt/uebersteuert.
    '-filter:a', 'volume=1',
    '-ac', '2',
    '-ar', '48000',
    '-c:a', 'libopus',
    // "audio" statt des Opus-Standard-Modus fuer Sprache (VoIP) - deutlich bessere Klangtreue bei
    // Musik, gleiche Bitrate. compression_level 10 = maximaler Encoder-Aufwand/-Qualitaet (langsamer,
    // aber der Pi hat dafuer Luft, kein Echtzeit-Problem). vbr on = variable statt konstante Bitrate,
    // nutzt die 128k dort, wo es tatsaechlich etwas bringt, statt sie stur auf jeden Frame zu pressen.
    '-application', 'audio',
    '-vbr', 'on',
    '-compression_level', '10',
    '-b:a', '128k',
    '-f', 'ogg',
    'pipe:1',
  ]);

  ffmpeg = spawned;

  spawned.stderr.on('data', (data) => {
    console.error(`[Band] ffmpeg: ${data.toString()}`);
  });

  spawned.on('error', (err) => {
    logError(err, { context: 'Band: ffmpeg-Prozess' }).catch(() => {});
  });

  const resource = createAudioResource(spawned.stdout, { inputType: StreamType.OggOpus });
  currentResource = resource;
  player.play(resource);
}

function ensurePlayer() {
  if (player) return player;

  player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });

  // Sobald ein Titel zu Ende ist, wird der Player idle - genau hier wird der naechste (zufaellige,
  // nicht wiederholende) Titel gestartet, wodurch sich die endlose Playlist ergibt.
  player.on(AudioPlayerStatus.Idle, () => {
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
      playTrack();
    }
  });

  player.on('error', (err) => {
    logError(err, { context: 'Band: Audio-Player' }).catch(() => {});
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
      playTrack();
    }
  });

  return player;
}

// Offizielles Reconnect-Muster von @discordjs/voice: bei "Disconnected" kann es sich um einen
// kurzen Netzwerk-Hickup (dann kommt die Verbindung von selbst zurueck) oder ein echtes Trennen
// (z. B. Kanal geloescht, Bot rausgeworfen) handeln - erst nach beiden Timeouts wird die
// Verbindung als endgueltig verloren behandelt und zerstoert, statt endlos zu haengen.
function attachReconnectHandling(conn) {
  conn.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(conn, VoiceConnectionStatus.Signalling, RECONNECT_TIMEOUT_MS),
        entersState(conn, VoiceConnectionStatus.Connecting, RECONNECT_TIMEOUT_MS),
      ]);
      // Discord signalisiert selbst ein Reconnect - nichts weiter zu tun.
    } catch {
      conn.destroy();
    }
  });

  conn.on(VoiceConnectionStatus.Destroyed, () => {
    if (connection === conn) {
      connection = null;
      currentChannelId = null;
    }
  });
}

// Beitreten allein macht einen Stage-Channel noch nicht "live" - dafuer braucht es eine eigene
// Stage-Instanz (das Ding, das den Status/Titel oben im Kanal zeigt). sendStartNotification:false
// unterdrueckt die sonst uebliche @everyone-Benachrichtigung beim Start. Existiert bereits eine
// Instanz (z. B. manuell gestartet, oder der Bot war schon verbunden), wird nichts doppelt angelegt.
async function ensureStageInstance(guild, channel) {
  // Nur fuer echte Stage-Channels relevant - band-voice erlaubt inzwischen auch normale
  // Voice-Channels (siehe /config), fuer die es schlicht keine Stage-Instanz gibt.
  if (channel?.type !== ChannelType.GuildStageVoice) return;
  if (channel?.stageInstance) return;

  try {
    await guild.stageInstances.create(channel.id, {
      topic: STATUS_TEXT,
      privacyLevel: StageInstancePrivacyLevel.GuildOnly,
      sendStartNotification: false,
    });
  } catch (err) {
    await logError(err, {
      context: 'Band: konnte Stage-Instanz nicht starten (fehlt "Kanäle verwalten" auf dem Stage-Channel?)',
      guildId: guild.id,
    });
  }
}

// Bei einem normalen Voice-Channel gibt es (anders als bei Stage, wo Zuhoerer per Design stumm
// sind) keinen eingebauten Mechanismus dafuer - stattdessen wird "Sprechen" fuer @everyone auf
// dem Channel gesperrt. Wirkt als reine Berechtigung (kein individuelles Server-Mute), betrifft
// also auch neu beitretende Nutzer automatisch, ohne dass der Bot bei jedem Beitritt eingreifen
// muesste. Fuer Stage-Channels wirkungslos/unnoetig, da dort ein anderes Modell (Sprecher-
// Anfrage) gilt - wird deshalb uebersprungen.
async function ensureListenOnly(guild, channel) {
  if (channel.type !== ChannelType.GuildVoice) return;

  try {
    await channel.permissionOverwrites.edit(guild.roles.everyone, { Speak: false });
  } catch (err) {
    await logError(err, {
      context: 'Band: konnte "Sprechen" fuer @everyone nicht sperren (fehlt "Berechtigungen verwalten" auf dem Voice-Channel?)',
      guildId: guild.id,
    });
  }
}

// Niemand soll im Text-Chat des Lounge-Channels schreiben koennen - gilt fuer BEIDE Kanaltypen
// (anders als die Sprechen-Sperre, die nur fuer normale Voice-Channels noetig ist), da der
// Text-Chat unabhaengig vom Voice-Modell existiert. Der Bot selbst braucht ein explizites
// Allow-Overwrite, sonst koennte er seine eigenen Abstimmungs-Embeds nicht mehr posten.
async function ensureNoTextChat(guild, channel) {
  try {
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
    await channel.permissionOverwrites.edit(
      guild.client.user.id,
      { SendMessages: true },
      { type: OverwriteType.Member }
    );
  } catch (err) {
    await logError(err, {
      context: 'Band: konnte "Nachrichten senden" fuer @everyone nicht sperren (fehlt "Berechtigungen verwalten"?)',
      guildId: guild.id,
    });
  }
}

// Das Pendant zum Stage-Topic fuer normale Voice-Channels - die Statuszeile unter dem
// Channel-Namen. Braucht die eigene Berechtigung "Statuszeile des Sprachkanals festlegen".
async function ensureVoiceStatus(guild, channel) {
  if (channel.type !== ChannelType.GuildVoice) return;

  try {
    await guild.client.rest.put(Routes.channelVoiceStatus(channel.id), { body: { status: STATUS_TEXT } });
  } catch (err) {
    await logError(err, {
      context: 'Band: konnte Voice-Channel-Status nicht setzen (fehlt "Statuszeile des Sprachkanals festlegen"?)',
      guildId: guild.id,
    });
  }
}

async function connectTo(guild, channelId, channel) {
  if (connection) {
    connection.destroy();
    connection = null;
  }

  connection = joinVoiceChannel({
    channelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  attachReconnectHandling(connection);
  connection.subscribe(ensurePlayer());

  await entersState(connection, VoiceConnectionStatus.Ready, RECONNECT_TIMEOUT_MS).catch(() => {});

  // In einem Stage-Channel landet man beim Beitritt zunaechst im Publikum (stummgeschaltet) statt
  // als Sprecher - ohne diesen Schritt waere die Band unhoerbar. Braucht "Mitglieder stummschalten"
  // auf dem jeweiligen Stage-Channel, sonst schlaegt das mit einem Berechtigungsfehler fehl (wird
  // geloggt, verhindert aber nicht die Verbindung selbst). Bei einem normalen Voice-Channel gibt es
  // dieses Publikum/Sprecher-Konzept gar nicht - setSuppressed() ist dort KEIN No-Op, sondern wirft
  // "VoiceNotStageChannel", daher hier explizit uebersprungen statt ins Leere zu laufen.
  if (channel?.type === ChannelType.GuildStageVoice) {
    try {
      const me = guild.members.me ?? (await guild.members.fetchMe());
      await me.voice.setSuppressed(false);
    } catch (err) {
      await logError(err, {
        context: 'Band: konnte sich im Stage-Channel nicht selbst zum Sprecher machen (fehlt "Mitglieder stummschalten"?)',
        guildId: guild.id,
      });
    }
  }

  if (channel) await ensureStageInstance(guild, channel);
  if (channel) await ensureListenOnly(guild, channel);
  if (channel) await ensureNoTextChat(guild, channel);
  if (channel) await ensureVoiceStatus(guild, channel);

  currentChannelId = channelId;
  playTrack();
}

// Sucht den aktuell in /config hinterlegten Channel heraus (Guild + Channel-Objekt) - gemeinsam
// genutzt von syncBandChannel (automatischer Takt) und forceRejoin (manuell per /rejoin), damit
// beide exakt dieselbe Aufloesungslogik verwenden.
async function resolveConfiguredChannel(client) {
  for (const guild of client.guilds.cache.values()) {
    const channelId = getBandVoiceChannelId(guild.id);
    if (!channelId) continue;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) continue;

    return { guild, channelId, channel };
  }
  return null;
}

// Wird regelmaessig aufgerufen (siehe startBandSync): stellt sicher, dass die Band im aktuell in
// /config hinterlegten Voice-Channel spielt - reagiert also automatisch, wenn der Channel erst
// nachtraeglich gesetzt oder spaeter geaendert wird, ohne dass der Bot neu gestartet werden muss.
async function syncBandChannel(client) {
  const resolved = await resolveConfiguredChannel(client);

  if (!resolved) {
    if (connection) {
      connection.destroy();
      connection = null;
      currentChannelId = null;
    }
    return;
  }

  const { guild, channelId, channel } = resolved;

  // Bewusst strikt auf "Ready" geprueft, nicht nur "nicht Destroyed" - bei einem Netzwerk-/DNS-
  // Ausfall waehrend des Verbindungsaufbaus (siehe connectTo(): das entersState(..., Ready, ...)
  // gibt bei Timeout bewusst NICHT auf, sondern faehrt trotzdem fort) kann die Verbindung in einem
  // Zwischenzustand (z.B. "Signalling"/"Connecting"/"Disconnected") haengen bleiben, OHNE jemals
  // "Destroyed" zu erreichen - die alte Pruefung haette das faelschlich als "schon verbunden"
  // durchgehen lassen und NIE wieder neu verbunden, obwohl Discord die Verbindung laengst nicht mehr
  // fuehrt (Bot erscheint online, aber nicht im Channel, spielt aber lokal "ins Leere" weiter).
  const alreadyConnected =
    connection && connection.state.status === VoiceConnectionStatus.Ready && currentChannelId === channelId;

  if (alreadyConnected) {
    // Selbstheilung: normalerweise startet der Idle-Handler in ensurePlayer() von selbst den
    // naechsten Titel. War der Ordner aber gerade leer, als zuletzt versucht wurde (siehe
    // playTrack()), bleibt der Player fuer immer still - dieser Check holt das nach, sobald
    // wieder Titel vorhanden sind, ohne auf einen Neustart angewiesen zu sein.
    if (player && player.state.status === AudioPlayerStatus.Idle && getTracks().length > 0) {
      playTrack();
    }
    return;
  }

  try {
    await connectTo(guild, channelId, channel);
  } catch (err) {
    await logError(err, { context: 'Band: Voice-Channel verbinden', guildId: guild.id });
  }
}

// Fuer /skip: bricht den laufenden Titel sofort ab und startet direkt den naechsten - playTrack()
// kuemmert sich selbst um stopFfmpeg() vorher, kein Sonderfall noetig.
function skipTrack() {
  if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
    return { ok: false, message: 'Aktuell keine aktive Verbindung zum Voice-/Stage-Channel.' };
  }

  if (getTracks().length === 0) {
    return { ok: false, message: 'Keine Titel im aktuellen Ordner gefunden.' };
  }

  playTrack();
  return { ok: true };
}

// Fuer /credits: der Pfad relativ zu shared/music (z. B. "funk/Aces High.mp3"), wie er auch als
// Schluessel in music_credits verwendet wird - null, wenn gerade nichts spielt.
function getCurrentTrack() {
  return lastTrack;
}

function startBandSync(client) {
  syncBandChannel(client).catch((err) => logError(err, { context: 'Band-Sync (Start)' }));
  setInterval(() => {
    syncBandChannel(client).catch((err) => logError(err, { context: 'Band-Sync' }));
  }, SYNC_INTERVAL_MS);
}

// Fuer /rejoin: verwirft eine evtl. noch bestehende (z. B. haengende/stumme) Verbindung und baut
// unbedingt neu auf, statt wie syncBandChannel nur bei Bedarf zu handeln - fuer den Fall, dass der
// automatische Sync-Takt aus irgendeinem Grund nicht von selbst wieder verbunden hat.
async function forceRejoin(client) {
  if (connection) {
    connection.destroy();
    connection = null;
    currentChannelId = null;
  }

  const resolved = await resolveConfiguredChannel(client);
  if (!resolved) {
    return { ok: false, message: 'Kein Voice-/Stage-Channel konfiguriert (siehe `/config setchannel selection:band-voice`) oder der konfigurierte Kanal existiert nicht mehr.' };
  }

  const { guild, channelId, channel } = resolved;

  try {
    await connectTo(guild, channelId, channel);
    return { ok: true };
  } catch (err) {
    await logError(err, { context: 'Band: manueller Rejoin', guildId: guild.id });
    return { ok: false, message: 'Verbindung fehlgeschlagen - siehe Error-Log für Details.' };
  }
}

// Fuer die Genre-Abstimmung: welcher Ordner (oder null = alle gemischt) gerade aktiv ist, um bei
// Stimmengleichstand den Status quo bevorzugen zu koennen statt unnoetig zu wechseln.
function getActiveFolder() {
  return activeFolder;
}

module.exports = {
  MUSIC_DIR,
  startBandSync,
  forceRejoin,
  getFolders,
  setActiveFolder,
  getActiveFolder,
  skipTrack,
  getCurrentTrack,
  onTrackChange,
  setTrackWeightProvider,
  getTrackStartedAt,
  getTrackDurationSeconds,
  getPlaybackDurationMs,
};
