export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  telegram_id INTEGER,
  avatar_file_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ticket_price INTEGER NOT NULL DEFAULT 0,
  max_players INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_rsvps (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  response TEXT NOT NULL CHECK(response IN ('yes', 'no')),
  queue_order INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS game_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  buyin INTEGER NOT NULL,
  payout INTEGER NOT NULL,
  profit INTEGER NOT NULL,
  place INTEGER
);

CREATE TABLE IF NOT EXISTS bot_sessions (
  user_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_date ON games(date);
CREATE INDEX IF NOT EXISTS idx_game_rsvps_game ON game_rsvps(game_id);

CREATE TABLE IF NOT EXISTS game_invite_messages (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  telegram_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  PRIMARY KEY (game_id, telegram_id)
);
CREATE INDEX IF NOT EXISTS idx_game_results_game ON game_results(game_id);
CREATE INDEX IF NOT EXISTS idx_game_results_player ON game_results(player_id);
`;
