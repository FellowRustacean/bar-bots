const { onTrackChange } = require('./bandPlayer');
const { getArtistByFolder } = require('../../storage/artists');
const { logError } = require('../logs/errorLog');

// Wird gezeigt, wenn gerade kein Titel eines registrierten Artists laeuft (normale Genre-Ordner
// oder gemischte Wiedergabe) - der "Haus-Name" der Band.
const DEFAULT_NAME = 'The Barflies';

// Merkt sich, fuer welchen Titel zuletzt umbenannt wurde - der onTrackChange-Hook feuert ZWEIMAL
// pro Titel (sofort beim Start, erneut sobald ffprobe die Dauer geliefert hat, siehe
// nowPlaying.js), die Umbenennung soll aber nur beim tatsaechlichen Titelwechsel passieren.
let lastHandledTrack = undefined;

function trackFolder(track) {
  if (!track || !track.includes('/')) return null;
  return track.split('/')[0];
}

async function renameForTrack(client, track) {
  const folder = trackFolder(track);

  for (const guild of client.guilds.cache.values()) {
    const artist = folder ? getArtistByFolder(guild.id, folder) : null;
    const desiredName = artist?.name ?? DEFAULT_NAME;

    try {
      const me = guild.members.me ?? (await guild.members.fetchMe());
      if (me.nickname === desiredName || (!me.nickname && desiredName === me.user.username)) continue;
      await me.setNickname(desiredName);
    } catch (err) {
      await logError(err, {
        context: 'Band: Umbenennung fuer Artist fehlgeschlagen (fehlt "Nickname aendern"?)',
        guildId: guild.id,
      });
    }
  }
}

// Haengt sich an denselben onTrackChange-Hook wie das Player-Embed (siehe startNowPlayingSync in
// nowPlaying.js) - laeuft die Band gerade Musik aus dem Ordner eines registrierten Artists (siehe
// /artist), nennt sich der Bot per Server-Nickname nach diesem Artist um, sonst nach DEFAULT_NAME.
function startArtistNicknameSync(client) {
  onTrackChange((track) => {
    const isNewTrack = track !== lastHandledTrack;
    lastHandledTrack = track;
    if (!isNewTrack) return;

    renameForTrack(client, track).catch((err) => logError(err, { context: 'Band: Artist-Umbenennung' }));
  });
}

module.exports = { startArtistNicknameSync, DEFAULT_NAME };
