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
//
const { canRunTeamBreak, runTeamBreak } = require('./teamBreak');

module.exports = [
  {
    key: 'team_break',
    label: 'Team-Päuschen am Tisch',
    weight: 1,
    canRun: canRunTeamBreak,
    run: runTeamBreak,
  },
];
