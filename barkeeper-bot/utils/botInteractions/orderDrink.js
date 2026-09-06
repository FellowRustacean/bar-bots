const { getBartresenChannelId } = require('../../storage/barSettings');
const { getDrinks } = require('../drinks/drinks');
const { indefiniteArticleFor, randomOrderComingLine, sendPreparationSteps } = require('../drinks/serving');
const { enqueueOrder } = require('../drinks/orderQueue');
const outboxStore = require('../../storage/outbox');
const { pickRandomLine } = require('../../../shared/lib/messageLines');

const BARKEEPER_USER_ID = '1540353945665536152';

// Jeweils 4 Lieblingsgetränke pro Bot, mit eigenem Charakter, aber immer mindestens ein
// bodenständiges Wasser/Schorle-Getränk dabei.
const ORDERERS = [
  {
    botName: 'kellner',
    userId: '1541047126652616774',
    favoriteDrinks: ['Wasser mit Kohlensäure', 'Apfelschorle', 'Bier', 'Cola'],
  },
  {
    botName: 'tuersteher',
    userId: '1541048904043331614',
    favoriteDrinks: ['Wasser', 'Schwäbische Schorle', 'Whiskey Sour', 'Cola'],
  },
  {
    botName: 'manager',
    userId: '1541049685530255590',
    favoriteDrinks: ['Wasser mit Kohlensäure', 'Espresso', 'Gin Tonic', 'Sekt'],
  },
  {
    botName: 'techniker',
    userId: '1541560757399982141',
    favoriteDrinks: ['Kaffee', 'Energy Drink', 'Cola', 'Wasser mit Kohlensäure'],
  },
];

// Textbausteine liegen in shared/data/messages/barkeeper.json (Key "orderDrinkRequest") - wird
// bei jedem Aufruf frisch gelesen, eine Aenderung dort greift sofort ohne Neustart (siehe
// messageLines.js).

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canRunOrderDrink(client) {
  for (const guild of client.guilds.cache.values()) {
    if (getBartresenChannelId(guild.id)) return true;
  }
  return false;
}

// Lässt einen zufälligen Bot (Kellner/Türsteher/Manager/Techniker) am Tresen nach einem seiner
// Lieblingsgetränke fragen, dann bedient Barkeeper ihn ganz normal über /getränk-Logik.
async function runOrderDrink(client) {
  const drinks = getDrinks();

  for (const guild of client.guilds.cache.values()) {
    const bartresenChannelId = getBartresenChannelId(guild.id);
    if (!bartresenChannelId) continue;

    const channel = await guild.channels.fetch(bartresenChannelId).catch(() => null);
    if (!channel) continue;

    const orderer = randomFrom(ORDERERS);
    const drinkName = randomFrom(orderer.favoriteDrinks);
    const entry = drinks[drinkName];
    if (!entry) continue; // Getränk fehlt aus irgendeinem Grund (mehr) in drinks.json

    const line = pickRandomLine('barkeeper', 'orderDrinkRequest')
      .replace('{barkeeper}', `<@${BARKEEPER_USER_ID}>`)
      .replace('{artikel}', indefiniteArticleFor(entry.artikel))
      .replace('{drink}', drinkName);

    // Die Bestell-Nachricht muss vom bestellenden Bot selbst kommen - dafür die bereits
    // bestehende Outbox nutzen (kein eigener Mechanismus nötig).
    outboxStore.enqueueOutboxMessage({
      botName: orderer.botName,
      action: 'send',
      guildId: guild.id,
      channelId: bartresenChannelId,
      content: line,
    });

    // Kurze Pause, damit die Bestellung sichtbar vor der Bedienung erscheint (der Outbox-Poller
    // des bestellenden Bots braucht bis zu 1s, um sie tatsächlich abzuschicken).
    await sleep(2000 + Math.floor(Math.random() * 2000));

    // Anzeigename statt Mention - der bestellende Bot wird namentlich erwähnt, aber nicht angepingt.
    const ordererMember = await guild.members.fetch(orderer.userId).catch(() => null);
    const ordererDisplayName = ordererMember?.displayName ?? orderer.botName;

    // Die komplette Bedienung (Bestätigung + Zubereitung) läuft als EIN Block über dieselbe
    // Warteschlange wie /getränk - sonst könnte die Bestätigungs-Nachricht mitten in eine gerade
    // laufende, echte Nutzer-Bestellung hineinplatzen.
    await new Promise((resolve) => {
      enqueueOrder(bartresenChannelId, async () => {
        await channel.send({ content: randomOrderComingLine(ordererDisplayName, drinkName, entry.artikel) });
        await sendPreparationSteps(channel, ordererDisplayName, drinkName, entry);
        resolve();
      });
    });

    return; // Ein Durchlauf pro Aufruf reicht - dieses Setup hat ohnehin nur einen Server.
  }
}

module.exports = { canRunOrderDrink, runOrderDrink };
