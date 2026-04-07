/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, Play, RotateCcw, Cpu, User as UserIcon, ChevronRight, Activity, Trophy, Brain, Database, Eye, LayoutGrid, Binary, ArrowRight, Zap, Target, Upload, FileText, Copy, Check, Search, Users, Shield, LogOut, Clock, ChevronLeft, Star, TriangleAlert as AlertTriangle, Circle as HelpCircle, Circle as XCircle, History } from 'lucide-react';
import { Board as BoardType, Player, ROWS, COLS, GameState, AIConfig, ParallelGameState } from './types';
import { 
  createEmptyBoard, 
  isValidMove, 
  dropPiece, 
  checkWinner, 
  minimax,
  toBitboard,
  getValidMoves
} from './logic/connect4';
import { getLLMPrompt } from './logic/export';
import { fetchNNUEWeights, evaluateNNUE, setWeights, NNUEWeights, getNNUEInput } from './logic/nnue';
import { trainNNUE as trainNNUEGenerator, TrainingProgress } from './logic/training';
import Board, { MoveQuality } from './components/Board';
import { NNUEVisualizer } from './components/NNUEVisualizer';
import Auth from './components/Auth';
import AIWorker from './logic/ai.worker?worker';

type GameMode = 'human-vs-ai' | 'ai-vs-ai' | 'human-vs-human' | 'parallel-generator' | 'matchmaking';

