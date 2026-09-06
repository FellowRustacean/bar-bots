const { loadLineSet } = require('../../../shared/lib/messageLines');

// Globaler Vorrat des Tresens (nicht pro Channel - es gibt nur eine Bar). Bewusst In-Memory, kein
// Neustart-Überstehen nötig für diesen Ambiente-Mechanismus; startet nach jedem Neustart einfach
// wieder voll aufgefüllt.
const POOL_CONFIG = {
  zutaten: { max: 10, label: 'Zutaten' },
  flaschen: { max: 6, label: 'Flaschen' },
  kaffee: { max: 10, label: 'Kaffeemaschine' },
};

const state = {
  zutaten: POOL_CONFIG.zutaten.max,
  flaschen: POOL_CONFIG.flaschen.max,
  kaffee: POOL_CONFIG.kaffee.max,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomRestockDelay() {
  return (30 + Math.random() * 60) * 1000; // 30-90s
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// 2-5 zufällige, unterschiedliche Geräusche pro Reinigung (keine Wiederholung innerhalb einer
// Reinigung, sofern genug verschiedene vorhanden sind). Textbausteine + Sounds liegen alle in
// shared/data/messages/barkeeper.json (Keys "stockOut"/"restocked"/"coffeeCleaningStart"/
// "coffeeCleaningDone"/"coffeeCleanSounds") - wird bei jedem Aufruf frisch gelesen, eine Aenderung
// dort greift sofort ohne Neustart (siehe messageLines.js).
function randomCleaningSounds() {
  const count = 2 + Math.floor(Math.random() * 4);
  const shuffled = [...loadLineSet('barkeeper', 'coffeeCleanSounds')].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function render(template, label) {
  return `*${template.replace('{label}', label)}*`;
}

async function restockIngredientsOrBottles(channel, pool) {
  const config = POOL_CONFIG[pool];

  await channel.send(render(randomFrom(loadLineSet('barkeeper', 'stockOut')), config.label));
  await sleep(randomRestockDelay());

  state[pool] = config.max;
  await channel.send(render(randomFrom(loadLineSet('barkeeper', 'restocked')), config.label));
}

async function restockCoffeeMachine(channel) {
  await channel.send(`*${randomFrom(loadLineSet('barkeeper', 'coffeeCleaningStart'))}*`);

  const sounds = randomCleaningSounds();
  const totalDelay = randomRestockDelay();
  const perGap = totalDelay / (sounds.length + 1);

  for (const sound of sounds) {
    await sleep(perGap);
    await channel.send(sound);
  }
  await sleep(perGap);

  state.kaffee = POOL_CONFIG.kaffee.max;
  await channel.send(`*${randomFrom(loadLineSet('barkeeper', 'coffeeCleaningDone'))}*`);
}

// Stellt sicher, dass für ein Getränk aus dem angegebenen Vorrats-Pool noch etwas übrig ist -
// ist der Pool leer, wird zuerst die passende Nachschub-Sequenz abgewickelt (Lager holen bzw.
// Kaffeemaschine reinigen), bevor der Verbrauch verbucht wird. Läuft immer innerhalb der
// bestehenden Bestell-Warteschlange (siehe orderQueue.js), blockiert also ganz natürlich weitere
// Bestellungen für die Dauer des Nachschubs.
async function ensureSupply(channel, pool) {
  if (!POOL_CONFIG[pool]) return; // unbekannter/fehlender Pool - nichts zu verbrauchen

  if (state[pool] <= 0) {
    if (pool === 'kaffee') {
      await restockCoffeeMachine(channel);
    } else {
      await restockIngredientsOrBottles(channel, pool);
    }
  }

  state[pool]--;
}

module.exports = { ensureSupply };
