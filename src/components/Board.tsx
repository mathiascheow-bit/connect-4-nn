/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, AnimatePresence } from 'motion/react';
import { Star, Check, AlertTriangle, HelpCircle, XCircle } from 'lucide-react';
import { Board as BoardType, Player, ROWS, COLS } from '../types';

export type MoveQuality = 'brilliant' | 'best' | 'inaccuracy' | 'mistake' | 'blunder';

interface BoardProps {
  board: BoardType;
  onColumnClick: (col: number) => void;
  disabled: boolean;
  winningCells?: [number, number][];
  lastMove?: { row: number, col: number, quality?: MoveQuality };
}

export default function Board({ board, onColumnClick, disabled, winningCells, lastMove }: BoardProps) {
  const getQualityIcon = (quality: MoveQuality) => {
    switch (quality) {
      case 'brilliant': return <Star size={16} className="text-blue-400 fill-blue-400" />;
      case 'best': return <Check size={16} className="text-emerald-500" />;
      case 'inaccuracy': return <HelpCircle size={16} className="text-yellow-500" />;
      case 'mistake': return <AlertTriangle size={16} className="text-orange-500" />;
      case 'blunder': return <XCircle size={16} className="text-red-500" />;
      default: return null;
    }
  };

  const getQualityLabel = (quality: MoveQuality) => {
    switch (quality) {
      case 'brilliant': return 'BRILLIANT';
      case 'best': return 'BEST';
      case 'inaccuracy': return 'INACCURACY';
      case 'mistake': return 'MISTAKE';
      case 'blunder': return 'BLUNDER';
      default: return '';
    }
  };

  return (
    <div className="relative bg-[#1a1a1a] p-2 md:p-4 rounded-xl border border-[#333] shadow-2xl overflow-hidden w-full max-w-[min(90vw,70vh)] aspect-[7/6]">
      {/* Board Grid */}
      <div className="grid grid-cols-7 gap-1 md:gap-2 h-full w-full relative z-10">
        {Array.from({ length: COLS }).map((_, colIndex) => (
          <div
            key={colIndex}
            onClick={() => !disabled && onColumnClick(colIndex)}
            className={`flex flex-col gap-1 md:gap-2 cursor-pointer group h-full ${disabled ? 'cursor-not-allowed' : ''}`}
          >
            {Array.from({ length: ROWS }).map((_, rowIndex) => {
              const cell = board[rowIndex][colIndex];
              const isWinning = winningCells?.some(([r, c]) => r === rowIndex && c === colIndex);

              return (
                <div
                  key={rowIndex}
                  className="flex-1 aspect-square rounded-full bg-[#0a0a0a] border border-[#222] flex items-center justify-center relative shadow-inner"
                >
                  <AnimatePresence>
                    {cell && (
                      <motion.div
                        initial={{ y: -400, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: 'spring', damping: 15, stiffness: 100 }}
                        className={`w-[80%] h-[80%] rounded-full shadow-lg ${
                          cell === 1 ? 'bg-red-500' : 'bg-yellow-400'
                        } ${isWinning ? 'ring-2 md:ring-4 ring-white animate-pulse' : ''}`}
                      />
                    )}
                  </AnimatePresence>

                  {/* Move Quality Indicator */}
                  {lastMove && lastMove.row === rowIndex && lastMove.col === colIndex && lastMove.quality && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="absolute -right-2 -top-2 z-20 bg-[#111] border border-white/10 rounded-full p-1 shadow-lg flex items-center gap-1"
                    >
                      {getQualityIcon(lastMove.quality)}
                      <span className={`text-[8px] font-bold pr-1 ${
                        lastMove.quality === 'brilliant' ? 'text-blue-400' :
                        lastMove.quality === 'best' ? 'text-emerald-500' :
                        lastMove.quality === 'inaccuracy' ? 'text-yellow-500' :
                        lastMove.quality === 'mistake' ? 'text-orange-500' : 'text-red-500'
                      }`}>
                        {getQualityLabel(lastMove.quality)}
                      </span>
                    </motion.div>
                  )}
                  
                  {/* Hover indicator */}
                  {!cell && !disabled && (
                    <div className="absolute inset-0 rounded-full bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Background Grid Lines */}
      <div className="absolute inset-0 pointer-events-none opacity-10">
        <div className="w-full h-full grid grid-cols-7 grid-rows-6">
          {Array.from({ length: 42 }).map((_, i) => (
            <div key={i} className="border border-white/20" />
          ))}
        </div>
      </div>
    </div>
  );
}
