import mysql from 'mysql2/promise';

const required = ['DB_HOST', 'DB_USER', 'DB_NAME'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

export async function getBotSettings() {
  const [rows] = await pool.execute(
    'SELECT * FROM bot_settings WHERE id = 1',
  );
  return rows[0] ?? null;
}

export async function saveBotSettings(panelChannelId, reviewChannelId) {
  await pool.execute(
    `INSERT INTO bot_settings (id, panel_channel_id, review_channel_id)
     VALUES (1, ?, ?)
     ON DUPLICATE KEY UPDATE panel_channel_id = VALUES(panel_channel_id),
                             review_channel_id = VALUES(review_channel_id)`,
    [panelChannelId, reviewChannelId],
  );
}

export async function saveModeratorForum(forumChannelId) {
  await pool.execute(
    `INSERT INTO bot_settings (id, moderator_forum_channel_id)
     VALUES (1, ?)
     ON DUPLICATE KEY UPDATE moderator_forum_channel_id = VALUES(moderator_forum_channel_id)`,
    [forumChannelId],
  );
}

export async function getActiveServers() {
  const [rows] = await pool.execute(
    `SELECT DISTINCT s.id, s.name
     FROM role_servers s
     INNER JOIN available_roles r ON r.server_id = s.id AND r.active = TRUE
     WHERE s.active = TRUE
     ORDER BY s.id`,
  );
  return rows;
}

export async function getActiveRoles(serverId) {
  const [rows] = await pool.execute(
    `SELECT id, discord_role_id, label
     FROM available_roles
     WHERE server_id = ? AND active = TRUE
     ORDER BY id`,
    [serverId],
  );
  return rows;
}

export async function addServer(name) {
  const [result] = await pool.execute(
    'INSERT INTO role_servers (name) VALUES (?)',
    [name],
  );
  return result.insertId;
}

export async function addRole(serverId, discordRoleId, label) {
  await pool.execute(
    `INSERT INTO available_roles (server_id, discord_role_id, label)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE label = VALUES(label), active = TRUE`,
    [serverId, discordRoleId, label],
  );
}

export async function getCatalog() {
  const [rows] = await pool.execute(
    `SELECT s.id AS server_id, s.name AS server_name,
            r.discord_role_id, r.label
     FROM role_servers s
     LEFT JOIN available_roles r ON r.server_id = s.id AND r.active = TRUE
     WHERE s.active = TRUE
     ORDER BY s.id, r.id`,
  );
  return rows;
}

export async function getServer(serverId) {
  const [rows] = await pool.execute(
    'SELECT id FROM role_servers WHERE id = ? AND active = TRUE',
    [serverId],
  );
  return rows[0] ?? null;
}

export async function getManagedRoleIds() {
  const [rows] = await pool.execute(
    `SELECT DISTINCT r.discord_role_id
     FROM role_servers s
     INNER JOIN available_roles r ON r.server_id = s.id AND r.active = TRUE
     WHERE s.active = TRUE`,
  );
  return rows.map((row) => row.discord_role_id);
}

export async function createRoleRequest(userId, serverId, role) {
  const [result] = await pool.execute(
    `INSERT INTO role_requests
       (user_id, server_id, available_role_id, discord_role_id)
     VALUES (?, ?, ?, ?)`,
    [userId, serverId, role.id, role.discord_role_id],
  );
  return result.insertId;
}

export async function setReviewMessage(requestId, messageId) {
  await pool.execute(
    'UPDATE role_requests SET review_message_id = ? WHERE id = ?',
    [messageId, requestId],
  );
}

export async function getRoleRequest(requestId) {
  const [rows] = await pool.execute(
    `SELECT rr.*, s.name AS server_name, ar.label AS role_label
     FROM role_requests rr
     INNER JOIN role_servers s ON s.id = rr.server_id
     INNER JOIN available_roles ar ON ar.id = rr.available_role_id
     WHERE rr.id = ?`,
    [requestId],
  );
  return rows[0] ?? null;
}

export async function getModerationStats() {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(status = 'pending'), 0) AS pending,
            COALESCE(SUM(status = 'approved'), 0) AS approved,
            COALESCE(SUM(status = 'rejected'), 0) AS rejected
    FROM role_requests`,
  );
  return rows[0];
}

export async function getPendingRequests(limit = 1, offset = 0) {
  const [rows] = await pool.execute(
    `SELECT rr.id, rr.user_id, rr.server_id, rr.discord_role_id, rr.created_at,
            s.name AS server_name, ar.label AS role_label
     FROM role_requests rr
     INNER JOIN role_servers s ON s.id = rr.server_id
     INNER JOIN available_roles ar ON ar.id = rr.available_role_id
    WHERE rr.status = 'pending'
     ORDER BY rr.created_at ASC, rr.id ASC
     LIMIT ? OFFSET ?`,
      [limit, offset],
  );
  return rows;
}

export async function createModeratorProfile(userId, roleId, positionKey, realName, age) {
  const [result] = await pool.execute(
    `INSERT INTO moderator_profiles
       (user_id, moderator_role_id, position_key, real_name, age)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, roleId, positionKey, realName, age],
  );
  return result.insertId;
}

