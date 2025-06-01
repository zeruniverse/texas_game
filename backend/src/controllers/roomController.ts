import { Server, Socket } from 'socket.io';
import { Room } from '../models/Room';
import { Player } from '../models/Player';
import { RoomThreadManager } from '../services/RoomThreadManager';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { setResetServerFunction } from '../server';

const rooms: Room[] = [];
let threadManager: RoomThreadManager;

export function roomController(io: Server) {
  // 重置服务器函数（移到这里可以访问handleThreadMessage）
  async function resetServer() {
    try {
      console.log('开始重置服务器...');
      
      // 1. 通知所有客户端即将重置
      io.emit('server_reset_start', { message: '服务器即将重置，请稍后重新连接' });
      
      // 2. 给用户一点时间看到消息
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 3. 强制断开所有客户端连接
      const sockets = await io.fetchSockets();
      for (const socket of sockets) {
        socket.emit('kicked_out', { message: '服务器重置，请刷新页面重新连接' });
        socket.disconnect(true);
      }
      
      // 4. 处理现有的房间线程
      if (threadManager) {
        if (config.roomThreadPreserve) {
          // 如果配置为保留线程，则重置所有房间状态但保留线程
          for (const room of rooms) {
            if (room.threadStatus === 'running') {
              try {
                await threadManager.stopRoomThread(room.id); // 这会重置房间状态但保留线程
                console.log(`房间 ${room.id} 已重置状态但保留线程`);
              } catch (error) {
                console.error(`重置房间 ${room.id} 状态失败:`, error);
              }
            }
          }
        } else {
          // 如果不保留线程，则完全关闭所有线程
          await threadManager.shutdown();
        }
      }
      
      // 5. 重置房间数据（保持房间ID和线程状态）
      const existingRooms = [...rooms]; // 保存现有房间引用
      rooms.length = 0;
      
      // 6. 重新创建房间（使用当前配置）
      let roomCounter = 1;
      
      // 创建线下房间
      for (let i = 1; i <= config.rooms.offline.count; i++) {
        const roomId = `room${roomCounter}`;
        const existingRoom = existingRooms.find(r => r.id === roomId);
        
        rooms.push({
          id: roomId,
          name: `${config.rooms.offline.namePrefix}${i}`,
          maxPlayers: config.gameSettings.maxPlayers,
          players: [],
          online: false,
          autoStart: false,
          locked: false,
          lastActiveTime: Date.now(),
          // 如果保留线程且房间已存在，保持线程状态，否则设为idle
          threadStatus: (config.roomThreadPreserve && existingRoom?.threadStatus === 'running') ? 'running' : 'idle',
          threadId: (config.roomThreadPreserve && existingRoom?.threadId) ? existingRoom.threadId : undefined,
          participants: [],
          gameState: { 
            deck: [], 
            communityCards: [], 
            pot: 0, 
            bets: {}, 
            totalBets: {}, 
            currentTurn: 0, 
            dealerIndex: 0, 
            blinds: { sb: config.gameSettings.blinds.smallBlind, bb: config.gameSettings.blinds.bigBlind }, 
            sbIndex: 0, 
            bbIndex: 1, 
            playerHands: {}, 
            currentBet: config.gameSettings.blinds.bigBlind, 
            folded: [], 
            round: 0, 
            acted: [],
            stage: 'idle'
          }
        });
        roomCounter++;
      }
      
      // 创建线上房间
      for (let i = 1; i <= config.rooms.online.count; i++) {
        const roomId = `room${roomCounter}`;
        const existingRoom = existingRooms.find(r => r.id === roomId);
        
        rooms.push({
          id: roomId,
          name: `${config.rooms.online.namePrefix}${i}`,
          maxPlayers: config.gameSettings.maxPlayers,
          players: [],
          online: true,
          autoStart: false,
          locked: false,
          lastActiveTime: Date.now(),
          // 如果保留线程且房间已存在，保持线程状态，否则设为idle
          threadStatus: (config.roomThreadPreserve && existingRoom?.threadStatus === 'running') ? 'running' : 'idle',
          threadId: (config.roomThreadPreserve && existingRoom?.threadId) ? existingRoom.threadId : undefined,
          participants: [],
          gameState: { 
            deck: [], 
            communityCards: [], 
            pot: 0, 
            bets: {}, 
            totalBets: {}, 
            currentTurn: 0, 
            dealerIndex: 0, 
            blinds: { sb: config.gameSettings.blinds.smallBlind, bb: config.gameSettings.blinds.bigBlind }, 
            sbIndex: 0, 
            bbIndex: 1, 
            playerHands: {}, 
            currentBet: config.gameSettings.blinds.bigBlind, 
            folded: [], 
            round: 0, 
            acted: [],
            stage: 'idle'
          }
        });
        roomCounter++;
      }
      
      // 7. 重新初始化线程管理器（只有在不保留线程时才完全重新创建）
      if (!config.roomThreadPreserve) {
        threadManager = new RoomThreadManager(rooms, handleThreadMessage);
      } else {
        // 如果保留线程，只需要更新房间引用
        threadManager.updateRooms(rooms);
      }
      
      console.log(`服务器重置完成，重新创建了 ${config.rooms.offline.count} 个线下房间和 ${config.rooms.online.count} 个线上房间`);
      if (config.roomThreadPreserve) {
        console.log('已保留现有的worker线程');
      }
      
      return true;
    } catch (error) {
      console.error('重置服务器失败:', error);
      return false;
    }
  }

  // 将重置函数注册到HTTP接口
  setResetServerFunction(resetServer);

  // 从配置文件动态创建房间
  let roomCounter = 1;
  
  // 创建线下房间
  for (let i = 1; i <= config.rooms.offline.count; i++) {
    rooms.push({
      id: `room${roomCounter}`,
      name: `${config.rooms.offline.namePrefix}${i}`,
      maxPlayers: config.gameSettings.maxPlayers,
      players: [],
      online: false,
      autoStart: false,
      locked: false,
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
        blinds: { sb: config.gameSettings.blinds.smallBlind, bb: config.gameSettings.blinds.bigBlind }, 
        sbIndex: 0, 
        bbIndex: 1, 
        playerHands: {}, 
        currentBet: config.gameSettings.blinds.bigBlind, 
        folded: [], 
        round: 0, 
        acted: [],
        stage: 'idle'
      }
    });
    roomCounter++;
  }
  
  // 创建线上房间  
  for (let i = 1; i <= config.rooms.online.count; i++) {
    rooms.push({
      id: `room${roomCounter}`,
      name: `${config.rooms.online.namePrefix}${i}`,
      maxPlayers: config.gameSettings.maxPlayers,
      players: [],
      online: true,
      autoStart: false,
      locked: false,
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
        blinds: { sb: config.gameSettings.blinds.smallBlind, bb: config.gameSettings.blinds.bigBlind }, 
        sbIndex: 0, 
        bbIndex: 1, 
        playerHands: {}, 
        currentBet: config.gameSettings.blinds.bigBlind, 
        folded: [], 
        round: 0, 
        acted: [],
        stage: 'idle'
      }
    });
    roomCounter++;
  }

  console.log(`已根据配置创建 ${config.rooms.offline.count} 个线下房间和 ${config.rooms.online.count} 个线上房间`);

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
          const { id, lastActiveTime, threadStatus, threadId, ...updateData } = data.data;
          rooms[roomIndex] = { ...rooms[roomIndex], ...updateData };
          
          // 向所有客户端广播房间列表更新
          const roomsInfo = rooms.map(room => ({
            id: room.id,
            name: room.name,
            current: room.players.length,
            online: room.online,
            locked: room.locked
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
      online: room.online,
      locked: room.locked
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

    // 切换房间锁定状态 - 转发到房间线程
    socket.on('toggle_room_lock', async ({ roomId }) => {
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
        await sendTaskToRoom(roomId, 'toggle_room_lock', { playerId: player.id }, socket.id, player.id);
      } catch (error) {
        socket.emit('error', '切换房间锁定状态失败');
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
        socket.emit('kicked_out', { message: '房间不存在' });
        socket.disconnect();
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
        } else {
          // 房间锁定或房间已满等错误应该强制用户返回大厅
          socket.emit('kicked_out', { message: response.error || '加入房间失败' });
          socket.disconnect();
        }
      } catch (error) {
        socket.emit('kicked_out', { message: '加入房间失败' });
        socket.disconnect();
      }
    });

    // 断线重连 - 转发到房间线程
    socket.on('reconnect_room', async ({ roomId, playerId, nickname }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('kicked_out', { message: '房间不存在' });
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
        } else {
          // 使用后端返回的具体错误信息
          socket.emit('kicked_out', { message: response.error || '重连失败' });
          socket.disconnect();
        }
      } catch (error) {
        socket.emit('kicked_out', { message: '重连失败，请重新进入房间' });
        socket.disconnect();
      }
    });

    // 重置服务器 - 需要密码验证
    socket.on('reset_server', async ({ password }) => {
      try {
        // 验证密码
        if (!password || password !== config.resetPassword) {
          socket.emit('reset_server_response', { success: false, error: '密码错误' });
          console.log(`重置服务器请求被拒绝：密码错误 (来自 ${socket.id})`);
          return;
        }

        console.log(`收到重置服务器请求 (来自 ${socket.id})，密码验证通过`);
        
        // 密码正确，执行重置
        const resetSuccess = await resetServer();
        
        if (resetSuccess) {
          // 重置成功，但此时连接已断开，无需发送响应
          console.log('服务器重置成功');
        } else {
          socket.emit('reset_server_response', { success: false, error: '重置服务器失败' });
        }
      } catch (error) {
        console.error('重置服务器过程中发生错误:', error);
        socket.emit('reset_server_response', { success: false, error: '重置服务器失败' });
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