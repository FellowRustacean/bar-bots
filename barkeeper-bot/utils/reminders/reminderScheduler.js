const { getDueReminders, deleteReminder } = require('../../storage/reminders');
const { logError } = require('../logs/errorLog');

const CHECK_INTERVAL_MS = 30 * 1000;

function startReminderScheduler(client) {
  setInterval(async () => {
    const due = getDueReminders(Date.now());

    for (const reminder of due) {
      deleteReminder(reminder.id);

      try {
        const channel = await client.channels.fetch(reminder.channel_id);
        if (channel?.isTextBased()) {
          await channel.send(`⏰ <@${reminder.user_id}> Erinnerung: ${reminder.comment}`);
        }
      } catch (err) {
        await logError(err, { context: 'Erinnerung senden', guildId: reminder.guild_id });
      }
    }
  }, CHECK_INTERVAL_MS);
}

module.exports = { startReminderScheduler };
