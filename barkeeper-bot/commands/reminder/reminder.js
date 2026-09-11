const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { parseDuration } = require('../../utils/duration');
const { addReminder, listReminders, removeReminderAt } = require('../../storage/reminders');

const data = new SlashCommandBuilder()
  .setName('reminder')
  .setDescription('Verwalte deine Erinnerungen')
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('Setzt eine neue Erinnerung')
      .addStringOption((opt) =>
        opt.setName('timer').setDescription('Dauer, z. B. 1d12h30m').setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName('comment').setDescription('Woran soll erinnert werden?').setRequired(true)
      )
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('Zeigt alle deine aktiven Erinnerungen'))
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Entfernt eine Erinnerung')
      .addIntegerOption((opt) =>
        opt
          .setName('timer_number')
          .setDescription('Nummer aus /reminder list')
          .setRequired(true)
          .setMinValue(1)
      )
  );

async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'set') {
    const timerStr = interaction.options.getString('timer', true);
    const comment = interaction.options.getString('comment', true);
    const durationMs = parseDuration(timerStr);

    if (!durationMs) {
      await interaction.reply({
        content: 'Ungültiger Zeitraum. Format: `_d_h_m`, z. B. `1d12h30m`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const remindAt = Date.now() + durationMs;
    addReminder({
      userId: interaction.user.id,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      comment,
      remindAt,
    });

    const timestamp = Math.floor(remindAt / 1000);
    await interaction.reply({
      content: `⏰ Erinnerung gesetzt für <t:${timestamp}:f> (<t:${timestamp}:R>): ${comment}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'list') {
    const reminders = listReminders(interaction.user.id);

    if (reminders.length === 0) {
      await interaction.reply({ content: 'Du hast keine aktiven Erinnerungen.', flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = reminders.map((r, i) => {
      const timestamp = Math.floor(r.remind_at / 1000);
      return `**${i + 1}.** <t:${timestamp}:f> (<t:${timestamp}:R>) - ${r.comment}`;
    });

    await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === 'remove') {
    const index = interaction.options.getInteger('timer_number', true);
    const removed = removeReminderAt(interaction.user.id, index);

    if (!removed) {
      await interaction.reply({ content: 'Diese Erinnerung wurde nicht gefunden.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({
      content: `Erinnerung **${index}** wurde entfernt: ${removed.comment}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { data, execute };
