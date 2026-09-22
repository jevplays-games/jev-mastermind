PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  discord_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_ref TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS web_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  discord_user_id TEXT REFERENCES users(discord_user_id),
  csrf TEXT NOT NULL,
  oauth_state_hash TEXT,
  oauth_expires_at INTEGER,
  pending_launch_hash TEXT,
  context_json TEXT,
  context_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS launch_tickets (
  token_hash TEXT PRIMARY KEY,
  interaction_id TEXT NOT NULL UNIQUE,
  expected_user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  discord_user_id TEXT REFERENCES users(discord_user_id),
  create_request_id TEXT NOT NULL,
  create_request_hash TEXT NOT NULL,
  config_id TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy','normal','hard','jev')),
  phase TEXT NOT NULL CHECK (phase IN ('human_break','jev_break','complete','forfeit','void')),
  revision INTEGER NOT NULL DEFAULT 0,
  started_ranked INTEGER NOT NULL CHECK (started_ranked IN (0,1)),
  eligible INTEGER NOT NULL CHECK (eligible IN (0,1)),
  guild_id TEXT,
  channel_id TEXT,
  state_json TEXT NOT NULL,
  secrets_json TEXT NOT NULL,
  audit_json TEXT NOT NULL DEFAULT '[]',
  timings_json TEXT NOT NULL DEFAULT '[]',
  receipts_json TEXT NOT NULL DEFAULT '[]',
  pending_json TEXT,
  config_json TEXT NOT NULL,
  summary_json TEXT,
  outcome TEXT CHECK (outcome IN ('win','loss','draw')),
  finish_reason TEXT,
  human_cost INTEGER CHECK (human_cost BETWEEN 1 AND 11),
  jev_cost INTEGER CHECK (jev_cost BETWEEN 1 AND 11),
  fallback_count INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  last_action_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE(owner_key,create_request_id),
  CHECK ((guild_id IS NULL AND channel_id IS NULL) OR (guild_id IS NOT NULL AND channel_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS active_ranked_user ON matches(discord_user_id) WHERE started_ranked=1 AND phase IN ('human_break','jev_break');
CREATE INDEX IF NOT EXISTS matches_world ON matches(config_id,difficulty,eligible,finished_at,discord_user_id);
CREATE INDEX IF NOT EXISTS matches_server ON matches(guild_id,config_id,difficulty,eligible,finished_at,discord_user_id);
CREATE INDEX IF NOT EXISTS matches_channel ON matches(guild_id,channel_id,config_id,difficulty,eligible,finished_at,discord_user_id);
CREATE INDEX IF NOT EXISTS matches_owner ON matches(owner_key,created_at);
CREATE INDEX IF NOT EXISTS matches_user ON matches(discord_user_id,created_at);
CREATE INDEX IF NOT EXISTS matches_pending ON matches(phase,expires_at);
CREATE INDEX IF NOT EXISTS sessions_expiry ON web_sessions(expires_at);
CREATE INDEX IF NOT EXISTS tickets_expiry ON launch_tickets(expires_at);
-- Structured, allowlisted server events: no secrets, raw IPs, launch tokens, emails, or names.
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  match_id TEXT,
  name TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_time ON analytics_events(created_at,name);
CREATE INDEX IF NOT EXISTS events_match ON analytics_events(match_id,created_at);
-- Atomic, bounded quotas. Unlike isolate-local counters these survive restarts and concurrent Workers.
CREATE TABLE IF NOT EXISTS usage_buckets (
  bucket TEXT PRIMARY KEY,
  used INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS buckets_expiry ON usage_buckets(expires_at);
