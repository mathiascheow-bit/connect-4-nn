import { Board, ROWS, COLS, Player } from '../types';

export function boardToASCII(board: Board): string {
  let ascii = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      if (cell === null) ascii += '. ';
      else if (cell === 1) ascii += '1 ';
      else if (cell === 2) ascii += '2 ';
    }
    ascii += '\n';
  }
  return ascii.trim();
}

export function getLLMPrompt(board: Board, currentPlayer: 1 | 2, moves: number[]): string {
  const ascii = boardToASCII(board);
  const movesStr = moves.length > 0 ? moves.join(', ') : 'None';
  
  return `I am playing Connect 4. Here is the current board state:

Current Player: Player ${currentPlayer} (${currentPlayer === 1 ? 'Red' : 'Yellow'})
Board (1 = Player 1, 2 = Player 2, . = Empty):
${ascii}

Moves played so far (column indices 0-6):
${movesStr}

Please analyze the position and suggest the best move for Player ${currentPlayer}. Explain your reasoning.`;
}
