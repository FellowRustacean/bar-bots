const createOutboxPoller = require('../../../shared/lib/outboxPoller');
const { createDmSendAction } = require('../../../shared/lib/dmSendAction');
const outboxStore = require('../../storage/outbox');
const { logError } = require('../logs/errorLog');
const { getDrinks } = require('../drinks/drinks');
const { randomOrderComingLine, sendPreparationSteps } = require('../drinks/serving');
const { enqueueOrder, pendingCount } = require('../drinks/orderQueue');
const { linkDmRelay } = require('../../storage/dmThreads');

// Manager erkennt per LLM (drinkOrderDetector.js), ob eine Chat-Nachricht an Quinn im
// Tresen-Kanal eine Bestellung ist, und legt dafuer diesen Job an (content = Getraenkename,
// title = Anzeigename der bestellenden Person) - die eigentliche Bestell-Logik (Bestaetigung +
// Zubereitungsschritte) bleibt hier beim Barkeeper, dieselbe wie bei /getränk, nur ohne
// Slash-Command-Interaction als Ausloeser.
async function handleOrderDrink(job, { channel, markOutboxJobDone }) {
  const drinkName = job.content;
  const displayName = job.title;
  const entry = getDrinks()[drinkName];
  if (!entry) {
    markOutboxJobDone(job.id, null);
    return;
  }

  // Warteschlangen-Hinweis nur anhaengen, wenn tatsaechlich eine existiert (genau wie bei
  // /getränk) - sonst wuerde suggeriert, das Getraenk muesse warten, obwohl es direkt drankommt.
  const position = pendingCount(job.channel_id);
  const comingLine = randomOrderComingLine(displayName, drinkName, entry.artikel);
  const content = position > 0 ? `${comingLine} (Du bist Nummer ${position + 1} in der Warteschlange.)` : comingLine;

  const message = await channel.send({ content });
  markOutboxJobDone(job.id, message.id);

  enqueueOrder(job.channel_id, () => sendPreparationSteps(channel, displayName, drinkName, entry));
}

module.exports = createOutboxPoller(outboxStore, logError, {
  order_drink: handleOrderDrink,
  dm_send: createDmSendAction({ linkDmRelay }),
});
