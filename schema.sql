<<<<<<< HEAD
CREATE DATABASE IF NOT EXISTS discord_role_requests
=======
CREATE DATABASE IF NOT EXISTS DProject
>>>>>>> 96f1effa0965c9f1a4b4aaecc4660a21840ae098
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE discord_role_requests;

CREATE TABLE IF NOT EXISTS bot_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  panel_channel_id VARCHAR(20) NULL,
  review_channel_id VARCHAR(20) NULL,
  moderator_forum_channel_id VARCHAR(20) NULL,
  ticket_channel_id VARCHAR(20) NULL,
  tickets_opened_category_id VARCHAR(20) NULL,
  tickets_held_category_id VARCHAR(20) NULL,
  tickets_closed_category_id VARCHAR(20) NULL,
  tickets_archive_channel_id VARCHAR(20) NULL,
  level_notify_channel VARCHAR(20) NULL,
  main_chat_id VARCHAR(20) NULL,
  market_channel_id VARCHAR(20) NULL,
  market_message_id VARCHAR(20) NULL,
  market_log_channel_id VARCHAR(20) NULL,
  ban_log_channel_id VARCHAR(20) NULL,
  mute_log_channel_id VARCHAR(20) NULL,
  kick_log_channel_id VARCHAR(20) NULL,
  economy_log_channel VARCHAR(20) NULL,
  archive_embeds_version TINYINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- These are game/community servers shown in the request menu, not Discord guilds.
