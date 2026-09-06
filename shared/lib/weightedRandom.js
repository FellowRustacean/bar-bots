// Wählt zufällig ein Element aus einer Liste, gewichtet nach dessen `weight`-Feld (fehlt es,
// zählt 1). Höheres Gewicht = häufiger gewählt - die Gewichte müssen sich zu keiner bestimmten
// Summe addieren, nur relativ zueinander zählen (z. B. 10 vs. 3 -> 10/13 bzw. 3/13 Chance).
function pickWeighted(items) {
  const totalWeight = items.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  let roll = Math.random() * totalWeight;

  for (const item of items) {
    roll -= item.weight ?? 1;
    if (roll < 0) return item;
  }

  return items[items.length - 1]; // Rundungs-Sicherheitsnetz
}

module.exports = { pickWeighted };
