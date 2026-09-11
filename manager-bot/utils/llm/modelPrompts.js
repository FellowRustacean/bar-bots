// Laedt automatisch JEDE Modell-Datei aus ./models/ (ausser shared.js) und baut daraus die
// Profil-Tabelle, ueber die chatOrchestrator.js pro Aufruf das passende Prompt-/Parser-Profil
// nachschlaegt (Schluessel = target.model, siehe /model set). Ein neues LoRA-Modell zu
// registrieren heisst: neue Datei in models/ ablegen, die { modelName, systemPrompt, format,
// buildUserPrompt, parseReply } exportiert (siehe models/qwen2.5-7b-facts_p_e3_r32_v2.js als
// Vorlage) - KEIN Eintrag hier oder in chatOrchestrator.js noetig.
//
// Modelle OHNE eigene Datei hier bekommen automatisch DEFAULT_PROFILE (siehe
// chatOrchestrator.js) - ein neues Basis-/Testmodell laesst sich also einfach per /model set
// laden, ohne dass hier etwas geaendert werden muss.

const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, 'models');

function loadModelProfiles() {
  const profiles = {};
  for (const file of fs.readdirSync(MODELS_DIR)) {
    if (file === 'shared.js' || !file.endsWith('.js')) continue;
    const mod = require(path.join(MODELS_DIR, file));
    if (!mod.modelName) {
      console.warn(`[modelPrompts] ${file} exportiert kein "modelName" - wird uebersprungen.`);
      continue;
    }
    profiles[mod.modelName] = mod;
  }
  return profiles;
}

const MODEL_PROMPT_PROFILES = loadModelProfiles();

module.exports = { MODEL_PROMPT_PROFILES };
