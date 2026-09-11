// Fabrikfunktion statt fixem require('./db') - siehe botInteractions.js für die Begründung.
function createTeamMeetingStore(db) {
  const createMeetingStmt = db.prepare(`
    INSERT INTO team_meetings (guild_id, trigger_channel_id, created_at) VALUES (?, ?, ?)
  `);
  const setMeetingChannelStmt = db.prepare('UPDATE team_meetings SET channel_id = ? WHERE id = ?');
  const getMeetingStmt = db.prepare('SELECT id, guild_id AS guildId, trigger_channel_id AS triggerChannelId, channel_id AS channelId FROM team_meetings WHERE id = ?');

  const addParticipantStmt = db.prepare(`
    INSERT INTO team_meeting_participants (meeting_id, bot_name, role, join_at, leave_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const markJoinedStmt = db.prepare('UPDATE team_meeting_participants SET joined = 1 WHERE id = ?');
  const markLeftStmt = db.prepare('UPDATE team_meeting_participants SET left = 1 WHERE id = ?');

  // Leader-Eintraege sind sofort faellig, sobald join_at erreicht ist. Follower-Eintraege
  // zusaetzlich erst, wenn der Leader den echten Tisch-Channel bereits eingetragen hat (siehe
  // channel_id IS NOT NULL) - vorher gibt es fuer sie noch nichts zu betreten.
  const getDueJoinsStmt = db.prepare(`
    SELECT
      p.id AS participantId, p.meeting_id AS meetingId, p.bot_name AS botName, p.role,
      m.guild_id AS guildId, m.trigger_channel_id AS triggerChannelId, m.channel_id AS channelId
    FROM team_meeting_participants p
    JOIN team_meetings m ON m.id = p.meeting_id
    WHERE p.bot_name = ? AND p.joined = 0 AND p.join_at <= ?
      AND (p.role = 'leader' OR m.channel_id IS NOT NULL)
  `);

  const getDueLeavesStmt = db.prepare(`
    SELECT
      p.id AS participantId, p.meeting_id AS meetingId, p.bot_name AS botName, p.role,
      m.guild_id AS guildId, m.channel_id AS channelId
    FROM team_meeting_participants p
    JOIN team_meetings m ON m.id = p.meeting_id
    WHERE p.bot_name = ? AND p.joined = 1 AND p.left = 0 AND p.leave_at <= ?
  `);

  const getFollowerNamesStmt = db.prepare(`
    SELECT bot_name AS botName FROM team_meeting_participants WHERE meeting_id = ? AND role = 'follower'
  `);

  // Fuer /interaction start/stop: alle noch nicht abgeschlossenen Teilnehmer (left = 0) einer
  // Guild, unabhaengig davon, ob sie schon beigetreten sind oder noch warten.
  const getActiveParticipantsStmt = db.prepare(`
    SELECT p.id AS participantId, p.bot_name AS botName, p.role, p.joined, p.left
    FROM team_meeting_participants p
    JOIN team_meetings m ON m.id = p.meeting_id
    WHERE m.guild_id = ? AND p.left = 0
  `);
  // Fuer einen noch nicht beigetretenen Teilnehmer bei /interaction stop: verhindert den
  // geplanten Beitritt komplett, statt ihn erst beitreten und gleich wieder verlassen zu lassen.
  const cancelParticipantStmt = db.prepare('UPDATE team_meeting_participants SET joined = 1, left = 1 WHERE id = ?');
  // Fuer einen bereits beigetretenen Teilnehmer bei /interaction stop: setzt leave_at auf jetzt,
  // der eigene Poller des jeweiligen Bots verlaesst ihn dann innerhalb des naechsten Takts.
  const forceLeaveNowStmt = db.prepare('UPDATE team_meeting_participants SET leave_at = ? WHERE id = ?');

  function createMeeting(guildId, triggerChannelId, createdAt = Date.now()) {
    const result = createMeetingStmt.run(guildId, triggerChannelId, createdAt);
    return result.lastInsertRowid;
  }

  function addParticipant(meetingId, botName, role, joinAt, leaveAt) {
    addParticipantStmt.run(meetingId, botName, role, joinAt, leaveAt);
  }

  function setMeetingChannel(meetingId, channelId) {
    setMeetingChannelStmt.run(channelId, meetingId);
  }

  function getMeeting(meetingId) {
    return getMeetingStmt.get(meetingId) ?? null;
  }

  function getFollowerNames(meetingId) {
    return getFollowerNamesStmt.all(meetingId).map((row) => row.botName);
  }

  function getDueJoins(botName, now = Date.now()) {
    return getDueJoinsStmt.all(botName, now);
  }

  function getDueLeaves(botName, now = Date.now()) {
    return getDueLeavesStmt.all(botName, now);
  }

  function markJoined(participantId) {
    markJoinedStmt.run(participantId);
  }

  function markLeft(participantId) {
    markLeftStmt.run(participantId);
  }

  function getActiveParticipants(guildId) {
    return getActiveParticipantsStmt.all(guildId);
  }

  function cancelParticipant(participantId) {
    cancelParticipantStmt.run(participantId);
  }

  function forceLeaveNow(participantId, now = Date.now()) {
    forceLeaveNowStmt.run(now, participantId);
  }

  return {
    createMeeting,
    addParticipant,
    setMeetingChannel,
    getMeeting,
    getFollowerNames,
    getDueJoins,
    getDueLeaves,
    markJoined,
    markLeft,
    getActiveParticipants,
    cancelParticipant,
    forceLeaveNow,
  };
}

module.exports = createTeamMeetingStore;
