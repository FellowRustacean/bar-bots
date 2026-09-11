const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getReferralLink, createReferralLink, getReferralStats } = require('../../storage/referrals');
const { getEntryMessage } = require('../../storage/entrySettings');
const { logError } = require('../../utils/logs/errorLog');

// Bewusst KEIN setDefaultMemberPermissions - dieser Befehl steht allen Nutzern offen.
const data = new SlashCommandBuilder()
  .setName('referral')
  .setDescription('Zeigt deinen persönlichen Einladungslink und deine Referral-Statistik');

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  let link = getReferralLink(guildId, userId);

  if (!link) {
    // Der Link setzt am Eingangs-Channel an (siehe entryGate.js) - dort landen neue Mitglieder
    // ohnehin über den "Die Bar betreten"-Button.
    const entryChannelId = getEntryMessage(guildId)?.channelId ?? null;
    const channel = entryChannelId
      ? await interaction.guild.channels.fetch(entryChannelId).catch(() => null)
      : null;

    if (!channel) {
      await interaction.editReply(
        '❌ Für diesen Server ist noch kein Eingangs-Channel eingerichtet - dort würde dein Link ansetzen. Bitte einen Admin, das per `/config` nachzuholen.'
      );
      return;
    }

    try {
      const invite = await channel.createInvite({
        maxAge: 0,
        maxUses: 0,
        unique: true,
        reason: `Referral-Link für ${interaction.user.tag}`,
      });
      createReferralLink(guildId, userId, invite.code);
      link = { inviteCode: invite.code };
    } catch (err) {
      await logError(err, {
        context: 'Referral: Link erstellen (fehlt dem Bot "Einladung erstellen"?)',
        guildId,
      });
      await interaction.editReply('❌ Konnte keinen Link erstellen - siehe Error-Log für Details.');
      return;
    }
  }

  const stats = getReferralStats(guildId, userId);

  await interaction.editReply(
    `🔗 Dein Referral-Link: https://discord.gg/${link.inviteCode}\n` +
      `👥 ${stats.joined} gejoint\n` +
      `✅ ${stats.active}/${stats.joined} aktiv`
  );
}

module.exports = { data, execute };
