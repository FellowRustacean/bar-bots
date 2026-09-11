const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  skipTrack,
  onTrackChange,
  getCurrentTrack,
  getTrackDurationSeconds,
  getPlaybackDurationMs,
} = require('./bandPlayer');
const { getBandVoiceChannelId, getBandPlayerMessageId, setBandPlayerMessageId } = require('../../storage/bandSettings');
const { getCredit } = require('../../storage/musicCredits');
const { getArtistByFolder } = require('../../storage/artists');
const { setRating, getUserRating, getRatingsForTrack } = require('../../storage/bandRatings');
const {
  addSkipVote,
  removeSkipVote,
  hasSkipVote,
  getSkipVoteCount,
  removeSkipVotesNotIn,
  clearSkipVotes,
} = require('../../storage/bandSkipVotes');
const { logError } = require('../logs/errorLog');

const RATE_BUTTON_PREFIX = 'band_rate:';
const SKIP_BUTTON_ID = 'band_skip';
const SYNC_INTERVAL_MS = 5 * 1000;
const EMBED_COLOR = 0x5865f2;
const PROGRESS_BAR_LENGTH = 20;
const STARS = [1, 2, 3, 4, 5];

// Merkt sich, fuer welchen Titel zuletzt ein onTrackChange-Event verarbeitet wurde - der Hook
// feuert ZWEIMAL pro Titel (sofort beim Start, erneut sobald ffprobe die Dauer geliefert hat),
// Skip-Stimmen duerfen aber nur beim tatsaechlichen Titelwechsel geleert werden, nicht beim
// zweiten Aufruf fuer denselben Titel.
let lastHandledTrack = undefined;

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// playbackDuration kommt direkt vom @discordjs/voice-AudioResource (tatsaechlich verarbeitete
// Stream-Zeit) statt aus einer reinen Wanduhr-Differenz - bleibt auch bei kurzen Verzoegerungen
// beim Verbindungsaufbau/Puffern korrekt synchron zum tatsaechlich Gehoerten.
function buildProgressBar() {
  const playbackMs = getPlaybackDurationMs();
  const durationSeconds = getTrackDurationSeconds();
  if (playbackMs === null) return 'Gerade lädt...';
  if (!durationSeconds) return '⏳ Dauer wird ermittelt...';

  const elapsedSeconds = Math.min(durationSeconds, Math.floor(playbackMs / 1000));
  const ratio = durationSeconds > 0 ? elapsedSeconds / durationSeconds : 0;
  const filled = Math.round(ratio * PROGRESS_BAR_LENGTH);
  const bar = '▬'.repeat(filled) + '🔘' + '▬'.repeat(Math.max(0, PROGRESS_BAR_LENGTH - filled - 1));

  return `${bar}\n${formatDuration(elapsedSeconds)} / ${formatDuration(durationSeconds)}`;
}

// Band-Artist (siehe /artist bei Band) hat Vorrang vor einem music_credits-Eintrag - der oberste
// Ordnername des Tracks (z. B. "Johnny & The Pimps/Digga.mp3" -> "Johnny & The Pimps") wird gegen
// die artists-Tabelle geprueft. Nur wenn kein Artist-Profil fuer diesen Ordner existiert, wird auf
// den bisherigen music_credits-Mechanismus zurueckgefallen (fuer die automatisch importierten
// Genre-Ordner wie "funk"/"jazz").
function trackTitleAndArtist(track, guildId) {
  const folder = track?.includes('/') ? track.split('/')[0] : null;
  const bandArtist = folder ? getArtistByFolder(guildId, folder) : null;

  const fallbackTitle = track ? track.replace(/\.[^/.]+$/, '').split('/').pop() : 'Unbekannt';

  if (bandArtist) {
    return {
      title: fallbackTitle,
      artist: bandArtist.creditUrl ? `[${bandArtist.name}](${bandArtist.creditUrl})` : bandArtist.name,
    };
  }

  const credit = track ? getCredit(track) : null;
  const title = credit?.title ?? fallbackTitle;
  const artist = credit ? `[${credit.creditName}](${credit.creditUrl})` : '-';

  return { title, artist };
}

