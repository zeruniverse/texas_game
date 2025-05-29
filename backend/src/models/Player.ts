export interface Player {
  id: string;
  nickname: string;
  chips: number;
  socketId: string;
  lastHeartbeat: number;
  inGame: boolean;
}