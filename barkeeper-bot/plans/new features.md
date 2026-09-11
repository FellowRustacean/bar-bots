Please implement these features:

# General
- Make all `/config <...>` that configure set channels to `/config setchannel <selection> <#channel>`
- Same with `/config setcategory <selection> <#category>`

# XP-Tracking & Ranks
- Daily XP-Gain is capped at 2,500XP
- A member will get 5XP per message with a 1-minute-cooldown and 3XP per minute spent in voice channels. Voice channel XP is calculated at events such as leaving/switching a channel or at hourly statistics update
- Here is a leveling formula: 250 * 1.02^(n-1), with n being the users level. Users start at level 1, so they need 250 * 1.02^(1-1) = 250 XP to reach level 2
- Add `/config setchannel <afk> <#VoiceChannel>` to configure afk Channel. When user switches to or from afk channel, do not grant XP. Inactive users will be moved to afk channel
## Commands:
`/xp <add|remove|set> <@User> <amount>` - edits the XP amount of a user. Only available to @Administrator
`/rank <?@User>` - shows own rank of total user count of server, so n/m with n being own or selected User rank and m total amount of users
`/leaderboard <total|month>` - shows top 10 users either with total values or with XP gained this month

# User Profile
`/profile <?@User>` Shows when they joined the server, their level, current XP progression to next level with progress bar and XP, total XP. Optionally tags a user. When not, it shows own profile. Otherwise shows tagged user

# Statistics System
- Tracks on an hourly basis how many people are active in chat and in voice channels and how much time was spent in voice/how many messages were sent. Uses message events to track individual user IDs (excluding bots) and voice events and an hourly check what users are in voice channels.
    -> For doing this, when a message is sent, just increment the counter for the respective hour in the database by 1. Same with voice events. For users, store a last voice event timestamp. Check once per hour (full hour). When bot restarts, reset last voice event timestamp of all users with current time. Otherwise you'd risk that a user who left a voice channel at 2026-08-18 10:00 and bot is offline from 2026-08-20 12:00 to 12:05 and the user joins a voice channel at 2026-08-20 12:02, he'd appear to be in the voice for 2d2h2m. That's why you have to reset all on reboot
- Tracks total messages per user
- Tracks total time spent in voice channels per user
## Commands:
`/stats <users|voice|chat> <start> <?end>` - renders a chart with respective statistic. start/end are written in YYYY-MM-DD, end is optional. Only for @Administrator

# Reminder
## Commands:
`/reminder set <timer> <comment>` - `<timer>` in `_d_h_m`, comment free text. Will then tag user when timer runs out
`/reminder list` - shows all current timers with comment and when they'll run out
`/reminder remove <timer_number>` - in the `/reminder list` reminders are numbered. Using that timer_number can be used to remove the timer