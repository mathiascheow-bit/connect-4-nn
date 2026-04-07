import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Brain, Circle } from 'lucide-react';
import { Board, AIConfig, COLS } from '../types';
import { toBitboard, makeMove, bitboardMinimax, getValidBitboardMoves, hasWon } from '../logic/connect4';
import { evaluateNNUE } from '../logic/nnue';

interface EvaluationBannerProps {
  board: Board;
  currentPlayer: 1 | 2;
  config: AIConfig;
}

export const EvaluationBanner: React.FC<EvaluationBannerProps> = ({ board, currentPlayer, config }) => {
  const evaluations = useMemo(() => {
    const { position, mask } = toBitboard(board);
    // In our bitboard logic, 'position' is the current player's pieces
    // However, toBitboard defaults to p1. Let's fix it for the current player.
    const p1 = position;
    const p2 = position ^ mask;
    const currentPos = currentPlayer === 1 ? p1 : p2;
    const opponentPos = currentPlayer === 1 ? p2 : p1;

    const results = Array(COLS).fill(null).map((_, col) => {
      // Check if move is valid
      if (((mask + (1n << BigInt(col * 7))) & (1n << BigInt(col * 7 + 6))) !== 0n) {
        return { valid: false, searchScore: 0, intuitionScore: 0 };
      }

      const { nextPosition, nextMask } = makeMove(currentPos, mask, col);
      
      // Intuition (NNUE) - evaluate from current player's perspective after move
      // evaluateNNUE returns score for the player whose turn it is in the bitboard
      // After makeMove, it's the opponent's turn, so we negate it
      const intuition = -evaluateNNUE(nextPosition, nextMask);
      
      // Search (Tree) - use the depth from the user's config
      const search = -bitboardMinimax(nextPosition, nextMask, config.depth, -2000000, 2000000, config, 1);

      return {
        valid: true,
        searchScore: Math.round(search),
        intuitionScore: intuition
      };
    });

    // Find best search move
    let bestSearchCol = -1;
    let maxSearchScore = -Infinity;
    results.forEach((res, col) => {
      if (res.valid && res.searchScore > maxSearchScore) {
        maxSearchScore = res.searchScore;
        bestSearchCol = col;
      }
    });

    // Find best intuition move
    let bestIntuitionCol = -1;
    let maxIntuitionScore = -Infinity;
    results.forEach((res, col) => {
      if (res.valid && res.intuitionScore > maxIntuitionScore) {
        maxIntuitionScore = res.intuitionScore;
        bestIntuitionCol = col;
      }
    });

    return { results, bestSearchCol, bestIntuitionCol, maxSearchScore };
  }, [board, currentPlayer, config]);

  const { results, bestSearchCol, bestIntuitionCol, maxSearchScore } = evaluations;

  // Determine win/loss status
  const isWin = maxSearchScore > 500000;
  const isLoss = maxSearchScore < -500000;
  const statusText = isWin ? "FORCED WIN DETECTED" : isLoss ? "CRITICAL DISADVANTAGE" : "POSITIONAL EQUILIBRIUM";
  const statusColor = isWin ? "text-emerald-500" : isLoss ? "text-red-500" : "text-white/40";

  return (
    <div className="w-full max-w-2xl mx-auto bg-[#0a0a0a] border border-white/5 rounded-2xl p-6 space-y-6 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-500/10 rounded-lg">
            <Brain className="w-5 h-5 text-red-500" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-white/90">Engine Internal Evaluation</h3>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-white/20" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">Intuition (NNUE)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">Search (Tree)</span>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-3">
        {results.map((res, col) => (
          <div key={col} className="space-y-3">
            <div className={`text-center text-[9px] font-bold uppercase tracking-widest transition-colors ${col === bestSearchCol ? 'text-red-500' : col === bestIntuitionCol ? 'text-white' : 'text-white/20'}`}>
              Col {col}
            </div>
            
            <div className={`relative group transition-all duration-300 ${
              !res.valid ? 'opacity-20' : ''
            }`}>
              {/* Search Score Box */}
              <div className={`
                aspect-[1.5/1] rounded-xl border flex flex-col items-center justify-center transition-all duration-500
                ${col === bestSearchCol 
                  ? 'bg-red-500/10 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.15)]' 
                  : 'bg-white/[0.02] border-white/5 group-hover:border-white/10'
                }
              `}>
                <span className={`text-xs font-mono font-bold ${col === bestSearchCol ? 'text-red-500' : 'text-white/60'}`}>
                  {res.valid ? (res.searchScore > 0 ? `+${res.searchScore}` : res.searchScore) : '---'}
                </span>
              </div>

              {/* Intuition Score */}
              <div className="mt-2 text-center relative">
                <span className={`text-[9px] font-mono transition-colors ${col === bestIntuitionCol ? 'text-white font-bold' : 'text-white/20'}`}>
                  {res.valid ? res.intuitionScore.toFixed(4) : '0.0000'}
                </span>
                
                {/* Intuition Best Move Indicator (White Dot) */}
                {col === bestIntuitionCol && (
                  <motion.div 
                    layoutId="best-intuition-indicator"
                    className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-1 h-1 bg-white rounded-full shadow-[0_0_4px_rgba(255,255,255,0.5)]"
                  />
                )}
              </div>

              {/* Search Best Move Indicator (Red Dot) */}
              {col === bestSearchCol && (
                <motion.div 
                  layoutId="best-search-indicator"
                  className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-[#0a0a0a] shadow-[0_0_8px_rgba(239,68,68,0.5)] z-10"
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Status */}
      <div className="pt-4 border-t border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-3 h-3 text-white/20" />
          <span className={`text-[10px] font-mono uppercase tracking-widest ${statusColor}`}>
            {statusText}
          </span>
        </div>
        <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest">
          Depth {config.depth} Search • Real-time Inference
        </div>
      </div>
    </div>
  );
};

import { Activity } from 'lucide-react';
