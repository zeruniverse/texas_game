import { defineStore } from 'pinia';
import { io, Socket } from 'socket.io-client';

interface RoomInfo {
  id: string;
  name: string;
  current: number;
  online: boolean;
}

export const useMainStore = defineStore('main', {
  state: () => ({
    socket: null as Socket | null,
    rooms: [] as RoomInfo[],
    currentRoom: null as string | null,
    nickname: '',
    hand: [] as string[],
    communityCards: [] as string[],
    pot: 0,
    bets: {} as Record<string, number>,
    currentTurn: '' as string,
    players: [] as any[],
    round: 0,
    currentBet: 0,
    timeLeft: 0,
    timerId: null as ReturnType<typeof setInterval> | null,
    gameActive: false
  }),
  actions: {
    initSocket() {
      this.socket = io('http://localhost:3000');
      // 房间列表
      this.socket.on('room_list', (rooms: RoomInfo[]) => {
        this.rooms = rooms;
      });
      // 心跳保持在线
      setInterval(() => {
        this.socket?.emit('heartbeat');
      }, 5000);
      // 接收手牌
      this.socket.on('deal_hand', (data: { hand: string[] }) => {
        this.hand = data.hand;
        // 游戏开始
        this.gameActive = true;
      });
      // 接收公共游戏状态
      this.socket.on('game_state', (data: { communityCards: string[]; pot: number; bets: Record<string, number>; round: number; currentBet: number }) => {
        this.communityCards = data.communityCards;
        this.pot = data.pot;
        this.bets = data.bets;
        this.round = data.round;
        this.currentBet = data.currentBet;
      });
      // 请求玩家行动
      this.socket.on('action_request', (data: { playerId: string; action?: string; amount?: number }) => {
        this.currentTurn = data.playerId;
        // 重置并开始倒计时
        this.timeLeft = 30;
        this.startTimer();
      });
      // 游戏启动
      this.socket.on('game_started', () => {
        this.gameActive = true;
      });
      // 游戏结束
      this.socket.on('game_over', () => {
        this.gameActive = false;
        this.timeLeft = 0;
        if (this.timerId) {
          clearInterval(this.timerId);
          this.timerId = null;
        }
      });
      // 房间更新
      this.socket.on('room_update', (room: any) => {
        this.players = room.players;
      });
      // 监听时间更新，同步延时
      this.socket.on('time_update', (data: { seconds: number }) => {
        this.timeLeft += data.seconds;
      });
      // 监听分奖池阶段，停止倒计时
      this.socket.on('distribution_start', () => {
        this.timeLeft = 0;
        if (this.timerId) {
          clearInterval(this.timerId);
          this.timerId = null;
        }
      });
    },
    joinRoom(roomId: string, nickname: string) {
      if (!this.socket) return;
      const playerId = nickname; // 简化: 使用昵称作为 playerId
      this.currentRoom = roomId;
      this.nickname = nickname;
      this.socket.emit('join_room', { roomId, playerId, nickname });
      this.socket.on('room_update', (room) => {
        // 处理 room 更新，后续补充逻辑
        console.log('room_update', room);
      });
    },
    startTimer() {
      if (this.timerId) clearInterval(this.timerId);
      this.timerId = setInterval(() => {
        if (this.timeLeft > 0) this.timeLeft--;
        else if (this.timerId) clearInterval(this.timerId);
      }, 1000);
    },
    extendTime() {
      if (this.socket && this.currentRoom) {
        this.socket.emit('extend_time', { roomId: this.currentRoom });
      }
    }
  }
});