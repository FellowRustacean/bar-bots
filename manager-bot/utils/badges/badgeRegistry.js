// Katalog aller Badges, die DIESER Bot vergeben kann (wird beim Start in den gemeinsamen
// Katalog synchronisiert, siehe ensureBadgeCatalog() in storage/badges.js). Weitere Badges später
// einfach hier ergänzen - kein Schema-Update nötig.
module.exports = [
  { key: 'referral_1', label: 'Erster Kontakt', emoji: '🤝', description: '1 aktives Referral geworben' },
  { key: 'referral_3', label: 'Vernetzt', emoji: '🌐', description: '3 aktive Referrals geworben' },
  { key: 'referral_5', label: 'Stammtisch-Botschafter:in', emoji: '📣', description: '5 aktive Referrals geworben' },
  { key: 'referral_10', label: 'Türöffner:in', emoji: '🚪', description: '10 aktive Referrals geworben' },
  { key: 'referral_25', label: 'Legende der Bar', emoji: '👑', description: '25 aktive Referrals geworben' },
];