export async function deleteModeratorProfile(userId) {
  await pool.execute(
    'DELETE FROM moderator_profiles WHERE user_id = ?',
    [userId],
  );
}

export async function setModeratorArchiveThread(userId, threadId) {
  await pool.execute(
    'UPDATE moderator_profiles SET archive_thread_id = ? WHERE user_id = ?',
    [threadId, userId],
  );
}

export async function getModeratorProfile(userId, weekStart) {
  const [rows] = await pool.execute(
    `SELECT p.*, COALESCE(w.message_count, 0) AS weekly_messages
     FROM moderator_profiles p
     LEFT JOIN moderator_weekly_stats w
       ON w.user_id = p.user_id AND w.week_start = ?
     WHERE p.user_id = ? AND p.active = TRUE`,
    [weekStart, userId],
  );
  return rows[0] ?? null;
}

export async function getModeratorProfileRecord(userId, weekStart) {
  const [rows] = await pool.execute(
    `SELECT p.*, COALESCE(w.message_count, 0) AS weekly_messages
     FROM moderator_profiles p
     LEFT JOIN moderator_weekly_stats w
       ON w.user_id = p.user_id AND w.week_start = ?
     WHERE p.user_id = ?`,
    [weekStart, userId],
  );
  return rows[0] ?? null;
}

export async function getModeratorPositionRole(positionKey) {
  const [rows] = await pool.execute(
    `SELECT discord_role_id
     FROM moderator_position_roles
    WHERE position_key = ?`,
      [positionKey],
  );
  return rows[0]?.discord_role_id ?? null;
}

export async function getModeratorPositionRoleIds() {
  const [rows] = await pool.execute(
    'SELECT discord_role_id FROM moderator_position_roles',
  );
  return rows.map((row) => row.discord_role_id);
}

export async function getCommandAccessRoleIds(command) {
  const [rows] = await pool.execute(
    `SELECT pr.discord_role_id
     FROM commands_access ca
     JOIN moderator_position_roles pr ON pr.position_key = ca.moderator_role
    WHERE ca.command = ?`,
    [command],
  );
  return rows.map((row) => row.discord_role_id);
}

export async function getPositionRoleIds(positionKeys) {
  const [rows] = await pool.query(
    'SELECT position_key, discord_role_id FROM moderator_position_roles WHERE position_key IN (?)',
    [positionKeys],
  );
  return Object.fromEntries(rows.map((row) => [row.position_key, row.discord_role_id]));
}

export async function createTicketRecord(userId, content) {
  const [result] = await pool.execute(
    'INSERT INTO tickets (user_id, content) VALUES (?, ?)',
    [userId, content],
  );
  return result.insertId;
}

export async function setTicketChannel(ticketId, channelId) {
  await pool.execute('UPDATE tickets SET channel_id = ? WHERE id = ?', [channelId, ticketId]);
}

export async function deleteTicketRecord(ticketId) {
  await pool.execute('DELETE FROM tickets WHERE id = ?', [ticketId]);
}

export async function getTicketByChannel(channelId) {
  const [rows] = await pool.execute('SELECT * FROM tickets WHERE channel_id = ?', [channelId]);
  return rows[0] ?? null;
}

export async function claimTicketHold(ticketId, moderatorId) {
  const [result] = await pool.execute(
    `UPDATE tickets
     SET held_by = ?, held_at = CURRENT_TIMESTAMP, status = 'held'
     WHERE id = ? AND status = 'open' AND held_by IS NULL`,
    [moderatorId, ticketId],
  );
  return result.affectedRows === 1;
}

export async function releaseTicketHold(ticketId) {
  await pool.execute(
    `UPDATE tickets SET held_by = NULL, held_at = NULL, status = 'open'
     WHERE id = ? AND status = 'held'`,
    [ticketId],
  );
}