CREATE TABLE IF NOT EXISTS role_servers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_role_server_name (name),
  KEY ix_role_servers_active (active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS available_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  server_id BIGINT UNSIGNED NOT NULL,
  discord_role_id VARCHAR(20) NOT NULL,
  label VARCHAR(100) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_available_role (server_id, discord_role_id),
  KEY ix_available_roles_server_active (server_id, active),
  CONSTRAINT fk_available_roles_server FOREIGN KEY (server_id)
    REFERENCES role_servers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL,
  server_id BIGINT UNSIGNED NOT NULL,
  available_role_id BIGINT UNSIGNED NOT NULL,
  discord_role_id VARCHAR(20) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
  reviewer_id VARCHAR(20) NULL,
  review_message_id VARCHAR(20) NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_role_requests_pending (status, created_at),
  KEY ix_role_requests_user (user_id, status),
  CONSTRAINT fk_role_requests_server FOREIGN KEY (server_id)
    REFERENCES role_servers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_role_requests_role FOREIGN KEY (available_role_id)
    REFERENCES available_roles(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS moderator_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL,
  moderator_role_id VARCHAR(20) NOT NULL,
  position_key VARCHAR(40) NULL,
  real_name VARCHAR(100) NOT NULL,
  age TINYINT UNSIGNED NOT NULL,
  appointed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_promotion_at DATETIME NULL,
  warning_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  reprimand_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  points INT NOT NULL DEFAULT 0,
  archive_thread_id VARCHAR(20) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_moderator_profile_user (user_id),
  KEY ix_moderator_profiles_active (active),
  CONSTRAINT chk_moderator_warning_limit CHECK (warning_count <= 3),
  CONSTRAINT chk_moderator_reprimand_limit CHECK (reprimand_count <= 3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS moderator_position_roles (
  position_key VARCHAR(40) NOT NULL,
  discord_role_id VARCHAR(20) NOT NULL,
  PRIMARY KEY (position_key),
  UNIQUE KEY uq_moderator_position_role (discord_role_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS moderator_weekly_stats (
  user_id VARCHAR(20) NOT NULL,
  week_start DATE NOT NULL,
  message_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, week_start),
  CONSTRAINT fk_moderator_weekly_profile FOREIGN KEY (user_id)
    REFERENCES moderator_profiles(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS moderator_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL,
  event_type ENUM('promotion', 'warning', 'reprimand', 'dismissal', 'points') NOT NULL,
  actor_id VARCHAR(20) NOT NULL,
  note VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_moderator_events_history (user_id, created_at),
  CONSTRAINT fk_moderator_event_profile FOREIGN KEY (user_id)
    REFERENCES moderator_profiles(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS moderation_actions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  action ENUM('ban', 'unban', 'mute', 'unmute', 'kick') NOT NULL,
  target_id VARCHAR(20) NOT NULL,
  moderator_id VARCHAR(20) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  duration_ms BIGINT UNSIGNED NULL,
  expires_at_ms BIGINT UNSIGNED NULL,
  cleared_messages BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_moderation_target (guild_id, target_id, created_at),
  KEY ix_moderation_expiring_bans (guild_id, action, active, expires_at_ms)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS commands_access (
  command VARCHAR(32) NOT NULL,
  moderator_role VARCHAR(40) NOT NULL,
  PRIMARY KEY (command, moderator_role)
) ENGINE=InnoDB;

-- Кто может использовать команду: одна строка = команда + должность (position_key из moderator_position_roles).
INSERT IGNORE INTO commands_access (command, moderator_role) VALUES
  ('setmoder', 'moderation_curator'),
  ('setmoder', 'deputy_head_moderator'),
  ('setmoder', 'head_moderator'),
  ('setmoder', 'discord_administrator'),
  ('fire', 'moderation_curator'),
  ('fire', 'deputy_head_moderator'),
  ('fire', 'head_moderator'),
  ('fire', 'discord_administrator'),
  ('setwarn', 'moderation_curator'),
  ('setwarn', 'deputy_head_moderator'),
  ('setwarn', 'head_moderator'),
  ('setwarn', 'discord_administrator'),
  ('setvig', 'moderation_curator'),
  ('setvig', 'deputy_head_moderator'),
  ('setvig', 'head_moderator'),
  ('setvig', 'discord_administrator'),
  ('stats', 'moderator'),
  ('stats', 'senior_moderator'),
  ('stats', 'moderation_curator'),
  ('stats', 'deputy_head_moderator'),
  ('stats', 'head_moderator'),
  ('stats', 'discord_administrator'),
  ('ban', 'senior_moderator'),
  ('ban', 'moderation_curator'),
  ('ban', 'deputy_head_moderator'),
  ('ban', 'head_moderator'),
  ('ban', 'discord_administrator'),
  ('unban', 'senior_moderator'),
  ('unban', 'moderation_curator'),
  ('unban', 'deputy_head_moderator'),
  ('unban', 'head_moderator'),
  ('unban', 'discord_administrator'),
  ('mute', 'moderator'),
  ('mute', 'senior_moderator'),
  ('mute', 'moderation_curator'),
  ('mute', 'deputy_head_moderator'),
  ('mute', 'head_moderator'),
  ('mute', 'discord_administrator'),
  ('unmute', 'moderator'),
  ('unmute', 'senior_moderator'),
  ('unmute', 'moderation_curator'),
  ('unmute', 'deputy_head_moderator'),
  ('unmute', 'head_moderator'),
  ('unmute', 'discord_administrator'),
  ('kick', 'moderator'),
  ('kick', 'senior_moderator'),
  ('kick', 'moderation_curator'),
  ('kick', 'deputy_head_moderator'),
  ('kick', 'head_moderator'),
  ('kick', 'discord_administrator');

CREATE TABLE IF NOT EXISTS tickets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NULL,
  content TEXT NOT NULL,
  status ENUM('open', 'held', 'closed', 'deleted') NOT NULL DEFAULT 'open',
  held_by VARCHAR(20) NULL,
  closed_by VARCHAR(20) NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  held_at TIMESTAMP NULL DEFAULT NULL,
  closed_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_ticket_channel (channel_id),
  KEY ix_tickets_status_closed (status, closed_at)
) ENGINE=InnoDB;

-- Доступ к командам обращений (position_key из moderator_position_roles).
INSERT IGNORE INTO commands_access (command, moderator_role) VALUES
  ('hold', 'senior_moderator'),
  ('hold', 'moderation_curator'),
  ('hold', 'deputy_head_moderator'),
  ('hold', 'head_moderator'),
  ('hold', 'discord_administrator'),
  ('hold', 'technical_moderator'),
  ('close', 'senior_moderator'),
  ('close', 'moderation_curator'),
  ('close', 'deputy_head_moderator'),
  ('close', 'head_moderator'),
  ('close', 'discord_administrator'),
  ('close', 'technical_moderator'),
  ('pass', 'senior_moderator'),
  ('pass', 'moderation_curator'),
  ('pass', 'deputy_head_moderator'),
  ('pass', 'head_moderator'),
  ('pass', 'discord_administrator'),
  ('pass', 'technical_moderator');

CREATE TABLE IF NOT EXISTS user_levels (
  user_id VARCHAR(20) NOT NULL PRIMARY KEY,
  level INT UNSIGNED NOT NULL DEFAULT 1,
  exp INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_user_levels_rank (level, exp)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS level_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  message_exp_min INT UNSIGNED NOT NULL DEFAULT 15,
  message_exp_max INT UNSIGNED NOT NULL DEFAULT 25,
  message_cooldown_seconds INT UNSIGNED NOT NULL DEFAULT 60,
  voice_exp_per_minute INT UNSIGNED NOT NULL DEFAULT 10,
  keep_previous_roles BOOLEAN NOT NULL DEFAULT FALSE
) ENGINE=InnoDB;

INSERT IGNORE INTO level_settings (id) VALUES (1);

-- Роли за уровни: одна строка = уровень и роль, которая выдаётся при его достижении.
CREATE TABLE IF NOT EXISTS level_roles (
  level INT UNSIGNED NOT NULL PRIMARY KEY,
  role_id VARCHAR(20) NOT NULL,
  UNIQUE KEY uq_level_roles_role (role_id)
) ENGINE=InnoDB;

-- Доступ к /exp и /lvl (position_key из moderator_position_roles). /leaders и /rank доступны всем.
INSERT IGNORE INTO commands_access (command, moderator_role) VALUES
  ('exp', 'moderation_curator'), ('exp', 'deputy_head_moderator'), ('exp', 'head_moderator'), ('exp', 'discord_administrator'),
  ('lvl', 'moderation_curator'), ('lvl', 'deputy_head_moderator'), ('lvl', 'head_moderator'), ('lvl', 'discord_administrator');

-- Доступ к /uplvl (position_key из moderator_position_roles).
INSERT IGNORE INTO commands_access (command, moderator_role) VALUES
  ('uplvl', 'technical_moderator'),
  ('uplvl', 'discord_administrator'),
  ('uplvl', 'head_moderator'),
  ('uplvl', 'deputy_head_moderator');

-- Доступ к /setpoints (position_key из moderator_position_roles).
INSERT IGNORE INTO commands_access (command, moderator_role) VALUES
  ('setpoints', 'moderation_curator'),
  ('setpoints', 'deputy_head_moderator'),
  ('setpoints', 'head_moderator'),
  ('setpoints', 'discord_administrator');
<<<<<<< HEAD

-- Экономика: валюта «Нефриты».
CREATE TABLE IF NOT EXISTS user_economy (
  user_id VARCHAR(20) NOT NULL PRIMARY KEY,
  nefrits BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- История выдачи и снятия Нефритов.
CREATE TABLE IF NOT EXISTS economy_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL,
  amount BIGINT NOT NULL,
  balance_after BIGINT UNSIGNED NOT NULL,
  actor_id VARCHAR(20) NOT NULL,
  reason VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_economy_user (user_id, created_at)
) ENGINE=InnoDB;

-- Доступ к /nefrit (position_key из moderator_position_roles). /profile доступна всем.
INSERT IGNORE INTO commands_access (command, moderator_role) VALUES
  ('nefrit', 'moderation_curator'),
  ('nefrit', 'deputy_head_moderator'),
  ('nefrit', 'head_moderator'),
  ('nefrit', 'discord_administrator');

-- Магазин: товары, которые покупаются за Нефриты.
CREATE TABLE IF NOT EXISTS market_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  price BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_market_item_name (name)
) ENGINE=InnoDB;

-- История покупок.
CREATE TABLE IF NOT EXISTS market_purchases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL,
  item_id INT UNSIGNED NOT NULL,
  item_name VARCHAR(80) NOT NULL,
  price BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_market_purchases_user (user_id, created_at)
) ENGINE=InnoDB;

-- Доступ к /addmarket (position_key из moderator_position_roles).
INSERT IGNORE INTO commands_access (command, moderator_role) VALUES
  ('addmarket', 'moderation_curator'),
  ('addmarket', 'deputy_head_moderator'),
  ('addmarket', 'head_moderator'),
  ('addmarket', 'discord_administrator');

-- Доступ к /delmarket.
INSERT IGNORE INTO commands_access (command, moderator_role) VALUES
  ('delmarket', 'moderation_curator'),
  ('delmarket', 'deputy_head_moderator'),
  ('delmarket', 'head_moderator'),
  ('delmarket', 'discord_administrator');
=======
>>>>>>> 96f1effa0965c9f1a4b4aaecc4660a21840ae098
