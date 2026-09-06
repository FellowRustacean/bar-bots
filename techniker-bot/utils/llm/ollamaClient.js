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

// Laedt ein Modell JETZT SCHON in den RAM (keep_alive: -1 = bleibt dauerhaft geladen, kein
// automatisches Entladen mehr durch Inaktivitaet) - genutzt bei /model set, damit die erste echte
// Chat-Anfrage nach einem Modellwechsel nicht den vollen Ladezeit-Malus zahlt (siehe Session-Tests:
// bis zu ~74s Kaltstart bei 7B).
async function preloadModel(name) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({ model: name, keep_alive: -1 }),
  });
  if (!res.ok) throw new Error(`Ollama /api/generate (preload): HTTP ${res.status}`);
}

module.exports = { listModels, withExclusiveOllamaAccess, unloadModel, preloadModel };