export async function closeTicketRecord(ticketId, moderatorId) {
  const [result] = await pool.execute(
    `UPDATE tickets
     SET status = 'closed', closed_by = ?, closed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('open', 'held')`,
    [moderatorId, ticketId],
  );
  return result.affectedRows === 1;
}

export async function getTicketsDueForDeletion() {
  const [rows] = await pool.execute(
    `SELECT * FROM tickets
     WHERE status = 'closed' AND channel_id IS NOT NULL
       AND closed_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR)
     ORDER BY id
     LIMIT 20`,
  );
  return rows;
}

export async function markTicketArchived(ticketId) {
  await pool.execute('UPDATE tickets SET archived = TRUE WHERE id = ?', [ticketId]);
}

export async function markTicketDeleted(ticketId) {
  await pool.execute("UPDATE tickets SET status = 'deleted' WHERE id = ?", [ticketId]);
}

export async function getLevelSettings() {
  const [rows] = await pool.execute('SELECT * FROM level_settings WHERE id = 1');
  return rows[0] ?? null;
}

export async function getLevelRoles() {
  const [rows] = await pool.execute('SELECT level, role_id FROM level_roles ORDER BY level');
  return rows;
}

export async function updateUserLevel(userId, compute) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('INSERT IGNORE INTO user_levels (user_id) VALUES (?)', [userId]);
    const [rows] = await connection.execute('SELECT level, exp FROM user_levels WHERE user_id = ? FOR UPDATE', [userId]);
    const before = { level: Number(rows[0].level), exp: Number(rows[0].exp) };
    const after = compute(before);
    await connection.execute('UPDATE user_levels SET level = ?, exp = ? WHERE user_id = ?', [after.level, after.exp, userId]);
    await connection.commit();
    return { before, after };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getUserLevel(userId) {
  const [rows] = await pool.execute('SELECT level, exp FROM user_levels WHERE user_id = ?', [userId]);
  return rows[0] ? { level: Number(rows[0].level), exp: Number(rows[0].exp) } : null;
}

export async function getUserRank(userId, level, exp) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS ahead FROM user_levels
     WHERE level > ? OR (level = ? AND exp > ?) OR (level = ? AND exp = ? AND user_id < ?)`,
    [level, level, exp, level, exp, userId],
  );
  return Number(rows[0].ahead) + 1;
}

export async function countLevelTop() {
  const [rows] = await pool.execute('SELECT COUNT(*) AS total FROM user_levels WHERE level > 1 OR exp > 0');
  return Number(rows[0].total);
}

export async function getLevelTop(limit, offset) {
  const [rows] = await pool.query(
    `SELECT user_id, level, exp FROM user_levels
     WHERE level > 1 OR exp > 0
     ORDER BY level DESC, exp DESC, user_id
     LIMIT ? OFFSET ?`,
    [Number(limit), Number(offset)],
  );
  return rows;
}

export async function reactivateModeratorProfile(userId, roleId, positionKey, realName, age) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE moderator_profiles
       SET moderator_role_id = ?, position_key = ?, real_name = ?, age = ?,
           appointed_at = CURRENT_TIMESTAMP, last_promotion_at = NULL,
           warning_count = 0, reprimand_count = 0, points = 0, active = TRUE,
           archive_thread_id = NULL
       WHERE user_id = ? AND active = FALSE`,
      [roleId, positionKey, realName, age, userId],
    );
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return false;
    }
    await connection.execute(
      'DELETE FROM moderator_weekly_stats WHERE user_id = ?',
      [userId],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function deactivateModeratorProfile(userId, actorId, reason) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      'UPDATE moderator_profiles SET active = FALSE WHERE user_id = ? AND active = TRUE',
      [userId],
    );
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return false;
    }
    await connection.execute(
      `INSERT INTO moderator_events (user_id, event_type, actor_id, note)
       VALUES (?, 'dismissal', ?, ?)`,
      [userId, actorId, reason],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getModeratorProfiles(weekStart, limit = 25, offset = 0) {
  const [rows] = await pool.execute(
    `SELECT p.user_id, p.moderator_role_id, p.real_name,
            COALESCE(w.message_count, 0) AS weekly_messages
     FROM moderator_profiles p
     LEFT JOIN moderator_weekly_stats w
       ON w.user_id = p.user_id AND w.week_start = ?
     WHERE p.active = TRUE
     ORDER BY p.real_name, p.user_id
     LIMIT ? OFFSET ?`,
    [weekStart, limit, offset],
  );
  return rows;
}

export async function countModeratorProfiles() {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS total FROM moderator_profiles WHERE active = TRUE',
  );
  return Number(rows[0].total);
}

