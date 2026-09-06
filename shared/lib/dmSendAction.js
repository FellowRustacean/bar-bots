// Fabrikfunktion - jeder Bot bindet seine eigene linkDmRelay-Funktion ein (siehe storage/dmThreads.js)
// und registriert das Ergebnis als customAction 'dm_send' bei seinem eigenen createOutboxPoller-
// Aufruf (siehe utils/outbox/outboxPoller.js). Liegt als EIGENE Datei statt fest im generischen
// outboxPoller.js, weil hier Zugriff auf die bot-eigene DM-Relay-Verknuepfung noetig ist - der Kern-
// Poller bleibt so weiterhin ohne bot-spezifische Abhaengigkeiten.
function createDmSendAction({ linkDmRelay }) {
  // job.title traegt hier (nur bei dieser Aktion) die Anhang-URLs als JSON-Array (Bilder/Dateien der
  // urspruenglichen Thread-Nachricht) - siehe handleButton in dmThreadFlow.js, das den Job baut.
  return async function dmSendAction(job, { client, channel, markOutboxJobDone }) {
    let attachmentUrls = [];
    if (job.title) {
      try {
        attachmentUrls = JSON.parse(job.title);
      } catch {
        attachmentUrls = [];
      }
    }

    // Zustellungsfehler (DMs gesperrt, blockiert, kein gemeinsamer Server mehr) sind ein erwarteter,
    // haeufiger Fall hier - werden bewusst als 'done' (nicht 'error') markiert und direkt im Thread
    // beantwortet, statt den allgemeinen Error-Log-Kanal damit zu fluten. Bei Erfolg NUR die
    // spaeter im Thread gesetzte ✅-Reaktion (siehe handleButton) - keine zusaetzliche Textnachricht.
    try {
      const user = await client.users.fetch(job.target_user_id);
      const dm = await user.createDM();
      const sent = await dm.send({
        content: job.content || undefined,
        files: attachmentUrls.length > 0 ? attachmentUrls : undefined,
      });

      if (job.message_id) {
        linkDmRelay(job.message_id, job.channel_id, sent.id, dm.id);
      }

      markOutboxJobDone(job.id, sent.id);
    } catch (err) {
      await channel
        .send({ content: `⚠️ Nachricht konnte nicht zugestellt werden (${err.message}).` })
        .catch(() => {});
      markOutboxJobDone(job.id, null);
    }
  };
}

module.exports = { createDmSendAction };
