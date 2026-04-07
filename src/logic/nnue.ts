/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Board, ROWS, COLS } from '../types';
import { toBitboard } from './connect4';

/**
 * NNUE (Efficiently Updatable Neural Network) Architecture for Connect 4
 * 
 * INPUT: 84 Neurons
 * - 42 neurons: Current player's pieces (1 if piece exists at bit, 0 otherwise)
 * - 42 neurons: Opponent's pieces (1 if piece exists at bit, 0 otherwise)
 * 
 * OUTPUT: 1 Neuron (Value)
 * - Range: [-1.0, 1.0]
 * - Represents the expected outcome from the current player's perspective.
 * 
 * REWARDS:
 * - Win: +1.0
 * - Loss: -1.0
 * - Draw: 0.0
 */

export interface NNUEInput {
  currentPlayerBits: number[]; // 42 elements
  opponentBits: number[];      // 42 elements
}

export interface NNUELevel {
  biases: number[];
  inputs: number[];
  outputs: number[];
  weights: number[][]; // weights[inputIndex][outputIndex]
}

export interface NNUEWeights {
  brain: {
    levels: NNUELevel[];
  };
  fitness?: number;
  generation?: number;
}

let currentWeights: NNUEWeights | null = null;

export function setWeights(weights: NNUEWeights) {
  currentWeights = weights;
}

export async function fetchNNUEWeights(source: string = 'both') {
  try {
    const res = await fetch(`/api/nnue/weights?source=${source}`);
    const data = await res.json();
    
    let weights: NNUEWeights;
    if (data.brain) {
      weights = data;
    } else {
      // Convert old format to new format if necessary
      weights = {
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
              biases: [0],
              weights: new Array(16).fill(0).map(() => [Math.random() * 0.2 - 0.1])
            }
          ]
        }
      };
    }
    
    currentWeights = weights;
    return currentWeights;
  } catch (err) {
    console.error("Failed to fetch NNUE weights:", err);
    return null;
  }
}

/**
 * Converts a bitboard state into NNUE input neurons.
 * This is "perspective-aware": the first 42 neurons are ALWAYS the current player.
 */
export function getNNUEInput(position: bigint, mask: bigint): NNUEInput {
  const currentPlayerBits: number[] = new Array(42).fill(0);
  const opponentBits: number[] = new Array(42).fill(0);
  
  const opponent = position ^ mask;
  
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      // Bitboard layout: c * 7 + (ROWS - 1 - r)
      const bitIndex = c * 7 + (ROWS - 1 - r);
      const bit = 1n << BigInt(bitIndex);
      const neuronIndex = c * ROWS + r; // Flattened 42-cell index
      
      if ((position & bit) !== 0n) {
        currentPlayerBits[neuronIndex] = 1;
      } else if ((opponent & bit) !== 0n) {
        opponentBits[neuronIndex] = 1;
      }
    }
  }
  
  return { currentPlayerBits, opponentBits };
}

/**
 * NNUE Evaluation using multi-layer "Brain" architecture.
 * Optimized for performance by using pre-allocated arrays and avoiding redundant work.
 */
const INPUT_SIZE = 84;
const HIDDEN_SIZE = 16;
const inputBuffer = new Float32Array(INPUT_SIZE);
const hiddenBuffer = new Float32Array(HIDDEN_SIZE);

export function evaluateNNUE(position: bigint, mask: bigint): number {
  if (!currentWeights) {
    return 0.0;
  }

  const levels = currentWeights.brain.levels;
  if (levels.length < 2) return 0.0;

  // 1. Prepare Input (Sparse Update)
  inputBuffer.fill(0);
  const opponent = position ^ mask;
  
  for (let c = 0; c < COLS; c++) {
    const colShift = BigInt(c * 7);
    const pBits = Number((position >> colShift) & 0x3Fn);
    const oBits = Number((opponent >> colShift) & 0x3Fn);
    const colOffset = c * ROWS;
    
    if (pBits !== 0) {
      if (pBits & 0x20) inputBuffer[colOffset] = 1;     // Row 0 (Top)
      if (pBits & 0x10) inputBuffer[colOffset + 1] = 1; // Row 1
      if (pBits & 0x08) inputBuffer[colOffset + 2] = 1; // Row 2
      if (pBits & 0x04) inputBuffer[colOffset + 3] = 1; // Row 3
      if (pBits & 0x02) inputBuffer[colOffset + 4] = 1; // Row 4
      if (pBits & 0x01) inputBuffer[colOffset + 5] = 1; // Row 5 (Bottom)
    }
    
    if (oBits !== 0) {
      if (oBits & 0x20) inputBuffer[colOffset + 42] = 1;
      if (oBits & 0x10) inputBuffer[colOffset + 43] = 1;
      if (oBits & 0x08) inputBuffer[colOffset + 44] = 1;
      if (oBits & 0x04) inputBuffer[colOffset + 45] = 1;
      if (oBits & 0x02) inputBuffer[colOffset + 46] = 1;
      if (oBits & 0x01) inputBuffer[colOffset + 47] = 1;
    }
  }

  // 2. Hidden Layer (Layer 0)
  const level0 = levels[0];
  const weights0 = level0.weights;
  const biases0 = level0.biases;
  
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    let sum = biases0[j];
    for (let i = 0; i < INPUT_SIZE; i++) {
      if (inputBuffer[i] === 1) {
        sum += weights0[i][j];
      }
    }
    // Sigmoid activation
    hiddenBuffer[j] = 1 / (1 + Math.exp(-sum));
  }

  // 3. Output Layer (Layer 1)
  const level1 = levels[1];
  const weights1 = level1.weights;
  const biases1 = level1.biases;
  
  let finalSum = biases1[0];
  for (let i = 0; i < HIDDEN_SIZE; i++) {
    finalSum += hiddenBuffer[i] * weights1[i][0];
  }
  
  return Math.tanh(finalSum);
}
