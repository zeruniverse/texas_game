export interface GameState {
  deck: string[];
  communityCards: string[];
  pot: number;
  bets: Record<string, number>;
  totalBets: Record<string, number>;
  currentTurn: number;
  dealerIndex: number;
  blinds: { sb: number; bb: number };
  sbIndex: number;
  bbIndex: number;
  currentBet: number;
  folded: string[];
  round: number;
  playerHands: Record<string, string[]>;
  acted: string[];
}