// Genre = der Unterordner-Pfad relativ zu shared/music (z. B. "smooth jazz/Song.mp3" -> "smooth
// jazz") - funktioniert unabhaengig davon, ob es einen music_credits-Eintrag gibt (dessen genre-
// Spalte ist nur fuer die per Downloader-Skript importierten Titel gepflegt, nicht fuer manuell
// ergaenzte wie "smooth jazz"/"swing").
function trackGenre(track) {
  if (!track || !track.includes('/')) return null;
  const genre = track.split('/').slice(0, -1).join('/');
  // Jeden Wortanfang großschreiben (z. B. "smooth jazz" -> "Smooth Jazz") statt nur den ersten
  // Buchstaben - sieht bei mehrwortigen Ordnernamen konsistenter aus.
  return genre.replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildNowPlayingEmbed(guildId, track, skipCount, skipTotal) {
  const { title, artist } = trackTitleAndArtist(track, guildId);
  const genre = trackGenre(track);
  const ratings = track ? getRatingsForTrack(guildId, track) : [];
  const avg = ratings.length > 0 ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length : null;

  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('🎵 Jetzt läuft')
    .addFields(
      { name: 'Titel', value: title, inline: true },
      { name: 'Interpret', value: artist, inline: true },
      { name: 'Genre', value: genre ?? '-', inline: true },
      { name: 'Fortschritt', value: buildProgressBar() },
      {
        name: 'Bewertung',
        value: avg !== null ? `⭐ ${avg.toFixed(1)}/5 (${ratings.length} Bewertung${ratings.length === 1 ? '' : 'en'})` : 'Noch keine Bewertungen',
      },
      { name: 'Skip', value: `${skipCount}/${skipTotal} wollen überspringen` }
    );
}

function buildComponents() {
  const starRow = new ActionRowBuilder().addComponents(
    STARS.map((n) =>
      new ButtonBuilder()
        .setCustomId(`${RATE_BUTTON_PREFIX}${n}`)
        .setLabel(`${n} ⭐`)
        .setStyle(ButtonStyle.Secondary)
    )
  );
  const skipRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(SKIP_BUTTON_ID).setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary)
  );

  return [starRow, skipRow];
}

async function fetchVoiceChannel(guild) {
  const channelId = getBandVoiceChannelId(guild.id);
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel && channel.isVoiceBased() ? channel : null;
}

function presentUserIds(channel) {
  return channel.members.filter((member) => !member.user.bot).map((member) => member.id);
}

// Wird aus mehreren unabhaengigen Quellen gleichzeitig ausgeloest (5s-Sync-Timer, Titelwechsel-Hook
// - bis zu zweimal pro Titel -, Skip-/Bewertungs-Buttons) - jeder Aufruf baut sein Embed synchron aus
// dem zu diesem Zeitpunkt aktuellen Titel, macht danach aber ZWEI Netzwerk-Roundtrips (Nachricht
// holen, dann bearbeiten). Ueberlappen sich zwei Aufrufe (z. B. schneller Titelwechsel waehrend der
// 5s-Tick gerade laeuft), kann der AELTERE, aber langsamere Edit den bereits aktuelleren ueberschreiben
// und so einen veralteten Titel/Fortschritt "einfrieren", bis der naechste Titelwechsel das zufaellig
// wieder korrigiert. Der Sequenzzaehler verhindert das: jeder Aufruf traegt sich als "neuester" ein,
// und prueft unmittelbar vor dem eigentlichen Edit, ob er das immer noch ist - ein zwischenzeitlich
// ueberholter (veralteter) Aufruf verwirft seinen Edit einfach, statt ihn trotzdem abzuschicken.
const latestUpdateSeqByGuild = new Map();

