import React from 'react';
import { motion } from 'motion/react';
import { NNUEWeights, NNUELevel } from '../logic/nnue';
import { TrainingProgress } from '../logic/training';
import { Board } from '../types';

interface NNUEVisualizerProps {
  weights: NNUEWeights;
  progress: TrainingProgress | null;
}

const MiniBoard: React.FC<{ board: Board }> = ({ board }) => {
  return (
    <div className="grid grid-cols-7 gap-1 bg-white/5 p-2 rounded-xl border border-white/10 w-fit mx-auto">
      {board.map((row, r) => 
        row.map((cell, c) => (
          <div 
            key={`${r}-${c}`} 
            className={`w-4 h-4 rounded-full border border-white/5 ${
              cell === 1 ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]' : 
              cell === 2 ? 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.4)]' : 
              'bg-white/5'
            }`}
          />
        ))
      )}
    </div>
  );
};

export const NNUEVisualizer: React.FC<NNUEVisualizerProps> = ({ weights, progress }) => {
  const level0 = weights.brain.levels[0];
  
  // Calculate heatmap for Level 0 weights (84 x 16)
  // We'll show a grid of 16 neurons, each showing its 84 weights as a 6x7 board
  
  return (
    <div className="space-y-8">
      {/* NNUE Description */}
      <div className="bg-red-500/5 p-6 rounded-3xl border border-red-500/10 space-y-4">
        <h3 className="text-sm font-bold text-red-500 uppercase tracking-widest">What is NNUE?</h3>
        <p className="text-sm text-white/60 leading-relaxed">
          <span className="text-white font-bold">Efficiently Updatable Neural Network.</span> Unlike deep networks that look at pixels, NNUE looks at the board state directly. 
          It is designed to be extremely fast, allowing the AI to evaluate thousands of positions per second.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="space-y-2">
            <p className="text-white font-bold">Perspective-Aware Input</p>
            <p className="text-white/40">The AI always sees the board from its own point of view. The first 42 neurons are its pieces, the next 42 are the opponent's.</p>
          </div>
          <div className="space-y-2">
            <p className="text-white font-bold">The Reward System</p>
            <p className="text-white/40">We use <span className="text-red-400">Supervised Learning</span>. If a move led to a win, the "Teacher" tells the brain the target is +1.0. If it lost, the target is -1.0. The brain adjusts its weights to minimize the prediction error.</p>
          </div>
        </div>
      </div>

      {/* Training Progress Bar & Preview */}
      {progress ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white/5 p-6 rounded-3xl border border-white/10 space-y-4">
            <div className="flex justify-between items-end">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-1">Training Progress</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-mono text-white">
                    {progress.currentMove} <span className="text-white/20">/ {progress.totalMoves}</span>
                  </p>
                  {progress.totalEpochs > 1 && (
                    <p className="text-xs font-mono text-red-500/60">
                      EPOCH {progress.epoch}/{progress.totalEpochs}
                    </p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-1">Accuracy</p>
                <p className="text-2xl font-mono text-red-500">{(progress.avgAccuracy * 100).toFixed(2)}%</p>
              </div>
            </div>
            
            <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
              <motion.div 
                className="h-full bg-red-500"
                initial={{ width: 0 }}
                animate={{ width: `${(progress.currentMove / progress.totalMoves) * 100}%` }}
                transition={{ duration: 0.1 }}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-1">Last Prediction</p>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${progress.prediction > 0 ? 'bg-red-500' : 'bg-yellow-500'}`} />
                  <p className="text-sm font-mono">{progress.prediction.toFixed(3)}</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-1">Actual Result</p>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${progress.target > 0 ? 'bg-red-500' : progress.target < 0 ? 'bg-yellow-500' : 'bg-white/20'}`} />
                  <p className="text-sm font-mono">{progress.target.toFixed(1)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white/5 p-6 rounded-3xl border border-white/10 flex flex-col items-center justify-center space-y-4">
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Studying Position</p>
            <MiniBoard board={progress.board} />
            <p className="text-[10px] text-white/20 font-mono">MOVE #{progress.currentMove}</p>
          </div>
        </div>
      ) : (
        <div className="bg-white/5 p-12 rounded-3xl border border-white/10 flex flex-col items-center justify-center space-y-4 text-center">
          <div className="w-12 h-12 border-2 border-red-500/20 border-t-red-500 rounded-full animate-spin" />
          <p className="text-sm text-white/40 font-mono uppercase tracking-widest">Awaiting Training Data...</p>
        </div>
      )}

      {/* Weight Heatmap (Level 0) */}
      <div className="space-y-4">
        <h3 className="text-xs uppercase tracking-widest text-white/40 font-bold">Feature Detectors (Hidden Layer)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
          {level0.biases.map((bias, neuronIdx) => (
            <div key={neuronIdx} className="space-y-2">
              <div className="aspect-[7/6] bg-white/5 rounded-lg border border-white/5 p-1 grid grid-cols-7 gap-0.5">
                {new Array(42).fill(0).map((_, cellIdx) => {
                  const w1 = Number(level0.weights[cellIdx][neuronIdx]) || 0;
                  const w2 = Number(level0.weights[42 + cellIdx][neuronIdx]) || 0;
                  const val = w1 - w2; // Difference in importance for P1 vs P2
                  const opacity = Math.min(Math.abs(val) * 2, 1);
                  const color = val > 0 ? `rgba(239, 68, 68, ${opacity})` : `rgba(234, 179, 8, ${opacity})`;
                  
                  return (
                    <div 
                      key={cellIdx} 
                      className="rounded-[1px]" 
                      style={{ backgroundColor: color }}
                      title={`P1: ${w1.toFixed(3)}, P2: ${w2.toFixed(3)}`}
                    />
                  );
                })}
              </div>
              <p className="text-[8px] text-center font-mono text-white/20">NEURON #{neuronIdx}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Level 1 Weights */}
      <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
        <h3 className="text-xs uppercase tracking-widest text-white/40 font-bold mb-4">Output Layer (Judgment)</h3>
        <div className="flex items-center gap-4">
          {weights.brain.levels[1].weights.map((w, i) => {
            const val = Number(w[0]) || 0;
            return (
              <div key={i} className="flex-1 space-y-2">
                <div className="h-12 bg-white/5 rounded-xl border border-white/5 relative overflow-hidden">
                  <motion.div 
                    className={`absolute bottom-0 left-0 right-0 ${val > 0 ? 'bg-red-500/40' : 'bg-yellow-500/40'}`}
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.min(Math.abs(val), 1) * 100}%` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono">
                    {val.toFixed(2)}
                  </div>
                </div>
                <p className="text-[8px] text-center font-mono text-white/20">H-{i}</p>
              </div>
            );
          })}
          <div className="w-px h-12 bg-white/10 mx-2" />
          <div className="space-y-2">
            <div className="h-12 w-16 bg-white/10 rounded-xl border border-white/20 flex items-center justify-center text-xs font-mono text-red-500">
              {(Number(weights.brain.levels[1].biases[0]) || 0).toFixed(2)}
            </div>
            <p className="text-[8px] text-center font-mono text-white/20">BIAS</p>
          </div>
        </div>
      </div>
    </div>
  );
};
