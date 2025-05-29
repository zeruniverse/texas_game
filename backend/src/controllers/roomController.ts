import { Server, Socket } from 'socket.io';
import { Room } from '../models/Room';
import { Player } from '../models/Player';
import { createDeck, shuffleDeck } from '../utils/deck';
import { evaluateHand } from '../utils/handEvaluator';

// 动作超时定时器：key 为 roomId
const actionTimers: Map<string, NodeJS.Timeout> = new Map();

const rooms: Room[] = [];

export function roomController(io: Server) {
  // 初始化9个房间，前6为线下，后3为线上
  for (let i = 1; i <= 9; i++) {
    rooms.push({
      id: `room${i}`,
      name: `房间${i}`,
      maxPlayers: 20,
      players: [],
      // 标记线上/线下
      online: i > 6,
      // 始终初始化游戏状态，以支持线下的下注逻辑
      gameState: { deck: [], communityCards: [], pot: 0, bets: {}, totalBets: {}, currentTurn: 0, dealerIndex: 0, blinds: { sb: 5, bb: 10 }, sbIndex: 0, bbIndex: 1, playerHands: {}, currentBet: 10, folded: [], round: 0, acted: [] }
    });
  }

  // 自动发牌并开始游戏
  function startGame(room: Room) {
    const gs = room.gameState!;
    // 如果线上房间，洗牌并发牌；线下不发牌
    if (room.online) {
      gs.deck = shuffleDeck(createDeck());
      room.players.forEach(p => {
        const card1 = gs.deck.pop()!;
        const card2 = gs.deck.pop()!;
        gs.playerHands[p.id] = [card1, card2];
        io.to(p.socketId).emit('deal_hand', { hand: gs.playerHands[p.id] });
      });
    }
    gs.communityCards = [];
    gs.pot = 0;
    gs.bets = {};
    // 初始化回合参数
    gs.currentBet = gs.blinds.bb;
    gs.folded = [];
    gs.round = 0;
    gs.acted = [];
    gs.totalBets = {};
    // 轮换庄家
    gs.dealerIndex = (gs.dealerIndex + 1) % room.players.length;
    const sbIndex = (gs.dealerIndex + 1) % room.players.length;
    const bbIndex = (sbIndex + 1) % room.players.length;
    gs.sbIndex = sbIndex;
    gs.bbIndex = bbIndex;
    const sbPlayer = room.players[sbIndex];
    const bbPlayer = room.players[bbIndex];
    sbPlayer.chips -= gs.blinds.sb;
    bbPlayer.chips -= gs.blinds.bb;
    gs.bets[sbPlayer.id] = gs.blinds.sb;
    gs.bets[bbPlayer.id] = gs.blinds.bb;
    gs.pot = gs.blinds.sb + gs.blinds.bb;
    // 更新累计下注
    gs.totalBets[sbPlayer.id] = gs.blinds.sb;
    gs.totalBets[bbPlayer.id] = gs.blinds.bb;
    // 初始最高注为大盲
    gs.currentBet = gs.blinds.bb;
    gs.currentTurn = (bbIndex + 1) % room.players.length;
    gs.playerHands = {};
    // 同步玩家筹码与下注显示
    io.to(room.id).emit('room_update', room);
    // 广播公共游戏状态
    io.to(room.id).emit('game_state', { communityCards: gs.communityCards, pot: gs.pot, bets: gs.bets, currentTurn: gs.currentTurn, dealerIndex: gs.dealerIndex, round: gs.round, currentBet: gs.currentBet });
    // 请求第一个玩家行动
    const nextPlayerId = room.players[gs.currentTurn].id;
    io.to(room.id).emit('action_request', { playerId: nextPlayerId });
    // 启动超时定时器
    const timeout = setTimeout(() => handleTimeout(room.id), 30000);
    actionTimers.set(room.id, timeout);
  }

  // 离线检测定时任务
  setInterval(() => {
    const now = Date.now();
    rooms.forEach(room => {
      const toRemove: string[] = [];
      room.players.forEach(player => {
        const offlineTime = now - player.lastHeartbeat;
        if (player.chips > 0 && offlineTime > 90 * 60 * 1000) {
          io.to(room.id).emit('chat_broadcast', { message: `${player.nickname} 因长时间离线被自动 cash out 并踢出房间` });
          toRemove.push(player.id);
        } else if (player.chips === 0 && offlineTime > 10 * 1000) {
          io.to(room.id).emit('chat_broadcast', { message: `${player.nickname} 因长时间离线被踢出房间` });
          toRemove.push(player.id);
        }
      });
      if (toRemove.length > 0) {
        room.players = room.players.filter(p => !toRemove.includes(p.id));
        io.to(room.id).emit('room_update', room);
      }
    });
  }, 5000);

  io.on('connection', (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // 心跳更新
    socket.on('heartbeat', () => {
      rooms.forEach(room => {
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) player.lastHeartbeat = Date.now();
      });
    });

    // 聊天消息
    socket.on('chat_msg', ({ roomId, message }) => {
      io.to(roomId).emit('chat_broadcast', { message });
    });

    // cash in
    socket.on('cash_in', ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) return;
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;
      player.chips += 1000;
      io.to(roomId).emit('chat_broadcast', { message: `${player.nickname} cash in 1000` });
      io.to(roomId).emit('room_update', room);
    });

    // cash out
    socket.on('cash_out', ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) return;
      const idx = room.players.findIndex(p => p.socketId === socket.id);
      if (idx === -1) return;
      const player = room.players[idx];
      room.players.splice(idx, 1);
      socket.leave(roomId);
      io.to(roomId).emit('chat_broadcast', { message: `${player.nickname} cash out 并退出房间` });
      io.to(roomId).emit('room_update', room);
    });

    // take (线下房间)
    socket.on('take', ({ roomId, amount }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room || !room.gameState || room.online) return;
      const gs = room.gameState;
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;
      const takeAmt = Math.floor(amount);
      if (isNaN(takeAmt) || takeAmt < 0) { socket.emit('error', 'take 金额需为非负整数'); return; }
      if (takeAmt > gs.pot) { socket.emit('error', 'take 金额不能超过奖池'); return; }
      // 从奖池取出筹码
      player.chips += takeAmt;
      gs.pot -= takeAmt;
      io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname} take ${takeAmt}]` });
      io.to(roomId).emit('room_update', room);
      // 奖池清空时结束游戏
      if (gs.pot === 0) {
        io.to(roomId).emit('game_over');
      }
    });

    // 客户端请求开始游戏
    socket.on('start_game', ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) return;
      // 锁定参与者：筹码>0 且在线
      room.participants = room.players.filter(p => p.chips > 0 && p.inGame).map(p => p.id);
      if (room.participants.length < 2) {
        socket.emit('chat_broadcast', { message: '至少需要2名玩家才能开始游戏' });
        return;
      }
      io.to(roomId).emit('chat_broadcast', { message: '游戏已开始' });
      // 通知前端启用游戏模式
      io.to(roomId).emit('game_started');
      startGame(room);
    });

    // 客户端请求延长思考时间
    socket.on('extend_time', ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) return;
      const player = room.players.find(p => p.socketId === socket.id);
      if (player) {
        io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname} 延时当前行动30s]` });
      }
      // 重置超时定时器
      const timer = actionTimers.get(roomId);
      if (timer) {
        clearTimeout(timer);
        actionTimers.delete(roomId);
      }
      // 重新设置
      const timeout = setTimeout(() => handleTimeout(roomId), 30000);
      actionTimers.set(roomId, timeout);
      // 广播同步剩余时间事件
      io.to(roomId).emit('time_update', { seconds: 30 });
    });

    // 玩家动作 (线上房间)
    socket.on('action', ({ roomId, action, amount }) => {
      // 收到玩家操作，清除该房间定时器
      const t = actionTimers.get(roomId);
      if (t) { clearTimeout(t); actionTimers.delete(roomId); }
      const room = rooms.find(r => r.id === roomId);
      if (!room || !room.gameState) return;
      const gs = room.gameState;
      const players = room.players;
      const playerIndex = players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== gs.currentTurn) {
        socket.emit('error', '当前无法操作'); return;
      }
      const player = players[playerIndex];
      // 处理动作
      switch (action) {
        case 'fold':
          gs.folded.push(player.id);
          io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname} Fold]` });
          break;
        case 'check':
          if ((gs.bets[player.id] || 0) !== gs.currentBet) {
            socket.emit('error', '无法 Check'); return;
          }
          io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname} Check]` });
          break;
        case 'call': {
          const toCall = gs.currentBet - (gs.bets[player.id] || 0);
          const amt = Math.min(toCall, player.chips);
          player.chips -= amt;
          gs.bets[player.id] = (gs.bets[player.id] || 0) + amt;
          gs.pot += amt;
          // 更新累计下注
          gs.totalBets[player.id] = (gs.totalBets[player.id] || 0) + amt;
          io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname} Call ${amt}]` });
          break;
        }
        case 'raise': {
          const raiseAmtInput = amount;
          const toCall = gs.currentBet - (gs.bets[player.id] || 0);
          const raiseAmt = Math.floor(raiseAmtInput);
          if (isNaN(raiseAmt) || raiseAmt <= 0) { socket.emit('error', '加注金额需为正整数'); return; }
          const totalAmt = toCall + raiseAmt;
          // 如果加注后剩余筹码 <= 0，则不能 raise，建议使用 All-in
          if (player.chips <= totalAmt) { socket.emit('error', '加注后剩余筹码不足，请使用 All-in'); return; }
          player.chips -= totalAmt;
          gs.bets[player.id] = (gs.bets[player.id] || 0) + totalAmt;
          gs.pot += totalAmt;
          // 更新累计下注
          gs.totalBets[player.id] = (gs.totalBets[player.id] || 0) + (totalAmt);
          gs.currentBet += raiseAmt;
          io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname} Raise ${raiseAmt}]` });
          break;
        }
        case 'allin': {
          // 全押逻辑
          const toCallAllin = gs.currentBet - (gs.bets[player.id] || 0);
          const totalAllin = player.chips;
          player.chips = 0;
          gs.bets[player.id] = (gs.bets[player.id] || 0) + totalAllin;
          gs.pot += totalAllin;
          gs.totalBets[player.id] = (gs.totalBets[player.id] || 0) + totalAllin;
          // 当前注上升到全押层
          gs.currentBet = Math.max(gs.currentBet, gs.bets[player.id]);
          io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname} All-in]` });
          break;
        }
      }
      // 标记已行动
      if (!gs.acted.includes(player.id)) gs.acted.push(player.id);
      // 同步玩家筹码与下注显示
      io.to(roomId).emit('room_update', room);
      // 判断剩余玩家：不考虑筹码，只看未弃牌的参与者
      const activeIds = room.participants!.filter(id => !gs.folded.includes(id));
      const activePlayers = activeIds.map(id => room.players.find(p => p.id === id)!);
      if (activePlayers.length === 1) {
        // 单人胜出
        const winner = activePlayers[0];
        winner.chips += gs.pot;
        io.to(roomId).emit('chat_broadcast', { message: `${winner.nickname} 赢得底池 ${gs.pot}` });
        io.to(roomId).emit('room_update', room);
        // 本局结束
        io.to(roomId).emit('game_over');
        return;
      }
      // 检查本轮下注结束：所有未弃牌参与者都至少行动一次且下注平注
      const allActed = activePlayers.every(p => gs.acted.includes(p.id));
      const allCalled = activePlayers.every(p => (gs.bets[p.id] || 0) === gs.currentBet);
      if (allActed && allCalled) {
        // 进入下一阶段
        if (gs.round === 0) {
          gs.round = 1;
          const flop = gs.deck.splice(gs.deck.length - 3, 3);
          gs.communityCards.push(...flop);
        } else if (gs.round === 1) {
          gs.round = 2;
          gs.communityCards.push(gs.deck.pop()!);
        } else if (gs.round === 2) {
          if (!room.online) {
            // 线下分奖池阶段：停止定时器，通知前端
            const t = actionTimers.get(room.id);
            if (t) { clearTimeout(t); actionTimers.delete(room.id); }
            io.to(room.id).emit('distribution_start');
            return;
          }
          gs.round = 3;
          gs.communityCards.push(gs.deck.pop()!);
        } else {
          // 摊牌：侧池与主池分配
          const inPlayers = room.participants!.filter(id => !gs.folded.includes(id));
          const totals = inPlayers.map(id => gs.totalBets[id] || 0);
          const uniqueBets = Array.from(new Set(totals)).sort((a, b) => a - b);
          const pots: { amount: number; participants: string[] }[] = [];
          let prev = 0;
          uniqueBets.forEach(bet => {
            const pts = inPlayers.filter(id => (gs.totalBets[id] || 0) >= bet);
            const amt = (bet - prev) * pts.length;
            pots.push({ amount: amt, participants: pts });
            prev = bet;
          });
          const results: Record<string, number> = {};
          pots.forEach(potSlice => {
            // 找出这一池最佳手牌
            let bestScore = -Infinity;
            const winners: string[] = [];
            potSlice.participants.forEach(id => {
              const score = evaluateHand([...gs.communityCards, ...gs.playerHands[id]]);
              if (score > bestScore) { bestScore = score; winners.length = 0; winners.push(id); }
              else if (score === bestScore) winners.push(id);
            });
            const share = Math.floor(potSlice.amount / winners.length);
            winners.forEach(id => { results[id] = (results[id] || 0) + share; });
          });
          // 分配筹码
          Object.entries(results).forEach(([id, win]) => {
            const player = room.players.find(p => p.id === id)!;
            player.chips += win;
          });
          // 广播结果
          io.to(roomId).emit('chat_broadcast', { message: `胜出者及分池: ${JSON.stringify(results)}` });
          io.to(roomId).emit('room_update', room);
          // 本局结束
          io.to(roomId).emit('game_over');
          return;
        }
        // 重置下注
        gs.currentBet = 0;
        gs.bets = {};
        // 清空已行动列表，进入下一轮
        gs.acted = [];
        // 指向庄家后首位有效玩家
        let idx = (gs.dealerIndex + 1) % players.length;
        while (gs.folded.includes(players[idx].id) || players[idx].chips === 0) idx = (idx + 1) % players.length;
        gs.currentTurn = idx;
        io.to(roomId).emit('game_state', { communityCards: gs.communityCards, pot: gs.pot, bets: gs.bets, currentTurn: gs.currentTurn, dealerIndex: gs.dealerIndex, round: gs.round, currentBet: gs.currentBet });
        io.to(roomId).emit('action_request', { playerId: players[gs.currentTurn].id });
        // 设置超时定时器
        const timeout = setTimeout(() => handleTimeout(roomId), 30000);
        actionTimers.set(roomId, timeout);
      } else {
        // 下一个玩家
        let idx = (playerIndex + 1) % players.length;
        while (gs.folded.includes(players[idx].id) || players[idx].chips === 0) idx = (idx + 1) % players.length;
        gs.currentTurn = idx;
        io.to(roomId).emit('game_state', { communityCards: gs.communityCards, pot: gs.pot, bets: gs.bets, currentTurn: gs.currentTurn, dealerIndex: gs.dealerIndex, round: gs.round, currentBet: gs.currentBet });
        io.to(roomId).emit('action_request', { playerId: players[gs.currentTurn].id });
        // 设置超时定时器
        const timeout = setTimeout(() => handleTimeout(roomId), 30000);
        actionTimers.set(roomId, timeout);
      }
    });

    // 断开连接
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      rooms.forEach(room => {
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
          player.lastHeartbeat = Date.now();
          player.inGame = false;
        }
      });
    });

    // 发送房间列表给新连接，包含游戏类型
    socket.emit('room_list', rooms.map(r => ({ id: r.id, name: r.name, current: r.players.length, online: r.online })));

    // 加入房间
    socket.on('join_room', ({ roomId, playerId, nickname }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        return;
      }
      if (room.players.length >= room.maxPlayers) {
        socket.emit('error', '房间已满');
        return;
      }
      let player = room.players.find(p => p.id === playerId);
      if (!player) {
        player = { id: playerId, nickname, chips: 0, socketId: socket.id, lastHeartbeat: Date.now(), inGame: true };
        room.players.push(player);
      } else {
        player.socketId = socket.id;
        player.lastHeartbeat = Date.now();
      }
      socket.join(roomId);
      // 广播房间更新
      io.to(roomId).emit('room_update', room);
    });
  });

  // 心理惩罚: 处理超时弃牌
  function handleTimeout(roomId: string) {
    const room = rooms.find(r => r.id === roomId);
    if (!room || !room.gameState) return;
    const gs = room.gameState;
    const players = room.players;
    const idx = gs.currentTurn;
    const player = players[idx];
    // 自动弃牌
    gs.folded.push(player.id);
    io.to(roomId).emit('chat_broadcast', { message: `${player.nickname} 超时自动弃牌` });
    // 清理定时器
    const t = actionTimers.get(roomId);
    if (t) { clearTimeout(t); actionTimers.delete(roomId); }
    // 转移到下一位
    let next = (idx + 1) % players.length;
    while (gs.folded.includes(players[next].id) || players[next].chips === 0) {
      next = (next + 1) % players.length;
    }
    gs.currentTurn = next;
    io.to(roomId).emit('game_state', { communityCards: gs.communityCards, pot: gs.pot, bets: gs.bets, currentTurn: gs.currentTurn, dealerIndex: gs.dealerIndex, round: gs.round, currentBet: gs.currentBet });
    io.to(roomId).emit('action_request', { playerId: players[gs.currentTurn].id });
    // 新超时定时器
    const timeout = setTimeout(() => handleTimeout(roomId), 30000);
    actionTimers.set(roomId, timeout);
  }
}