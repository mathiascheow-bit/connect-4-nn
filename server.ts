/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import pg from "pg";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        elo INTEGER DEFAULT 1500,
        avatar_id INTEGER DEFAULT 0,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        p1_id INTEGER REFERENCES users(id),
        p2_id INTEGER REFERENCES users(id),
        p1_elo INTEGER,
        p2_elo INTEGER,
        winner_id INTEGER REFERENCES users(id),
        is_bot_match BOOLEAN DEFAULT FALSE,
        bot_depth INTEGER,
        pairing_id INTEGER,
        winner VARCHAR(10),
        category VARCHAR(50) DEFAULT 'general',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS moves (
        id SERIAL PRIMARY KEY,
        match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
        move_number INTEGER,
        board_state JSONB,
        move_made INTEGER,
        final_result INTEGER
      );

      CREATE TABLE IF NOT EXISTS nnue_weights (
        id SERIAL PRIMARY KEY,
        layer_name VARCHAR(50),
        weights JSONB,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migration: Ensure pairing_id, category, and avatar_id columns exist
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='pairing_id') THEN
          ALTER TABLE matches ADD COLUMN pairing_id INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='category') THEN
          ALTER TABLE matches ADD COLUMN category VARCHAR(50) DEFAULT 'general';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='avatar_id') THEN
          ALTER TABLE users ADD COLUMN avatar_id INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_active') THEN
          ALTER TABLE users ADD COLUMN last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;
      END $$;
    `);

    // Initialize default admin if not exists
    const adminCheck = await pool.query("SELECT * FROM users WHERE username = 'mathias_cheow'");
    if (adminCheck.rows.length === 0) {
      await pool.query("INSERT INTO users (username, password, elo) VALUES ('mathias_cheow', 'h43456847', 2500)");
    }

    // Initialize default weights if none exist
    const weightCheck = await pool.query("SELECT COUNT(*) FROM nnue_weights");
    if (weightCheck.rows[0].count === '0') {
      const defaultWeights = {
        brain: {
          levels: [
            {
              inputs: new Array(84).fill(0),
              outputs: new Array(16).fill(0),
              biases: new Array(16).fill(0).map(() => Math.random() * 0.2 - 0.1),
              weights: new Array(84).fill(0).map(() => new Array(16).fill(0).map(() => Math.random() * 0.2 - 0.1))
            },
            {
              inputs: new Array(16).fill(0),
              outputs: new Array(1).fill(0),
              biases: [0.0],
              weights: new Array(16).fill(0).map(() => [Math.random() * 0.2 - 0.1])
            }
          ]
        }
      };
      await pool.query("INSERT INTO nnue_weights (layer_name, weights) VALUES ('kaggle', $1), ('user', $1), ('both', $1)", [JSON.stringify(defaultWeights)]);
    }

    console.log("Database initialized successfully");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  await initDb();

  // Matchmaking Queue (In-memory for simplicity)
  let matchmakingQueue: { userId: number, username: string, elo: number, avatarId: number, joinedAt: number }[] = [];
  let activeMatches = new Map<number, { 
    opponent: any, 
    playerColor: number, 
    opponentColor: number,
    moves: number[],
    lastMoveAt: number,
    p1_avatar: number,
    p2_avatar: number
  }>();

  // API Routes
  app.post("/api/user/update-username", async (req, res) => {
    const { userId, newUsername } = req.body;
    try {
      const result = await pool.query(
        "UPDATE users SET username = $1 WHERE id = $2 RETURNING id, username, elo, avatar_id",
        [newUsername, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ success: true, user: result.rows[0] });
    } catch (err: any) {
      if (err.code === '23505') {
        return res.status(400).json({ error: "Username already exists" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/user/update-avatar", async (req, res) => {
    const { userId, avatarId } = req.body;
    try {
      const result = await pool.query(
        "UPDATE users SET avatar_id = $1 WHERE id = $2 RETURNING id, username, elo, avatar_id",
        [avatarId, userId]
      );
      
      // Update active match if exists
      const match = activeMatches.get(userId);
      if (match) {
        if (match.playerColor === 1) match.p1_avatar = avatarId;
        else match.p2_avatar = avatarId;
      }

      res.json({ success: true, user: result.rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/user/heartbeat", async (req, res) => {
    const { userId } = req.body;
    try {
      await pool.query("UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = $1", [userId]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/user/status/:userId", async (req, res) => {
    try {
      const result = await pool.query("SELECT last_active FROM users WHERE id = $1", [req.params.userId]);
      if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
      
      const lastActive = new Date(result.rows[0].last_active).getTime();
      const now = Date.now();
      const isOnline = (now - lastActive) < 10000; // 10 seconds threshold
      
      res.json({ isOnline });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    const { username, password } = req.body;
    try {
      const result = await pool.query(
        "INSERT INTO users (username, password, elo, avatar_id) VALUES ($1, $2, 1500, 0) RETURNING id, username, elo, avatar_id",
        [username, password]
      );
      res.json({ success: true, user: result.rows[0] });
    } catch (err: any) {
      if (err.code === '23505') {
        return res.status(400).json({ error: "Username already exists" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    try {
      const result = await pool.query(
        "SELECT id, username, password, elo, avatar_id FROM users WHERE username = $1",
        [username]
      );
      if (result.rows.length === 0 || result.rows[0].password !== password) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const { password: _, ...user } = result.rows[0];
      res.json({ success: true, user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/leaderboard", async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT id, username, elo, avatar_id FROM users ORDER BY elo DESC"
      );
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/chat/messages", async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT m.id, m.content, m.created_at, u.username, u.avatar_id 
         FROM messages m 
         JOIN users u ON m.user_id = u.id 
         ORDER BY m.created_at DESC LIMIT 50`
      );
      res.json(result.rows.reverse());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/chat/send", async (req, res) => {
    const { userId, content } = req.body;
    try {
      await pool.query(
        "INSERT INTO messages (user_id, content) VALUES ($1, $2)",
        [userId, content]
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/user/matches/:userId", async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT m.*, 
                u1.username as p1_username, u1.avatar_id as p1_avatar,
                u2.username as p2_username, u2.avatar_id as p2_avatar
         FROM matches m
         LEFT JOIN users u1 ON m.p1_id = u1.id
         LEFT JOIN users u2 ON m.p2_id = u2.id
         WHERE m.p1_id = $1 OR m.p2_id = $1
         ORDER BY m.created_at DESC LIMIT 20`,
        [req.params.userId]
      );
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/matchmaking/join", (req, res) => {
    const { userId, username, elo, avatarId } = req.body;
    // Remove if already in queue or active matches
    matchmakingQueue = matchmakingQueue.filter(u => u.userId !== userId);
    activeMatches.delete(userId);
    
    // Check if someone else is waiting
    if (matchmakingQueue.length > 0) {
      const opponent = matchmakingQueue.shift()!;
      
      // Randomize colors
      const player1IsRed = Math.random() > 0.5;
      const p1Color = player1IsRed ? 1 : 2;
      const p2Color = player1IsRed ? 2 : 1;

      // Store for both players
      const matchData = {
        moves: [],
        lastMoveAt: Date.now(),
        p1_avatar: player1IsRed ? avatarId : opponent.avatarId,
        p2_avatar: player1IsRed ? opponent.avatarId : avatarId
      };

      activeMatches.set(opponent.userId, { 
        ...matchData,
        opponent: { userId, username, elo, avatarId }, 
        playerColor: p2Color, 
        opponentColor: p1Color 
      });

      activeMatches.set(userId, {
        ...matchData,
        opponent: { userId: opponent.userId, username: opponent.username, elo: opponent.elo, avatarId: opponent.avatarId },
        playerColor: p1Color,
        opponentColor: p2Color
      });

      // Found a match!
      return res.json({ 
        success: true, 
        matchFound: true, 
        opponent, 
        playerColor: p1Color, 
        opponentColor: p2Color 
      });
    }

    // Join queue
    matchmakingQueue.push({ userId, username, elo, avatarId, joinedAt: Date.now() });
    res.json({ success: true, matchFound: false });
  });

  app.post("/api/matchmaking/poll", (req, res) => {
    const { userId } = req.body;
    const match = activeMatches.get(userId);
    if (match && match.opponent) {
      return res.json({ success: true, matchFound: true, ...match });
    }
    res.json({ success: true, matchFound: false });
  });

  app.post("/api/match/move", (req, res) => {
    const { userId, col } = req.body;
    const match = activeMatches.get(userId);
    if (!match) return res.status(404).json({ error: "Match not found" });

    match.moves.push(col);
    match.lastMoveAt = Date.now();

    // Update the opponent's match state too
    const opponentMatch = activeMatches.get(match.opponent.userId);
    if (opponentMatch) {
      opponentMatch.moves.push(col);
      opponentMatch.lastMoveAt = Date.now();
    }

    res.json({ success: true });
  });

  app.get("/api/match/status/:userId", (req, res) => {
    const userId = parseInt(req.params.userId);
    const match = activeMatches.get(userId);
    if (!match) return res.status(404).json({ error: "Match not found" });

    res.json({
      moves: match.moves,
      p1_avatar: match.p1_avatar,
      p2_avatar: match.p2_avatar,
      lastMoveAt: match.lastMoveAt,
      serverTime: Date.now()
    });
  });

  app.post("/api/matchmaking/leave", (req, res) => {
    const { userId } = req.body;
    matchmakingQueue = matchmakingQueue.filter(u => u.userId !== userId);
    res.json({ success: true });
  });

  app.post("/api/elo/update", async (req, res) => {
    const { userId, opponentId, winnerId, isBot } = req.body;
    try {
      const userRes = await pool.query("SELECT elo FROM users WHERE id = $1", [userId]);
      let userElo = userRes.rows[0].elo;
      
      let opponentElo = 1500;
      if (!isBot) {
        const oppRes = await pool.query("SELECT elo FROM users WHERE id = $1", [opponentId]);
        opponentElo = oppRes.rows[0].elo;
      } else {
        // Bot ELOs as defined by user
        // 500 (D2), 1000 (D4), 1500 (D6), 2000 (D8), 2500 (D10)
        opponentElo = opponentId; // We'll pass the bot's ELO as opponentId for simplicity
      }

      const kFactor = 32;
      const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - userElo) / 400));
      const actualScore = winnerId === userId ? 1 : (winnerId === null ? 0.5 : 0);
      
      const newElo = Math.round(userElo + kFactor * (actualScore - expectedScore));
      
      await pool.query("UPDATE users SET elo = $1 WHERE id = $2", [newElo, userId]);
      
      res.json({ success: true, newElo });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", database: "connected" });
    } catch (err) {
      console.error("Health check failed:", err);
      res.status(500).json({ status: "error", database: "disconnected", error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/debug/counts", async (req, res) => {
    try {
      const matches = await pool.query("SELECT COUNT(*) FROM matches");
      const moves = await pool.query("SELECT COUNT(*) FROM moves");
      const weights = await pool.query("SELECT COUNT(*) FROM nnue_weights");
      
      const tables = await pool.query(`
        SELECT table_schema, table_name 
        FROM information_schema.tables 
        WHERE table_name = 'kaggle_training_data_1'
      `);
      
      let kaggleCount = '0';
      let kaggleError = null;
      let kaggleColumns = [];
      let kaggleSchema = 'public';
      let kaggleSample = null;
      
      if (tables.rows.length > 0) {
        kaggleSchema = tables.rows[0].table_schema;
        try {
          const kaggle = await pool.query(`SELECT COUNT(*) FROM "${kaggleSchema}"."kaggle_training_data_1"`);
          kaggleCount = kaggle.rows[0].count;
          
          const columns = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'kaggle_training_data_1' AND table_schema = $1
          `, [kaggleSchema]);
          kaggleColumns = columns.rows.map(r => r.column_name);

          if (kaggleCount !== '0') {
            const sample = await pool.query(`SELECT * FROM "${kaggleSchema}"."kaggle_training_data_1" LIMIT 1`);
            kaggleSample = sample.rows[0];
          }
        } catch (e) {
          kaggleError = e instanceof Error ? e.message : String(e);
        }
      } else {
        kaggleError = "Table 'kaggle_training_data_1' not found in any schema.";
      }
      
      const allTables = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      
      res.json({
        matches: matches.rows[0].count,
        moves: moves.rows[0].count,
        weights: weights.rows[0].count,
        kaggle: kaggleCount,
        kaggleError: kaggleError,
        kaggleColumns: kaggleColumns,
        kaggleSchema: kaggleSchema,
        kaggleSample: kaggleSample,
        tables: allTables.rows.map(r => r.table_name)
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/nnue/init", async (req, res) => {
    try {
      // Clear existing weights first
      await pool.query("DELETE FROM nnue_weights");
      
      const defaultWeights = {
        brain: {
          levels: [
            {
              inputs: new Array(84).fill(0),
              outputs: new Array(16).fill(0),
              biases: new Array(16).fill(0).map(() => Math.random() * 0.2 - 0.1),
              weights: new Array(84).fill(0).map(() => new Array(16).fill(0).map(() => Math.random() * 0.2 - 0.1))
            },
            {
              inputs: new Array(16).fill(0),
              outputs: new Array(1).fill(0),
              biases: [0.0],
              weights: new Array(16).fill(0).map(() => [Math.random() * 0.2 - 0.1])
            }
          ]
        }
      };
      await pool.query("INSERT INTO nnue_weights (layer_name, weights) VALUES ('kaggle', $1), ('user', $1), ('both', $1)", [JSON.stringify(defaultWeights)]);
      res.json({ success: true });
    } catch (err) {
      console.error("Error initializing weights:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/save-match", async (req, res) => {
    const { p1Depth, p2Depth, pairingId, winner, moves, category = 'general' } = req.body;
    
    try {
      const matchResult = await pool.query(
        "INSERT INTO matches (p1_depth, p2_depth, pairing_id, winner, category) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [p1Depth, p2Depth, pairingId, winner, category]
      );
      
      const matchId = matchResult.rows[0].id;
      
      // Prepare bulk insert for moves
      const moveValues = moves.map((m: any, index: number) => [
        matchId,
        index,
        JSON.stringify(m.board),
        m.move,
        m.result
      ]);

      // Simple iterative insert for now, could be optimized with a single query
      for (const vals of moveValues) {
        await pool.query(
          "INSERT INTO moves (match_id, move_number, board_state, move_made, final_result) VALUES ($1, $2, $3, $4, $5)",
          vals
        );
      }

      res.json({ success: true, matchId });
    } catch (err) {
      console.error("Error saving match:", err);
      res.status(500).json({ error: "Failed to save match" });
    }
  });

  app.post("/api/clear-matches", async (req, res) => {
    try {
      // Delete from moves first to handle potential foreign key constraints
      // then delete from matches.
      await pool.query("DELETE FROM moves");
      await pool.query("DELETE FROM matches");
      res.json({ success: true });
    } catch (err) {
      console.error("Error clearing matches:", err);
      res.status(500).json({ error: "Failed to clear matches" });
    }
  });

  app.get("/api/matches", async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM matches ORDER BY created_at DESC LIMIT 50");
      res.json(result.rows);
    } catch (err) {
      console.error("Error fetching matches:", err);
      res.status(500).json({ error: "Failed to fetch matches" });
    }
  });

  app.get("/api/match/:id", async (req, res) => {
    try {
      const match = await pool.query("SELECT * FROM matches WHERE id = $1", [req.params.id]);
      const moves = await pool.query("SELECT * FROM moves WHERE match_id = $1 ORDER BY move_number ASC", [req.params.id]);
      res.json({ match: match.rows[0], moves: moves.rows });
    } catch (err) {
      console.error("Error fetching match details:", err);
      res.status(500).json({ error: "Failed to fetch match details" });
    }
  });

  // --- NNUE Weights & Training ---
  app.get('/api/nnue/weights', async (req, res) => {
    const source = req.query.source || 'both';
    try {
      const result = await pool.query('SELECT * FROM nnue_weights WHERE layer_name = $1 ORDER BY updated_at DESC LIMIT 1', [source]);
      if (result.rows.length === 0) {
        // Default weights (84 -> 16 -> 1)
        const defaultWeights = {
          brain: {
            levels: [
              {
                inputs: new Array(84).fill(0),
                outputs: new Array(16).fill(0),
                biases: new Array(16).fill(0).map(() => Math.random() * 0.2 - 0.1),
                weights: new Array(84).fill(0).map(() => new Array(16).fill(0).map(() => Math.random() * 0.2 - 0.1))
              },
              {
                inputs: new Array(16).fill(0),
                outputs: new Array(1).fill(0),
                biases: [0.0],
                weights: new Array(16).fill(0).map(() => [Math.random() * 0.2 - 0.1])
              }
            ]
          }
        };
        return res.json(defaultWeights);
      }
      res.json(result.rows[0].weights);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/nnue/weights', async (req, res) => {
    try {
      const { weights, source = 'both' } = req.body;
      // Use UPSERT logic: Try to update the specific source layer first
      const result = await pool.query(
        'UPDATE nnue_weights SET weights = $1, updated_at = CURRENT_TIMESTAMP WHERE layer_name = $2',
        [JSON.stringify(weights), source]
      );
      
      // If no row was updated, it means the source doesn't exist yet, so insert it
      if (result.rowCount === 0) {
        await pool.query(
          'INSERT INTO nnue_weights (layer_name, weights) VALUES ($1, $2)',
          [source, JSON.stringify(weights)]
        );
      }
      
      res.json({ success: true });
    } catch (err) {
      console.error("Error saving weights:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/nnue/training-data', async (req, res) => {
    const source = req.query.source || 'both';
    const category = req.query.category; // Optional: 'specialized' or 'general'
    try {
      let userMoves = [];
      let kaggleMoves = [];

      // 1. Get user moves from our own database
      if (source === 'user' || source === 'both') {
        const limit = source === 'user' ? 5000 : 2500;
        let query = `
          SELECT m.board_state, m.final_result 
          FROM moves m
          JOIN matches mt ON m.match_id = mt.id
          WHERE m.board_state IS NOT NULL AND m.final_result IS NOT NULL
        `;
        const params: any[] = [limit];
        
        if (category) {
          query += ` AND mt.category = $2`;
          params.push(category);
        }
        
        query += ` ORDER BY RANDOM() LIMIT $1`;

        const userMovesResult = await pool.query(query, params);
        
        userMoves = userMovesResult.rows.map(row => {
          // Normalize board state to use 1 and 2
          const normalizedBoard = row.board_state.map((r: any) => 
            r.map((cell: any) => {
              if (cell === 1 || cell === '1' || cell === 'x') return 1;
              if (cell === 2 || cell === '2' || cell === 'o' || cell === -1 || cell === '-1') return 2;
              return null;
            })
          );
          
          // Normalize result: 1 for P1 win, -1 for P2 win
          let normalizedResult = 0;
          if (row.final_result === 1 || row.final_result === '1' || row.final_result === 'win') normalizedResult = 1;
          if (row.final_result === 2 || row.final_result === '2' || row.final_result === 'loss' || row.final_result === -1 || row.final_result === '-1') normalizedResult = -1;
          
          return { board_state: normalizedBoard, final_result: normalizedResult };
        });
      }

      // 2. Get Kaggle moves
      if (source === 'kaggle' || source === 'both') {
        const limit = source === 'kaggle' ? 5000 : 2500;
        // Find the schema for the kaggle table
        const tableCheck = await pool.query(`
          SELECT table_schema 
          FROM information_schema.tables 
          WHERE table_name = 'kaggle_training_data_1'
          LIMIT 1
        `);
        
        const schema = tableCheck.rows.length > 0 ? tableCheck.rows[0].table_schema : 'public';
        
        // Check columns to be sure
        const columnCheck = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'kaggle_training_data_1' AND table_schema = $1
        `, [schema]);
        
        const columns = columnCheck.rows.map(r => r.column_name);
        const hasBoardState = columns.includes('board_state');
        const hasFinalResult = columns.includes('final_result');
        
        if (hasBoardState && hasFinalResult) {
          const result = await pool.query(`
            SELECT board_state, final_result 
            FROM "${schema}"."kaggle_training_data_1" 
            WHERE board_state IS NOT NULL AND final_result IS NOT NULL
            ORDER BY RANDOM() LIMIT $1
          `, [limit]);
          
          kaggleMoves = result.rows.map(row => {
            // Normalize board state to use 1 and 2
            const normalizedBoard = row.board_state.map((r: any) => 
              r.map((cell: any) => {
                if (cell === 1 || cell === '1' || cell === 'x') return 1;
                if (cell === 2 || cell === '2' || cell === 'o' || cell === -1 || cell === '-1') return 2;
                return null;
              })
            );
            
            // Normalize result: 1 for P1 win, -1 for P2 win
            let normalizedResult = 0;
            if (row.final_result === 1 || row.final_result === '1' || row.final_result === 'win') normalizedResult = 1;
            if (row.final_result === 2 || row.final_result === '2' || row.final_result === 'loss' || row.final_result === -1 || row.final_result === '-1') normalizedResult = -1;
            
            return { board_state: normalizedBoard, final_result: normalizedResult };
          });
        } else {
          // Handle Kaggle schema: pos_01...pos_42, winner
          const posColumns = columns.filter(c => c.startsWith('pos_')).sort();
          const hasWinner = columns.includes('winner');

          if (posColumns.length === 42 && hasWinner) {
            const query = `SELECT ${posColumns.join(', ')}, winner FROM "${schema}"."kaggle_training_data_1" ORDER BY RANDOM() LIMIT $1`;
            const result = await pool.query(query, [limit]);
            
            kaggleMoves = result.rows.map(row => {
              // Map board state: 'x' -> 1, 'o' -> -1, 'b' -> 0 (or 1, 2, 0)
              const flat_board = posColumns.map(col => {
                const val = row[col];
                if (val === 'x' || val === 1 || val === '1') return 1;
                if (val === 'o' || val === 2 || val === -1 || val === '2' || val === '-1') return 2; // Use 2 for player 2
                return null; // Use null for empty
              });

              // Reshape into 6x7 2D array (Board type)
              const board_state = [];
              for (let r = 0; r < 6; r++) {
                board_state.push(flat_board.slice(r * 7, (r + 1) * 7));
              }

              // Map result: 'win' -> 1, 'loss' -> -1, 'draw' -> 0
              let final_result = 0;
              const w = row.winner;
              if (w === 'win' || w === 1 || w === '1') final_result = 1;
              if (w === 'loss' || w === 2 || w === -1 || w === '2' || w === '-1') final_result = -1;

              return { board_state, final_result };
            });
          }
        }
      }

      // 3. Combine both sources
      const allMoves = [...userMoves, ...kaggleMoves];
      
      if (allMoves.length === 0) {
        return res.status(400).json({ 
          error: `No training data found for source '${source}'.` 
        });
      }

      res.json(allMoves);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