export async function promoteModerator(userId, roleId, positionKey, expectedPositionKey, actorId, note) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE moderator_profiles
       SET moderator_role_id = ?, position_key = ?, last_promotion_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND active = TRUE AND position_key <=> ?`,
      [roleId, positionKey, userId, expectedPositionKey ?? null],
    );
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return false;
    }
    await connection.execute(
      `INSERT INTO moderator_events (user_id, event_type, actor_id, note)
       VALUES (?, 'promotion', ?, ?)`,
      [userId, actorId, note],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function addModeratorWarning(userId, actorId, note) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE moderator_profiles
       SET warning_count = warning_count + 1
      WHERE user_id = ? AND active = TRUE AND warning_count < 3`,
          [userId],
    );
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return false;
    }
    await connection.execute(
      `INSERT INTO moderator_events (user_id, event_type, actor_id, note)
       VALUES (?, 'warning', ?, ?)`,
      [userId, actorId, note],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function addModeratorReprimand(userId, actorId, note) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE moderator_profiles
       SET reprimand_count = reprimand_count + 1
      WHERE user_id = ? AND active = TRUE AND reprimand_count < 3`,
          [userId],
    );
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return false;
    }
    await connection.execute(
      `INSERT INTO moderator_events (user_id, event_type, actor_id, note)
       VALUES (?, 'reprimand', ?, ?)`,
      [userId, actorId, note],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function removeModeratorWarning(userId, actorId, note) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE moderator_profiles
       SET warning_count = warning_count - 1
       WHERE user_id = ? AND active = TRUE AND warning_count > 0`,
      [userId],
    );
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return false;
    }
    await connection.execute(
      `INSERT INTO moderator_events (user_id, event_type, actor_id, note)
       VALUES (?, 'warning', ?, ?)`,
      [userId, actorId, `Снято предупреждение: ${note}`],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function removeModeratorReprimand(userId, actorId, note) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE moderator_profiles
       SET reprimand_count = reprimand_count - 1
       WHERE user_id = ? AND active = TRUE AND reprimand_count > 0`,
      [userId],
    );
    if (result.affectedRows !== 1) {
      await connection.rollback();
      return false;
    }
    await connection.execute(
      `INSERT INTO moderator_events (user_id, event_type, actor_id, note)
       VALUES (?, 'reprimand', ?, ?)`,
      [userId, actorId, `Снят выговор: ${note}`],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function adjustModeratorDiscipline(userId, type, delta, actorId, reason) {
  const columns = {
    warning: 'warning_count',
    reprimand: 'reprimand_count',
  };
  const column = columns[type];
  if (!column) throw new Error('Unsupported moderator discipline type.');
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 3) {
    throw new Error('Discipline delta must be an integer from -3 to 3, excluding zero.');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT ${column} AS current_count
       FROM moderator_profiles
       WHERE user_id = ? AND active = TRUE
       FOR UPDATE`,
      [userId],
    );
    if (!rows.length) {
      await connection.rollback();
      return { success: false, reason: 'profile_missing' };
    }

    const currentCount = Number(rows[0].current_count);
    const nextCount = currentCount + delta;
    if (nextCount < 0 || nextCount > 3) {
      await connection.rollback();
      return { success: false, reason: 'limit', currentCount };
    }

    await connection.execute(
      `UPDATE moderator_profiles SET ${column} = ? WHERE user_id = ? AND active = TRUE`,
      [nextCount, userId],
    );
    const eventType = type === 'warning' ? 'warning' : 'reprimand';
    const actionLabel = delta > 0 ? `Выдано +${delta}` : `Снято ${delta}`;
    await connection.execute(
      `INSERT INTO moderator_events (user_id, event_type, actor_id, note)
       VALUES (?, ?, ?, ?)`,
      [userId, eventType, actorId, `${actionLabel}: ${reason}`],
    );
    await connection.commit();
    return { success: true, count: nextCount };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function incrementModeratorWeeklyMessage(userId, weekStart) {
  const [result] = await pool.execute(
    `INSERT INTO moderator_weekly_stats (user_id, week_start, message_count)
     SELECT ?, ?, 1
     FROM moderator_profiles
     WHERE user_id = ? AND active = TRUE
     ON DUPLICATE KEY UPDATE message_count = message_count + 1`,
    [userId, weekStart, userId],
  );
  return result.affectedRows > 0;
}

