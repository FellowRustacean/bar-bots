// Discord-User-IDs der sieben Bot-Accounts, bot-uebergreifend gemeinsam genutzt (u. a. von
// teamMeetingPoller.js in jedem der sechs "Personal"-Bots, um fuer andere teilnehmende Bots
// gezielte Connect-Overwrites zu setzen). Dieselben IDs wie in
// manager bot/utils/personas/botPersonas.js - dort zusaetzlich mit label/clientId-Objektform
// fuer /message und /forum, hier bewusst als einfaches Objekt, da andere Bots nur die ID
// brauchen und nicht extra manager bots Ordner requiren sollen (jeder Bot bleibt eigenstaendig).
module.exports = {
  barkeeper: '1540353945665536152',
  werwolf: '1540719215475171449',
  kellner: '1541047126652616774',
  tuersteher: '1541048904043331614',
  manager: '1541049685530255590',
  techniker: '1541560757399982141',
  band: '1541738400187420692',
};
