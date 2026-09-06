const { ButtonStyle } = require('discord.js');

const TICKET_TYPES = {
  support: {
    key: 'support',
    label: 'Support',
    style: ButtonStyle.Primary,
    teamTier: 'Supporter',
    visibility: 'team',
  },
  report: {
    key: 'report',
    label: 'Nutzer melden',
    style: ButtonStyle.Danger,
    teamTier: 'Moderator',
    visibility: 'team',
  },
  application: {
    key: 'application',
    label: 'Bewerbung',
    style: ButtonStyle.Success,
    teamTier: 'Administrator',
    visibility: 'admin',
    // Bewerbungen laufen anders als Support/Beschwerde NICHT anonymisiert über zwei Channels,
    // sondern direkt in einem einzigen Channel zwischen Ersteller und Administrator-Rolle.
    singleChannel: true,
    // Erst ab einer gewissen gezeigten Aktivitaet bewerben (siehe createTicket in
    // ticketActions.js) - darunter wird gar kein Ticket eroeffnet, nur ein Hinweis.
    minXp: 10_000,
  },
};

module.exports = { TICKET_TYPES };