// Selbstheilend: fehlt die Nachricht (z. B. geloescht, oder die ID stammt noch von vor einem
// Neustart und der Fetch schlaegt aus einem anderen Grund fehl), wird sie neu angelegt und die
// neue ID persistiert, statt fuer immer stillschweigend ins Leere zu laufen (frueher wurde ein
// fehlgeschlagener fetch/edit einfach ignoriert - erst ein manuelles /refresh half).
async function updateNowPlayingMessage(guild, channel) {
  const mySeq = (latestUpdateSeqByGuild.get(guild.id) ?? 0) + 1;
  latestUpdateSeqByGuild.set(guild.id, mySeq);

  const track = getCurrentTrack();
  const skipCount = getSkipVoteCount(guild.id);
  const skipTotal = presentUserIds(channel).length;
  const embed = buildNowPlayingEmbed(guild.id, track, skipCount, skipTotal);
  const components = buildComponents();

  const messageId = getBandPlayerMessageId(guild.id);
  const existingMessage = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;

  // Zwischenzeitlich ist bereits ein neuerer Aufruf gestartet (siehe Kommentar oben) - dieser hier
  // ist veraltet, den Edit NICHT mehr abschicken, sonst ueberschreibt er womoeglich schon aktuellere
  // Daten.
  if (latestUpdateSeqByGuild.get(guild.id) !== mySeq) return;

  if (existingMessage) {
    await existingMessage.edit({ content: null, embeds: [embed], components }).catch(async (err) => {
      await logError(err, { context: 'Player-Embed konnte nicht bearbeitet werden', guildId: guild.id });
    });
    return;
  }

  try {
    const sent = await channel.send({ embeds: [embed], components });
    setBandPlayerMessageId(guild.id, sent.id);
  } catch (err) {
    await logError(err, { context: 'Player-Embed konnte nicht neu angelegt werden', guildId: guild.id });
  }
}

// Fuer /refresh: legt die Nachricht an, falls sie noch nicht existiert ODER inzwischen geloescht
// wurde (Fetch schlaegt dann fehl -> existingMessage bleibt null -> neue Nachricht wird gesendet).
async function refreshNowPlayingMessage(guild) {
  const channel = await fetchVoiceChannel(guild);
  if (!channel) {
    return { ok: false, message: 'Kein Voice-/Stage-Channel konfiguriert (siehe `/config setchannel selection:band-voice`) oder der konfigurierte Kanal existiert nicht mehr.' };
  }

  const track = getCurrentTrack();
  const skipCount = getSkipVoteCount(guild.id);
  const skipTotal = presentUserIds(channel).length;
  const embed = buildNowPlayingEmbed(guild.id, track, skipCount, skipTotal);
  const components = buildComponents();

  const existingId = getBandPlayerMessageId(guild.id);
  const existingMessage = existingId ? await channel.messages.fetch(existingId).catch(() => null) : null;

  if (existingMessage) {
    await existingMessage.edit({ content: null, embeds: [embed], components });
  } else {
    const sent = await channel.send({ embeds: [embed], components });
    setBandPlayerMessageId(guild.id, sent.id);
  }

  return { ok: true };
}

