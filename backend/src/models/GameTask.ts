export interface GameTask {
  id: string;
  type: string;
  roomId: string;
  data: any;
  timestamp: number;
  socketId?: string;
  playerId?: string;
}

export interface GameTaskResponse {
  taskId: string;
  success: boolean;
  data?: any;
  error?: string;
} 