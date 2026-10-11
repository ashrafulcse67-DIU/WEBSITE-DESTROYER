-- Append-only results. The public API can only INSERT (validated) and read the top 10; nothing edits or deletes rows.
CREATE TABLE IF NOT EXISTS game_results (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id            TEXT    NOT NULL UNIQUE,                       -- one signed round = one result (duplicate protection)
  player_id           TEXT    NOT NULL,                              -- anonymous random device id, NOT an account
  display_name        TEXT    NOT NULL CHECK (length(display_name) BETWEEN 3 AND 16),
  character_id        TEXT    NOT NULL CHECK (character_id IN ('glitch','boom','nova','hole')),
  score               INTEGER NOT NULL CHECK (score BETWEEN 1 AND 11150),
  elapsed_time_ms     INTEGER NOT NULL CHECK (elapsed_time_ms BETWEEN 12000 AND 60000),
  destruction_percent INTEGER NOT NULL CHECK (destruction_percent = 100),
  completed           INTEGER NOT NULL CHECK (completed = 1),
  validation_status   TEXT    NOT NULL DEFAULT 'ok',
  created_at          INTEGER NOT NULL                               -- server time, ms since epoch
);
CREATE INDEX IF NOT EXISTS idx_results_rank   ON game_results (score DESC, elapsed_time_ms ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_results_player ON game_results (player_id, score DESC, elapsed_time_ms ASC, id ASC);

-- Short-lived counters for rate limiting (keyed by a salted hash of the IP, purged after an hour).
CREATE TABLE IF NOT EXISTS rate_events (key TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rate ON rate_events (key, ts);
