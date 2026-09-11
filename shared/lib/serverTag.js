// "Server-Tag" = Discords Primary-Guild-Tag-Feature (der kurze Tag neben dem Namen, z. B. "BAR").
// Pure Logik ohne DB/npm-Abhaengigkeiten, daher direkt aus shared/lib heraus nutzbar (siehe
// CLAUDE.md-Konvention: shared/lib darf keine npm-Pakete requiren) - von mehreren Bots gebraucht
// (Barkeeper fuer den XP-Bonus, Manager fuer die Anzeige in /profile).
//
// Gilt nur, wenn der Nutzer den Tag aktiv anzeigt (identityEnabled) UND er auf GENAU diese Guild
// zeigt (nicht irgendeinen anderen Server-Tag, den der Nutzer evtl. von einem anderen Server hat).
function hasServerTag(member) {
  const primaryGuild = member?.user?.primaryGuild;
  return Boolean(primaryGuild?.identityEnabled && primaryGuild.identityGuildId === member.guild?.id);
}

module.exports = { hasServerTag };
