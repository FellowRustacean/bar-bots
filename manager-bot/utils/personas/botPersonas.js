// Jeder Charakter entspricht einem der sieben Bots (eigener Discord-Account, eigener Client-Prozess).
// Der Manager kennt hier nur deren User-IDs, um z. B. bei /message edit/delete den richtigen Bot
// anhand des Nachrichten-Autors zu erkennen - gesendet/bearbeitet wird immer über die
// Outbox-Warteschlange vom jeweils echten Bot-Prozess selbst (kein Token-Teilen nötig). Von
// /message UND /forum genutzt, daher hier zentral statt an zwei Stellen dupliziert.
// displayName = Charaktername (siehe character.md) - Band hat (noch) keinen eigenen Namen, bleibt
// dort null und zeigt nur die Bot-Rolle.
const BOT_PERSONAS = [
  { name: 'barkeeper', label: 'Barkeeper', displayName: 'Quinn', clientId: '1540353945665536152' },
  { name: 'werwolf', label: 'Werwolf', displayName: 'Jacob', clientId: '1540719215475171449' },
  { name: 'kellner', label: 'Kellner', displayName: 'Benedict', clientId: '1541047126652616774' },
  { name: 'tuersteher', label: 'Türsteher', displayName: 'Colt', clientId: '1541048904043331614' },
  { name: 'manager', label: 'Manager', displayName: 'Mary', clientId: '1541049685530255590' },
  { name: 'techniker', label: 'Techniker', displayName: 'Tony', clientId: '1541560757399982141' },
  { name: 'band', label: 'Band', displayName: null, clientId: '1541738400187420692' },
];

function findPersonaByAuthorId(authorId) {
  return BOT_PERSONAS.find((persona) => persona.clientId === authorId);
}

// "Name (Rolle)" wenn ein Charaktername bekannt ist, sonst nur die Rolle (aktuell nur Band) -
// alphabetisch sortiert nach dem tatsaechlich angezeigten Text. Von /message UND /forum genutzt,
// damit beide Auswahllisten identisch aussehen.
function personaChoices() {
  return BOT_PERSONAS.map((persona) => ({
    name: persona.displayName ? `${persona.displayName} (${persona.label})` : persona.label,
    value: persona.name,
  })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

module.exports = { BOT_PERSONAS, findPersonaByAuthorId, personaChoices };
