import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

export type User = {
  id: string;
  username: string;
  email?: string;
  elo: number;
  avatar_id: number;
  last_active: string;
  created_at: string;
};

export type Match = {
  id: string;
  p1_id: string;
  p2_id: string;
  p1_elo: number;
  p2_elo: number;
  winner_id: string | null;
  is_bot_match: boolean;
  bot_depth?: number;
  pairing_id?: number;
  winner?: string;
  category: string;
  p1_username: string;
  p2_username: string;
  p1_avatar: number;
  p2_avatar: number;
  created_at: string;
};

export type Message = {
  id: string;
  user_id: string;
  content: string;
  username: string;
  avatar_id: number;
  created_at: string;
};

export type Move = {
  id: string;
  match_id: string;
  move_number: number;
  board_state: number[][];
  move_made: number;
  final_result: number;
};
