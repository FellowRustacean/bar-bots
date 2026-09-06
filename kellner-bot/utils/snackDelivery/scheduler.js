const { getDueSnackOrders, deleteSnackOrder } = require('../../storage/snackOrders');
const { logError } = require('../logs/errorLog');
const { pickRandomLine } = require('../../../shared/lib/messageLines');

const CHECK_INTERVAL_MS = 15 * 1000;

// Textbausteine liegen in shared/data/messages/kellner.json (Key "snackDelivery") - wird bei
// jedem Aufruf frisch gelesen, eine Aenderung dort greift sofort ohne Neustart (siehe
// messageLines.js).
function randomDeliveryMessage(snackName) {
  return pickRandomLine('kellner', 'snackDelivery').replace('{snack}', snackName);
}

function startSnackDeliveryScheduler(client) {
  setInterval(async () => {
    const due = getDueSnackOrders(Date.now());

    for (const order of due) {
      // Sofort entfernen (wie bei reminders) - der eigentliche Zustellversuch läuft danach async,
      // ein erneuter Poll-Tick währenddessen darf dieselbe Bestellung nicht nochmal aufgreifen.
      deleteSnackOrder(order.id);

      try {
        // Tisch existiert nicht mehr (z. B. Voice-Channel wurde geleert und automatisch gelöscht) -
        // dann passiert laut Vorgabe schlicht nichts.
        const channel = await client.channels.fetch(order.channelId).catch(() => null);
        if (!channel || !channel.isVoiceBased()) continue;

        const line = `*${randomDeliveryMessage(order.snackName)}*`;
        const stillAtTable = channel.members.has(order.userId);

        await channel.send(stillAtTable ? `${line} <@${order.userId}>` : line);
      } catch (err) {
        await logError(err, { context: 'Snack-Lieferung', guildId: order.guildId });
      }
    }
  }, CHECK_INTERVAL_MS);
}

module.exports = { startSnackDeliveryScheduler };
