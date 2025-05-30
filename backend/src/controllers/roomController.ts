import { Server, Socket } from 'socket.io';
import { Room } from '../models/Room';
import { Player } from '../models/Player';
import { RoomThreadManager } from '../services/RoomThreadManager';
import { v4 as uuidv4 } from 'uuid';

const rooms: Room[] = [];
let threadManager: RoomThreadManager;

export function roomController(io: Server) {
  // 初始化9个房间，前6为线下，后3为线上
  for (let i = 1; i <= 9; i++) {
    rooms.push({
      id: `room${i}`,
      name: `房间${i}`,
      maxPlayers: 20,
      players: [],
      online: i > 6,
      autoStart: false,
      lastActiveTime: Date.now(),
      threadStatus: 'idle',
      gameState: { 
        deck: [], 
        communityCards: [], 
        pot: 0, 
        bets: {}, 
        totalBets: {}, 
        currentTurn: 0, 
        dealerIndex: 0, 
        blinds: { sb: 5, bb: 10 }, 
        sbIndex: 0, 
        bbIndex: 1, 
        playerHands: {}, 
        currentBet: 10, 
        folded: [], 
        round: 0, 
        acted: [] 
      }
    });
  }

  // 初始化线程管理器
  threadManager = new RoomThreadManager(rooms, handleThreadMessage);

  // 处理房间线程发来的事件
  async function handleThreadMessage(data: any) {
    if (data.type === 'emit') {
      // 特殊处理room_update事件
      if (data.event === 'room_update') {
        const roomIndex = rooms.findIndex(r => r.id === data.roomId);
        if (roomIndex !== -1) {
          // 同步更新主线程的房间数据
          rooms[roomIndex] = { ...rooms[roomIndex], ...data.data };
          
          // 向所有客户端广播房间列表更新
          const roomsInfo = rooms.map(room => ({
            id: room.id,
            name: room.name,
            current: room.players.length,
            online: room.online
          }));
          io.emit('room_list', roomsInfo);
        }
      }
      
      io.to(data.roomId).emit(data.event, data.data);
    } else if (data.type === 'emit_to_socket') {
      io.to(data.socketId).emit(data.event, data.data);
    }
  }

  // 向房间线程发送任务的通用函数
  async function sendTaskToRoom(roomId: string, taskType: string, taskData: any, socketId?: string, playerId?: string) {
    try {
      // 确保房间线程运行
      await threadManager.ensureRoomThreadRunning(roomId);
      
      const response = await threadManager.sendTask(roomId, {
        type: taskType,
        roomId,
        data: taskData,
        socketId,
        playerId
      });

      return response;
    } catch (error) {
      console.error(`发送任务到房间 ${roomId} 失败:`, error);
      throw error;
    }
  }

  io.on('connection', (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // 发送房间列表给新连接，保持向后兼容
    const roomsInfo = rooms.map(room => ({
      id: room.id,
      name: room.name,
      current: room.players.length,
      online: room.online
    }));
    socket.emit('room_list', roomsInfo);

    // 心跳更新 - 转发到对应房间线程
    socket.on('heartbeat', async () => {
      for (const room of rooms) {
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
          try {
            await sendTaskToRoom(room.id, 'heartbeat', { playerId: player.id }, socket.id, player.id);
          } catch (error) {
            console.error('心跳处理失败:', error);
          }
          break;
        }
      }
    });

    // 聊天消息 - 转发到房间线程
    socket.on('chat_msg', async ({ roomId, message }) => {
      try {
        await sendTaskToRoom(roomId, 'chat_message', { message }, socket.id);
      } catch (error) {
        socket.emit('error', '发送消息失败');
      }
    });

    // cash in - 转发到房间线程
    socket.on('cash_in', async ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        return;
      }
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) {
        socket.emit('error', '玩家不存在');
        return;
      }

      try {
        await sendTaskToRoom(roomId, 'cash_in', { playerId: player.id }, socket.id, player.id);
      } catch (error) {
        socket.emit('error', 'Cash in 失败');
      }
    });

    // cash out - 转发到房间线程
    socket.on('cash_out', async ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        return;
      }
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) {
        socket.emit('error', '玩家不存在');
        return;
      }

      try {
        await sendTaskToRoom(roomId, 'cash_out', { playerId: player.id }, socket.id, player.id);
        socket.leave(roomId);
      } catch (error) {
        socket.emit('error', 'Cash out 失败');
      }
    });

    // take (线下房间) - 转发到房间线程
    socket.on('take', async ({ roomId, amount }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        return;
      }
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) {
        socket.emit('error', '玩家不存在');
        return;
      }

      try {
        const response = await sendTaskToRoom(roomId, 'take', { playerId: player.id, amount }, socket.id, player.id);
        if (!response.success) {
          socket.emit('error', response.error || 'Take 操作失败');
        }
      } catch (error) {
        socket.emit('error', 'Take 操作失败');
      }
    });

    // take_all (线下房间) - 转发到房间线程
    socket.on('take_all', async ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        return;
      }
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) {
        socket.emit('error', '玩家不存在');
        return;
      }

      try {
        const response = await sendTaskToRoom(roomId, 'take_all', { playerId: player.id }, socket.id, player.id);
        if (!response.success) {
          socket.emit('error', response.error || 'Take all 操作失败');
        }
      } catch (error) {
        socket.emit('error', 'Take all 操作失败');
      }
    });

    // 切换自动开始状态 - 转发到房间线程
    socket.on('toggle_auto_start', async ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        return;
      }
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) {
        socket.emit('error', '玩家不存在');
        return;
      }

      try {
        await sendTaskToRoom(roomId, 'toggle_auto_start', { playerId: player.id }, socket.id, player.id);
      } catch (error) {
        socket.emit('error', '切换自动开始状态失败');
      }
    });

    // 客户端请求开始游戏 - 转发到房间线程
    socket.on('start_game', async ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        return;
      }

      try {
        const response = await sendTaskToRoom(roomId, 'start_game', {}, socket.id);
        if (!response.success) {
          socket.emit('error', response.error || '开始游戏失败');
        }
      } catch (error) {
        socket.emit('error', '开始游戏失败');
      }
    });

    // 客户端请求延长思考时间 - 转发到房间线程
    socket.on('extend_time', async ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        return;
      }
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) {
        socket.emit('error', '玩家不存在');
        return;
      }

      try {
        const response = await sendTaskToRoom(roomId, 'extend_time', { playerId: player.id }, socket.id, player.id);
        if (!response.success) {
          socket.emit('error', response.error || '延时失败');
        }
      } catch (error) {
        socket.emit('error', '延时失败');
      }
    });

    // 玩家行动 - 转发到房间线程
    socket.on('player_action', async ({ roomId, action, amount }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        return;
      }
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) {
        socket.emit('error', '玩家不存在');
        return;
      }

      try {
        const response = await sendTaskToRoom(roomId, 'player_action', { 
          playerId: player.id, 
          action, 
          amount 
        }, socket.id, player.id);
        
        if (!response.success) {
          socket.emit('error', response.error || '行动失败');
        }
      } catch (error) {
        socket.emit('error', '行动失败');
      }
    });

    // 兼容前端发送的action事件（与player_action相同的处理逻辑）
    socket.on('action', async ({ roomId, action, amount }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        return;
      }
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) {
        socket.emit('error', '玩家不存在');
        return;
      }

      try {
        const response = await sendTaskToRoom(roomId, 'player_action', { 
          playerId: player.id, 
          action, 
          amount 
        }, socket.id, player.id);
        
        if (!response.success) {
          socket.emit('error', response.error || '行动失败');
        }
      } catch (error) {
        socket.emit('error', '行动失败');
      }
    });

    // 获取房间列表
    socket.on('get_rooms', () => {
      // 返回房间基本信息，不包含敏感数据
      const roomsInfo = rooms.map(room => ({
        id: room.id,
        name: room.name,
        maxPlayers: room.maxPlayers,
        playerCount: room.players.length,
        online: room.online,
        autoStart: room.autoStart,
        gameInProgress: room.participants ? room.participants.length > 0 : false
      }));
      socket.emit('rooms_list', roomsInfo);
    });

    // 加入房间 - 转发到房间线程
    socket.on('join_room', async ({ roomId, playerId, nickname }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        return;
      }

      try {
        const response = await sendTaskToRoom(roomId, 'join_room', { 
          playerId, 
          nickname, 
          socketId: socket.id 
        }, socket.id, playerId);

        if (response.success) {
          socket.join(roomId);
          
          // 发送当前房间状态给新加入的玩家
          const updatedRoom = response.data?.room || room;
          socket.emit('room_update', updatedRoom);
          
          // 如果游戏正在进行中，同步游戏状态
          if (updatedRoom.participants && updatedRoom.participants.length > 0) {
            socket.emit('game_started', {});
            // 请求最新的游戏状态
            const gameStateResponse = await sendTaskToRoom(roomId, 'get_room_state', {});
            if (gameStateResponse.success && gameStateResponse.data?.room?.gameState) {
              const gs = gameStateResponse.data.room.gameState;
              socket.emit('game_state', {
                communityCards: gs.communityCards,
                pot: gs.pot,
                bets: gs.bets,
                currentTurn: gs.currentTurn,
                dealerIndex: gs.dealerIndex,
                round: gs.round,
                currentBet: gs.currentBet
              });
              
              // 如果该玩家参与游戏并且是线上房间，发送手牌
              if (updatedRoom.participants.includes(playerId) && gs.playerHands[playerId] && updatedRoom.online) {
                socket.emit('deal_hand', { hand: gs.playerHands[playerId] });
              }
              
              // 发送当前行动请求，同步当前轮到谁以及剩余时间
              if (gs.currentTurn >= 0 && gs.currentTurn < updatedRoom.players.length) {
                // 通过房间线程获取正确的剩余时间
                await sendTaskToRoom(roomId, 'sync_action_request', { socketId: socket.id });
              }
            }
          }
        } else {
          socket.emit('error', response.error || '加入房间失败');
        }
      } catch (error) {
        socket.emit('error', '加入房间失败');
      }
    });

    // 断线重连 - 转发到房间线程
    socket.on('reconnect_room', async ({ roomId, playerId, nickname }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        socket.disconnect();
        return;
      }

      try {
        const response = await sendTaskToRoom(roomId, 'reconnect', { 
          playerId, 
          nickname, 
          socketId: socket.id 
        }, socket.id, playerId);

        if (response.success) {
          socket.join(roomId);
          
          // 发送当前房间状态给重连的玩家
          const updatedRoom = response.data?.room || room;
          socket.emit('room_update', updatedRoom);
          
          // 如果游戏正在进行中，同步游戏状态
          if (updatedRoom.participants && updatedRoom.participants.length > 0) {
            socket.emit('game_started', {});
            // 请求最新的游戏状态
            const gameStateResponse = await sendTaskToRoom(roomId, 'get_room_state', {});
            if (gameStateResponse.success && gameStateResponse.data?.room?.gameState) {
              const gs = gameStateResponse.data.room.gameState;
              socket.emit('game_state', {
                communityCards: gs.communityCards,
                pot: gs.pot,
                bets: gs.bets,
                currentTurn: gs.currentTurn,
                dealerIndex: gs.dealerIndex,
                round: gs.round,
                currentBet: gs.currentBet
              });
              
              // 如果该玩家参与游戏并且是线上房间，发送手牌
              if (updatedRoom.participants.includes(playerId) && gs.playerHands[playerId] && updatedRoom.online) {
                socket.emit('deal_hand', { hand: gs.playerHands[playerId] });
              }
              
              // 发送当前行动请求，同步当前轮到谁以及剩余时间
              if (gs.currentTurn >= 0 && gs.currentTurn < updatedRoom.players.length) {
                // 通过房间线程获取正确的剩余时间
                await sendTaskToRoom(roomId, 'sync_action_request', { socketId: socket.id });
              }
            }
          }
        } else {
          socket.emit('kicked_out', { message: '会话过期，请重新进入房间' });
          socket.disconnect();
        }
      } catch (error) {
        socket.emit('kicked_out', { message: '重连失败，请重新进入房间' });
        socket.disconnect();
      }
    });

    // 断开连接处理
    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${socket.id}`);
      
      // 查找该socket所在的房间并通知房间线程处理离线
      for (const room of rooms) {
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
          try {
            await sendTaskToRoom(room.id, 'player_offline', { 
              playerId: player.id, 
              socketId: socket.id 
            });
          } catch (error) {
            console.error('处理玩家离线失败:', error);
          }
          break;
        }
      }
    });
  });

  // 优雅关闭
  process.on('SIGTERM', async () => {
    console.log('正在优雅关闭服务器...');
    await threadManager.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('正在优雅关闭服务器...');
    await threadManager.shutdown();
    process.exit(0);
  });
}