const MIN_PLAYERS = 5;
const MAX_PLAYERS = 15;

// Spieler -> { dorf, werewolves, solo } laut Rollenverteilungs-Tabelle.
const ROLE_TABLE = {
  5: { dorf: 4, werewolves: 1, solo: 0 },
  6: { dorf: 5, werewolves: 1, solo: 0 },
  7: { dorf: 5, werewolves: 2, solo: 0 },
  8: { dorf: 5, werewolves: 2, solo: 1 },
  9: { dorf: 6, werewolves: 2, solo: 1 },
  10: { dorf: 7, werewolves: 2, solo: 1 },
  11: { dorf: 7, werewolves: 3, solo: 1 },
  12: { dorf: 8, werewolves: 3, solo: 1 },
  13: { dorf: 8, werewolves: 3, solo: 2 },
  14: { dorf: 9, werewolves: 3, solo: 2 },
  15: { dorf: 9, werewolves: 4, solo: 2 },
};

const DORF_SPECIAL_ROLES = [
  { name: 'Doktor', max: 1 },
  { name: 'Jäger', max: 2 },
  { name: 'Priester', max: 1 },
  { name: 'Seher', max: 1 },
  { name: 'Hexe', max: 1 },
  { name: 'Amor', max: 1 },
  { name: 'Schütze', max: 1 },
  { name: 'Aura-Seher', max: 1 },
];

// Ersetzt bei ausreichender Spielerzahl einen der Werwolf-Slots.
const WEREWOLF_SPECIAL_ROLES = [{ name: 'Werwolf Schamane', max: 1, min: 10 }];

const SOLO_ROLES = [
  { name: 'Narr', max: 1, min: 8 },
  { name: 'Kopfgeldjäger', max: 1, min: 10 },
  { name: 'Brandstifter', max: 1, min: 12 },
];

const ROLE_TEAMS = {
  Dorfbewohner: 'dorf',
  Doktor: 'dorf',
  Jäger: 'dorf',
  Priester: 'dorf',
  Seher: 'dorf',
  Hexe: 'dorf',
  Amor: 'dorf',
  Schütze: 'dorf',
  'Aura-Seher': 'dorf',
  Werwolf: 'werewolves',
  'Werwolf Schamane': 'werewolves',
  Narr: 'solo',
  Kopfgeldjäger: 'solo',
  Brandstifter: 'solo',
};

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Füllt `count` Slots mit zufälligen, eindeutigen Sonderrollen (bis max je Rolle, sofern
// playerCount >= min). Übrige Slots werden - falls angegeben - mit fillerRole aufgefüllt.
function fillSlots(count, specialRoles, playerCount, fillerRole) {
  const eligible = specialRoles.filter((r) => !r.min || playerCount >= r.min);
  const pool = [];
  for (const role of eligible) {
    for (let i = 0; i < role.max; i++) pool.push(role.name);
  }

  const picked = shuffle(pool).slice(0, count);
  while (picked.length < count && fillerRole) {
    picked.push(fillerRole);
  }

  return picked;
}

function buildRoleList(playerCount) {
  const distribution = ROLE_TABLE[playerCount];
  if (!distribution) {
    throw new Error(`Keine Rollenverteilung für ${playerCount} Spieler definiert.`);
  }

  const dorfRoles = [
    'Dorfbewohner',
    'Dorfbewohner',
    'Dorfbewohner',
    ...fillSlots(distribution.dorf - 3, DORF_SPECIAL_ROLES, playerCount),
  ];

  const werewolfRoles = fillSlots(distribution.werewolves, WEREWOLF_SPECIAL_ROLES, playerCount, 'Werwolf');
  const soloRoles = fillSlots(distribution.solo, SOLO_ROLES, playerCount);

  return { dorfRoles, werewolfRoles, soloRoles };
}

// Weist den übergebenen Spielern (Array von User-IDs) zufällig Rollen zu.
// Gibt eine Map userId -> roleName zurück.
function assignRoles(playerIds) {
  const { dorfRoles, werewolfRoles, soloRoles } = buildRoleList(playerIds.length);
  const allRoles = shuffle([...dorfRoles, ...werewolfRoles, ...soloRoles]);
  const shuffledPlayers = shuffle(playerIds);

  const assignments = new Map();
  shuffledPlayers.forEach((userId, i) => assignments.set(userId, allRoles[i]));
  return assignments;
}

function getTeam(roleName) {
  return ROLE_TEAMS[roleName] ?? 'unknown';
}

module.exports = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  ROLE_TABLE,
  ROLE_TEAMS,
  buildRoleList,
  assignRoles,
  getTeam,
};
