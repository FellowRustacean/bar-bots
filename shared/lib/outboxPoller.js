const POLL_INTERVAL_MS = 1000;

// Fabrikfunktion statt fixem require('../../storage/outbox')/require('../logs/errorLog'), damit
// diese Datei aus dem gemeinsamen shared/lib-Ordner heraus für jeden Bot funktioniert - jeder Bot
// reicht seinen eigenen Outbox-Store und sein eigenes logError rein (siehe
// utils/outbox/outboxPoller.js in jedem Bot-Ordner).
// customActions (optional): Map von Aktionsname -> async (job, { client, channel, markOutboxJobDone })
// fuer bot-spezifische Aktionen, die nicht in jeden Bot gehoeren (z. B. "order_drink" nur beim
// Barkeeper) - so bleibt diese gemeinsame Datei generisch, ohne bot-spezifische requires.
function createOutboxPoller(outboxStore, logError, customActions = {}) {
  const { claimPendingOutboxJobs, markOutboxJobDone, markOutboxJobError } = outboxStore;

  async function processJob(client, job) {
    const channel = await client.channels.fetch(job.channel_id).catch(() => null);
    if (!channel) throw new Error('Kanal nicht gefunden oder kein Zugriff');

    if (customActions[job.action]) {
      await customActions[job.action](job, { client, channel, markOutboxJobDone });
      return;
    }

    if (job.action === 'send') {
      const message = await channel.send({ content: job.content });
      markOutboxJobDone(job.id, message.id);
      return;
    }

    if (job.action === 'edit') {
      const message = await channel.messages.fetch(job.message_id);
      await message.edit({ content: job.content });
      markOutboxJobDone(job.id, message.id);
      return;
    }

    if (job.action === 'delete') {
      const message = await channel.messages.fetch(job.message_id);
      await message.delete();
      markOutboxJobDone(job.id, job.message_id);
      return;
    }

    if (job.action === 'typing') {
      // Kein result_message_id noetig - reiner "X schreibt..."-Indikator, laeuft nach ~10s ab.
      await channel.sendTyping();
      markOutboxJobDone(job.id, null);
      return;
    }

    if (job.action === 'forum_post') {
      // channel ist hier der Forum-Channel selbst (kein normaler Text-Channel) - threads.create()
      // legt einen neuen Post samt Start-Nachricht an. result_message_id trägt danach die
      // Thread-ID statt einer Nachrichten-ID (gleiches Feld, andere Bedeutung bei dieser Aktion).
      const thread = await channel.threads.create({
        name: job.title,
        message: { content: job.content },
      });
      markOutboxJobDone(job.id, thread.id);
      return;
    }

    throw new Error(`Unbekannte Outbox-Aktion: ${job.action}`);
  }

  // Jeder Bot pollt in kurzen Abständen die gemeinsame Datenbank auf Jobs, die an seinen eigenen
  // bot_name adressiert sind, und führt sie mit seinem eigenen (bereits eingeloggten) Client aus -
  // so kann z. B. Manager eine Nachricht "als Werwolf" auslösen, ohne dessen Token zu besitzen.
  function startOutboxPoller(client, botName) {
    setInterval(async () => {
      let jobs;
      try {
        jobs = claimPendingOutboxJobs(botName);
      } catch (err) {
        await logError(err, { context: 'Outbox-Poller: Jobs abrufen' });
        return;
      }

      for (const job of jobs) {
        try {
          await processJob(client, job);
        } catch (err) {
          markOutboxJobError(job.id, err.message ?? String(err));
          await logError(err, { context: `Outbox-Job #${job.id} (${job.action})`, guildId: job.guild_id });
        }
      }
    }, POLL_INTERVAL_MS);
  }

  return { startOutboxPoller };
}

module.exports = createOutboxPoller;