async function handleRateButton(interaction) {
  const voiceChannelId = getBandVoiceChannelId(interaction.guildId);

  if (!voiceChannelId || interaction.member.voice.channelId !== voiceChannelId) {
    await interaction.reply({ content: '❌ Du musst im Lounge-Channel sein, um zu bewerten.', flags: MessageFlags.Ephemeral });
    return;
  }

  const track = getCurrentTrack();
  if (!track) {
    await interaction.reply({ content: '❌ Gerade läuft nichts.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Sofort bestaetigen (Discord-Interaktionen laufen nach 3s ab) - Channel-Fetch + Nachrichten-
  // Bearbeitung danach sind Netzwerk-Roundtrips, die zusammen laenger dauern koennen.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rating = Number(interaction.customId.slice(RATE_BUTTON_PREFIX.length));
  setRating(interaction.guildId, interaction.user.id, track, rating);

  const channel = await fetchVoiceChannel(interaction.guild);
  if (channel) await updateNowPlayingMessage(interaction.guild, channel);

  await interaction.editReply({ content: `✅ Du hast diesen Song mit ${rating} ⭐ bewertet.` });
}

async function handleSkipButton(interaction) {
  const voiceChannelId = getBandVoiceChannelId(interaction.guildId);

  if (!voiceChannelId || interaction.member.voice.channelId !== voiceChannelId) {
    await interaction.reply({ content: '❌ Du musst im Lounge-Channel sein, um abzustimmen.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (hasSkipVote(interaction.guildId, interaction.user.id)) {
    await interaction.reply({ content: 'ℹ️ Du hast bereits für Skip gestimmt.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Sofort bestaetigen (Discord-Interaktionen laufen nach 3s ab) - Channel-Fetch + Nachrichten-
  // Bearbeitung danach sind Netzwerk-Roundtrips, die zusammen laenger dauern koennen.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  addSkipVote(interaction.guildId, interaction.user.id);

  const channel = await fetchVoiceChannel(interaction.guild);
  const total = channel ? presentUserIds(channel).length : 0;
  const count = getSkipVoteCount(interaction.guildId);

  if (total > 0 && count * 2 >= total) {
    // clearSkipVotes() + Embed-Refresh passieren automatisch ueber den onTrackChange-Hook, sobald
    // skipTrack() tatsaechlich einen neuen Titel startet.
    skipTrack();
    await interaction.editReply({ content: '⏭️ Genug Stimmen - der Titel wird übersprungen.' });
    return;
  }

  if (channel) await updateNowPlayingMessage(interaction.guild, channel);
  await interaction.editReply({ content: `✅ Stimme gezählt (${count}/${total}).` });
}

// Verlassen des Lounge-Channels entfernt nur die Skip-Stimme, NICHT die Bewertung - eine
// Bewertung gilt fuer den Song an sich und bleibt dauerhaft gespeichert.
async function handleVoiceLeave(oldState, newState) {
  if (oldState.member?.user?.bot) return;
  if (oldState.channelId === newState.channelId) return;

  const voiceChannelId = getBandVoiceChannelId(oldState.guild.id);
  if (!voiceChannelId || oldState.channelId !== voiceChannelId) return;

  removeSkipVote(oldState.guild.id, oldState.member.id);

  const channel = await fetchVoiceChannel(oldState.guild).catch(() => null);
  if (channel) await updateNowPlayingMessage(oldState.guild, channel);
}

async function reconcile(client) {
  for (const guild of client.guilds.cache.values()) {
    const channel = await fetchVoiceChannel(guild);
    if (!channel) continue;

    removeSkipVotesNotIn(guild.id, presentUserIds(channel));
    await updateNowPlayingMessage(guild, channel);
  }
}

function startNowPlayingSync(client) {
  // Feuert bei JEDEM Titelwechsel-Event (auch dem zweiten fuer dieselbe Dauer-Aktualisierung) -
  // Skip-Stimmen werden aber nur beim tatsaechlichen Wechsel geleert (siehe lastHandledTrack).
  onTrackChange((track) => {
    const isNewTrack = track !== lastHandledTrack;
    lastHandledTrack = track;

    for (const guild of client.guilds.cache.values()) {
      if (isNewTrack) clearSkipVotes(guild.id);

      fetchVoiceChannel(guild)
        .then((channel) => channel && updateNowPlayingMessage(guild, channel))
        .catch((err) => logError(err, { context: 'Player-Embed: nach Titelwechsel aktualisieren', guildId: guild.id }));
    }
  });

  reconcile(client).catch((err) => logError(err, { context: 'Player-Embed-Abgleich (Start)' }));
  setInterval(() => {
    reconcile(client).catch((err) => logError(err, { context: 'Player-Embed-Abgleich' }));
  }, SYNC_INTERVAL_MS);
}

module.exports = {
  RATE_BUTTON_PREFIX,
  SKIP_BUTTON_ID,
  refreshNowPlayingMessage,
  handleRateButton,
  handleSkipButton,
  handleVoiceLeave,
  startNowPlayingSync,
};
