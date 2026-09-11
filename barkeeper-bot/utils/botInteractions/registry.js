// Lokale Registry der Bot-Interaktionen, die DIESER Bot ausführen kann - wird beim Start
// automatisch in den gemeinsamen Katalog (bot_interactions) synchronisiert, damit auch andere
// Bots beim zufälligen Auswürfeln davon wissen (siehe shared/lib/interactionScheduler.js).
//
// Jeder Eintrag:
//   {
//     key: string,       // eindeutig über die GESAMTE Flotte, nicht nur diesen Bot
//     label: string,     // Klartext-Beschreibung für den gemeinsamen Katalog
//     weight: number,    // relative Häufigkeit beim Auswürfeln (Standard: 1)
//     canRun: async (client) => boolean,  // optional - Vorbedingung, Default: immer ausführbar
//     run: async (client) => void,        // die eigentliche Handlung
//   }

const { canRunOrderDrink, runOrderDrink } = require('./orderDrink');
const { canRunItemDrops, runItemDrops } = require('./itemDrops');

module.exports = [
  {
    key: 'barkeeper_bot_orders_drink',
    label: 'Bot bestellt ein Getränk',
    weight: 3,
    canRun: canRunOrderDrink,
    run: runOrderDrink,
  },
  {
    key: 'barkeeper_item_drops',
    label: 'Quinn lässt am Tresen etwas fallen',
    weight: 4,
    canRun: canRunItemDrops,
    run: runItemDrops,
  },
];
