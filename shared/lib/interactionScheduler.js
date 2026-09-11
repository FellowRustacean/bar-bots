const { pickWeighted } = require('./weightedRandom');

const POLL_INTERVAL_MS = 5 * 1000;

// Fabrikfunktion statt fixem require(...): jeder Bot reicht seinen eigenen Interaction-Store
// (siehe storage/botInteractions.js), seine lokale Registry (utils/botInteractions/registry.js)
// und sein eigenes logError rein.
//
// registry-Format: Array aus
//   { key: string, label: string, weight?: number, canRun: (client) => boolean|Promise<boolean>, run: (client) => void|Promise<void> }
// - key: eindeutig über die GESAMTE Flotte (nicht nur innerhalb eines Bots).
// - label: Klartext-Beschreibung, landet im gemeinsamen Katalog (bot_interactions), rein
//   informativ.
// - weight: relative Häufigkeit beim zufälligen Auswürfeln (Standard: 1). Zwei Interaktionen mit
//   Gewicht 10 und 3 werden im Verhältnis 10:3 ausgewählt, nicht gleich oft.
// - canRun: optionale Vorbedingung (z. B. "gibt es überhaupt einen Tisch zum Abwischen?"). Fehlt
//   sie, gilt die Interaktion immer als ausführbar.
// - run: die eigentliche Handlung.
function createInteractionScheduler(store, registry, logError) {
  // Wird beim Start aufgerufen (index.js), bevor der Poller läuft - meldet die eigenen
  // Interaktionen im gemeinsamen Katalog an, damit andere Bots beim Auswürfeln davon wissen.
  function registerInteractions(botName) {
    store.syncInteractionRegistry(botName, registry);
  }

  async function runOwnJobs(client, botName) {
    const jobs = store.claimPendingInteractionJobs(botName);

    for (const job of jobs) {
      const entry = registry.find((r) => r.key === job.interactionKey);

      if (!entry) {
        // Sollte nicht passieren (Registry wurde ja synchronisiert), aber falls doch - z. B. der
        // Bot wurde zwischen Ankündigung und Ausführung neu deployt und die Interaktion entfernt.
        store.markInteractionJobError(job.id, `Unbekannte Interaktion: ${job.interactionKey}`);
        continue;
      }

      try {
        const eligible = entry.canRun ? await entry.canRun(client) : true;

        if (!eligible) {
          store.markInteractionJobSkipped(job.id);
          continue;
        }

        await entry.run(client);
        store.markInteractionJobDone(job.id);
      } catch (err) {
        store.markInteractionJobError(job.id, err.message ?? String(err));
        await logError(err, { context: `Bot-Interaktion "${job.interactionKey}"` });
      }
    }
  }

  // Prüft den gemeinsamen Takt; gewinnt dieser Prozess das Beanspruchen, wird gewichtet zufällig
  // EINE Interaktion aus dem GESAMTEN Katalog (alle Bots) gezogen und als Job an deren Bot
  // adressiert.
  function maybeTriggerRandomInteraction() {
    if (!store.claimScheduledRun()) return;

    const candidates = store.getEnabledInteractions();
    if (candidates.length === 0) return;

    const chosen = pickWeighted(candidates);
    store.enqueueInteractionJob(chosen.botName, chosen.key);
  }

  function startInteractionScheduler(client, botName) {
    registerInteractions(botName);

    setInterval(() => {
      try {
        maybeTriggerRandomInteraction();
      } catch (err) {
        logError(err, { context: 'Bot-Interaktion: Zufallstakt' }).catch(() => {});
      }

      runOwnJobs(client, botName).catch((err) => {
        logError(err, { context: 'Bot-Interaktion: Job-Ausführung' }).catch(() => {});
      });
    }, POLL_INTERVAL_MS);
  }

  return { startInteractionScheduler };
}

module.exports = createInteractionScheduler;
