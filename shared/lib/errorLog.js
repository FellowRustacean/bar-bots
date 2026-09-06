// Bewusst kein `require('discord.js')` hier - der shared/lib-Ordner ist kein eigenes npm-Projekt
// mit eigenem node_modules, Node würde das Modul also nicht finden. channel.send() akzeptiert für
// files auch ein einfaches { attachment, name }-Objekt statt eines AttachmentBuilder, das reicht.

// Fabrikfunktion statt fixem require('../../storage/guildConfig'), damit diese Datei aus dem
// gemeinsamen shared/lib-Ordner heraus für jeden Bot funktioniert, unabhängig davon, wo genau
// dessen eigene storage/guildConfig.js relativ dazu liegt - jeder Bot reicht seine eigene
// getLogChannel-Funktion beim require rein (siehe utils/logs/errorLog.js in jedem Bot-Ordner).
function createErrorLog(getLogChannel) {
  // Muss einmal beim Start registriert werden (index.js), damit auch Fehler ganz ohne
  // Interaktionskontext (z. B. uncaughtException) noch irgendwo geloggt werden können.
  let registeredClient = null;

  function registerClient(client) {
    registeredClient = client;
  }

  function formatErrorText(err, context) {
    const lines = [
      `Zeitpunkt: ${new Date().toISOString()}`,
      context ? `Kontext: ${context}` : null,
      '',
      err?.stack || String(err),
    ].filter((line) => line !== null);

    return lines.join('\n');
  }

  async function sendToGuildErrorChannel(guild, content) {
    const channelId = getLogChannel(guild.id, 'errors');
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const attachment = { attachment: Buffer.from(content, 'utf8'), name: `error-${Date.now()}.txt` };

    await channel.send({ content: '⚠️ Ein Fehler ist aufgetreten.', files: [attachment] }).catch(() => {});
  }

  // Loggt einen Fehler zur Konsole und - falls konfiguriert - als .txt in den Error-Log-Channel.
  // Ist guildId bekannt, wird nur dorthin geloggt; ansonsten (z. B. bei einem globalen/
  // prozessweiten Fehler ohne erkennbaren Server-Kontext) in die Error-Channels aller Server,
  // die einen konfiguriert haben. Wirft selbst NIEMALS einen Fehler.
  async function logError(err, { context, guildId } = {}) {
    console.error(context ? `[${context}]` : '[Fehler]', err);

    if (!registeredClient) return;

    try {
      const content = formatErrorText(err, context);

      if (guildId) {
        const guild = await registeredClient.guilds.fetch(guildId).catch(() => null);
        if (guild) await sendToGuildErrorChannel(guild, content);
        return;
      }

      for (const guild of registeredClient.guilds.cache.values()) {
        await sendToGuildErrorChannel(guild, content);
      }
    } catch (loggingErr) {
      // Selbst das Error-Logging darf niemals einen weiteren Fehler werfen.
      console.error('[ErrorLog] Konnte Fehler nicht in den Log-Channel senden:', loggingErr);
    }
  }

  return { registerClient, logError };
}

module.exports = createErrorLog;
