const { getBandVoiceChannelId } = require('../../storage/bandSettings');
const { getRatingsForTrack } = require('../../storage/bandRatings');

const NEUTRAL_WEIGHT = 3; // Fuer noch unbewertete Titel - weder bevorzugt noch benachteiligt.

// Wird an bandPlayer.setTrackWeightProvider() uebergeben, damit die Zufallswiedergabe Titel
// proportional zur Durchschnittsbewertung der AKTUELL im Lounge-Channel anwesenden Nutzer
// gewichtet (5 Sterne = 5x so wahrscheinlich wie 1 Stern) - bewusst nur die Anwesenden, nicht
// alle, die den Titel je bewertet haben, wie in der Anforderung beschrieben. Rein synchron
// gehalten (nur Client-Cache, kein fetch()), da bandPlayer.pickNextTrack() selbst synchron ist.
function createTrackWeightProvider(client) {
  return function getTrackWeight(track) {
    for (const guild of client.guilds.cache.values()) {
      const channelId = getBandVoiceChannelId(guild.id);
      if (!channelId) continue;

      const channel = guild.channels.cache.get(channelId);
      if (!channel) continue;

      const presentUserIds = new Set(
        channel.members.filter((member) => !member.user.bot).map((member) => member.id)
      );
      const ratings = getRatingsForTrack(guild.id, track).filter((row) => presentUserIds.has(row.userId));

      if (ratings.length === 0) return NEUTRAL_WEIGHT;
      return ratings.reduce((sum, row) => sum + row.rating, 0) / ratings.length;
    }

    return NEUTRAL_WEIGHT;
  };
}

module.exports = { createTrackWeightProvider, NEUTRAL_WEIGHT };
