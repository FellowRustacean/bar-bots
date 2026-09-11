// Techniker laeuft auf demselben Pi wie Ollama - localhost statt LAN-IP, funktioniert unabhaengig
// von der Netzwerkkonfiguration und muss Ollama nicht im LAN exponieren.
const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

// Der Pi hat nur begrenzt RAM/CPU fuer Ollama - ein Pull (Netzwerk/Disk) oder eine zukuenftige
// Generierung (CPU-Inferenz) sollen sich nicht ueberlappen, sonst "flutet" das den Pi. Statt einer
// Warteschlange wird eine zweite Anfrage sofort mit einer klaren Fehlermeldung abgelehnt - einfacher
// nachzuvollziehen als ein still wartender Request ohne Rueckmeldung.
let busyWith = null;

async function withExclusiveOllamaAccess(label, fn) {
  if (busyWith) {
    throw new Error(`Ollama ist gerade mit "${busyWith}" beschaeftigt - bitte kurz warten und erneut versuchen.`);
  }
  busyWith = label;
  try {
    return await fn();
  } finally {
    busyWith = null;
  }
}

async function listModels() {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
  if (!res.ok) throw new Error(`Ollama /api/tags: HTTP ${res.status}`);
  const data = await res.json();
  return data.models ?? [];
}

// Erzwingt sofortiges Entladen eines Modells aus dem RAM (keep_alive: 0) - genutzt bei /model set,
// damit beim Modellwechsel nie zwei Modelle gleichzeitig geladen sind (der Pi hat dafuer nicht
// genug RAM, siehe Session-Tests: ein zweites Modell laden, waehrend eins schon resident ist,
// liess das Laden selbst um Minuten haengen statt sauber zu scheitern). Kein Prompt noetig - ein
// /api/generate-Call ohne "prompt" laedt/entlaedt nur, generiert nichts.
async function unloadModel(name) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({ model: name, keep_alive: 0 }),
  });
  if (!res.ok) throw new Error(`Ollama /api/generate (unload): HTTP ${res.status}`);
}

// Manager-bot definiert die System-Prompts (Ollama-Modellname -> Prompt/Parser-Profil, siehe
// manager-bot/utils/llm/modelPrompts.js) - hier direkt cross-Prozess importiert (selbes
// Filesystem auf dem Pi), damit preloadModel() unten denselben System-Prompt kennt, den die
// erste echte Chat-Anfrage nachher verwendet. Kein eigenes Profil (z.B. Basismodell ohne LoRA)
// oder manager-bot-Pfad nicht erreichbar -> null, preloadModel faellt dann auf reines
// Gewichte-Laden zurueck (bisheriges Verhalten).
function getSystemPromptFor(name) {
  try {
    const { MODEL_PROMPT_PROFILES } = require('/home/pi/bots/manager-bot/utils/llm/modelPrompts.js');
    return MODEL_PROMPT_PROFILES[name]?.systemPrompt ?? null;
  } catch {
    return null;
  }
}

// Laedt ein Modell JETZT SCHON in den RAM (keep_alive: -1 = bleibt dauerhaft geladen, kein
// automatisches Entladen mehr durch Inaktivitaet) UND prefillt im SELBEN Call gleich den echten
// System-Prompt mit (falls das Modell eins hat, siehe getSystemPromptFor) - genutzt bei
// /model set, damit die erste echte Chat-Anfrage nach einem Modellwechsel weder den vollen
// Ladezeit-Malus (siehe Session-Tests: bis zu ~74s Kaltstart bei 7B) NOCH das System-Prompt-
// Prefill zahlt (das bisher erst bei der ersten echten Anfrage passierte, siehe Session-
// Debugging 02.09. - "erste Anfrage nach /model set dauert trotzdem lange"). num_predict:1
// haelt die Generierung minimal, es geht nur um das Prefill, nicht um eine echte Antwort.
async function preloadModel(name) {
  const system = getSystemPromptFor(name);
  const body = { model: name, keep_alive: -1 };
  if (system) {
    body.system = system;
    body.prompt = ' ';
    body.options = { num_predict: 1 };
  }
  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama /api/generate (preload): HTTP ${res.status}`);
}

module.exports = { listModels, withExclusiveOllamaAccess, unloadModel, preloadModel };