export async function getModeratorWeeklyWork(userId, sinceUnixSeconds) {
  const [[tickets], [roleRequests], [punishments]] = await Promise.all([
    pool.execute(
      `SELECT COUNT(*) AS total FROM tickets
       WHERE closed_by = ? AND status IN ('closed', 'deleted') AND closed_at >= FROM_UNIXTIME(?)`,
      [userId, sinceUnixSeconds],
    ),
    pool.execute(
      `SELECT COUNT(*) AS total FROM role_requests
       WHERE reviewer_id = ? AND status IN ('approved', 'rejected') AND reviewed_at >= FROM_UNIXTIME(?)`,
      [userId, sinceUnixSeconds],
    ),
    pool.execute(
      `SELECT COALESCE(SUM(action = 'mute'), 0) AS mutes,
              COALESCE(SUM(action = 'ban'), 0) AS bans,
              COALESCE(SUM(action = 'kick'), 0) AS kicks
       FROM moderation_actions
       WHERE moderator_id = ? AND created_at >= FROM_UNIXTIME(?)`,
      [userId, sinceUnixSeconds],
    ),
  ]);
  return {
    ticketsClosed: Number(tickets[0].total),
    roleRequestsReviewed: Number(roleRequests[0].total),
    mutes: Number(punishments[0].mutes),
    bans: Number(punishments[0].bans),
    kicks: Number(punishments[0].kicks),
  };
}

export async function updateRequestStatus(requestId, status, reviewerId) {
  const [result] = await pool.execute(
    `UPDATE role_requests
     SET status = ?, reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'pending'`,
    [status, reviewerId, requestId],
  );
  return result.affectedRows === 1;
}

export async function resetRequestToPending(requestId) {
  await pool.execute(
    `UPDATE role_requests
     SET status = 'pending', reviewer_id = NULL, reviewed_at = NULL
     WHERE id = ? AND status = 'approved'`,
    [requestId],
  );
}

