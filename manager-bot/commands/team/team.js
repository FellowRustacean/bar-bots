const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildBindings, setBinding } = require('../../storage/teamRoles');

const TIERS = ['Supporter', 'Moderator', 'Administrator'];

const data = new SlashCommandBuilder()
  .setName('team')
  .setDescription('Team-Rollen verwalten')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName('manage')
      .setDescription('Verknüpft eine Team-Stufe mit einer Server-Rolle')
      .addStringOption((opt) =>
        opt
          .setName('tier')
          .setDescription('Team-Stufe')
          .setRequired(true)
          .addChoices(...TIERS.map((t) => ({ name: t, value: t })))
      )
      .addRoleOption((opt) =>
        opt.setName('role').setDescription('Rolle, die mit dieser Stufe verknüpft wird').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Fügt einer Team-Stufe einen Nutzer hinzu')
      .addStringOption((opt) =>
        opt
          .setName('tier')
          .setDescription('Team-Stufe')
          .setRequired(true)
          .addChoices(...TIERS.map((t) => ({ name: t, value: t })))
      )
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Hinzuzufügender Nutzer').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Entfernt einen Nutzer aus seiner Team-Stufe')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Zu entfernender Nutzer').setRequired(true)
      )
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('Listet alle Team-Mitglieder nach Stufe auf'));

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const bindings = getGuildBindings(interaction.guildId);

  if (subcommand === 'manage') {
    const tier = interaction.options.getString('tier', true);
    const role = interaction.options.getRole('role', true);

    setBinding(interaction.guildId, tier, role.id);
    await interaction.reply({
      content: `**${tier}** wurde mit ${role} verknüpft.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'add') {
    const tier = interaction.options.getString('tier', true);
    const user = interaction.options.getUser('user', true);
    const roleId = bindings[tier];

    if (!roleId) {
      await interaction.reply({
        content: `**${tier}** ist noch mit keiner Rolle verknüpft. Nutze zuerst \`/team manage ${tier} <Rolle>\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const member = await interaction.guild.members.fetch(user.id);
      const otherRoleIds = Object.values(bindings).filter((id) => id !== roleId && member.roles.cache.has(id));

      if (otherRoleIds.length > 0) {
        await member.roles.remove(otherRoleIds);
      }
      await member.roles.add(roleId);
      await interaction.reply({
        content: `${user} wurde zu **${tier}** hinzugefügt.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await interaction.reply({
        content: `Die Rolle konnte ${user} nicht zugewiesen werden. Stelle sicher, dass der Bot die Berechtigung **Rollen verwalten** hat und seine Rolle über der Rolle **${tier}** steht.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (subcommand === 'remove') {
    const user = interaction.options.getUser('user', true);
    const boundRoleIds = Object.values(bindings);

    if (boundRoleIds.length === 0) {
      await interaction.reply({
        content: 'Es sind noch keine Team-Stufen mit Rollen verknüpft.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const member = await interaction.guild.members.fetch(user.id);
      const rolesToRemove = boundRoleIds.filter((id) => member.roles.cache.has(id));

      if (rolesToRemove.length === 0) {
        await interaction.reply({
          content: `${user} hat keine Team-Rolle.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await member.roles.remove(rolesToRemove);
      await interaction.reply({
        content: `Die Team-Rolle(n) wurden von ${user} entfernt.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      await interaction.reply({
        content: `Die Team-Rolle konnte nicht von ${user} entfernt werden. Stelle sicher, dass der Bot die Berechtigung **Rollen verwalten** hat und seine Rolle über der Team-Rolle steht.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (subcommand === 'list') {
    const entries = Object.entries(bindings);

    if (entries.length === 0) {
      await interaction.reply({
        content: 'Es sind noch keine Team-Stufen mit Rollen verknüpft.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.guild.members.fetch();

    const lines = [...TIERS].reverse().map((tier) => {
      const roleId = bindings[tier];
      if (!roleId) return `**${tier}:** _keine Rolle verknüpft_`;

      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) return `**${tier}:** _verknüpfte Rolle wurde gelöscht_`;

      const memberList = role.members.size > 0 ? [...role.members.values()].map((m) => `${m}`).join(', ') : '_Niemand_';
      return `**${tier}** (${role}, ${role.members.size})\n${memberList}`;
    });

    await interaction.reply({
      content: `### Team-Mitglieder\n\n${lines.join('\n\n')}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { data, execute };
