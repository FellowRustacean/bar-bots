const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { getFolders, setActiveFolder, getActiveFolder } = require('./bandPlayer');
const { getBandVoiceChannelId, getBandVoteMessageId, setBandVoteMessageId } = require('../../storage/bandSettings');
const {
  setVote,
  removeVote,
  getVoteCounts,
  clearVotesForGenresNotIn,
  removeVotesNotIn,
} = require('../../storage/bandVotes');
const { logError } = require('../logs/errorLog');

const VOTE_BUTTON_PREFIX = 'band_vote:';
const SYNC_INTERVAL_MS = 30 * 1000;
const EMBED_COLOR = 0x5865f2;

function buildVoteEmbed() {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('🎶 Genre-Abstimmung')
    .setDescription(
      'Stimmt ab, welches Genre gerade laufen soll! Nur wer gerade in diesem Voice-/Stage-Channel ' +
        'ist, kann abstimmen - verlässt du den Channel, wird deine Stimme automatisch entfernt.'
    );
}

function buildVoteComponents(genres, counts) {
  const countMap = new Map(counts.map((row) => [row.genre, row.count]));
  const rows = [];

  for (let i = 0; i < genres.length; i += 5) {
    const rowGenres = genres.slice(i, i + 5);
    rows.push(
      new ActionRowBuilder().addComponents(
        rowGenres.map((genre) =>
          new ButtonBuilder()
            .setCustomId(`${VOTE_BUTTON_PREFIX}${genre}`)
            .setLabel(`${genre} (${countMap.get(genre) ?? 0})`)
            .setStyle(ButtonStyle.Secondary)
        )
      )
    );
  }

  return rows;
}

// Bei mehreren Genres mit gleich vielen Stimmen bleibt nach Moeglichkeit das aktuell laufende
// Genre aktiv, statt grundlos zu wechseln - erst wenn es selbst nicht mehr unter den
// Fuehrenden ist, wird zufaellig unter ihnen gewaehlt. Keine Stimmen ueberhaupt -> null (= alle
// Genres gemischt), passend zu setActiveFolder(null).
function determineWinner(counts, currentGenre) {
  if (counts.length === 0) return null;

  const max = Math.max(...counts.map((row) => row.count));
  const leaders = counts.filter((row) => row.count === max).map((row) => row.genre);

  if (leaders.length === 1) return leaders[0];
  if (currentGenre && leaders.includes(currentGenre)) return currentGenre;
  return leaders[Math.floor(Math.random() * leaders.length)];
}

async function fetchVoiceChannel(guild) {
  const channelId = getBandVoiceChannelId(guild.id);
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel && channel.isVoiceBased() ? channel : null;
}

// Aehnliche Race wie bei updateNowPlayingMessage in nowPlaying.js: mehrere unabhaengige Quellen
// (Vote-Klick, Channel-Verlassen, periodischer 30s-Abgleich) koennen ueberlappend feuern - ein
// aelterer, aber langsamerer Edit koennte sonst einen bereits aktuelleren ueberschreiben.
const latestUpdateSeqByGuild = new Map();

// Wendet das aktuell fuehrende Genre an (falls es sich geaendert hat) und aktualisiert die
// Stimmenzahl auf den Buttons der Abstimmungs-Nachricht - der gemeinsame Kern hinter Vote-Klicks,
// Verlassen des Channels UND dem periodischen Abgleich.
async function applyWinnerAndUpdateMessage(guild, channel) {
  const mySeq = (latestUpdateSeqByGuild.get(guild.id) ?? 0) + 1;
  latestUpdateSeqByGuild.set(guild.id, mySeq);

  const genres = getFolders();
  const counts = getVoteCounts(guild.id);
  const currentGenre = getActiveFolder();
  const winner = determineWinner(counts, currentGenre);

  if (winner !== currentGenre) {
    setActiveFolder(winner);
  }

  // Selbstheilend: fehlt die Nachricht (z. B. geloescht), wird sie neu angelegt und die neue ID
  // persistiert, statt fuer immer stillschweigend ins Leere zu laufen (frueher wurde ein
  // fehlgeschlagener fetch/edit einfach ignoriert - erst ein manuelles /refresh half).
  const messageId = getBandVoteMessageId(guild.id);
  const existingMessage = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;

  // Zwischenzeitlich ist bereits ein neuerer Aufruf gestartet - dieser hier ist veraltet, den Edit
  // NICHT mehr abschicken (siehe ausfuehrlicher Kommentar bei updateNowPlayingMessage).
  if (latestUpdateSeqByGuild.get(guild.id) !== mySeq) return;

  if (existingMessage) {
    await existingMessage.edit({ content: null, components: buildVoteComponents(genres, counts) }).catch(async (err) => {
      await logError(err, { context: 'Genre-Abstimmung-Embed konnte nicht bearbeitet werden', guildId: guild.id });
    });
    return;
  }

  try {
    const sent = await channel.send({ embeds: [buildVoteEmbed()], components: buildVoteComponents(genres, counts) });
    setBandVoteMessageId(guild.id, sent.id);
  } catch (err) {
    await logError(err, { context: 'Genre-Abstimmung-Embed konnte nicht neu angelegt werden', guildId: guild.id });
  }
}

