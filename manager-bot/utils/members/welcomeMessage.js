const { getLogChannel } = require('../../storage/guildConfig');
const { getMemberRoleId } = require('../../storage/roleSettings');
const { enqueueOutboxMessage } = require('../../storage/outbox');
const { BOT_PERSONAS } = require('../personas/botPersonas');

// Jeder Charakter ausser Band (kein eigener Name/keine eigene Stimme fuers Willkommen-Sagen, siehe
// /dm, das Band aus demselben Grund ausschliesst).
function randomWelcomePersona() {
  const candidates = BOT_PERSONAS.filter((p) => p.name !== 'band');
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Feuert NICHT beim rohen Server-Beitritt, sondern erst, wenn ein Mitglied die "Gast"-Rolle bekommt
// (member_role_id, siehe /config setrole selection:member) - in der Praxis meist durch Klick auf
// den "Bar betreten"-Button (siehe entryGate.js). Passt so inhaltlich besser: die Begruessung feiert
// den tatsaechlichen Eintritt in die Bar, nicht nur den rohen Discord-Beitritt. Kanal frei per
// /config setchannel selection:welcome konfigurierbar, laeuft ohne gesetzten Kanal einfach ins Leere.
async function handleMemberRoleChange(oldMember, newMember) {
  if (newMember.user.bot) return;

  const memberRoleId = getMemberRoleId(newMember.guild.id);
  if (!memberRoleId) return;
  if (oldMember.roles.cache.has(memberRoleId) || !newMember.roles.cache.has(memberRoleId)) return;

  const channelId = getLogChannel(newMember.guild.id, 'welcome');
  if (!channelId) return;

  const persona = randomWelcomePersona();
  enqueueOutboxMessage({
    botName: persona.name,
    action: 'send',
    guildId: newMember.guild.id,
    channelId,
    content: `👋 Willkommen in der Bar, ${newMember}!`,
  });
}

module.exports = { handleMemberRoleChange };