const AVATARS = [
  { id: 0, name: 'Default', icon: '🤖' },
  { id: 1, name: 'Cyber', icon: '🦾' },
  { id: 2, name: 'Core', icon: '🧠' },
  { id: 3, name: 'Pulse', icon: '⚡' },
  { id: 4, name: 'Void', icon: '🌌' },
  { id: 5, name: 'Neon', icon: '🌈' },
  { id: 6, name: 'Titan', icon: '🛡️' },
  { id: 7, name: 'Swift', icon: '🦅' },
];

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [isMatchmaking, setIsMatchmaking] = useState(false);
  const [matchmakingTimer, setMatchmakingTimer] = useState(0);
  const [opponent, setOpponent] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [evaluation, setEvaluation] = useState(0); // -100 to 100
  const [lastMoveQuality, setLastMoveQuality] = useState<{ row: number, col: number, quality: MoveQuality } | null>(null);
  const [previousEval, setPreviousEval] = useState(0);

  const [gameState, setGameState] = useState<GameState>({
    board: createEmptyBoard(),
    currentPlayer: 1,
    winner: null,
    isThinking: false,
    moves: [],
  });

  const [mode, setMode] = useState<GameMode>('human-vs-ai');
  const [humanColor, setHumanColor] = useState<1 | 2>(1);
  const [ai1Config, setAi1Config] = useState<AIConfig>({ depth: 10, botType: 'nnue' });
  const [ai2Config, setAi2Config] = useState<AIConfig>({ depth: 10, botType: 'nnue' });
  const [nnueWeights, setNnueWeights] = useState<any>(null);
  const [trainingEpochs, setTrainingEpochs] = useState(5);
  const [focusMode, setFocusMode] = useState(false);
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [stats, setStats] = useState({ p1Wins: 0, p2Wins: 0, draws: 0 });
  const [viewMode, setViewMode] = useState<'visual' | 'data'>('visual');
  const [activeTab, setActiveTab] = useState<'arena' | 'leaderboard' | 'game' | 'generator' | 'viewer' | 'nnue'>('arena');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userMatches, setUserMatches] = useState<any[]>([]);
  const [isMatchHistoryOpen, setIsMatchHistoryOpen] = useState(false);
  const [isAutoMoving, setIsAutoMoving] = useState(false);
  const [currentBotDepth, setCurrentBotDepth] = useState(4);
  const [isOpponentOnline, setIsOpponentOnline] = useState(true);
  const [isTraining, setIsTraining] = useState(false);
  const [moveTimer, setMoveTimer] = useState(25);
  const [lastMoveAt, setLastMoveAt] = useState<number>(Date.now());
  const [serverOffset, setServerOffset] = useState<number>(0);
  const [gameTimer, setGameTimer] = useState(180); // 3 minutes
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isMatchActive, setIsMatchActive] = useState(false);
  const [matchResult, setMatchResult] = useState<'win' | 'loss' | 'draw' | null>(null);
  const [trainingSource, setTrainingSource] = useState<'kaggle' | 'user' | 'both'>('both');
  const [activeBrainSource, setActiveBrainSource] = useState<'kaggle' | 'user' | 'both'>('both');
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [trainingStats, setTrainingStats] = useState<any>(null);
  const [trainingProgress, setTrainingProgress] = useState<TrainingProgress | null>(null);
  const [kaggleData, setKaggleData] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importResult, setImportResult] = useState<{ count: number } | null>(null);
  const [dbCounts, setDbCounts] = useState({ matches: 0, moves: 0, weights: 0, kaggle: 0, kaggleError: null as string | null });
  const [showCopiedToast, setShowCopiedToast] = useState(false);

  const isAdmin = user?.username === 'mathias_cheow';

  useEffect(() => {
    const savedUser = localStorage.getItem('c4_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
  }, []);

  const updateAvatar = async (avatarId: number) => {
    if (!user) return;
    // Reset move timer when interacting to prevent bot takeover
    if (isMatchActive && gameState.currentPlayer === humanColor) {
      setLastMoveAt(Date.now() + serverOffset);
    }
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api/user/update`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, avatarId }),
      });
      const data = await res.json();
      if (data.success) {
        const updatedUser = { ...user, avatar_id: avatarId };
        setUser(updatedUser);
        localStorage.setItem('c4_user', JSON.stringify(updatedUser));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchUserMatches = async (userId: string) => {
    try {
      const res = await fetch(`/api/user/matches/${userId}`);
      const data = await res.json();
      setUserMatches(data);
      setIsMatchHistoryOpen(true);
    } catch (err) {
      console.error(err);
    }
  };

  const cancelMatchmaking = () => {
    setIsMatchmaking(false);
    setMatchmakingTimer(30);
  };

  const fetchLeaderboard = useCallback(async () => {
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api/leaderboard`;
      const res = await fetch(apiUrl);
      const data = await res.json();
      setLeaderboard(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'leaderboard') {
      fetchLeaderboard();
    }
  }, [activeTab, fetchLeaderboard]);

  const startMatchmaking = () => {
    if (!user) return;
    setIsMatchmaking(true);
    setMatchmakingTimer(30);
    setMode('matchmaking');
    setOpponent(null);
    
    fetch('/api/matchmaking/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, username: user.username, elo: user.elo, avatarId: user.avatar_id }),
    })
    .then(res => res.json())
    .then(data => {
      if (data.matchFound) {
        setOpponent(data.opponent);
        setIsOpponentOnline(true);
        setHumanColor(data.playerColor);
        setIsMatchmaking(false);
        setIsMatchActive(true);
        setIsGameRunning(true);
        setLastMoveAt(Date.now() + serverOffset);
        setGameTimer(180);
        resetGame();
      }
    });
  };

  useEffect(() => {
    let pollInterval: any;
    if (isMatchmaking && !opponent && user) {
      pollInterval = setInterval(() => {
        fetch('/api/matchmaking/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id }),
        })
        .then(res => res.json())
        .then(data => {
          if (data.matchFound) {
            setOpponent(data.opponent);
            setIsOpponentOnline(true);
            setHumanColor(data.playerColor);
            setIsMatchmaking(false);
            setIsMatchActive(true);
            setIsGameRunning(true);
            setLastMoveAt(Date.now() + serverOffset);
            setIsAutoMoving(false);
            setGameTimer(180);
            resetGame();
          }
        });
      }, 1000);
    }
    return () => clearInterval(pollInterval);
  }, [isMatchmaking, opponent, user]);

  useEffect(() => {
    let interval: any;
    if (isMatchmaking && user) {
      interval = setInterval(() => {
        setMatchmakingTimer(prev => {
          if (prev <= 0) {
            // Match with bot
            setIsMatchmaking(false);
            setIsOpponentOnline(true);
            const botElos = [500, 1000, 1500, 2000, 2500];
            const botElo = botElos.find(e => e >= user.elo) || 2500;
            const botDepth = botElo === 500 ? 2 : botElo === 1000 ? 4 : botElo === 1500 ? 6 : botElo === 2000 ? 8 : 10;
            
            const BOT_NAMES = ["Arthur", "Elena", "Marcus", "Sophia", "Julian", "Isabella", "Victor", "Clara", "Strategy_King", "Deep_Connect", "Sovereign_Chess", "Master_Mind", "Logic_Lord", "Alex_92", "Sarah_Pro", "Chris_Connect", "Emma_Win", "David_Drop"];
            const randomName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];

            setOpponent({ 
              username: randomName, 
              elo: botElo, 
              isBot: true, 
              depth: botDepth 
            });
            setAi2Config({ depth: botDepth, botType: 'nnue' });
            
            // Randomize colors for bot match too
            const playerIsRed = Math.random() > 0.5;
            setHumanColor(playerIsRed ? 1 : 2);
            
            setIsMatchActive(true);
            setIsGameRunning(true);
            setLastMoveAt(Date.now() + serverOffset);
            setGameTimer(180);
            resetGame();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isMatchmaking, user]);

  useEffect(() => {
    let heartbeat: any;
    if (user && isMatchActive) {
      heartbeat = setInterval(() => {
        fetch('/api/user/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id }),
        }).catch(console.error);
      }, 5000);
    }
    return () => clearInterval(heartbeat);
  }, [user?.id, isMatchActive]);

  // Timers Logic
  useEffect(() => {
    let timer: any;
    if (isMatchActive && !gameState.winner) {
      timer = setInterval(() => {
        setGameTimer(prev => {
          if (prev <= 0) {
            // Game Timeout
            setGameState(g => ({ ...g, winner: g.currentPlayer === 1 ? 2 : 1 }));
            return 0;
          }
          return prev - 1;
        });

        setMoveTimer(() => {
          const now = Date.now();
          const serverNow = now + serverOffset;
          const elapsed = (serverNow - lastMoveAt) / 1000;
          const remaining = Math.max(0, 25 - elapsed);

          if (remaining <= 5 && !isAutoMoving && !gameState.winner) {
            const isMyTurn = gameState.currentPlayer === humanColor;
            
            if (isMyTurn) {
              // Bot take over at 5s remaining
              const depth = user.elo < 1000 ? 2 : user.elo < 1500 ? 4 : user.elo < 2000 ? 6 : 8;
              setCurrentBotDepth(depth);
              setIsAutoMoving(true);
              setGameState(g => ({ ...g, isThinking: true }));
            } else if (opponent && !opponent.isBot) {
              // Opponent's turn, check if they are offline
              fetch(`/api/user/status/${opponent.id}`)
                .then(res => res.json())
                .then(data => {
                  if (!data.isOnline) {
                    // Opponent is offline, move for them
                    const depth = opponent.elo < 1000 ? 2 : opponent.elo < 1500 ? 4 : opponent.elo < 2000 ? 6 : 8;
                    setCurrentBotDepth(depth);
                    setIsAutoMoving(true);
                    setGameState(g => ({ ...g, isThinking: true }));
                  }
                })
                .catch(console.error);
              
              // If they hit 5s, we move for them anyway if they are not moving
              const depth = opponent.elo < 1000 ? 2 : opponent.elo < 1500 ? 4 : opponent.elo < 2000 ? 6 : 8;
              setCurrentBotDepth(depth);
              setIsAutoMoving(true);
              setGameState(g => ({ ...g, isThinking: true }));
            }
          }
          return Math.floor(remaining);
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isMatchActive, gameState.winner, gameState.currentPlayer, humanColor, gameState.board, user?.elo, isAutoMoving, opponent, serverOffset, lastMoveAt]);

  useEffect(() => {
    if (!isMatchActive || !opponent || opponent.isBot || gameState.winner) return;
    
    const isMyTurn = gameState.currentPlayer === humanColor;
    if (!isMyTurn) {
      // Check opponent status immediately when turn changes
      fetch(`/api/user/status/${opponent.id}`)
        .then(res => res.json())
        .then(data => setIsOpponentOnline(data.isOnline))
        .catch(console.error);
    }
  }, [gameState.currentPlayer, isMatchActive, opponent, humanColor, gameState.winner]);

  const updateUsername = async () => {
    if (!user || !newUsername.trim()) return;
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api/user/update`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, newUsername }),
      });
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        localStorage.setItem('c4_user', JSON.stringify(data.user));
        setIsSettingsOpen(false);
      } else {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const updateElo = async (winnerId: number | null) => {
    if (!user || mode !== 'matchmaking') return;
    
    try {
      // Save the match first
      const matchData = {
        p1_id: humanColor === 1 ? user.id : opponent.id,
        p1_username: humanColor === 1 ? user.username : opponent.username,
        p1_elo: humanColor === 1 ? user.elo : opponent.elo,
        p1_avatar: humanColor === 1 ? user.avatar_id : opponent.avatar_id,
        p2_id: humanColor === 2 ? user.id : opponent.id,
        p2_username: humanColor === 2 ? user.username : opponent.username,
        p2_elo: humanColor === 2 ? user.elo : opponent.elo,
        p2_avatar: humanColor === 2 ? user.avatar_id : opponent.avatar_id,
        winner: winnerId,
        moves: gameState.moves,
        category: 'arena'
      };

      await fetch('/api/save-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(matchData),
      });

      const res = await fetch('/api/elo/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          opponentId: opponent.isBot ? opponent.elo : opponent.id,
          winnerId,
          isBot: opponent.isBot
        }),
      });
      const data = await res.json();
      if (data.success) {
        const updatedUser = { ...user, elo: data.newElo };
        setUser(updatedUser);
        localStorage.setItem('c4_user', JSON.stringify(updatedUser));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchCounts = useCallback(() => {
    fetch('/api/debug/counts')
      .then(res => res.json())
      .then(data => {
        setDbCounts(data);
        console.log("Database Tables:", data.tables);
        if (data.kaggleError) {
          console.error("Kaggle Table Error:", data.kaggleError);
        } else {
          console.log("Kaggle Table Columns:", data.kaggleColumns);
          console.log("Kaggle Sample Row:", data.kaggleSample);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // Parallel Generator State
  const [parallelGames, setParallelGames] = useState<ParallelGameState[]>(
    Array.from({ length: 10 }, (_, i) => ({
      id: i,
      board: createEmptyBoard(),
      currentPlayer: 1,
      winner: null,
      isThinking: false,
      moves: [],
      p1Depth: 2,
      p2Depth: 2,
      status: 'idle'
    }))
  );

  const [recentMatches, setRecentMatches] = useState<any[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<any | null>(null);
  const [playbackIndex, setPlaybackIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [isSelfPlay, setIsSelfPlay] = useState(false);
  const [isTrainerVsNNUE, setIsTrainerVsNNUE] = useState(false);
  const [isSpecializedRecording, setIsSpecializedRecording] = useState(false);
  const [pendingPairings, setPendingPairings] = useState<{p1: number, p2: number}[]>([]);
  const [completedCount, setCompletedCount] = useState(0);

  const [isResetting, setIsResetting] = useState(false);

  // Refs to track in-progress operations to prevent infinite loops
  const savingGamesRef = useRef<Set<number>>(new Set());
  const thinkingGamesRef = useRef<Set<number>>(new Set());

  // Fetch NNUE Weights
  const fetchWeights = useCallback(async () => {
    try {
      const response = await fetch(`/api/nnue/weights?t=${Date.now()}`);
      const data = await response.json();
      if (data.brain) {
        setNnueWeights(data);
        setWeights(data);
      } else {
        // Fallback to random initialization if no weights
        const initialWeights: NNUEWeights = {
          brain: {
            levels: [
              {
                biases: Array(16).fill(0).map(() => Math.random() * 0.2 - 0.1),
                inputs: Array(84).fill(0),
                outputs: Array(16).fill(0),
                weights: Array(84).fill(0).map(() => Array(16).fill(0).map(() => Math.random() * 0.2 - 0.1))
              },
              {
                biases: [Math.random() * 0.2 - 0.1],
                inputs: Array(16).fill(0),
                outputs: [0],
                weights: Array(16).fill(0).map(() => [Math.random() * 0.2 - 0.1])
              }
            ]
          }
        };
        setNnueWeights(initialWeights);
        setWeights(initialWeights);
      }
    } catch (err) {
      console.error('Failed to fetch weights:', err);
    }
  }, []);

  useEffect(() => {
    fetchWeights();
  }, [fetchWeights]);

  const importKaggleData = async (dataToImport?: string) => {
    const data = dataToImport || kaggleData;
    if (!data.trim()) return;
    setIsImporting(true);
    try {
      const res = await fetch('/api/nnue/import-kaggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawData: data })
      });
      
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Server responded with ${res.status}: ${text.slice(0, 100)}`);
      }

      const result = await res.json();
      if (result.success) {
        setImportResult({ count: result.imported });
        setKaggleData('');
        fetchCounts();
        setTimeout(() => setImportResult(null), 5000);
      }
    } catch (err) {
      console.error("Import failed:", err);
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
      alert("Please upload a .csv or .txt file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      importKaggleData(content);
    };
    reader.readAsText(file);
  };

  const trainNNUE = async (category?: string) => {
    setIsTraining(true);
    setTrainingError(null);
    setTrainingProgress(null);
    try {
      // 1. Fetch training data
      let url = `/api/nnue/training-data?source=${trainingSource}`;
      if (category) {
        url += `&category=${category}`;
      }
      const response = await fetch(url);
      const moves = await response.json();
      
      if (!Array.isArray(moves)) {
        throw new Error(`Failed to fetch training data: ${moves.error || 'Unknown error'}`);
      }
      
      if (moves.length === 0) {
        alert("No training data available. Play some games or import Kaggle data first!");
        setIsTraining(false);
        return;
      }

      // 2. Start training generator
      const generator = trainNNUEGenerator(moves, nnueWeights, 0.02, trainingEpochs, focusMode);
      
      let lastProgress: TrainingProgress | null = null;
      let count = 0;

      for await (const progress of generator) {
        lastProgress = progress;
        count++;
        
        // Update UI every 10 moves to avoid lag, but every move in focus mode
        if (focusMode || count % 10 === 0) {
          setTrainingProgress(progress);
          setNnueWeights(progress.weights);
          setWeights(progress.weights);
          // Small delay to let UI render
          await new Promise(r => setTimeout(r, focusMode ? 50 : 10));
        }
      }

      if (lastProgress) {
        setTrainingProgress(lastProgress);
        setNnueWeights(lastProgress.weights);
        setWeights(lastProgress.weights);
        
        // 3. Save final weights to server
        await fetch('/api/nnue/weights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weights: lastProgress.weights, source: trainingSource })
        });
        
        // If we just trained the active brain, update it
        if (trainingSource === activeBrainSource) {
          setNnueWeights(lastProgress.weights);
          setWeights(lastProgress.weights);
        }
      }
    } catch (err) {
      console.error('Training failed:', err);
      setTrainingError(err instanceof Error ? err.message : String(err));
      alert(`Training failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsTraining(false);
    }
  };

  const resetWeights = async () => {
    if (!isResetting) {
      setIsResetting(true);
      setTimeout(() => setIsResetting(false), 3000); // Reset confirmation state after 3 seconds
      return;
    }

    try {
      await fetch('/api/nnue/init', { method: 'POST' });
      await fetchWeights();
      setTrainingProgress(null);
      setTrainingStats(null);
      setIsResetting(false);
    } catch (err) {
      console.error('Reset failed:', err);
      setIsResetting(false);
    }
  };
  const singleGameWorkerRef = useRef<Worker | null>(null);
  const workersRef = useRef<Worker[]>([]);
  const executeParallelMoveRef = useRef<any>(null);
  const executeMoveRef = useRef<any>(null);

  const copyBoardForLLM = () => {
    const movesList = gameState.moves.map(m => m.move).filter(m => m !== null) as number[];
    const prompt = getLLMPrompt(gameState.board, gameState.currentPlayer, movesList);
    navigator.clipboard.writeText(prompt);
    setShowCopiedToast(true);
    setTimeout(() => setShowCopiedToast(false), 2000);
  };

  // Parallel Move Execution
  const executeParallelMove = useCallback(async (gameId: number, col: number) => {
    setParallelGames(prev => {
      const game = prev[gameId];
      if (game.winner || !isValidMove(game.board, col)) return prev;

      const newBoard = dropPiece(game.board, col, game.currentPlayer);
      const winResult = checkWinner(newBoard);
      const winner = typeof winResult === 'object' && winResult !== null ? winResult.winner : winResult;
      const newMoves = [...game.moves, { board: game.board, move: col, player: game.currentPlayer }];

      const updatedGame = {
        ...game,
        board: newBoard,
        currentPlayer: game.currentPlayer === 1 ? 2 : 1,
        winner,
        isThinking: false,
        moves: newMoves,
        status: winner ? 'finished' : 'running'
      };

      const newGames = [...prev];
      newGames[gameId] = updatedGame as ParallelGameState;
      return newGames;
    });
    
    // Clear thinking ref so it can think again next turn
    thinkingGamesRef.current.delete(gameId);
  }, []);

  // Switch active brain source
  const switchBrain = async (source: 'kaggle' | 'user' | 'both') => {
    setActiveBrainSource(source);
    const weights = await fetchNNUEWeights(source);
    if (weights) {
      setNnueWeights(weights);
      setWeights(weights);
      console.log(`App: Switched to ${source.toUpperCase()} brain`);
    }
  };

  // Fetch NNUE weights once at startup
  useEffect(() => {
    const loadWeights = async () => {
      const weights = await fetchNNUEWeights(activeBrainSource);
      if (weights) {
        setNnueWeights(weights);
        setWeights(weights);
        console.log(`App: NNUE weights (${activeBrainSource}) loaded in main thread`);
      }
    };
    loadWeights();
  }, [activeBrainSource]);

  // Initialize Worker Pool
  useEffect(() => {
    const pool: Worker[] = [];
    for (let i = 0; i < 10; i++) {
      const worker = new AIWorker();
      worker.onmessage = (e) => {
        const { bestMove, gameId } = e.data;
        if (bestMove !== null) {
          executeParallelMoveRef.current?.(gameId, bestMove);
        } else {
          setParallelGames(prev => {
            const newGames = [...prev];
            newGames[gameId] = { ...newGames[gameId], isThinking: false };
            return newGames;
          });
        }
      };
      pool.push(worker);
    }
    workersRef.current = pool;

    return () => {
      pool.forEach(w => w.terminate());
      if (singleGameWorkerRef.current) {
        singleGameWorkerRef.current.terminate();
      }
    };
  }, []);

  // Fetch Recent Matches
  const fetchMatches = async () => {
    try {
      const res = await fetch('/api/matches');
      const data = await res.json();
      setRecentMatches(data);
    } catch (err) {
      console.error("Failed to fetch matches:", err);
    }
  };

  const clearDatabase = async () => {
    if (!window.confirm("Are you sure you want to clear all matches from the database? This cannot be undone.")) return;
    console.log("Attempting to clear database...");
    try {
      const res = await fetch('/api/clear-matches', { method: 'POST' });
      console.log("Clear database response status:", res.status);
      if (!res.ok) throw new Error("Failed to clear database on server");
      
      setRecentMatches([]);
      setSelectedMatch(null);
      if (typeof fetchMatches === 'function') {
        await fetchMatches();
      }
      alert("Database cleared successfully.");
    } catch (err) {
      console.error("Failed to clear database:", err);
      alert("Failed to clear database. Check console for details.");
    }
  };

  const resetGame = useCallback(() => {
    setGameState({
      board: createEmptyBoard(),
      currentPlayer: 1,
      winner: null,
      isThinking: false,
      moves: [],
    });
    setIsGameRunning(true);
    setLastMoveAt(Date.now() + serverOffset);
    setIsAutoMoving(false);
  }, []);

  // Match Status Polling (Moves & Avatars)
  useEffect(() => {
    let interval: any;
    if (isMatchActive && mode === 'matchmaking' && user && !gameState.winner) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/match/status/${user.id}`);
          const data = await res.json();
          
          if (data.moves) {
            // Sync moves if we're behind
            if (data.moves.length > gameState.moves.length) {
              const nextMove = data.moves[gameState.moves.length];
              executeMove(nextMove);
            }
          }

          if (data.lastMoveAt) {
            setLastMoveAt(data.lastMoveAt);
          }
          if (data.serverTime) {
            setServerOffset(data.serverTime - Date.now());
          }

          // Sync avatars
          if (opponent) {
            const oppAvatarId = humanColor === 1 ? data.p2_avatar : data.p1_avatar;
            if (oppAvatarId !== undefined && oppAvatarId !== opponent.avatar_id) {
              setOpponent((prev: any) => ({ ...prev, avatar_id: oppAvatarId }));
            }
          }
        } catch (err) {
          console.error("Match status poll failed:", err);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isMatchActive, mode, user, gameState.moves.length, gameState.winner, opponent, humanColor]);

  const executeMove = useCallback((col: number) => {
    if (gameState.winner || !isValidMove(gameState.board, col)) return;

    // Reset move timer on every move
    setLastMoveAt(Date.now() + serverOffset);
    setIsAutoMoving(false);

    // If in matchmaking and it was our turn, send move to server
    if (mode === 'matchmaking' && gameState.currentPlayer === humanColor && !opponent?.isBot) {
      fetch('/api/match/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, col })
      }).catch(console.error);
    }

    setGameState(prev => {
      const newBoard = dropPiece(prev.board, col, prev.currentPlayer);
      const winResult = checkWinner(newBoard);
      const winner = typeof winResult === 'object' && winResult !== null ? winResult.winner : winResult;

      return {
        ...prev,
        board: newBoard,
        currentPlayer: prev.currentPlayer === 1 ? 2 : 1,
        winner,
        isThinking: false,
        moves: [...prev.moves, { board: prev.board, move: col, player: prev.currentPlayer }]
      };
    });
  }, [humanColor, mode, user?.id, opponent?.isBot, gameState.winner, gameState.board, gameState.currentPlayer]);

  useEffect(() => {
    executeParallelMoveRef.current = executeParallelMove;
  }, [executeParallelMove]);

  useEffect(() => {
    executeMoveRef.current = executeMove;
  }, [executeMove]);

  // Save Match to Database
  const saveMatch = useCallback(async (game: ParallelGameState) => {
    const finalResult = game.winner === 1 ? 1 : game.winner === 2 ? -1 : 0;
    
    const formattedMoves = game.moves.map(m => {
      if (!m.board || !Array.isArray(m.board)) return null;
      // Convert board to NNUE format: null empty, 1 P1, 2 P2
      const nnueBoard = m.board.map(row => 
        row.map(cell => cell === null ? null : cell === 1 ? 1 : 2)
      );
      return {
        board_state: nnueBoard,
        move: m.move,
        final_result: finalResult
      };
    }).filter(m => m !== null);

    // Add the final terminal state (the board with the win)
    const finalNnueBoard = game.board.map(row => 
      row.map(cell => cell === null ? null : cell === 1 ? 1 : 2)
    );
    formattedMoves.push({
      board_state: finalNnueBoard,
      move: -1, // Special value for terminal state
      final_result: finalResult
    });

    try {
      await fetch('/api/save-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p1Depth: game.p1Depth,
          p2Depth: game.p2Depth,
          pairingId: game.pairingIndex,
          winner: game.winner,
          category: game.category || 'general',
          moves: formattedMoves
        })
      });
    } catch (err) {
      console.error("Failed to save match:", err);
    }
  }, []);

  useEffect(() => {
    if ((activeTab === 'practice' || activeTab === 'game') && gameState.winner && !savingGamesRef.current.has(-1)) {
      const gameToSave: ParallelGameState = {
        ...gameState,
        id: -1, // Special ID for main game
        p1Depth: ai1Config.depth,
        p2Depth: mode === 'human-vs-ai' ? 0 : ai2Config.depth,
        pairingIndex: 0,
        category: isSpecializedRecording ? 'specialized' : 'general',
        status: 'finished'
      };
      savingGamesRef.current.add(-1);
      saveMatch(gameToSave).finally(() => {
        // We don't necessarily need to remove it from the set immediately
        // as the winner will be reset on next game
      });
    }
    
    if (!gameState.winner) {
      savingGamesRef.current.delete(-1);
    }
  }, [gameState.winner, activeTab, saveMatch, ai1Config.depth, ai2Config.depth, mode]);

  // Handle Parallel Game Completion
  useEffect(() => {
    const finishedGames = parallelGames.filter(g => g.status === 'finished' && !savingGamesRef.current.has(g.id));
    if (finishedGames.length === 0) return;

    // Mark as saving in one batch
    finishedGames.forEach(g => savingGamesRef.current.add(g.id));
    
    setParallelGames(prev => {
      const newGames = [...prev];
      let changed = false;
      finishedGames.forEach(game => {
        if (newGames[game.id].status === 'finished') {
          newGames[game.id] = { ...newGames[game.id], status: 'saving' };
          changed = true;
        }
      });
      return changed ? newGames : prev;
    });

    // Process saving and restarting
    finishedGames.forEach(async (game) => {
      try {
        await saveMatch(game);
        setCompletedCount(prev => prev + 1);

        // Restart game with next pairing from queue
        setPendingPairings(prevQueue => {
          const nextQueue = [...prevQueue];
          const nextPairing = nextQueue.shift();

          setParallelGames(prevGames => {
            const newGames = [...prevGames];
            if (nextPairing) {
              newGames[game.id] = {
                id: game.id,
                board: createEmptyBoard(),
                currentPlayer: Math.random() > 0.5 ? 1 : 2,
                winner: null,
                isThinking: false,
                moves: [],
                p1Depth: nextPairing.p1,
                p2Depth: nextPairing.p2,
                pairingIndex: nextPairing.index,
                status: 'running'
              };
            } else if ((isSelfPlay || isTrainerVsNNUE) && completedCount < 100) {
              // Self-play or Trainer vs NNUE continues until 100 games
              newGames[game.id] = {
                id: game.id,
                board: createEmptyBoard(),
                currentPlayer: Math.random() > 0.5 ? 1 : 2,
                winner: null,
                isThinking: false,
                moves: [],
                p1Depth: 6,
                p2Depth: 6,
                pairingIndex: completedCount + 1,
                status: 'running'
              };
            } else {
              // No more pairings, set this slot to idle
              newGames[game.id] = {
                ...newGames[game.id],
                status: 'idle',
                winner: null,
                isThinking: false
              };
            }
            return newGames;
          });

          return nextQueue;
        });
      } catch (err) {
        console.error("Error in game completion loop:", err);
      } finally {
        savingGamesRef.current.delete(game.id);
      }
    });
  }, [parallelGames, saveMatch]);

  // Check if batch is finished
  useEffect(() => {
    if (isBatchRunning && parallelGames.every(g => g.status === 'idle') && pendingPairings.length === 0) {
      setIsBatchRunning(false);
      setIsSelfPlay(false);
      setIsTrainerVsNNUE(false);
      alert(isSelfPlay ? "Self-Play Reinforcement Complete! 100 games generated." : (isTrainerVsNNUE ? "Trainer vs NNUE Complete! 100 games generated." : "Batch Generation Complete! All unique pairings have been processed."));
    }
  }, [parallelGames, isBatchRunning, pendingPairings, isSelfPlay, isTrainerVsNNUE]);

  // Parallel AI Thinking
  useEffect(() => {
    if (activeTab !== 'generator' || !isBatchRunning) return;

    const runningGames = parallelGames.filter(g => g.status === 'running' && !g.isThinking);
    
    if (runningGames.length === 0) return;

    setParallelGames(prev => {
      const newGames = [...prev];
      runningGames.forEach(game => {
        newGames[game.id] = { ...game, isThinking: true };
      });
      return newGames;
    });

    runningGames.forEach(game => {
      // Use Worker from pool
      const worker = workersRef.current[game.id];
      if (worker) {
        let config: AIConfig;
        if (isSelfPlay) {
          config = { botType: 'nnue', depth: 6 };
        } else if (isTrainerVsNNUE) {
          // NNUE vs Trainer
          config = game.currentPlayer === 1 ? { botType: 'nnue', depth: 6 } : { botType: 'trainer', depth: 6 };
        } else {
          config = game.currentPlayer === 1 ? ai1Config : ai2Config;
        }

        worker.postMessage({
          board: game.board,
          depth: (isSelfPlay || isTrainerVsNNUE) ? 6 : (game.currentPlayer === 1 ? game.p1Depth : game.p2Depth),
          isMaximizing: game.currentPlayer === 1,
          gameId: game.id,
          config: { ...config, depth: (isSelfPlay || isTrainerVsNNUE) ? 6 : (game.currentPlayer === 1 ? game.p1Depth : game.p2Depth) },
          epsilon: (isSelfPlay || isTrainerVsNNUE) ? 0.15 : 0 // 15% random moves for variety
        });
      }
    });
  }, [parallelGames, isBatchRunning, activeTab, isSelfPlay, isTrainerVsNNUE]);

  useEffect(() => {
    if (activeTab === 'viewer') {
      fetchMatches();
    }
  }, [activeTab]);

  const viewMatchDetails = async (id: number) => {
    try {
      const res = await fetch(`/api/match/${id}`);
      const data = await res.json();
      setSelectedMatch(data);
      setPlaybackIndex(data.moves.length - 1);
      setIsPlaying(false);
    } catch (err) {
      console.error("Failed to fetch match details:", err);
    }
  };

  // Playback Logic
  useEffect(() => {
    if (!isPlaying || !selectedMatch) return;

    const interval = setInterval(() => {
      setPlaybackIndex(prev => {
        if (prev >= selectedMatch.moves.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isPlaying, selectedMatch]);

  // Handle stats when winner changes
  useEffect(() => {
    if (gameState.winner) {
      if (gameState.winner === 1) setStats(s => ({ ...s, p1Wins: s.p1Wins + 1 }));
      else if (gameState.winner === 2) setStats(s => ({ ...s, p2Wins: s.p2Wins + 1 }));
      else if (gameState.winner === 'draw') setStats(s => ({ ...s, draws: s.draws + 1 }));
      setIsGameRunning(false);
    }
  }, [gameState.winner]);

  const handleHumanMove = async (col: number) => {
    if (gameState.winner || gameState.isThinking) return;
    if (activeTab === 'game' && (!isGameRunning || (mode === 'human-vs-ai' && gameState.currentPlayer !== humanColor))) return;
    if (activeTab === 'practice' && gameState.currentPlayer !== 2) return; // Human is Yellow (Player 2)
    
    // Evaluate move quality before executing
    const { position, mask } = toBitboard(gameState.board);
    const scoreBefore = evaluateNNUE(position, mask);
    
    executeMove(col);

    // After move, evaluate again to determine quality
    setTimeout(() => {
      setGameState(current => {
        const { position: posAfter, mask: maskAfter } = toBitboard(current.board);
        // scoreAfter is from the NEXT player's perspective, so we negate it to get current player's perspective
        const scoreAfter = -evaluateNNUE(posAfter, maskAfter);
        const diff = scoreBefore - scoreAfter; // Positive diff means the move made the position worse
        
        let quality: MoveQuality = 'best';
        if (diff < -0.2) quality = 'brilliant';
        else if (diff < 0.1) quality = 'best';
        else if (diff > 1.5) quality = 'blunder';
        else if (diff > 0.8) quality = 'mistake';
        else if (diff > 0.3) quality = 'inaccuracy';

        // Find the row where the piece landed
        let row = -1;
        for (let r = 5; r >= 0; r--) {
          if (current.board[r][col] !== null) {
            row = r;
            break;
          }
        }

        if (row !== -1) {
          setLastMoveQuality({ row, col, quality });
        }
        
        return current;
      });
    }, 100);
  };

  // AI Turn Logic for Main Game
  useEffect(() => {
    if (!isGameRunning || gameState.winner || gameState.isThinking || (activeTab !== 'game' && activeTab !== 'practice' && !isMatchActive)) return;

    const isAiTurn = 
      (mode === 'human-vs-ai' && gameState.currentPlayer !== humanColor) ||
      (mode === 'ai-vs-ai') ||
      (mode === 'matchmaking' && opponent?.isBot && gameState.currentPlayer !== humanColor) ||
      isAutoMoving;

    if (isAiTurn) {
      console.log("App: Setting isThinking to true for AI turn", { mode, currentPlayer: gameState.currentPlayer, isAutoMoving });
      setGameState(prev => ({ ...prev, isThinking: true }));
    }
  }, [gameState.currentPlayer, gameState.winner, gameState.isThinking, isGameRunning, mode, humanColor, activeTab, isAutoMoving, isMatchActive, opponent]);

  useEffect(() => {
    if (!gameState.isThinking || gameState.winner || (activeTab !== 'game' && activeTab !== 'practice' && !isMatchActive)) return;

    // Terminate existing worker to cancel any ongoing search
    if (singleGameWorkerRef.current) {
      console.log("App: Terminating previous AI Worker to start fresh search");
      singleGameWorkerRef.current.terminate();
    }

    // Create a fresh worker for this move
    const worker = new AIWorker();
    worker.onmessage = (e) => {
      const { bestMove, score } = e.data;
      console.log("App: AI Worker responded with:", { bestMove, score });
      
      if (score !== undefined) {
        setPreviousEval(evaluation);
        setEvaluation(score);
      }

      if (bestMove !== null && bestMove !== undefined) {
        executeMoveRef.current?.(bestMove);
      } else {
        setGameState(prev => ({ ...prev, isThinking: false }));
      }
    };
    worker.onerror = (err) => {
      console.error("App: AI Worker error:", err);
      setGameState(prev => ({ ...prev, isThinking: false }));
    };
    singleGameWorkerRef.current = worker;

    const config = gameState.currentPlayer === 1 ? ai1Config : ai2Config;
    const depth = isAutoMoving ? currentBotDepth : config.depth;
    
    console.log("App: Posting message to AI Worker", {
      depth: depth,
      isMaximizing: gameState.currentPlayer === 1,
      botType: config.botType,
      isAutoMoving
    });

    // If using NNUE, send weights first
    if (config.botType === 'nnue' && nnueWeights) {
      worker.postMessage({ type: 'UPDATE_WEIGHTS', weights: nnueWeights });
    }

    worker.postMessage({
      board: gameState.board,
      depth: depth,
      isMaximizing: gameState.currentPlayer === 1,
      config: { ...config, depth: depth }
    });
  }, [gameState.isThinking, gameState.board, gameState.currentPlayer, ai1Config.depth, ai2Config.depth, activeTab, nnueWeights, isAutoMoving, currentBotDepth, isMatchActive]);

  const getPlayerLabel = (player: 1 | 2) => {
    if (mode === 'human-vs-ai') {
      return player === humanColor ? 'YOU' : 'AI';
    }
    if (mode === 'ai-vs-ai') {
      return `AI ${player}`;
    }
    return `Player ${player}`;
  };

  const renderCell = (cell: Player) => {
    if (viewMode === 'visual') {
      return (
        <div className={`w-full h-full rounded-full ${
          cell === 1 ? 'bg-red-500' : cell === 2 ? 'bg-yellow-400' : 'bg-[#0a0a0a]'
        }`} />
      );
    } else {
      const val = cell === null ? 0 : cell === 1 ? 1 : -1;
      return (
        <div className={`w-full h-full flex items-center justify-center font-mono text-[10px] ${
          val === 1 ? 'text-red-500' : val === -1 ? 'text-yellow-500' : 'text-white/20'
        }`}>
          {val}
        </div>
      );
    }
  };

  const initNNUE = async () => {
    try {
      const response = await fetch('/api/nnue/init', { method: 'POST' });
      if (response.ok) {
        alert("NNUE weights initialized!");
        window.location.reload();
      } else {
        alert("Failed to initialize weights.");
      }
    } catch (err) {
      console.error('Initialization failed:', err);
    }
  };

  if (!user) {
    return <Auth onLogin={setUser} />;
  }

  return (
    <div className="min-h-screen bg-[#050505] text-[#e0e0e0] font-sans p-4 md:p-8 selection:bg-red-500/30">
      <div className="fixed top-4 right-4 bg-black/50 p-4 rounded-lg text-[10px] font-mono z-50 space-y-2">
        <div>DB: {dbCounts.matches} matches, {dbCounts.moves} moves, {dbCounts.weights} weights, {dbCounts.kaggle} kaggle</div>
        {dbCounts.kaggleError && (
          <div className="text-red-400 max-w-[200px] break-words">Kaggle Error: {dbCounts.kaggleError}</div>
        )}
        {dbCounts.weights === '0' && (
          <button onClick={initNNUE} className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded">
            Initialize NNUE Weights
          </button>
        )}
      </div>
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 bg-[#111] p-1 rounded-xl border border-white/5 w-fit mx-auto shadow-2xl scale-90">
          {[
            { id: 'arena', label: 'Arena', icon: Trophy },
            { id: 'leaderboard', label: 'Leaderboard', icon: Activity },
            ...(isAdmin ? [
              { id: 'game', label: 'Engine', icon: Play },
              { id: 'generator', label: 'Generator', icon: Database },
              { id: 'viewer', label: 'Viewer', icon: Eye },
              { id: 'nnue', label: 'NNUE', icon: Brain },
            ] : [])
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as any);
                if (tab.id === 'practice') {
                  setMode('human-vs-ai');
                  setHumanColor(2); // Human is Yellow
                  resetGame();
                }
              }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg font-bold text-xs transition-all ${
                activeTab === tab.id 
                  ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' 
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg font-bold text-xs text-white/40 hover:text-white transition-all"
          >
            <Settings size={14} />
          </button>
          <button 
            onClick={() => {
              localStorage.removeItem('c4_user');
              setUser(null);
            }}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg font-bold text-xs text-white/20 hover:text-red-500 transition-all"
          >
            <LogOut size={14} />
          </button>
        </div>

        {/* Match History Modal */}
        <AnimatePresence>
          {isMatchHistoryOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/90 backdrop-blur-md z-[150] flex items-center justify-center p-4 md:p-8"
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-[#111] border border-white/10 w-full max-w-4xl max-h-[80vh] rounded-3xl flex flex-col shadow-2xl overflow-hidden"
              >
                <div className="p-8 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500">
                      <History size={24} />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight text-white">Match History</h2>
                      <p className="text-white/40 text-[10px] uppercase tracking-widest font-mono">Recent Competitive Encounters</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsMatchHistoryOpen(false)}
                    className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-white/40 hover:text-white transition-all"
                  >
                    <XCircle size={24} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-4 scrollbar-hide">
                  {userMatches.length === 0 ? (
                    <div className="text-center py-20 text-white/20 font-bold uppercase tracking-widest">No matches recorded</div>
                  ) : (
                    userMatches.map(match => (
                      <div key={match.id} className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 hover:bg-white/10 transition-all">
                        <div className="flex items-center gap-8 flex-1 w-full">
                          <div className="flex flex-col items-center gap-2 flex-1">
                            <span className="text-2xl">{AVATARS.find(a => a.id === match.p1_avatar)?.icon || '🤖'}</span>
                            <span className={`text-xs font-bold uppercase tracking-widest ${match.winner === 1 ? 'text-green-500' : 'text-white/40'}`}>{match.p1_username}</span>
                            <span className="text-[8px] text-white/20 font-mono">{match.p1_elo} ELO</span>
                          </div>
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-white/20 font-bold text-xs uppercase tracking-widest">VS</span>
                            <div className={`px-3 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest ${
                              match.winner === 0 ? 'bg-white/10 text-white/40' : 'bg-red-500/20 text-red-500'
                            }`}>
                              {match.winner === 0 ? 'Draw' : 'Finished'}
                            </div>
                          </div>
                          <div className="flex flex-col items-center gap-2 flex-1">
                            <span className="text-2xl">{AVATARS.find(a => a.id === match.p2_avatar)?.icon || '🤖'}</span>
                            <span className={`text-xs font-bold uppercase tracking-widest ${match.winner === 2 ? 'text-green-500' : 'text-white/40'}`}>{match.p2_username}</span>
                            <span className="text-[8px] text-white/20 font-mono">{match.p2_elo} ELO</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className="text-[10px] text-white/40 font-mono">{new Date(match.created_at).toLocaleDateString()}</div>
                          <button className="text-[10px] font-bold text-red-500 uppercase tracking-widest hover:underline">View Replay</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {isSettingsOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-[#111] border border-white/10 p-8 rounded-3xl max-w-md w-full space-y-6 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold tracking-tighter italic serif">USER <span className="text-red-500">SETTINGS</span></h2>
                <button onClick={() => setIsSettingsOpen(false)} className="text-white/40 hover:text-white">
                  <XCircle size={24} />
                </button>
              </div>
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold ml-1">Change Username</label>
                  <div className="relative">
                    <UserIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" />
                    <input
                      type="text"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm text-white focus:border-red-500/50 focus:outline-none transition-all"
                      placeholder={user.username}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold ml-1">Select Avatar</label>
                  <div className="grid grid-cols-4 gap-3">
                    {AVATARS.map(avatar => (
                      <button
                        key={avatar.id}
                        onClick={() => updateAvatar(avatar.id)}
                        className={`aspect-square rounded-xl flex items-center justify-center text-2xl transition-all border-2 ${
                          user.avatar_id === avatar.id ? 'bg-red-500/20 border-red-500' : 'bg-white/5 border-transparent hover:bg-white/10'
                        }`}
                      >
                        {avatar.icon}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={updateUsername}
                  className="w-full bg-red-500 hover:bg-red-600 text-white py-4 rounded-xl font-bold transition-all shadow-lg shadow-red-500/20"
                >
                  SAVE CHANGES
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isMatchActive && (
          <div className="fixed inset-0 bg-[#050505] z-[90] flex flex-col overflow-hidden">
            {/* Match Header */}
            <div className="flex items-center justify-between p-4 md:px-8 border-b border-white/5 bg-[#0a0a0a]">
              {/* Player 1 (Red) */}
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold transition-all ring-2 ${
                  humanColor === 1 
                    ? 'ring-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.3)]' 
                    : (opponent?.isBot ? 'ring-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]' : 'ring-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.3)]')
                } ${gameState.currentPlayer === 1 ? 'bg-red-500 text-white' : 'bg-white/5 text-white/20'}`}>
                  {AVATARS.find(a => a.id === (humanColor === 1 ? user.avatar_id : opponent?.avatar_id))?.icon || (humanColor === 1 ? user.username[0].toUpperCase() : opponent?.username[0].toUpperCase())}
                </div>
                <div className="hidden sm:block">
                  <div className="font-bold text-sm">
                    {humanColor === 1 ? user.username : opponent?.username}
                    {humanColor === 2 && !opponent?.isBot && !isOpponentOnline && (
                      <span className="ml-2 text-[8px] text-red-500 animate-pulse">OFFLINE</span>
                    )}
                  </div>
                  <div className="text-[8px] text-white/40 font-mono uppercase tracking-widest">
                    {humanColor === 1 ? `${user?.elo} ELO` : `${opponent?.elo} ELO`}
                  </div>
                </div>
                {gameState.currentPlayer === 1 && (
                  <div className="flex items-center gap-1.5 text-red-500 font-mono font-bold text-xs bg-red-500/10 px-2 py-1 rounded-lg">
                    <Clock size={12} className="animate-pulse" />
                    {moveTimer}s
                  </div>
                )}
              </div>

              {/* Game Timer Center */}
              <div className="flex flex-col items-center">
                <div className="text-2xl font-mono font-bold text-white/40 tracking-tighter">
                  {Math.floor(gameTimer / 60)}:{String(gameTimer % 60).padStart(2, '0')}
                </div>
                <div className="text-[8px] text-white/10 uppercase tracking-widest font-bold">Match Time</div>
                {isAutoMoving && (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-1 px-2 py-0.5 bg-purple-500/20 border border-purple-500/30 rounded-full flex items-center gap-1"
                  >
                    <div className="w-1 h-1 rounded-full bg-purple-500 animate-pulse" />
                    <span className="text-[7px] text-purple-400 font-bold uppercase tracking-widest">Bot Assisted</span>
                  </motion.div>
                )}
              </div>

              {/* Player 2 (Yellow) */}
              <div className="flex items-center gap-3 text-right">
                {gameState.currentPlayer === 2 && (
                  <div className="flex items-center gap-1.5 text-yellow-500 font-mono font-bold text-xs bg-yellow-500/10 px-2 py-1 rounded-lg">
                    {moveTimer}s
                    <Clock size={12} className="animate-pulse" />
                  </div>
                )}
                <div className="hidden sm:block">
                  <div className="font-bold text-sm">
                    {humanColor === 1 && !opponent?.isBot && !isOpponentOnline && (
                      <span className="mr-2 text-[8px] text-red-500 animate-pulse">OFFLINE</span>
                    )}
                    {humanColor === 2 ? user.username : opponent?.username}
                  </div>
                  <div className="text-[8px] text-white/40 font-mono uppercase tracking-widest">
                    {humanColor === 2 ? `${user?.elo} ELO` : `${opponent?.elo} ELO`}
                  </div>
                </div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold transition-all ring-2 ${
                  humanColor === 2 
                    ? 'ring-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.3)]' 
                    : (opponent?.isBot ? 'ring-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]' : 'ring-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.3)]')
                } ${gameState.currentPlayer === 2 ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/20'}`}>
                  {AVATARS.find(a => a.id === (humanColor === 2 ? user.avatar_id : opponent?.avatar_id))?.icon || (humanColor === 2 ? user.username[0].toUpperCase() : opponent?.username[0].toUpperCase())}
                </div>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {/* Main Game Area */}
              <div className="flex-1 flex flex-col p-4 md:p-8 transition-all duration-300 w-full relative">
                {/* Turn Indicator Overlay */}
                <AnimatePresence>
                  {gameState.currentPlayer === humanColor && !gameState.winner && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8, y: -20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.8, y: -20 }}
                      className="absolute top-12 left-1/2 -translate-x-1/2 z-[100] pointer-events-none"
                    >
                      <div className="bg-red-500 text-white px-8 py-3 rounded-2xl font-black text-2xl italic tracking-tighter shadow-[0_0_30px_rgba(239,68,68,0.5)] border-2 border-white/20 flex items-center gap-3">
                        <Zap size={24} fill="currentColor" className="animate-pulse" />
                        YOUR TURN
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Match Board */}
                <div className="flex-1 flex items-center justify-center">
                  <div className="max-w-xl w-full">
                    <Board 
                      board={gameState.board} 
                      onColumnClick={handleHumanMove} 
                      disabled={gameState.currentPlayer !== humanColor || !!gameState.winner}
                      winningCells={(() => {
                        const res = checkWinner(gameState.board);
                        return res && typeof res === 'object' ? res.cells : undefined;
                      })()}
                      lastMove={gameState.moves.length > 0 ? {
                        row: lastMoveQuality?.row || 0,
                        col: gameState.moves[gameState.moves.length-1].move,
                        quality: lastMoveQuality?.quality
                      } : undefined}
                    />
                  </div>
                </div>

                {/* Match Footer */}
                <div className="mt-4 flex flex-col items-center gap-4">
                  <div className="flex items-center gap-4">
                    {/* Avatar Spam/Change */}
                    <div className="flex items-center gap-1 bg-white/5 p-1.5 rounded-xl border border-white/10">
                      {AVATARS.map(avatar => (
                        <button
                          key={avatar.id}
                          onClick={() => {
                            if (!user) return;
                            fetch('/api/user/update-avatar', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ userId: user.id, avatarId: avatar.id }),
                            })
                            .then(res => res.json())
                            .then(data => {
                              if (data.success) {
                                setUser(data.user);
                                localStorage.setItem('c4_user', JSON.stringify(data.user));
                              }
                            });
                          }}
                          className={`w-10 h-10 flex items-center justify-center text-xl hover:bg-white/10 rounded-lg transition-all active:scale-90 ${user?.avatar_id === avatar.id ? 'bg-red-500/20 border border-red-500/50' : ''}`}
                          title={avatar.name}
                        >
                          {avatar.icon}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button 
                    onClick={() => {
                      setIsMatchActive(false);
                      setActiveTab('arena');
                      updateElo(gameState.currentPlayer === 1 ? 2 : 1); // Forfeit
                    }}
                    className="text-white/20 hover:text-red-500 font-bold uppercase tracking-widest text-[10px] transition-all"
                  >
                    Forfeit Match
                  </button>
                </div>
              </div>
            </div>

            {/* Winner Overlay */}
            <AnimatePresence>
              {gameState.winner && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-8"
                >
                  <div className="text-center space-y-8">
                    <motion.div
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      className="space-y-4"
                    >
                      <Trophy size={80} className={`mx-auto ${gameState.winner === humanColor ? 'text-yellow-500' : 'text-white/20'}`} />
                      <h2 className="text-6xl font-bold tracking-tighter italic serif">
                        {gameState.winner === 'draw' ? 'STALEMATE' : (gameState.winner === humanColor ? 'VICTORY' : 'DEFEAT')}
                      </h2>
                      <p className="text-white/40 font-mono uppercase tracking-[0.5em]">Match Concluded</p>
                    </motion.div>
                    
                    <button 
                      onClick={() => {
                        setIsMatchActive(false);
                        setActiveTab('arena');
                        updateElo(gameState.winner === 'draw' ? null : (gameState.winner === 1 ? (humanColor === 1 ? user.id : opponent.id) : (humanColor === 2 ? user.id : opponent.id)));
                      }}
                      className="bg-red-500 text-white px-12 py-4 rounded-2xl font-bold text-xl shadow-2xl shadow-red-500/20 hover:bg-red-600 transition-all"
                    >
                      Return to Arena
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {activeTab === 'arena' && (
          <div className="max-w-6xl mx-auto py-12 px-4 space-y-12">
            {/* Arena Hero Section */}
            <div className="flex flex-col items-center text-center space-y-8">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <h2 className="text-6xl md:text-8xl font-black tracking-tighter italic serif text-white">
                  THE <span className="text-red-500">ARENA</span>
                </h2>
                <p className="text-white/40 font-mono uppercase tracking-[0.5em] text-sm">Global PvP Domination</p>
              </motion.div>

              <div className="w-full max-w-md">
                <div className="bg-[#111] border border-white/10 rounded-[3rem] p-10 shadow-2xl relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  
                  <div className="relative z-10 space-y-8">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-20 h-20 bg-red-500/10 rounded-[2rem] flex items-center justify-center text-red-500 shadow-inner">
                        <Zap size={40} fill="currentColor" className={isMatchmaking ? 'animate-pulse' : ''} />
                      </div>
                      <div className="text-center">
                        <h3 className="text-2xl font-bold text-white uppercase tracking-tight">Battle Ready</h3>
                        <p className="text-white/40 text-[10px] uppercase tracking-widest font-mono">Enter the matchmaking queue</p>
                      </div>
                    </div>

                    {!isMatchmaking ? (
                      <button
                        onClick={startMatchmaking}
                        className="w-full bg-red-500 hover:bg-red-600 text-white py-8 rounded-3xl font-black text-2xl flex items-center justify-center gap-4 transition-all shadow-2xl shadow-red-500/30 active:scale-95 group"
                      >
                        <Play size={28} fill="currentColor" className="group-hover:translate-x-1 transition-transform" />
                        FIND MATCH
                      </button>
                    ) : (
                      <div className="space-y-8">
                        <div className="flex flex-col items-center justify-center space-y-6">
                          <div className="relative">
                            <div className="w-24 h-24 border-4 border-red-500/10 border-t-red-500 rounded-full animate-spin" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-2xl font-mono font-bold text-red-500">{matchmakingTimer}s</span>
                            </div>
                          </div>
                          <div className="text-center">
                            <p className="text-white font-bold animate-pulse tracking-widest uppercase text-xs">Scanning Grid...</p>
                            <p className="text-white/20 text-[8px] uppercase tracking-widest mt-1">Searching for worthy opponent</p>
                          </div>
                        </div>
                        <button
                          onClick={cancelMatchmaking}
                          className="w-full bg-white/5 hover:bg-white/10 text-white/40 py-4 rounded-2xl font-bold text-xs transition-all uppercase tracking-widest border border-white/5"
                        >
                          Withdraw
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Bento Stats Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[#111] border border-white/10 rounded-3xl p-6 shadow-xl group hover:border-red-500/30 transition-all">
                <div className="text-white/20 text-[8px] uppercase tracking-widest font-black mb-2 flex items-center gap-2">
                  <Activity size={10} /> Total Matches
                </div>
                <div className="text-3xl font-mono font-bold text-white group-hover:text-red-500 transition-colors">{dbCounts?.matches || 0}</div>
              </div>
              <div className="bg-[#111] border border-white/10 rounded-3xl p-6 shadow-xl group hover:border-red-500/30 transition-all">
                <div className="text-white/20 text-[8px] uppercase tracking-widest font-black mb-2 flex items-center gap-2">
                  <Users size={10} /> Active Players
                </div>
                <div className="text-3xl font-mono font-bold text-white group-hover:text-red-500 transition-colors">{leaderboard.length}</div>
              </div>
              <div className="bg-[#111] border border-white/10 rounded-3xl p-6 shadow-xl group hover:border-red-500/30 transition-all">
                <div className="text-white/20 text-[8px] uppercase tracking-widest font-black mb-2 flex items-center gap-2">
                  <Brain size={10} /> NNUE Weights
                </div>
                <div className="text-3xl font-mono font-bold text-white group-hover:text-red-500 transition-colors">{dbCounts?.weights || 0}</div>
              </div>
              <div className="bg-[#111] border border-white/10 rounded-3xl p-6 shadow-xl group hover:border-red-500/30 transition-all">
                <div className="text-white/20 text-[8px] uppercase tracking-widest font-black mb-2 flex items-center gap-2">
                  <Database size={10} /> Kaggle Data
                </div>
                <div className="text-3xl font-mono font-bold text-white group-hover:text-red-500 transition-colors">{dbCounts?.kaggle || 0}</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'leaderboard' && (
          <div className="max-w-4xl mx-auto space-y-8 py-12">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h2 className="text-3xl font-bold tracking-tighter italic serif">GLOBAL <span className="text-red-500">LEADERBOARD</span></h2>
                <p className="text-sm text-white/40 font-mono uppercase tracking-widest">Top Ranked Players in Connect Arena</p>
              </div>
              <button onClick={fetchLeaderboard} className="p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all border border-white/10">
                <RotateCcw size={18} />
              </button>
            </div>

            <div className="bg-[#111] border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-white/5">
                    <th className="px-8 py-4 text-[10px] font-bold text-white/40 uppercase tracking-widest">Rank</th>
                    <th className="px-8 py-4 text-[10px] font-bold text-white/40 uppercase tracking-widest">Player</th>
                    <th className="px-8 py-4 text-[10px] font-bold text-white/40 uppercase tracking-widest text-right">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((player, i) => (
                    <tr key={player.id} className={`border-b border-white/5 transition-all hover:bg-white/5 ${player.id === user.id ? 'bg-red-500/5' : ''}`}>
                      <td className="px-8 py-6">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${
                          i === 0 ? 'bg-yellow-500 text-black' : i === 1 ? 'bg-gray-300 text-black' : i === 2 ? 'bg-amber-600 text-white' : 'text-white/20'
                        }`}>
                          {i + 1}
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-3 cursor-pointer group" onClick={() => fetchUserMatches(player.id)}>
                          <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-2xl group-hover:bg-red-500/20 transition-all">
                            {AVATARS.find(a => a.id === (player.avatar_id || 0))?.icon || '🤖'}
                          </div>
                          <div>
                            <div className="font-bold text-white group-hover:text-red-500 transition-all">{player.username}</div>
                            {player.id === user.id && <div className="text-[8px] text-red-500 font-bold uppercase tracking-widest">You</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="text-lg font-mono font-bold text-red-500">{player.elo}</div>
                        <div className="text-[8px] text-white/20 uppercase tracking-widest">ELO</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'game' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Controls & Stats */}
            <div className="lg:col-span-4 space-y-6 order-2 lg:order-1">
              {/* Header */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-red-500">
                  <Activity size={20} className="animate-pulse" />
                  <span className="text-xs font-mono uppercase tracking-widest">System Online</span>
                </div>
                <h1 className="text-4xl font-bold tracking-tighter italic serif">
                  ENGINE <span className="text-red-500">TERMINAL</span>
                </h1>
                <p className="text-sm text-white/40 font-mono">Minimax Alpha-Beta Pruning Environment</p>
              </div>

              {/* Configuration Card */}
              <div className="bg-[#111] border border-white/10 rounded-2xl p-6 space-y-6 shadow-xl">
                <div className="flex items-center gap-2 border-b border-white/5 pb-4">
                  <Settings size={18} className="text-white/60" />
                  <h2 className="text-sm font-bold uppercase tracking-wider">Engine Configuration</h2>
                </div>

                {/* Mode Selector */}
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Operation Mode</label>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      { id: 'human-vs-ai', label: 'Human vs AI', icon: UserIcon },
                      { id: 'ai-vs-ai', label: 'AI vs AI', icon: Cpu },
                      { id: 'human-vs-human', label: 'Human vs Human', icon: UserIcon },
                    ].map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setMode(m.id as GameMode);
                          setGameState(prev => ({ ...prev, isThinking: false }));
                          setIsGameRunning(false);
                        }}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                          mode === m.id 
                            ? 'bg-red-500/10 border-red-500/50 text-red-500' 
                            : 'bg-white/5 border-white/5 hover:border-white/20 text-white/60'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <m.icon size={16} />
                          <span className="text-sm font-medium">{m.label}</span>
                        </div>
                        {mode === m.id && <ChevronRight size={14} />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Specialized Recording Toggle */}
                <div className="pt-4 border-t border-white/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                        <Database size={10} className="text-purple-500" />
                        Specialized Recording
                      </label>
                      <p className="text-[9px] text-white/20 font-mono">Save to Pro-Bot Training Sheet</p>
                    </div>
                    <button
                      onClick={() => setIsSpecializedRecording(!isSpecializedRecording)}
                      className={`w-12 h-6 rounded-full transition-all relative ${
                        isSpecializedRecording ? 'bg-purple-500' : 'bg-white/10'
                      }`}
                    >
                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                        isSpecializedRecording ? 'left-7' : 'left-1'
                      }`} />
                    </button>
                  </div>
                </div>

                {/* Human Color Selection */}
                {mode === 'human-vs-ai' && (
                  <div className="space-y-3">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Your Color</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setHumanColor(1)}
                        className={`p-2 rounded-xl border text-xs font-bold transition-all ${
                          humanColor === 1 
                            ? 'bg-red-500/10 border-red-500 text-red-500' 
                            : 'bg-white/5 border-white/5 text-white/40'
                        }`}
                      >
                        RED (P1)
                      </button>
                      <button
                        onClick={() => setHumanColor(2)}
                        className={`p-2 rounded-xl border text-xs font-bold transition-all ${
                          humanColor === 2 
                            ? 'bg-yellow-500/10 border-yellow-500 text-yellow-500' 
                            : 'bg-white/5 border-white/5 text-white/40'
                        }`}
                      >
                        YELLOW (P2)
                      </button>
                    </div>
                  </div>
                )}

                {/* Depth & Bot Controls */}
                <div className="space-y-6">
                  {/* P1 Controls */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">
                        {mode === 'human-vs-ai' && humanColor === 1 ? 'YOUR SETTINGS (N/A)' : 'P1 (Red) Brain'}
                      </label>
                      <span className="text-xs font-mono text-red-500">
                        Level {ai1Config.depth}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        disabled={mode === 'human-vs-ai' && humanColor === 1}
                        onClick={() => setAi1Config(prev => ({ ...prev, botType: 'nnue' }))}
                        className={`p-2 rounded-xl border text-[10px] font-bold transition-all disabled:opacity-20 ${
                          ai1Config.botType === 'nnue' 
                            ? 'bg-red-500/10 border-red-500 text-red-500' 
                            : 'bg-white/5 border-white/5 text-white/40'
                        }`}
                      >
                        NNUE
                      </button>
                      <button
                        disabled={mode === 'human-vs-ai' && humanColor === 1}
                        onClick={() => setAi1Config(prev => ({ ...prev, botType: 'trainer' }))}
                        className={`p-2 rounded-xl border text-[10px] font-bold transition-all disabled:opacity-20 ${
                          ai1Config.botType === 'trainer' 
                            ? 'bg-red-500/10 border-red-500 text-red-500' 
                            : 'bg-white/5 border-white/5 text-white/40'
                        }`}
                      >
                        TRAINER
                      </button>
                    </div>

                    <input
                      type="range"
                      min="2"
                      max="15"
                      disabled={mode === 'human-vs-ai' && humanColor === 1}
                      value={ai1Config.depth}
                      onChange={(e) => setAi1Config(prev => ({ ...prev, depth: parseInt(e.target.value) }))}
                      className="w-full accent-red-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer disabled:opacity-20"
                    />
                  </div>

                  {/* P2 Controls */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">
                        {mode === 'human-vs-ai' && humanColor === 2 ? 'YOUR SETTINGS (N/A)' : 'P2 (Yellow) Brain'}
                      </label>
                      <span className="text-xs font-mono text-yellow-500">
                        Level {ai2Config.depth}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        disabled={mode === 'human-vs-ai' && humanColor === 2}
                        onClick={() => setAi2Config(prev => ({ ...prev, botType: 'nnue' }))}
                        className={`p-2 rounded-xl border text-[10px] font-bold transition-all disabled:opacity-20 ${
                          ai2Config.botType === 'nnue' 
                            ? 'bg-yellow-500/10 border-yellow-500 text-yellow-500' 
                            : 'bg-white/5 border-white/5 text-white/40'
                        }`}
                      >
                        NNUE
                      </button>
                      <button
                        disabled={mode === 'human-vs-ai' && humanColor === 2}
                        onClick={() => setAi2Config(prev => ({ ...prev, botType: 'trainer' }))}
                        className={`p-2 rounded-xl border text-[10px] font-bold transition-all disabled:opacity-20 ${
                          ai2Config.botType === 'trainer' 
                            ? 'bg-yellow-500/10 border-yellow-500 text-yellow-500' 
                            : 'bg-white/5 border-white/5 text-white/40'
                        }`}
                      >
                        TRAINER
                      </button>
                    </div>

                    <input
                      type="range"
                      min="2"
                      max="15"
                      disabled={mode === 'human-vs-ai' && humanColor === 2}
                      value={ai2Config.depth}
                      onChange={(e) => setAi2Config(prev => ({ ...prev, depth: parseInt(e.target.value) }))}
                      className="w-full accent-yellow-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer disabled:opacity-20"
                    />
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="pt-4 flex gap-3">
                  <button
                    onClick={resetGame}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-red-500/20 active:scale-95"
                  >
                    <Play size={18} fill="currentColor" />
                    START
                  </button>
                  <button
                    onClick={() => {
                      setGameState({ board: createEmptyBoard(), currentPlayer: 1, winner: null, isThinking: false, moves: [] });
                      setIsGameRunning(false);
                    }}
                    className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all active:scale-95"
                    title="Reset Game"
                  >
                    <RotateCcw size={18} />
                  </button>
                  <button
                    onClick={copyBoardForLLM}
                    className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all active:scale-95 relative"
                    title="Copy Board for LLM"
                  >
                    {showCopiedToast ? <Check size={18} className="text-emerald-500" /> : <Copy size={18} />}
                    <AnimatePresence>
                      {showCopiedToast && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          className="absolute -top-10 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg whitespace-nowrap"
                        >
                          COPIED!
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </button>
                </div>
              </div>

              {/* Stats Card */}
              <div className="bg-[#111] border border-white/10 rounded-2xl p-6 shadow-xl">
                <div className="flex items-center gap-2 border-b border-white/5 pb-4 mb-4">
                  <Trophy size={18} className="text-white/60" />
                  <h2 className="text-sm font-bold uppercase tracking-wider">Session Statistics</h2>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-widest text-white/40">{mode === 'human-vs-ai' && humanColor === 1 ? 'YOU' : 'P1'}</div>
                    <div className="text-2xl font-mono text-red-500">{stats.p1Wins}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-widest text-white/40">{mode === 'human-vs-ai' && humanColor === 2 ? 'YOU' : 'P2'}</div>
                    <div className="text-2xl font-mono text-yellow-500">{stats.p2Wins}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-widest text-white/40">Draws</div>
                    <div className="text-2xl font-mono text-white/60">{stats.draws}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Game Board */}
            <div className="lg:col-span-8 flex flex-col items-center justify-center order-1 lg:order-2">
              {/* Status Bar */}
              <div className="w-full max-w-[500px] mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${
                    gameState.currentPlayer === 1 
                      ? 'bg-red-500/10 border-red-500/50 text-red-500' 
                      : 'bg-white/5 border-white/5 text-white/40'
                  }`}>
                    <div className={`w-2 h-2 rounded-full ${gameState.currentPlayer === 1 ? 'bg-red-500 animate-pulse' : 'bg-white/20'}`} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">{getPlayerLabel(1)}</span>
                  </div>
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${
                    gameState.currentPlayer === 2 
                      ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-500' 
                      : 'bg-white/5 border-white/5 text-white/40'
                  }`}>
                    <div className={`w-2 h-2 rounded-full ${gameState.currentPlayer === 2 ? 'bg-yellow-500 animate-pulse' : 'bg-white/20'}`} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">{getPlayerLabel(2)}</span>
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  {mode === 'human-vs-human' && !gameState.winner && (
                    <motion.div
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="flex items-center gap-3 px-4 py-1.5 bg-white/5 rounded-full border border-white/10"
                    >
                      <Brain size={14} className="text-red-500" />
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">NNUE Evaluator:</span>
                        {(() => {
                          const { position, mask } = toBitboard(gameState.board);
                          const score = evaluateNNUE(position, mask);
                          const winProb = (Math.tanh(score) + 1) / 2;
                          const p1Prob = gameState.currentPlayer === 1 ? winProb : 1 - winProb;
                          const p2Prob = 1 - p1Prob;
                          
                          return (
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                <span className="text-[10px] font-mono text-red-500">{(p1Prob * 100).toFixed(1)}%</span>
                              </div>
                              <div className="w-px h-2 bg-white/10" />
                              <div className="flex items-center gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                                <span className="text-[10px] font-mono text-yellow-500">{(p2Prob * 100).toFixed(1)}%</span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </motion.div>
                  )}
                  {gameState.isThinking && (
                    <motion.div
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="flex items-center gap-2 text-white/40"
                    >
                      <span className="text-[10px] font-mono uppercase tracking-widest">Engine Pruning...</span>
                      <div className="flex gap-1">
                        <div className="w-1 h-1 bg-white/40 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <div className="w-1 h-1 bg-white/40 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <div className="w-1 h-1 bg-white/40 rounded-full animate-bounce" />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Main Board */}
              <div className="relative group">
                <Board 
                  board={gameState.board} 
                  onColumnClick={handleHumanMove} 
                  disabled={!isGameRunning || gameState.winner !== null || gameState.isThinking} 
                />

                {/* Winner Overlay */}
                <AnimatePresence>
                  {gameState.winner && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-xl border border-white/10"
                    >
                      <div className="text-center space-y-4 p-8">
                        <div className={`text-5xl font-bold tracking-tighter italic ${
                          gameState.winner === 1 ? 'text-red-500' : gameState.winner === 2 ? 'text-yellow-500' : 'text-white'
                        }`}>
                          {gameState.winner === 'draw' ? 'DRAW' : `${getPlayerLabel(gameState.winner as 1 | 2)} WINS`}
                        </div>
                        <p className="text-white/40 text-sm font-mono uppercase tracking-widest">Sequence Detected • Pruning Successful</p>
                        <button
                          onClick={resetGame}
                          className="bg-white text-black px-8 py-3 rounded-xl font-bold hover:bg-white/90 transition-all active:scale-95"
                        >
                          RESTART ENGINE
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'generator' && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h2 className="text-3xl font-bold tracking-tighter italic serif">PARALLEL <span className="text-red-500">GENERATOR</span></h2>
                <p className="text-sm text-white/40 font-mono uppercase tracking-widest">
                  10 Simultaneous Engine Instances • 
                  {isBatchRunning ? (
                    <span className="text-emerald-500 ml-1">
                      {isSelfPlay ? 'Self-Play Reinforcement' : (isTrainerVsNNUE ? 'Trainer vs NNUE' : 'Batch Progress')}: {completedCount} / {isSelfPlay || isTrainerVsNNUE ? '100' : '36'} Games
                    </span>
                  ) : (
                    " Unique Level Pairings"
                  )}
                </p>
              </div>
              <div className="flex gap-3">
                <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
                  <button
                    onClick={() => setTrainingSource('kaggle')}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${trainingSource === 'kaggle' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                  >
                    KAGGLE
                  </button>
                  <button
                    onClick={() => setTrainingSource('user')}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${trainingSource === 'user' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                  >
                    SAVED
                  </button>
                  <button
                    onClick={() => setTrainingSource('both')}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${trainingSource === 'both' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                  >
                    BOTH
                  </button>
                </div>
                <button 
                  onClick={() => trainNNUE('specialized')}
                  disabled={isTraining}
                  className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-500 px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all border border-purple-500/20 disabled:opacity-50"
                >
                  <Database size={18} className={isTraining ? 'animate-pulse' : ''} />
                  {isTraining ? 'TRAINING...' : 'TRAIN (SPECIALIZED)'}
                </button>
                <button 
                  onClick={() => trainNNUE()}
                  disabled={isTraining}
                  className="bg-red-500/10 hover:bg-red-500/20 text-red-500 px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all border border-red-500/20 disabled:opacity-50"
                >
                  <Brain size={18} className={isTraining ? 'animate-pulse' : ''} />
                  {isTraining ? 'TRAINING...' : `TRAIN (${trainingSource.toUpperCase()})`}
                </button>
                <button
                  onClick={clearDatabase}
                  className="bg-white/5 hover:bg-white/10 text-white/60 px-4 py-3 rounded-xl font-bold flex items-center gap-2 transition-all border border-white/10"
                >
                  <RotateCcw size={18} />
                  CLEAR DB
                </button>
                {isBatchRunning ? (
                  <button
                    onClick={() => setIsBatchRunning(false)}
                    className="bg-white/10 hover:bg-white/20 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all border border-white/10"
                  >
                    <RotateCcw size={18} />
                    STOP BATCH
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        // Start 100 Trainer vs NNUE games
                        setPendingPairings([]);
                        setCompletedCount(0);
                        setIsSelfPlay(false);
                        setIsTrainerVsNNUE(true);
                        setParallelGames(prev => prev.map((g, i) => ({
                          ...g,
                          board: createEmptyBoard(),
                          currentPlayer: Math.random() > 0.5 ? 1 : 2,
                          winner: null,
                          isThinking: false,
                          moves: [],
                          p1Depth: 6,
                          p2Depth: 6,
                          pairingIndex: i + 1,
                          status: 'running'
                        })));
                        setIsBatchRunning(true);
                      }}
                      className="bg-purple-500 hover:bg-purple-600 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-purple-500/20"
                    >
                      <Cpu size={18} fill="currentColor" />
                      TRAINER VS NNUE
                    </button>
                    <button
                      onClick={() => {
                        // Start 100 self-play games
                        setPendingPairings([]);
                        setCompletedCount(0);
                        setIsSelfPlay(true);
                        setIsTrainerVsNNUE(false);
                        setParallelGames(prev => prev.map((g, i) => ({
                          ...g,
                          board: createEmptyBoard(),
                          currentPlayer: Math.random() > 0.5 ? 1 : 2,
                          winner: null,
                          isThinking: false,
                          moves: [],
                          p1Depth: 6,
                          p2Depth: 6,
                          pairingIndex: i + 1,
                          status: 'running'
                        })));
                        setIsBatchRunning(true);
                      }}
                      className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
                    >
                      <Zap size={18} fill="currentColor" />
                      SELF-PLAY REINFORCE
                    </button>
                    <button
                      onClick={() => {
                        // Generate all 36 unique pairings (Level 2-7)
                        setIsSelfPlay(false);
                        setIsTrainerVsNNUE(false);
                        const levels = [2, 3, 4, 5, 6, 7];
                        const allPairings: {p1: number, p2: number, index: number}[] = [];
                        let idx = 1;
                        for (const p1 of levels) {
                          for (const p2 of levels) {
                            allPairings.push({ p1, p2, index: idx++ });
                          }
                        }
                        
                        // Shuffle pairings for variety
                        const shuffled = [...allPairings].sort(() => Math.random() - 0.5);
                        
                        const initialBatch = shuffled.slice(0, 10);
                        const remaining = shuffled.slice(10);
                        
                        setPendingPairings(remaining);
                        setCompletedCount(0);
                        setParallelGames(prev => prev.map((g, i) => ({
                          ...g,
                          board: createEmptyBoard(),
                          currentPlayer: Math.random() > 0.5 ? 1 : 2,
                          winner: null,
                          isThinking: false,
                          moves: [],
                          p1Depth: initialBatch[i].p1,
                          p2Depth: initialBatch[i].p2,
                          pairingIndex: initialBatch[i].index,
                          status: 'running'
                        })));
                        setIsBatchRunning(true);
                      }}
                      className="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-red-500/20"
                    >
                      <Play size={18} fill="currentColor" />
                      INITIALIZE BATCH
                    </button>
                    <button
                      onClick={() => {
                        // Generate 100 random pairings (Level 4-10)
                        const allPairings: {p1: number, p2: number, index: number}[] = [];
                        for (let i = 0; i < 100; i++) {
                          const p1 = Math.floor(Math.random() * 7) + 4; // 4-10
                          const p2 = Math.floor(Math.random() * 7) + 4; // 4-10
                          allPairings.push({ p1, p2, index: i + 1 });
                        }
                        
                        const initialBatch = allPairings.slice(0, 10);
                        const remaining = allPairings.slice(10);
                        
                        setPendingPairings(remaining);
                        setCompletedCount(0);
                        setParallelGames(prev => prev.map((g, i) => ({
                          ...g,
                          board: createEmptyBoard(),
                          currentPlayer: Math.random() > 0.5 ? 1 : 2,
                          winner: null,
                          isThinking: false,
                          moves: [],
                          p1Depth: initialBatch[i].p1,
                          p2Depth: initialBatch[i].p2,
                          pairingIndex: initialBatch[i].index,
                          status: 'running'
                        })));
                        setIsBatchRunning(true);
                      }}
                      className="bg-purple-500 hover:bg-purple-600 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-purple-500/20"
                    >
                      <Zap size={18} fill="currentColor" />
                      SUPER BATCH (100)
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {parallelGames.map((game) => (
                <div key={game.id} className="bg-[#111] border border-white/10 rounded-2xl p-4 space-y-4 shadow-xl">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-[10px] font-mono font-bold text-white/40 uppercase tracking-widest">
                      Slot {game.id + 1} {game.pairingIndex && `• ID: ${game.pairingIndex}`}
                    </span>
                    <div className={`w-2 h-2 rounded-full ${game.status === 'running' ? 'bg-green-500 animate-pulse' : 'bg-white/10'}`} />
                  </div>
                  
                  <div className="aspect-[7/6] w-full bg-[#0a0a0a] rounded-lg border border-white/5 grid grid-cols-7 grid-rows-6 gap-0.5 p-1">
                    {game.board.map((row, r) => row.map((cell, c) => (
                      <div key={`${r}-${c}`} className="w-full h-full rounded-full overflow-hidden">
                        {renderCell(cell)}
                      </div>
                    )))}
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-[9px] font-mono uppercase tracking-widest">
                      <span className="text-red-500">P1: Lvl {game.p1Depth}</span>
                      <span className="text-yellow-500">P2: Lvl {game.p2Depth}</span>
                    </div>
                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-red-500"
                        animate={{ width: `${(game.moves.length / 42) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-8 p-8 bg-[#111] border border-white/10 rounded-2xl">
              <div className="flex items-center gap-3">
                <Binary size={24} className="text-red-500" />
                <div className="space-y-0.5">
                  <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Data Format</div>
                  <div className="text-sm font-mono">NNUE (0, 1, -1)</div>
                </div>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="flex items-center gap-3">
                <Database size={24} className="text-yellow-500" />
                <div className="space-y-0.5">
                  <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Storage</div>
                  <div className="text-sm font-mono">Neon PostgreSQL</div>
                </div>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="flex items-center gap-3">
                <LayoutGrid size={24} className="text-white/60" />
                <div className="space-y-0.5">
                  <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">View Mode</div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setViewMode('visual')}
                      className={`text-xs font-bold px-2 py-0.5 rounded ${viewMode === 'visual' ? 'bg-white text-black' : 'text-white/40'}`}
                    >
                      VISUAL
                    </button>
                    <button 
                      onClick={() => setViewMode('data')}
                      className={`text-xs font-bold px-2 py-0.5 rounded ${viewMode === 'data' ? 'bg-white text-black' : 'text-white/40'}`}
                    >
                      DATA
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'viewer' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Match List */}
            <div className="lg:col-span-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold uppercase tracking-wider italic serif">Recent <span className="text-red-500">Matches</span></h2>
                <div className="flex gap-2">
                  <button onClick={clearDatabase} className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl transition-all" title="Clear All Matches">
                    <RotateCcw size={16} />
                  </button>
                  <button onClick={fetchMatches} className="p-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all">
                    <RotateCcw size={16} />
                  </button>
                </div>
              </div>
              <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden shadow-xl max-h-[600px] overflow-y-auto">
                {recentMatches.map((match) => (
                  <button
                    key={match.id}
                    onClick={() => viewMatchDetails(match.id)}
                    className={`w-full p-4 flex items-center justify-between border-b border-white/5 hover:bg-white/5 transition-all ${
                      selectedMatch?.match?.id === match.id ? 'bg-red-500/10 border-l-4 border-l-red-500' : ''
                    }`}
                  >
                    <div className="text-left space-y-1">
                      <div className="text-xs font-mono font-bold flex items-center gap-2">
                        MATCH #{match.id}
                        {match.pairing_id && (
                          <span className="px-1.5 py-0.5 bg-white/5 rounded text-[8px] text-white/40 border border-white/5">
                            PAIRING {match.pairing_id}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-white/40 uppercase tracking-widest">
                        P1: L{match.p1_depth} vs P2: L{match.p2_depth}
                      </div>
                    </div>
                    <div className={`text-xs font-bold ${
                      match.winner === '1' ? 'text-red-500' : match.winner === '2' ? 'text-yellow-500' : 'text-white/40'
                    }`}>
                      {match.winner === 'draw' ? 'DRAW' : `P${match.winner} WIN`}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Match Detail View */}
            <div className="lg:col-span-8 space-y-6">
              {selectedMatch ? (
                <div className="bg-[#111] border border-white/10 rounded-2xl p-8 space-y-8 shadow-xl">
                  <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <div className="space-y-1">
                      <h3 className="text-2xl font-bold italic serif tracking-tight">
                        MATCH ANALYSIS <span className="text-red-500">#{selectedMatch?.match?.id}</span>
                        {selectedMatch?.match?.pairing_id && (
                          <span className="ml-3 text-xs font-mono text-white/20 uppercase tracking-widest">
                            Pairing ID: {selectedMatch.match.pairing_id}
                          </span>
                        )}
                      </h3>
                      <p className="text-[10px] text-white/40 font-mono uppercase tracking-[0.2em]">
                        {selectedMatch?.match?.created_at ? new Date(selectedMatch.match.created_at).toLocaleString() : 'N/A'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                       <button 
                        onClick={() => setViewMode('visual')}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${viewMode === 'visual' ? 'bg-white text-black' : 'bg-white/5 text-white/40'}`}
                      >
                        VISUAL
                      </button>
                      <button 
                        onClick={() => setViewMode('data')}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${viewMode === 'data' ? 'bg-white text-black' : 'bg-white/5 text-white/40'}`}
                      >
                        DATA
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                          Move {playbackIndex + 1} of {selectedMatch?.moves?.length || 0}
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              setIsPlaying(false);
                              setPlaybackIndex(0);
                            }}
                            className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/60"
                          >
                            <RotateCcw size={14} />
                          </button>
                          <button 
                            onClick={() => {
                              setIsPlaying(false);
                              setPlaybackIndex(prev => Math.max(0, prev - 1));
                            }}
                            className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/60"
                          >
                            <ChevronRight size={14} className="rotate-180" />
                          </button>
                          <button 
                            onClick={() => setIsPlaying(!isPlaying)}
                            className="p-1.5 bg-red-500 hover:bg-red-600 rounded-lg text-white"
                          >
                            {isPlaying ? <RotateCcw size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                          </button>
                          <button 
                            onClick={() => {
                              setIsPlaying(false);
                              setPlaybackIndex(prev => Math.min(selectedMatch.moves.length - 1, prev + 1));
                            }}
                            className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/60"
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="aspect-[7/6] w-full bg-[#0a0a0a] rounded-xl border border-white/10 grid grid-cols-7 grid-rows-6 gap-1 p-2">
                        {selectedMatch?.moves?.[playbackIndex]?.board_state?.map((row: any, r: number) => row.map((cell: any, c: number) => (
                          <div key={`${r}-${c}`} className="w-full h-full rounded-full overflow-hidden">
                            {renderCell(cell === 0 ? null : cell === 1 ? 1 : 2)}
                          </div>
                        )))}
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="space-y-4">
                        <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Match Summary</div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                            <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Winner</div>
                            <div className={`text-xl font-bold ${
                              selectedMatch?.match?.winner === '1' ? 'text-red-500' : selectedMatch?.match?.winner === '2' ? 'text-yellow-500' : 'text-white'
                            }`}>
                              {selectedMatch?.match?.winner === 'draw' ? 'DRAW' : selectedMatch?.match?.winner ? `Player ${selectedMatch.match.winner}` : 'N/A'}
                            </div>
                          </div>
                          <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                            <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Total Moves</div>
                            <div className="text-xl font-bold text-white">{selectedMatch.moves.length}</div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">NNUE Analysis</div>
                        <div className="bg-[#0a0a0a] p-4 rounded-xl border border-white/5 space-y-4">
                          <div className="flex items-center gap-2 text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-2">
                            <Brain size={12} />
                            Input (84 Neurons)
                          </div>
                          
                          {(() => {
                            const currentMove = selectedMatch?.moves?.[playbackIndex];
                            if (!currentMove) return null;
                            const board = currentMove.board_state;
                            if (!board) return null;
                            
                            // Reconstruct bitboard for current player
                            // In the saved data, 1 is P1, -1 is P2
                            let pos = 0n;
                            let mask = 0n;
                            const currentPlayer = (playbackIndex % 2 === 0) ? 1 : -1;
                            
                            for (let c = 0; c < 7; c++) {
                              for (let r = 0; r < 6; r++) {
                                const cell = board[r][c];
                                if (cell !== 0) {
                                  const bit = 1n << BigInt(c * 7 + (5 - r));
                                  mask |= bit;
                                  if (cell === currentPlayer) {
                                    pos |= bit;
                                  }
                                }
                              }
                            }
                            
                            const nnue = getNNUEInput(pos, mask);
                            
                            return (
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <div className="text-[8px] text-white/20 uppercase">Current Player (42)</div>
                                  <div className="grid grid-cols-7 gap-1">
                                    {nnue.currentPlayerBits.map((bit, i) => (
                                      <div 
                                        key={`cp-${i}`}
                                        className={`aspect-square rounded-sm ${bit ? 'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]' : 'bg-white/5'}`}
                                      />
                                    ))}
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <div className="text-[8px] text-white/20 uppercase">Opponent (42)</div>
                                  <div className="grid grid-cols-7 gap-1">
                                    {nnue.opponentBits.map((bit, i) => (
                                      <div 
                                        key={`op-${i}`}
                                        className={`aspect-square rounded-sm ${bit ? 'bg-white/40' : 'bg-white/5'}`}
                                      />
                                    ))}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/5">
                            <div>
                              <div className="text-[8px] text-white/20 uppercase mb-1">NNUE Output</div>
                              <div className="text-lg font-mono font-bold text-purple-400">
                                {(() => {
                                  const move = selectedMatch?.moves?.[playbackIndex];
                                  if (!move) return 'N/A';
                                  const { position, mask } = toBitboard(move.board);
                                  return evaluateNNUE(position, mask).toFixed(2);
                                })()}
                              </div>
                            </div>
                            <div>
                              <div className="text-[8px] text-white/20 uppercase mb-1">Reward</div>
                              <div className={`text-lg font-mono font-bold ${
                                selectedMatch?.moves?.[playbackIndex]?.final_result > 0 ? 'text-red-500' : 
                                selectedMatch?.moves?.[playbackIndex]?.final_result < 0 ? 'text-yellow-500' : 'text-white/40'
                              }`}>
                                {selectedMatch?.moves?.[playbackIndex]?.final_result > 0 ? '+1.0' : 
                                 selectedMatch?.moves?.[playbackIndex]?.final_result < 0 ? '-1.0' : '0.0'}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Move History</div>
                        <div className="bg-[#0a0a0a] rounded-xl border border-white/5 max-h-[200px] overflow-y-auto p-2 space-y-1">
                          {selectedMatch?.moves?.map((move: any, i: number) => (
                            <div key={i} className="flex items-center justify-between p-2 hover:bg-white/5 rounded-lg text-[10px] font-mono">
                              <span className="text-white/40">MOVE {i + 1}</span>
                              <div className="flex items-center gap-4">
                                <span className={move?.final_result === 1 ? 'text-red-500' : move?.final_result === -1 ? 'text-yellow-500' : 'text-white'}>
                                  {move?.move_made === -1 ? 'TERMINAL' : `COL ${move?.move_made + 1}`}
                                </span>
                                <span className="text-white/20">RESULT: {move?.final_result}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-white/20 space-y-4 border-2 border-dashed border-white/5 rounded-2xl">
                  <Eye size={48} />
                  <p className="text-sm font-mono uppercase tracking-widest">Select a match to analyze training data</p>
                </div>
              )}
            </div>
          </div>
        )}
        {activeTab === 'nnue' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-8"
          >
            <div className="lg:col-span-2 space-y-8">
              <div className="bg-[#111] rounded-3xl p-8 border border-white/5 shadow-2xl">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center text-red-500">
                      <Brain size={24} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold tracking-tight">NNUE Brain</h2>
                      <p className="text-xs text-white/40 uppercase tracking-widest font-bold">Multi-Layer Architecture (84 → 16 → 1)</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 mr-4">
                      <button
                        onClick={() => switchBrain('kaggle')}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeBrainSource === 'kaggle' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                      >
                        KAGGLE BRAIN
                      </button>
                      <button
                        onClick={() => switchBrain('user')}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeBrainSource === 'user' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                      >
                        SAVED BRAIN
                      </button>
                      <button
                        onClick={() => switchBrain('both')}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeBrainSource === 'both' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                      >
                        BOTH
                      </button>
                    </div>
                    <div className="flex items-center gap-4 px-4 py-2 bg-white/5 rounded-xl border border-white/5 mr-2">
                      <div className="flex flex-col">
                        <span className="text-[8px] uppercase tracking-widest text-white/40 font-bold">Epochs</span>
                        <div className="flex items-center gap-2">
                          <input 
                            type="range" 
                            min="1" 
                            max="100" 
                            value={trainingEpochs}
                            onChange={(e) => setTrainingEpochs(parseInt(e.target.value))}
                            className="w-24 accent-red-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                          />
                          <span className="text-xs font-mono text-red-500 w-6">{trainingEpochs}</span>
                        </div>
                      </div>
                      <div className="h-6 w-px bg-white/10" />
                      <button
                        onClick={() => setFocusMode(!focusMode)}
                        className={`flex flex-col items-center transition-all ${focusMode ? 'text-red-500' : 'text-white/20'}`}
                      >
                        <span className="text-[8px] uppercase tracking-widest font-bold">Focus Mode</span>
                        <Eye size={14} />
                      </button>
                    </div>
                    <button 
                      onClick={resetWeights}
                      disabled={isTraining}
                      className={`px-4 py-2.5 rounded-xl font-bold text-sm transition-all border ${
                        isResetting 
                          ? 'bg-red-500 text-white border-red-400 animate-pulse' 
                          : 'bg-white/5 text-white/40 hover:text-white border-white/5 hover:bg-white/10'
                      }`}
                    >
                      {isResetting ? 'Confirm Reset?' : 'Reset'}
                    </button>
                    <button 
                      onClick={trainNNUE}
                      disabled={isTraining}
                      className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all shadow-lg shadow-red-500/20"
                    >
                      <Zap size={16} className={isTraining ? 'animate-pulse' : ''} />
                      {isTraining ? 'Training...' : 'Train on Match Data'}
                    </button>
                  </div>
                  {trainingError && (
                    <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-mono">
                      <p className="font-bold uppercase mb-1">Training Error:</p>
                      {trainingError}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                    <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-1">Match Moves</p>
                    <p className="text-xl font-mono text-red-500">{dbCounts.moves}</p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                    <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-1">Kaggle Data</p>
                    <p className="text-xl font-mono text-red-500">{dbCounts.kaggle || 0}</p>
                  </div>
                </div>

                {trainingStats && !isTraining && (
                  <div className="mb-8 p-4 bg-white/5 rounded-2xl border border-white/5 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-1">Last Training: Moves</p>
                      <p className="text-xl font-mono text-red-500">{trainingStats.movesTrained}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-1">Last Training: Accuracy</p>
                      <p className="text-xl font-mono text-red-500">{(trainingStats.accuracy * 100).toFixed(2)}%</p>
                    </div>
                  </div>
                )}

                <div className="space-y-6">
                  {nnueWeights ? (
                    <NNUEVisualizer weights={nnueWeights} progress={trainingProgress} />
                  ) : (
                    <div className="py-12 text-center text-white/20 italic">
                      Loading weights...
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-8">
              <div className="bg-[#111] rounded-3xl p-8 border border-white/5 shadow-2xl">
                <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
                  <Upload size={16} className="text-red-500" />
                  Bulk Data Import
                </h3>
                <div className="space-y-4">
                  <p className="text-xs text-white/40 leading-relaxed">
                    Paste Kaggle/UCI training data below, drag and drop a .csv/.txt file, or import from Google Sheets.
                  </p>
                  
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Google Sheet ID"
                      className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-xs font-mono text-white/60 focus:border-red-500/50 focus:outline-none"
                      id="sheetIdInput"
                    />
                    <button 
                      onClick={async () => {
                        const sheetId = (document.getElementById('sheetIdInput') as HTMLInputElement).value;
                        if (!sheetId) return alert("Please enter a Google Sheet ID");
                        
                        setIsImporting(true);
                        try {
                          // Note: This requires the sheet to be public or the server to have access
                          const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`);
                          if (!res.ok) throw new Error("Failed to fetch sheet. Ensure it is public (Anyone with the link can view).");
                          const csvData = await res.text();
                          await importKaggleData(csvData);
                        } catch (err) {
                          alert(`Google Sheets Import Error: ${err instanceof Error ? err.message : String(err)}`);
                        } finally {
                          setIsImporting(false);
                        }
                      }}
                      disabled={isImporting}
                      className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all"
                    >
                      {isImporting ? 'IMPORTING...' : 'IMPORT FROM SHEET'}
                    </button>
                  </div>

                  <div 
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleFileDrop}
                    className={`relative group transition-all duration-300 ${isDragging ? 'scale-[1.02]' : ''}`}
                  >
                    <textarea
                      value={kaggleData}
                      onChange={(e) => setKaggleData(e.target.value)}
                      placeholder="1 1 1 -1 -1 1 0 ..."
                      className={`w-full h-32 bg-black/40 border rounded-xl p-3 text-[10px] font-mono text-white/60 focus:border-red-500/50 focus:outline-none transition-all resize-none ${
                        isDragging ? 'border-red-500 bg-red-500/5' : 'border-white/10'
                      }`}
                    />
                    {isDragging && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-500/10 backdrop-blur-[2px] rounded-xl pointer-events-none border-2 border-dashed border-red-500/50">
                        <Upload className="text-red-500 animate-bounce mb-2" size={32} />
                        <span className="text-xs font-bold text-red-500 uppercase tracking-widest">Drop File to Import</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => importKaggleData()}
                    disabled={isImporting || !kaggleData.trim()}
                    className="w-full bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all border border-white/5"
                  >
                    {isImporting ? (
                      <Activity size={14} className="animate-spin" />
                    ) : (
                      <Database size={14} />
                    )}
                    {isImporting ? 'Importing...' : 'Import to Database'}
                  </button>
                  {importResult && (
                    <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-500 text-[10px] font-bold flex items-center gap-2">
                      <Trophy size={12} />
                      Successfully imported {importResult.count} positions!
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-[#111] rounded-3xl p-8 border border-white/5 shadow-2xl">
                <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
                  <Activity size={16} className="text-red-500" />
                  Training Info
                </h3>
                <div className="space-y-4 text-sm text-white/60 leading-relaxed">
                  <p>
                    The NNUE (Efficiently Updatable Neural Network) uses a multi-layer "Brain" architecture.
                  </p>
                  <ul className="list-disc list-inside space-y-2 text-xs">
                    <li>Input Layer: 84 neurons (42 P1, 42 P2)</li>
                    <li>Hidden Layer: 16 neurons (Pattern Detectors)</li>
                    <li>Output Layer: 1 neuron (Judgment)</li>
                    <li>Activation: Sigmoid (Hidden) & Tanh (Output)</li>
                  </ul>
                  <p className="text-xs bg-red-500/10 p-3 rounded-xl text-red-500 border border-red-500/20">
                    Training uses Backpropagation with Stochastic Gradient Descent (SGD) move-by-move.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
        {activeTab === 'practice' && (
          <div className="flex flex-col items-center gap-8">
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-bold tracking-tighter italic serif">PRACTICE <span className="text-red-500">MODE</span></h2>
              <p className="text-sm text-white/40 font-mono uppercase tracking-widest">Human (Yellow) vs NNUE AI (Red)</p>
            </div>
            
            <div className="relative group">
              <Board 
                board={gameState.board} 
                onColumnClick={handleHumanMove}
                disabled={gameState.currentPlayer === 1 || !!gameState.winner || gameState.isThinking}
              />
              
              <AnimatePresence>
                {gameState.winner && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-3xl"
                  >
                    <div className="text-center p-8 bg-[#111] border border-white/10 rounded-3xl shadow-2xl space-y-6">
                      <Trophy size={64} className="mx-auto text-yellow-500" />
                      <div className="text-4xl font-bold tracking-tighter italic serif">
                        {gameState.winner === 'draw' ? 'DRAW' : `${gameState.winner === 2 ? 'YOU WIN!' : 'AI WINS'}`}
                      </div>
                      <button
                        onClick={resetGame}
                        className="bg-white text-black px-8 py-3 rounded-xl font-bold hover:bg-white/90 transition-all active:scale-95"
                      >
                        PLAY AGAIN
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {gameState.isThinking && (
              <div className="flex items-center gap-3 text-red-500 font-mono text-sm animate-pulse">
                <Brain size={16} />
                AI IS ANALYZING WITH NNUE...
              </div>
            )}
          </div>
        )}
      </div>

      {/* Background Ambience */}
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-red-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-yellow-500/5 blur-[120px] rounded-full" />
      </div>
    </div>
  );
}
