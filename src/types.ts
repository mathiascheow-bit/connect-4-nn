/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Player = 1 | 2 | null;
export type Board = Player[][];

export const ROWS = 6;
export const COLS = 7;

export interface GameState {
  board: Board;
  currentPlayer: 1 | 2;
  winner: Player | 'draw';
  isThinking: boolean;
  moves: { board: Board; move: number | null; player: 1 | 2 }[];
}

export interface ParallelGameState extends GameState {
  id: number;
  p1Depth: number;
  p2Depth: number;
  pairingIndex?: number;
  category?: string;
  status: 'idle' | 'running' | 'finished' | 'saving';
}

export interface AIConfig {
  depth: number;
  botType: 'nnue' | 'trainer';
}
