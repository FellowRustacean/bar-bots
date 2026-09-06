const { getOutboxJob } = require('../../storage/outbox');

// Wartet, bis der zuständige Bot-Prozess den Outbox-Job abgearbeitet hat (Polling-Intervall der
// Bots liegt bei ~1s), damit die Antwort an den Nutzer den tatsächlichen Ausgang widerspiegelt
// statt blind "wird ausgeführt" zu melden. Von /message UND /forum genutzt. Wartet auf einen
// TERMINALEN Status ('done'/'error') statt nur "nicht mehr 'pending'" - seit claimPendingOutboxJobs
// den Job beim Abholen sofort auf 'processing' setzt (siehe shared/lib/outbox.js), waere "nicht
// pending" sonst schon waehrend der eigentlichen Verarbeitung erfuellt, lange bevor ein echtes
// Ergebnis feststeht.
async function waitForOutboxJob(jobId, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = getOutboxJob(jobId);
    if (job && (job.status === 'done' || job.status === 'error')) return job;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return getOutboxJob(jobId);
}

module.exports = { waitForOutboxJob };
