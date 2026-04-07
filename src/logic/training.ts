import { NNUEWeights, NNUELevel } from './nnue';
import { Board } from '../types';

export interface TrainingProgress {
  currentMove: number;
  totalMoves: number;
  error: number;
  avgError: number;
  accuracy: number;
  avgAccuracy: number;
  prediction: number;
  target: number;
  weights: NNUEWeights;
  board: Board;
  epoch: number;
  totalEpochs: number;
}

export async function* trainNNUE(
  moves: any[],
  initialWeights: NNUEWeights,
  learningRate: number = 0.01,
  epochs: number = 1,
  focusMode: boolean = false
): AsyncGenerator<TrainingProgress> {
  const weights = JSON.parse(JSON.stringify(initialWeights)) as NNUEWeights;
  let totalError = 0;
  let totalCorrect = 0;
  let moveCount = 0;
  const totalSteps = moves.length * epochs;
  let currentStep = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      const originalBoard = move.board_state;
      const target = move.final_result;

      if (!originalBoard || !Array.isArray(originalBoard)) {
        console.warn(`Skipping move ${i} due to missing board state`, move);
        continue;
      }

      // Ensure every row is also an array
      if (originalBoard.some(row => !Array.isArray(row))) {
        console.warn(`Skipping move ${i} due to malformed board rows`, move);
        continue;
      }

      // Data Augmentation: Train on original and mirrored board
      const boardsToTrain = [originalBoard];
      
      // Create mirrored board
      const mirroredBoard: Board = originalBoard.map(row => [...row].reverse());
      boardsToTrain.push(mirroredBoard);

      for (const board of boardsToTrain) {
        currentStep++;
        
        // 1. Prepare Inputs (84) - Perspective Aware
        const inputs = new Array(84).fill(0);
        let p1Count = 0;
        let p2Count = 0;
        for (let c = 0; c < 7; c++) {
          for (let r = 0; r < 6; r++) {
            const val = board[r][c];
            if (val === 1 || val === '1' || val === 'x') p1Count++;
            else if (val === 2 || val === '2' || val === 'o' || val === -1 || val === '-1') p2Count++;
          }
        }
        
        const isP1Turn = p1Count === p2Count;
        const currentPlayer = isP1Turn ? 1 : 2;
        const opponent = isP1Turn ? 2 : 1;
        const perspectiveTarget = isP1Turn ? target : -target;

        for (let c = 0; c < 7; c++) {
          for (let r = 0; r < 6; r++) {
            const val = board[r][c];
            const neuronIndex = c * 6 + r;
            
            // Simplified input preparation (assuming normalized data from server)
            if (val === currentPlayer) inputs[neuronIndex] = 1;
            else if (val === opponent) inputs[42 + neuronIndex] = 1;
          }
        }

        // 2. Forward Pass
        const levels = weights?.brain?.levels;
        if (!levels) {
          console.error("Training failed: weights.brain.levels is missing");
          return;
        }
        const layerInputs: number[][] = [inputs];
        const layerOutputs: number[][] = [];

        let currentInputs = inputs;
        for (let l = 0; l < levels.length; l++) {
          const level = levels[l];
          const outputs: number[] = new Array(level.biases.length).fill(0);
          
          for (let j = 0; j < level.biases.length; j++) {
            let sum = Number(level.biases[j]);
            for (let k = 0; k < currentInputs.length; k++) {
              sum += currentInputs[k] * Number(level.weights[k][j]);
            }
            
            if (l === levels.length - 1) {
              outputs[j] = Math.tanh(sum);
            } else {
              outputs[j] = 1 / (1 + Math.exp(-sum)); // Sigmoid
            }
          }
          layerOutputs.push(outputs);
          currentInputs = outputs;
          layerInputs.push(outputs);
        }

        const prediction = layerOutputs[levels.length - 1][0];
        const error = perspectiveTarget - prediction;
        totalError += error * error;
        
        // Accuracy: Check if prediction sign matches target sign
        let isCorrect = false;
        if (perspectiveTarget > 0) isCorrect = prediction > 0;
        else if (perspectiveTarget < 0) isCorrect = prediction < 0;
        else isCorrect = Math.abs(prediction) <= 0.05; // Draw is correct if close to 0
        
        if (isCorrect) totalCorrect++;
        moveCount++;

        // 3. Backward Pass (Backpropagation)
        let delta: number | number[] = error * (1 - prediction * prediction); // Derivative of tanh

        for (let l = levels.length - 1; l >= 0; l--) {
          const level = levels[l];
          const inputsForLayer = layerInputs[l];
          const outputsForLayer = layerOutputs[l];
          const prevLayerOutputs = l > 0 ? layerOutputs[l - 1] : null;
          
          const nextDeltas: number[] = new Array(inputsForLayer.length).fill(0);

          for (let j = 0; j < level.biases.length; j++) {
            const currentDelta = Array.isArray(delta) ? delta[j] : delta;
            
            // Update biases - Use higher precision (12 decimals)
            const newBias = Number(level.biases[j]) + learningRate * currentDelta;
            if (!isNaN(newBias)) {
              level.biases[j] = Number(newBias.toFixed(12));
            }
            
            for (let k = 0; k < inputsForLayer.length; k++) {
              // Accumulate error for the layer below
              nextDeltas[k] += currentDelta * Number(level.weights[k][j]);
              
              // Update weights - Use higher precision (12 decimals)
              const newWeight = Number(level.weights[k][j]) + learningRate * currentDelta * inputsForLayer[k];
              if (!isNaN(newWeight)) {
                level.weights[k][j] = Number(newWeight.toFixed(12));
              }
            }
          }

          // Calculate deltas for the previous layer
          if (l > 0 && prevLayerOutputs && nextDeltas) {
            // Derivative of Sigmoid: σ(x) * (1 - σ(x))
            delta = nextDeltas.map((d, idx) => {
              const prevOut = prevLayerOutputs[idx] || 0;
              return d * prevOut * (1 - prevOut);
            });
          }
        }

        if (focusMode) {
          await new Promise(resolve => setTimeout(resolve, 50)); // Slow down for focus mode
        }

        yield {
          currentMove: currentStep,
          totalMoves: totalSteps * 2, // Account for mirroring
          error: error * error,
          avgError: totalError / moveCount,
          accuracy: isCorrect ? 1 : 0,
          avgAccuracy: totalCorrect / moveCount,
          prediction,
          target,
          weights,
          board,
          epoch: epoch + 1,
          totalEpochs: epochs
        };
      }
    }
  }
}
