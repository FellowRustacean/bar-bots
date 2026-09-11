// LoRA-Adapter "facts_p_e3_r32_v1_3" auf Basis Qwen2.5-7B-Instruct - siehe lora/RESULTS.md im
// PC-Repo (E21/E22). Baut auf "_v3" auf: gleicher Bleed- und Wiederholungs-Fix, zusaetzlich
// auf Mehrfachadressierung trainiert (mehrere Charaktere in EINEM Aufruf, nur die tatsaechlich
// ANGESPROCHENEN antworten - nicht jeder im Verlauf genannte Name, siehe E21). System-Prompt
// zusaetzlich um benannte Hintergrunddetails je Charakter vertieft (E22) - reine Prompt-
// Aenderung, KEIN neues Training (Adapter unveraendert ggue. dem reinen E21-Stand).
//
// Ausgabeformat bei MEHREREN Antworten: `getränk|Charakter: Nachricht;;Charakter: Nachricht`
// (";;" trennt mehrere Antworten, Reihenfolge = Antwortreihenfolge). Bei genau einer Antwort
// weiterhin `getränk|nachricht` wie zuvor.
//
// WICHTIG fuer eine echte Mehrfachadressierungs-Integration: chatOrchestrator.js muesste dafuer
// STRUKTURELL angepasst werden (ein Call mit "characters": [Kandidaten] statt N sequenzieller
// Calls, Antwort in mehrere Outbox-Nachrichten aufsplitten) - das ist HIER NICHT enthalten,
// diese Datei deckt nur den bestehenden Einzelantwort-Pfad ab (chatOrchestrator.js ruft nach
// wie vor pro Charakter einzeln auf, "characters" wird also nie mehr als 1 Eintrag haben, bis
// diese Integration nachgezogen wird). Bis dahin verhaelt sich dieses Modell wie v3, nur mit
// vertieftem Roster.
//
// modelName MUSS exakt dem Ollama-Modellnamen entsprechen (siehe `ollama list` / /model list).

const { buildLoraJsonUserPrompt } = require('./shared');

const systemPrompt = `1920er-Bar-Chat. Du bist der Charakter aus "character".
Mary 34 Managerin (Ex-Eventplanerin bei der Hotelkette Ashcombe & Whitfield, kündigte nach Streit mit der Chefetage) | Quinn 29 Barkeeperin (mit 19 von zuhause weg, arbeitete in Bars in Havanna, Chicago und London) | Benedict 41 Kellner (15 Jahre Butler bei Familie Ashworth auf deren Anwesen Blackthorn Hall, bis es verkauft wurde) | Colt 34 Türsteher (Sicherheitsdienst im Hafen von Liverpool, dann Türsteher der Aurora-Konzerthalle) | Tony 26 Techniker (Autodidakt aus Foren, baut seit Monaten an einem Automaten namens Cogsworth) | Jacob 46 Werwolf-Erzähler (Ex-Straßenkünstler, danach im Theaterensemble Mondschatten, bis es ihm zu eng wurde)
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
// Ausgabeformat kaputt machen. Parser bleibt bewusst auf EINE Antwort ausgelegt (siehe Hinweis
// oben) - fuer echte Mehrfachadressierung braucht es die pipe_multi-Variante (";;"-Split), noch
// nicht an chatOrchestrator.js angebunden.
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
  modelName: 'qwen2.5:7b-facts_p_e3_r32_v1.3',
  systemPrompt,
  format: undefined,
  buildUserPrompt: buildLoraJsonUserPrompt,
  parseReply,
};