export async function recordModerationAction({
  guildId,
  action,
  targetId,
  moderatorId,
  reason,
  durationMs = null,
  expiresAtMs = null,
  clearedMessages = false,
}) {
  if (action === 'ban' || action === 'unban') {
    await pool.execute(
      `UPDATE moderation_actions SET active = FALSE
       WHERE guild_id = ? AND target_id = ? AND action = 'ban' AND active = TRUE`,
      [guildId, targetId],
    );
  }
  await pool.execute(
    `INSERT INTO moderation_actions
       (guild_id, action, target_id, moderator_id, reason, duration_ms, expires_at_ms, cleared_messages, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [guildId, action, targetId, moderatorId, reason, durationMs, expiresAtMs, clearedMessages ? 1 : 0, action === 'ban' ? 1 : 0],
  );
}

export async function getExpiredBans(guildId, nowMs) {
  const [rows] = await pool.execute(
    `SELECT id, target_id FROM moderation_actions
     WHERE guild_id = ? AND action = 'ban' AND active = TRUE
       AND expires_at_ms IS NOT NULL AND expires_at_ms <= ?`,
    [guildId, nowMs],
  );
  return rows;
}

export async function deactivateBanRecord(id) {
  await pool.execute('UPDATE moderation_actions SET active = FALSE WHERE id = ?', [id]);
}

export async function adjustModeratorPoints(userId, delta, actorId, reason) {
  if (!Number.isInteger(delta) || delta === 0) throw new Error('Points delta must be a non-zero integer.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT points FROM moderator_profiles WHERE user_id = ? AND active = TRUE FOR UPDATE',
      [userId],
    );
    if (!rows.length) {
      await connection.rollback();
      return { success: false, reason: 'profile_missing' };
    }
    const currentPoints = Number(rows[0].points);
    const nextPoints = currentPoints + delta;
    if (nextPoints < 0) {
      await connection.rollback();
      return { success: false, reason: 'negative', currentPoints };
    }
    await connection.execute(
      'UPDATE moderator_profiles SET points = ? WHERE user_id = ? AND active = TRUE',
      [nextPoints, userId],
    );
    await connection.execute(
      `INSERT INTO moderator_events (user_id, event_type, actor_id, note)
       VALUES (?, 'points', ?, ?)`,
      [userId, actorId, `${delta > 0 ? 'Выдано +' : 'Снято '}${delta}: ${reason}`],
    );
    await connection.commit();
    return { success: true, points: nextPoints };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getModeratorArchiveThreads() {
  const [rows] = await pool.execute(
    'SELECT archive_thread_id, points FROM moderator_profiles WHERE archive_thread_id IS NOT NULL',
  );
  return rows;
}

export async function setArchiveEmbedsVersion(version) {
  await pool.execute('UPDATE bot_settings SET archive_embeds_version = ? WHERE id = 1', [version]);
}

export async function getNefrits(userId) {
  const [rows] = await pool.execute('SELECT nefrits FROM user_economy WHERE user_id = ?', [userId]);
  return rows[0] ? Number(rows[0].nefrits) : 0;
}

// Меняет баланс Нефритов в транзакции. Если итог ушёл бы ниже нуля, ничего не меняет.
export async function changeNefrits(userId, delta, actorId, reason) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('INSERT IGNORE INTO user_economy (user_id) VALUES (?)', [userId]);
    const [rows] = await connection.execute('SELECT nefrits FROM user_economy WHERE user_id = ? FOR UPDATE', [userId]);
    const before = Number(rows[0].nefrits);
    const after = before + delta;
    if (after < 0) {
      await connection.rollback();
      return { ok: false, before, after: before };
    }
    await connection.execute('UPDATE user_economy SET nefrits = ? WHERE user_id = ?', [after, userId]);
    await connection.execute(
      'INSERT INTO economy_transactions (user_id, amount, balance_after, actor_id, reason) VALUES (?, ?, ?, ?, ?)',
      [userId, delta, after, actorId, reason || null],
    );
    await connection.commit();
    return { ok: true, before, after };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function saveMarketMessageId(messageId) {
  await pool.execute(
    `INSERT INTO bot_settings (id, market_message_id) VALUES (1, ?)
     ON DUPLICATE KEY UPDATE market_message_id = VALUES(market_message_id)`,
    [messageId],
  );
}

export async function getMarketItems() {
  const [rows] = await pool.execute('SELECT id, name, price FROM market_items WHERE active = TRUE ORDER BY id');
  return rows.map((row) => ({ id: Number(row.id), name: row.name, price: Number(row.price) }));
}

export async function getMarketItem(itemId) {
  const [rows] = await pool.execute('SELECT id, name, price FROM market_items WHERE id = ? AND active = TRUE', [itemId]);
  return rows[0] ? { id: Number(rows[0].id), name: rows[0].name, price: Number(rows[0].price) } : null;
}

export async function addMarketItem(name, price, createdBy) {
  const [result] = await pool.execute(
    'INSERT INTO market_items (name, price, created_by) VALUES (?, ?, ?)',
    [name, price, createdBy],
  );
  return Number(result.insertId);
}

// Покупка в одной транзакции: проверка товара, баланса, списание Нефритов и запись истории.
export async function purchaseMarketItem(userId, itemId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [items] = await connection.execute(
      'SELECT id, name, price FROM market_items WHERE id = ? AND active = TRUE',
      [itemId],
    );
    if (!items[0]) {
      await connection.rollback();
      return { status: 'missing' };
    }
    const item = { id: Number(items[0].id), name: items[0].name, price: Number(items[0].price) };

    await connection.execute('INSERT IGNORE INTO user_economy (user_id) VALUES (?)', [userId]);
    const [rows] = await connection.execute('SELECT nefrits FROM user_economy WHERE user_id = ? FOR UPDATE', [userId]);
    const before = Number(rows[0].nefrits);
    if (before < item.price) {
      await connection.rollback();
      return { status: 'insufficient', item, balance: before };
    }

    const after = before - item.price;
    await connection.execute('UPDATE user_economy SET nefrits = ? WHERE user_id = ?', [after, userId]);
    await connection.execute(
      'INSERT INTO economy_transactions (user_id, amount, balance_after, actor_id, reason) VALUES (?, ?, ?, ?, ?)',
      [userId, -item.price, after, userId, `Покупка: ${item.name}`],
    );
    await connection.execute(
      'INSERT INTO market_purchases (user_id, item_id, item_name, price) VALUES (?, ?, ?, ?)',
      [userId, item.id, item.name, item.price],
    );
    await connection.commit();
    return { status: 'ok', item, before, after };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function deleteMarketItem(itemId) {
  const [result] = await pool.execute('DELETE FROM market_items WHERE id = ?', [itemId]);
  return result.affectedRows > 0;
}
