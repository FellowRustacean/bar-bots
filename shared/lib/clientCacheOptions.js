// Fabrikfunktion statt fixem require('discord.js') - shared/lib-Dateien haben bewusst keine
// eigenen npm-Abhängigkeiten (siehe botInteractions.js), jeder Bot reicht sein eigenes
// discord.js-`Options`-Objekt rein (siehe index.js: `createClientCacheOptions(Options)`).
//
// Discord.js cacht standardmäßig Nachrichten unbegrenzt (kein Limit, kein automatisches Aufräumen)
// - auf einem dauerhaft laufenden Pi-Prozess wächst das über Zeit unbegrenzt. RAM ist hier
// wichtiger als ein perfekt warmer Cache: lieber Nachrichten nach 1 Tag aus dem Speicher werfen und
// bei Bedarf (z. B. für Message-Log-Edits) neu von Discord nachladen, als dass der Prozess über
// Wochen immer mehr RAM belegt. messageLog.js behandelt fehlende Cache-Treffer bereits sauber
// (message.partial-Fallback), das Sweeping ist also gefahrlos.
const MESSAGE_CACHE_LIMIT_PER_CHANNEL = 50;
const MESSAGE_SWEEP_INTERVAL_SECONDS = 60 * 60; // stündlich prüfen
const MESSAGE_LIFETIME_SECONDS = 24 * 60 * 60; // 1 Tag

function createClientCacheOptions(Options) {
  return {
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: MESSAGE_CACHE_LIMIT_PER_CHANNEL,
      PresenceManager: 0, // keiner der Bots nutzt den GuildPresences-Intent
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: {
        interval: MESSAGE_SWEEP_INTERVAL_SECONDS,
        lifetime: MESSAGE_LIFETIME_SECONDS,
      },
    },
  };
}

module.exports = { createClientCacheOptions };
