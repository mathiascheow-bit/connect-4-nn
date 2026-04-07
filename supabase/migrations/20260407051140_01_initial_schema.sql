/*
  # Create initial Connect 4 schema

  1. New Tables
    - `users`: User accounts with ELO ratings
    - `messages`: Chat messages between users
    - `matches`: Match records between players
    - `moves`: Individual moves within matches
    - `nnue_weights`: Neural network weights for AI training

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated access
*/

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT auth.uid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email text,
  elo INTEGER DEFAULT 1500,
  avatar_id INTEGER DEFAULT 0,
  last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read all profiles"
  ON users FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read messages"
  ON messages FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own messages"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  p1_id uuid REFERENCES users(id) ON DELETE SET NULL,
  p2_id uuid REFERENCES users(id) ON DELETE SET NULL,
  p1_elo INTEGER,
  p2_elo INTEGER,
  winner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  is_bot_match BOOLEAN DEFAULT FALSE,
  bot_depth INTEGER,
  pairing_id INTEGER,
  winner VARCHAR(10),
  category VARCHAR(50) DEFAULT 'general',
  p1_username VARCHAR(50),
  p2_username VARCHAR(50),
  p1_avatar INTEGER DEFAULT 0,
  p2_avatar INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read all matches"
  ON matches FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert matches"
  ON matches FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid REFERENCES matches(id) ON DELETE CASCADE,
  move_number INTEGER,
  board_state JSONB,
  move_made INTEGER,
  final_result INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE moves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read all moves"
  ON moves FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert moves"
  ON moves FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS nnue_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layer_name VARCHAR(50),
  weights JSONB,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE nnue_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read weights"
  ON nnue_weights FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update weights"
  ON nnue_weights FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can insert weights"
  ON nnue_weights FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_p1_id ON matches(p1_id);
CREATE INDEX IF NOT EXISTS idx_matches_p2_id ON matches(p2_id);
CREATE INDEX IF NOT EXISTS idx_moves_match_id ON moves(match_id);
CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo DESC);
