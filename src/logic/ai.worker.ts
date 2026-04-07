import { Board, AIConfig } from '../types';
import { minimax } from './connect4';
import { fetchNNUEWeights } from './nnue';

const ctx: Worker = self as any;

let weightsLoaded = false;

ctx.onmessage = async (event: MessageEvent) => {
  if (event.data.type === 'UPDATE_WEIGHTS') {
    const { setWeights } = await import('./nnue');
    setWeights(event.data.weights);
    weightsLoaded = true;
    return;
  }

  console.log("AI Worker received message:", event.data);
  const { board, aiConfig, config, isMaximizing, gameId } = event.data;
  
  const finalConfig: AIConfig = aiConfig || config || { depth: 4, botType: 'nnue' };

  if (finalConfig.botType === 'nnue' && !weightsLoaded) {
    console.log("AI Worker: Fetching NNUE weights...");
    const weights = await fetchNNUEWeights();
    if (weights) {
      weightsLoaded = true;
      console.log("AI Worker: NNUE weights loaded.");
    } else {
      console.error("AI Worker: Failed to load NNUE weights.");
    }
  }

  console.log(`AI Worker: Starting minimax search (depth: ${finalConfig.depth}, botType: ${finalConfig.botType})...`);
  let [score, bestMove] = minimax(
    board,
    finalConfig.depth,
    -2000000,
    2000000,
    isMaximizing,
    finalConfig
  );

  // Add randomness for self-play variety if epsilon is provided
  if (event.data.epsilon && Math.random() < event.data.epsilon) {
    const { getValidMoves } = await import('./connect4');
    const moves = getValidMoves(board);
    if (moves.length > 0) {
      bestMove = moves[Math.floor(Math.random() * moves.length)];
      console.log(`AI Worker: Epsilon-greedy triggered. Random move: ${bestMove}`);
    }
  }

  console.log(`AI Worker: Search complete. Best move: ${bestMove}, Score: ${score}`);
  
  console.log("AI Worker: Sending message back to main thread", { bestMove, gameId, score });
  ctx.postMessage({ bestMove, gameId, score });
};
