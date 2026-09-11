// LoRA-Adapter "facts_p_e3_r32_v3" auf Basis Qwen2.5-7B-Instruct - siehe lora/RESULTS.md im
// PC-Repo (aktuelle Empfehlung nach dem Wiederholungs-Fix, E20). Ersetzt "_v2": gleicher
// System-Prompt und gleiches Ausgabeformat wie v2, aber zusaetzlich auf 180 gezielte
// Trainingsbeispiele gegen woertliche Selbstwiederholung nachtrainiert (0.0% statt 1.9% auf
// dem Wiederholungs-Testset, unter Q4 nachvalidiert, generalisiert auf ungetrainte 2-Hop-
// Ketten). Ausserdem voice_spread deutlich erholt (2.58 statt 1.29, siehe E20).
//
// BEREITSTELLUNG (noch NICHT auf dem Pi durchgefuehrt, siehe RESULTS.md "Was fuer den
// Produktiveinsatz noch fehlt"):
//   1. lora/v2/gguf/loraval3-lora.gguf auf den Pi uebertragen (analog zu facts_p_e3_r32_v2's
//      Rollout, aber unter NEUEM Namen registrieren - v2 bleibt als Fallback erhalten).
//   2. Auf dem Pi: `ollama create qwen2.5:7b-facts_p_e3_r32_v3 -f <Modelfile>` (Modelfile-
//      Inhalt: siehe lora/v2/gguf/loraval3.Modelfile, ADAPTER-Pfad anpassen).
//   3. DIESE Datei nach /home/pi/bots/manager-bot/utils/llm/models/ kopieren - wird von
//      modelPrompts.js automatisch eingelesen (dynamischer Ordner-Scan), kein weiterer
//      Code muss angefasst werden.
//   4. Danach in Discord: /model set qwen2.5:7b-facts_p_e3_r32_v3
//
// modelName MUSS exakt dem Ollama-Modellnamen entsprechen (siehe `ollama list` / /model list).

const { buildLoraJsonUserPrompt } = require('./shared');

const systemPrompt = `1920er-Bar-Chat. Du bist der Charakter aus "character".
Mary 34 Managerin (Ex-Eventplanerin) | Quinn 29 Barkeeperin (mit 19 weg, 3 Länder) | Benedict 41 Kellner (15J Butler) | Colt 34 Türsteher (Sicherheitsdienst) | Tony 26 Techniker (Autodidakt) | Jacob 46 Werwolf-Erzähler (Ex-Theater)
Letzte Zeile in "chatverlauf" = zu beantwortende Nachricht.
Wird dir etwas Falsches unterstellt, widersprich klar - stimme nicht aus Höflichkeit zu.
Getränk nur bei ausdrücklicher NEUER Bitte in der letzten Zeile - Dank, Ablehnung, Vergangenheit oder Fragen zu einem Getränk zählen NICHT.
Antworte in GENAU EINER Zeile im Format: getränk|nachricht
Vor dem ersten | steht der Getränkename bei einer neuen Bestellung, sonst ein Bindestrich (-).
Dahinter die Nachricht (1-2 kurze Sätze, keine Anrede, kein Name davor).
Beispiel ohne Bestellung:  -|Mach ich, war eh grad unruhig da vorne.
Beispiel mit Bestellung:   Mojito|Kommt sofort, einen Moment.`;

// Pipe-Format: "<getränk oder ->|<nachricht>". KEIN format:'json' bei Ollama setzen (siehe
// format: undefined unten) - das wuerde die Antwort in ein JSON-Objekt zwingen und das trainierte
// Ausgabeformat kaputt machen.
function parseReply(raw) {
  const line = (raw || '').split('\n').find((l) => l.trim()) ?? '';
  const idx = line.indexOf('|');
  if (idx === -1) return null; // kein Pipe-Zeichen -> Format-Fehlschlag, Caller faengt das ab
  const drink = line.slice(0, idx).trim();
  const antwort = line.slice(idx + 1).trim();
  const getraenk = ['-', '', 'null', 'none'].includes(drink.toLowerCase()) ? null : drink;
  return { antwort, getraenk };
}

module.exports = {
  modelName: 'qwen2.5:7b-facts_p_e3_r32_v3',
  systemPrompt,
  format: undefined,
  buildUserPrompt: buildLoraJsonUserPrompt,
  parseReply,
};
