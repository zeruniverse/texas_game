import { Player } from './Player';
import { GameState } from './GameState';

export interface Room {
  id: string;
  name: string;
  maxPlayers: number;
  players: Player[];
  gameState: GameState;
  online: boolean;
  participants?: string[];
  autoStart: boolean;
  locked: boolean;
  threadId?: string;
  lastActiveTime: number;
  threadStatus: 'idle' | 'running' | 'stopping';
}