// Fuer /refresh: liest die aktuelle Ordnerstruktur neu ein, verwirft Stimmen fuer verschwundene
// Genres, und legt die Abstimmungs-Nachricht an (falls noch keine existiert) oder aktualisiert sie
// (falls schon eine existiert) - kein Bot-Neustart noetig, da getFolders() ohnehin live von der
// Platte liest.
async function refreshVoteMessage(guild) {
  const channel = await fetchVoiceChannel(guild);
  if (!channel) {
    return { ok: false, message: 'Kein Voice-/Stage-Channel konfiguriert (siehe `/config setchannel selection:band-voice`) oder der konfigurierte Kanal existiert nicht mehr.' };
  }

  const genres = getFolders();
  clearVotesForGenresNotIn(guild.id, genres);

  const counts = getVoteCounts(guild.id);
  const components = buildVoteComponents(genres, counts);

  const existingId = getBandVoteMessageId(guild.id);
  const existingMessage = existingId ? await channel.messages.fetch(existingId).catch(() => null) : null;

  if (existingMessage) {
    await existingMessage.edit({ content: null, embeds: [buildVoteEmbed()], components });
  } else {
    const sent = await channel.send({ embeds: [buildVoteEmbed()], components });
    setBandVoteMessageId(guild.id, sent.id);
  }

  const currentGenre = getActiveFolder();
  const winner = determineWinner(counts, currentGenre);
  if (winner !== currentGenre) setActiveFolder(winner);

  return { ok: true };
}

async function handleVoteButton(interaction) {
  const genre = interaction.customId.slice(VOTE_BUTTON_PREFIX.length);
  const voiceChannelId = getBandVoiceChannelId(interaction.guildId);

  if (!voiceChannelId || interaction.member.voice.channelId !== voiceChannelId) {
    await interaction.reply({
      content: '❌ Du musst im Lounge-Channel sein, um abzustimmen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Sofort bestaetigen (Discord-Interaktionen laufen nach 3s ab) - der eigentliche Channel-
  // Fetch + die Nachrichten-Bearbeitung danach sind Netzwerk-Roundtrips, die zusammen laenger
  // dauern koennen, als bis zu einer finalen reply() zu warten sicher waere.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  setVote(interaction.guildId, interaction.user.id, genre);

  const channel = await fetchVoiceChannel(interaction.guild);
  if (channel) {
    await applyWinnerAndUpdateMessage(interaction.guild, channel);
  }

  await interaction.editReply({ content: `✅ Du hast für **${genre}** gestimmt.` });
}

// Wird bei jedem voiceStateUpdate aufgerufen (siehe index.js) - entfernt die Stimme sofort, wenn
// jemand den Lounge-Channel verlässt (egal ob komplette Trennung oder Wechsel in einen anderen
// Channel).
async function handleVoiceLeave(oldState, newState) {
  if (oldState.member?.user?.bot) return;
  if (oldState.channelId === newState.channelId) return;

  const voiceChannelId = getBandVoiceChannelId(oldState.guild.id);
  if (!voiceChannelId || oldState.channelId !== voiceChannelId) return;

  removeVote(oldState.guild.id, oldState.member.id);

  const channel = await fetchVoiceChannel(oldState.guild).catch(() => null);
  if (channel) {
    await applyWinnerAndUpdateMessage(oldState.guild, channel);
  }
}

// Periodischer Selbstheil-Abgleich (alle 30s, wie syncBandChannel): faengt verpasste
// voiceStateUpdate-Events ab, z. B. wenn der Bot mitten in einer Sitzung neu gestartet wurde und
// dabei jemand den Channel verlassen hat.
async function reconcileVotes(client) {
  for (const guild of client.guilds.cache.values()) {
    const channel = await fetchVoiceChannel(guild);
    if (!channel) continue;

    const presentUserIds = channel.members.filter((member) => !member.user.bot).map((member) => member.id);
    removeVotesNotIn(guild.id, presentUserIds);
    await applyWinnerAndUpdateMessage(guild, channel);
  }
}

function startVoteSync(client) {
  reconcileVotes(client).catch((err) => logError(err, { context: 'Genre-Abstimmung-Abgleich (Start)' }));
  setInterval(() => {
    reconcileVotes(client).catch((err) => logError(err, { context: 'Genre-Abstimmung-Abgleich' }));
  }, SYNC_INTERVAL_MS);
}

module.exports = {
  VOTE_BUTTON_PREFIX,
  refreshVoteMessage,
  handleVoteButton,
  handleVoiceLeave,
  startVoteSync,
};
