import { defineStore } from 'pinia';
import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from '../config';

interface RoomInfo {
  id: string;
  name: string;
  current: number;
  online: boolean;
  locked?: boolean;
}

export const useMainStore = defineStore('main', {
  state: () => ({
    messages: [] as any[],
    socket: null as Socket | null,
    rooms: [] as RoomInfo[],
    currentRoom: localStorage.getItem('texas_currentRoom') || null,
    nickname: localStorage.getItem('texas_nickname') || '',
    hand: [] as string[],
    communityCards: [] as string[],
    pot: 0,
    bets: {} as Record<string, number>,
    currentTurn: '' as string,
    players: [] as any[],
    participants: [] as string[],
    round: 0,
    currentBet: 0,
    timeLeft: 0,
    timerId: null as ReturnType<typeof setInterval> | null,
    heartbeatInterval: null as ReturnType<typeof setInterval> | null,
    gameActive: false,
    autoStart: false,
    distributionActive: false,
    roomLocked: false,
    // 游戏阶段：'idle'(未开始/已结束), 'playing'(游戏中), 'distribution'(分池中)
    stage: 'idle' as 'idle' | 'playing' | 'distribution'
  }),
  actions: {
    initSocket() {
      // 如果已有socket连接，先断开
      if (this.socket) {
        console.log('断开现有socket连接');
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
      }

      // 清除之前的心跳定时器
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      // 创建新的socket连接
      console.log('创建新的socket连接到:', SOCKET_URL);
      this.socket = io(SOCKET_URL);

      // 连接建立后的处理
      this.socket.on('connect', () => {
        console.log('Socket connected to:', SOCKET_URL);
        // 注意：具体的房间加入逻辑现在由各个组件自己处理
        // 这里只做基础的连接状态管理
      });

      // 房间列表
      this.socket.on('room_list', (rooms: RoomInfo[]) => {
        this.rooms = rooms;
      });
      
      // 心跳保持在线 - 使用管理的定时器
      this.heartbeatInterval = setInterval(() => {
        this.socket?.emit('heartbeat');
      }, 5000);
      // 接收手牌
      this.socket.on('deal_hand', (data: { hand: string[] }) => {
        this.hand = data.hand;
        // 游戏开始
        this.gameActive = true;
        // 新一局开始，重置分池阶段
        this.distributionActive = false;
      });
      // 接收公共游戏状态
      this.socket.on('game_state', (data: { communityCards: string[]; pot: number; bets: Record<string, number>; round: number; currentBet: number; currentTurn: number; stage?: 'idle' | 'playing' | 'distribution' }) => {
        this.communityCards = data.communityCards;
        this.pot = data.pot;
        this.bets = data.bets;
        this.round = data.round;
        this.currentBet = data.currentBet;
        // 同步stage状态
        if (data.stage !== undefined) {
          this.stage = data.stage;
        }
        // currentTurn由action_request事件更新，这里不处理
      });
      // 请求玩家行动
      this.socket.on('action_request', (data: { playerId: string; seconds?: number }) => {
        this.currentTurn = data.playerId;
        // 设置并开始倒计时（秒）
        this.timeLeft = data.seconds ?? 30;
        this.startTimer();
      });
      // 游戏启动
      this.socket.on('game_started', () => {
        // 新一局开始，重置公共牌和投注信息，手牌由deal_hand事件设置
        this.communityCards = [];
        this.bets = {};
        this.currentTurn = '';
        this.round = 0;
        this.currentBet = 0;
        this.gameActive = true;
        this.distributionActive = false;
        this.stage = 'playing';
      });
      // 分奖池阶段
      this.socket.on('distribution_start', () => {
        this.timeLeft = 0;
        if (this.timerId) {
          clearInterval(this.timerId);
          this.timerId = null;
        }
        this.distributionActive = true;
        this.stage = 'distribution';
      });
      // 游戏结束
      this.socket.on('game_over', () => {
        this.gameActive = false;
        this.timeLeft = 0;
        if (this.timerId) {
          clearInterval(this.timerId);
          this.timerId = null;
        }
        this.distributionActive = false;
        this.stage = 'idle';
        // 为了方便复盘，保留手牌和公共牌显示，不在这里清空
        // 手牌和公共牌将在下一局游戏开始时清空
        // 同时添加系统提示消息
        this.messages.push({ message: '[系统] 游戏结束，请点击开始游戏开始新局' });
      });
      // 聊天广播
      this.socket.on('chat_broadcast', (data: any) => {
        this.messages.push(data);
      });
      // 错误消息
      this.socket.on('error', (msg: string) => {
        this.messages.push({ message: `[系统] ${msg}` });
      });
      // 房间更新
      this.socket.on('room_update', (room: any) => {
        this.players = room.players;
        // 同步游戏参与者列表
        this.participants = room.participants || [];
        // 同步房间的自动开始状态
        if (room.autoStart !== undefined) {
          this.autoStart = room.autoStart;
        }
        // 同步房间锁定状态
        if (room.locked !== undefined) {
          this.roomLocked = room.locked;
        }
      });
      // 监听时间更新，设置剩余时间
      this.socket.on('time_update', (data: { seconds: number }) => {
        this.timeLeft = data.seconds;
      });
      // 监听被踢出事件
      this.socket.on('kicked_out', (data: { message: string }) => {
        alert(data.message);
        // 清理本地存储
        localStorage.removeItem('texas_currentRoom');
        localStorage.removeItem('texas_nickname');
        // 清理store状态
        this.currentRoom = null;
        this.nickname = '';
        this.participants = [];
        this.players = [];
        this.gameActive = false;
        this.distributionActive = false;
        // 使用disconnectSocket方法确保完全清理
        this.disconnectSocket();
        // 跳转到房间列表
        setTimeout(() => {
          window.location.href = '/';
        }, 100);
      });

      // 监听服务器重置开始事件
      this.socket.on('server_reset_start', (data: { message: string }) => {
        alert(data.message);
        // 清理所有状态
        this.currentRoom = null;
        this.nickname = '';
        this.participants = [];
        this.players = [];
        this.gameActive = false;
        this.distributionActive = false;
        this.messages = [];
        
        // 清理本地存储
        localStorage.removeItem('texas_currentRoom');
        localStorage.removeItem('texas_nickname');
        
        // 断开连接
        this.disconnectSocket();
      });
    },
    disconnectSocket() {
      if (this.socket) {
        console.log('主动断开socket连接');
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
      }
      
      // 清除心跳定时器
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
    },
    joinRoom(roomId: string, nickname: string) {
      if (!this.socket) return;
      
      // 切换房间时重置所有状态
      this.messages = [];
      this.resetGameState();
      
      const playerId = nickname; // 简化: 使用昵称作为 playerId
      this.currentRoom = roomId;
      this.nickname = nickname;
      localStorage.setItem('texas_nickname', nickname); // 保存昵称到localStorage
      localStorage.setItem('texas_currentRoom', roomId); // 保存当前房间到localStorage
      
      // 设置新加入标记，避免Room组件重复reconnect
      sessionStorage.setItem('texas_newJoin', 'true');
      
      this.socket.emit('join_room', { roomId, playerId, nickname });
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
    },
    resetGameState() {
      // 重置所有游戏相关状态
      this.hand = [];
      this.communityCards = [];
      this.pot = 0;
      this.bets = {};
      this.currentTurn = '';
      this.players = [];
      this.participants = [];
      this.round = 0;
      this.currentBet = 0;
      this.timeLeft = 0;
      this.gameActive = false;
      this.autoStart = false;
      this.distributionActive = false;
      this.roomLocked = false;
      this.stage = 'idle';
      
      // 清除游戏定时器
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
      
      // 注意：不在这里清除心跳定时器，因为心跳需要保持连接
      // 心跳定时器只在disconnectSocket时清除
    }
  }
});