const { BOT_PERSONAS } = require('../personas/botPersonas');

// key = bot_name (fuer die Outbox-Adressierung, siehe botPersonas.js), displayName = wie der
// Charakter im Chat angesprochen wird und in "Name: Text"-Zeilen erscheint, role = Rolle inkl.
// korrektem Geschlecht (z.B. "Barkeeperin" fuer Quinn, "Kellner" fuer Benedict - siehe
// character.md). KEINE feste Persoenlichkeits-Beschreibung mehr hier - die kommt ausschliesslich
// live aus /model context bei Techniker (siehe chatOrchestrator.js: personaList wird bei jeder
// Anfrage neu aus llm_persona_context gelesen, nicht gecacht).
const LLM_PERSONAS = {
  manager: { displayName: 'Mary', role: 'Managerin' },
  barkeeper: { displayName: 'Quinn', role: 'Barkeeperin' },
  kellner: { displayName: 'Benedict', role: 'Kellner' },
  tuersteher: { displayName: 'Colt', role: 'Türsteher' },
  techniker: { displayName: 'Tony', role: 'Techniker' },
  werwolf: { displayName: 'Jacob', role: 'Werwolf-Erzähler' },
};

// clientId aus BOT_PERSONAS reinmischen (dort ist sie schon gepflegt, hier nicht duplizieren).
for (const [key, persona] of Object.entries(LLM_PERSONAS)) {
  persona.botName = key;
  persona.clientId = BOT_PERSONAS.find((p) => p.name === key)?.clientId ?? null;
}

function findLlmPersonaByDisplayName(displayName) {
  return Object.values(LLM_PERSONAS).find((p) => p.displayName.toLowerCase() === displayName.toLowerCase());
}

module.exports = { LLM_PERSONAS, findLlmPersonaByDisplayName };
