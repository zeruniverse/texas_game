import { Server, Socket } from 'socket.io';
import { Room } from '../models/Room';
import { Player } from '../models/Player';
import { createDeck, shuffleDeck } from '../utils/deck';
import { evaluateHand } from '../utils/handEvaluator';

// 动作超时定时器：key 为 roomId
const actionTimers: Map<string, NodeJS.Timeout> = new Map();
// 存储各房间操作倒计时的截止时间（毫秒）
const actionDeadlines: Map<string, number> = new Map();

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
      autoStart: false, // 初始化自动开始状态
      // 始终初始化游戏状态，以支持线下的下注逻辑
      gameState: { deck: [], communityCards: [], pot: 0, bets: {}, totalBets: {}, currentTurn: 0, dealerIndex: 0, blinds: { sb: 5, bb: 10 }, sbIndex: 0, bbIndex: 1, playerHands: {}, currentBet: 10, folded: [], round: 0, acted: [] }
    });
  }

  // 自动发牌并开始游戏
  function startGame(room: Room) {
    const gs = room.gameState!;
    // 重置游戏状态
    gs.communityCards = [];
    gs.pot = 0;
    gs.bets = {};
    gs.currentBet = gs.blinds.bb;
    gs.folded = [];
    gs.round = 0;
    gs.acted = [];
    gs.totalBets = {};
    gs.playerHands = {}; // 在发牌前清空手牌

    // 获取参与游戏的玩家列表
    const participatingPlayers = room.players.filter(p => room.participants!.includes(p.id));

    if (participatingPlayers.length < 2) {
      io.to(room.id).emit('chat_broadcast', { message: '参与游戏的玩家不足，无法开始' });
      return;
    }

    // 如果线上房间，洗牌并发牌；线下不发牌
    if (room.online) {
      gs.deck = shuffleDeck(createDeck());
      participatingPlayers.forEach(p => {
        const card1 = gs.deck.pop()!;
        const card2 = gs.deck.pop()!;
        gs.playerHands[p.id] = [card1, card2];
        io.to(p.socketId).emit('deal_hand', { hand: gs.playerHands[p.id] });
      });
    }

    // 初始化回合参数 - 基于参与游戏的玩家
    gs.dealerIndex = (gs.dealerIndex + 1) % participatingPlayers.length;
    const sbIndex = (gs.dealerIndex + 1) % participatingPlayers.length;
    const bbIndex = (sbIndex + 1) % participatingPlayers.length;
    gs.sbIndex = sbIndex;
    gs.bbIndex = bbIndex;
    const sbPlayer = participatingPlayers[sbIndex];
    const bbPlayer = participatingPlayers[bbIndex];

    // 确保玩家有足够筹码下盲注
    if (sbPlayer.chips < gs.blinds.sb) {
      io.to(room.id).emit('chat_broadcast', { message: `${sbPlayer.nickname} 筹码不足以下小盲注，游戏无法开始` });
      room.participants = []; // 重置参与者列表
      return;
    }
    if (bbPlayer.chips < gs.blinds.bb) {
      io.to(room.id).emit('chat_broadcast', { message: `${bbPlayer.nickname} 筹码不足以下大盲注，游戏无法开始` });
      room.participants = []; // 重置参与者列表
      return;
    }

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

    // 下一个行动的玩家是大盲后的第一个参与者
    const nextPlayerIndex = (bbIndex + 1) % participatingPlayers.length;
    const nextPlayer = participatingPlayers[nextPlayerIndex];
    // 找到该玩家在整个房间玩家列表中的索引
    gs.currentTurn = room.players.findIndex(p => p.id === nextPlayer.id);

    // 同步玩家筹码与下注显示
    io.to(room.id).emit('room_update', room);
    // 通知前端进入游戏模式
    io.to(room.id).emit('game_started');
    // 广播公共游戏状态
    io.to(room.id).emit('game_state', { communityCards: gs.communityCards, pot: gs.pot, bets: gs.bets, currentTurn: gs.currentTurn, dealerIndex: gs.dealerIndex, round: gs.round, currentBet: gs.currentBet });
    // 请求第一个玩家行动
    io.to(room.id).emit('action_request', { playerId: nextPlayer.id, seconds: 30 });
    // 记录倒计时截止时间并启动超时定时器
    const deadline = Date.now() + 30000;
    actionDeadlines.set(room.id, deadline);
    const timeout = setTimeout(() => {
      actionDeadlines.delete(room.id);
      handleTimeout(room.id);
    }, 30000);
    actionTimers.set(room.id, timeout);
  }

  // 检查是否自动开始游戏
  function checkAutoStart(room: Room) {
    // 这里暂时不实现自动开始逻辑，待后续添加
    // 需要前端先有相应的设置状态
  }

  // 游戏结束时检查并T离线玩家
  function checkAndRemoveOfflinePlayers(room: Room) {
    const now = Date.now();
    const toRemove: string[] = [];
    room.players.forEach(player => {
      const offlineTime = now - player.lastHeartbeat;
      if (player.chips > 0 && offlineTime > 15 * 60 * 1000) {
        io.to(room.id).emit('chat_broadcast', { message: `${player.nickname} 因长时间离线被自动 cash out 并踢出房间` });
        toRemove.push(player.id);
      } else if (player.chips === 0 && offlineTime > 10 * 1000) {
        io.to(room.id).emit('chat_broadcast', { message: `${player.nickname} 因长时间离线被踢出房间` });
        toRemove.push(player.id);
      }
    });
    if (toRemove.length > 0) {
      // 清零被踢出玩家的cashinCount
      room.players = room.players.filter(p => {
        if (toRemove.includes(p.id)) {
          p.cashinCount = 0;
          return false;
        }
        return true;
      });
      io.to(room.id).emit('room_update', room);
    }
  }

  // 检查并清空全部断连的房间（保底机制）
  function checkAndClearEmptyRooms() {
    const now = Date.now();
    rooms.forEach(room => {
      if (room.players.length === 0) return; // 空房间不需要处理

      // 检查是否所有玩家都断连超过1分钟
      const allDisconnected = room.players.every(player => {
        const offlineTime = now - player.lastHeartbeat;
        return offlineTime > 60 * 1000; // 1分钟
      });

      if (allDisconnected) {
        console.log(`房间 ${room.id} 所有玩家都断连超过1分钟，执行清空操作`);

        // 清空所有玩家的cashinCount并踢出
        room.players.forEach(player => {
          player.cashinCount = 0;
        });
        room.players = [];

        // 重置房间为初始状态
        room.participants = [];
        room.autoStart = false;

        // 重置游戏状态
        if (room.gameState) {
          room.gameState = {
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
          };
        }

        // 清理该房间的超时定时器
        const timer = actionTimers.get(room.id);
        if (timer) {
          clearTimeout(timer);
          actionTimers.delete(room.id);
        }
        actionDeadlines.delete(room.id);

        // 广播房间重置（虽然没人在线，但保持日志一致性）
        console.log(`房间 ${room.id} 已重置为初始状态`);
      }
    });
  }

  // 离线检测定时任务
  setInterval(() => {
    const now = Date.now();
    rooms.forEach(room => {
      // 只在游戏未开始或游戏结束时检查T人
      const gameInProgress = room.participants && room.participants.length > 0;
      if (gameInProgress) return; // 游戏进行中不T人

      checkAndRemoveOfflinePlayers(room);
    });

    // 检查并清空全部断连的房间（保底机制）
    checkAndClearEmptyRooms();
  }, 30000);

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
      player.cashinCount += 1; // 增加cashin次数
      io.to(roomId).emit('chat_broadcast', {
        message: `${player.nickname} cash in 1000`,
        type: 'cashin' // 标记为cashin消息
      });
      io.to(roomId).emit('room_update', room);

      // 检查自动开始
      checkAutoStart(room);
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
      io.to(roomId).emit('chat_broadcast', {
        message: `${player.nickname} cash out 并退出房间`,
        type: 'cashout' // 标记为cashout消息
      });
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
      // 同步房间状态和游戏状态
      io.to(roomId).emit('room_update', room);
      io.to(roomId).emit('game_state', {
        communityCards: gs.communityCards,
        pot: gs.pot,
        bets: gs.bets,
        currentTurn: gs.currentTurn,
        dealerIndex: gs.dealerIndex,
        round: gs.round,
        currentBet: gs.currentBet
      });
      // 奖池清空时结束游戏
      if (gs.pot === 0) {
        handleGameOver(room);
      }
    });

    // take_all (线下房间)
    socket.on('take_all', ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room || !room.gameState || room.online) return;
      const gs = room.gameState;
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;
      if (gs.pot === 0) { socket.emit('error', '奖池已为空'); return; }
      // 取走所有奖池
      const takeAmt = gs.pot;
      player.chips += takeAmt;
      gs.pot = 0;
      io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname} take all ${takeAmt}]` });
      // 同步房间状态和游戏状态
      io.to(roomId).emit('room_update', room);
      io.to(roomId).emit('game_state', {
        communityCards: gs.communityCards,
        pot: gs.pot,
        bets: gs.bets,
        currentTurn: gs.currentTurn,
        dealerIndex: gs.dealerIndex,
        round: gs.round,
        currentBet: gs.currentBet
      });
      // 游戏结束
      handleGameOver(room);
    });

    // 切换自动开始状态
    socket.on('toggle_auto_start', ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) return;
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;

      room.autoStart = !room.autoStart;
      const status = room.autoStart ? '开启' : '关闭';
      io.to(roomId).emit('chat_broadcast', {
        message: `[玩家${player.nickname} ${status}了自动开始游戏]`,
        type: 'system'
      });
      io.to(roomId).emit('room_update', room);
    });

    // 客户端请求开始游戏
    socket.on('start_game', ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) return;
      // 锁定潜在参与者：筹码>0 且在线
      const participants = room.players.filter(p => p.chips > 0 && p.inGame).map(p => p.id);
      if (participants.length < 2) {
        // 人数不足，不修改参与者列表
        socket.emit('chat_broadcast', { message: '至少需要2名玩家才能开始游戏' });
        return;
      }
      // 设置参与者并开始游戏
      room.participants = participants;
      io.to(roomId).emit('chat_broadcast', { message: '游戏已开始' });
      // 通知前端启用游戏模式
      io.to(roomId).emit('game_started');
      // 同步房间状态
      io.to(roomId).emit('room_update', room);
      startGame(room);
    });

    // 客户端请求延长思考时间
    socket.on('extend_time', ({ roomId }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) return;

      // 检查游戏状态：只有在游戏进行中且轮到某人行动时才允许延时
      if (!room.gameState || room.participants?.length === 0) {
        socket.emit('error', '游戏未开始，无法延时');
        return;
      }

      const player = room.players.find(p => p.socketId === socket.id);
      if (player) {
        io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname} 延时当前行动30s]` });
      }
      // 重置超时定时器
      const timer = actionTimers.get(roomId);
      if (timer) {
        clearTimeout(timer);
        actionTimers.delete(roomId);
        actionDeadlines.delete(roomId);
      }
      // 重新设置
      const newDeadline = Date.now() + 30000;
      actionDeadlines.set(roomId, newDeadline);
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

      // 处理离线玩家自动行动
      const handleOfflinePlayerAction = (playerIdx: number) => {
        const player = players[playerIdx];
        const now = Date.now();
        const offlineTime = now - player.lastHeartbeat;

        // 如果玩家离线超过30秒，自动执行行动
        if (offlineTime > 30000) {
          const currentBet = gs.currentBet;
          const playerBet = gs.bets[player.id] || 0;
          const toCall = currentBet - playerBet;

          if (toCall === 0) {
            // 可以check，自动check
            io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname} 离线自动Check]` });
            if (!gs.acted.includes(player.id)) gs.acted.push(player.id);
            return true;
          } else {
            // 需要call，自动fold
            gs.folded.push(player.id);
            io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname} 离线自动Fold]` });
            if (!gs.acted.includes(player.id)) gs.acted.push(player.id);
            return true;
          }
        }
        return false;
      };

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

      // 同步玩家筹码与下注显示（确保最后的action立即显示）
      io.to(roomId).emit('room_update', room);
      io.to(roomId).emit('game_state', {
        communityCards: gs.communityCards,
        pot: gs.pot,
        bets: gs.bets,
        currentTurn: gs.currentTurn,
        dealerIndex: gs.dealerIndex,
        round: gs.round,
        currentBet: gs.currentBet
      });

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
        handleGameOver(room);
        return;
      }

      // 检查是否所有活跃玩家都无法再行动（All-in情况）
      // 只有在至少有一个玩家All-in（筹码为0）的情况下才检查
      const hasAllinPlayer = activePlayers.some(p => p.chips === 0);

      if (hasAllinPlayer) {
        const allCannotAct = activePlayers.every(p => {
          const hasChips = p.chips > 0;
          const hasActed = gs.acted.includes(p.id);
          const isAtCurrentBet = (gs.bets[p.id] || 0) === gs.currentBet;
          // 玩家无法行动的条件：没有筹码 或者 (已行动且下注已达到当前注)
          return !hasChips || (hasActed && isAtCurrentBet);
        });

        if (allCannotAct) {
          // 所有人都无法行动，直接跳到摊牌阶段，发完所有牌
          if (room.online) {
            // 发完所有公共牌
            while (gs.communityCards.length < 5 && gs.deck.length > 0) {
              gs.communityCards.push(gs.deck.pop()!);
            }

            // 立即同步游戏状态，让前端看到完整的公共牌
            io.to(roomId).emit('game_state', {
              communityCards: gs.communityCards,
              pot: gs.pot,
              bets: gs.bets,
              currentTurn: gs.currentTurn,
              dealerIndex: gs.dealerIndex,
              round: gs.round,
              currentBet: gs.currentBet
            });

            // 显示公共牌发放信息
            const cardNames = ['翻牌', '转牌', '河牌'];
            const currentCards = gs.communityCards.length;
            if (currentCards >= 3) {
              io.to(roomId).emit('chat_broadcast', { message: `All-in情况下发完所有公共牌: ${gs.communityCards.join(' ')}` });
            }

            // 显示所有玩家的底牌
            io.to(roomId).emit('chat_broadcast', { message: '所有玩家All-in，揭示底牌:' });
            activePlayers.forEach(p => {
              const hand = gs.playerHands[p.id] || [];
              io.to(roomId).emit('chat_broadcast', { message: `${p.nickname}: ${hand.join(' ')}` });
            });
          }

          // 直接进行摊牌和分池
          if (room.online) {
            // 摊牌：侧池与主池分配
            const inPlayers = room.participants!.filter(id => !gs.folded.includes(id));

            // 展示所有未fold玩家的底牌
            io.to(roomId).emit('chat_broadcast', { message: '摊牌阶段，揭示底牌:' });
            inPlayers.forEach(id => {
              const player = room.players.find(p => p.id === id)!;
              const hand = gs.playerHands[id] || [];
              io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname}底牌 ${hand.join(' ')}]` });
            });

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
            handleGameOver(room);
            return;
          } else {
            // 线下游戏进入分奖池阶段：先广播全部公共牌
            while (gs.communityCards.length < 5 && gs.deck.length > 0) {
              gs.communityCards.push(gs.deck.pop()!);
            }
            // 同步完整游戏状态
            io.to(room.id).emit('game_state', {
              communityCards: gs.communityCards,
              pot: gs.pot,
              bets: gs.bets,
              currentTurn: gs.currentTurn,
              dealerIndex: gs.dealerIndex,
              round: gs.round,
              currentBet: gs.currentBet
            });
            io.to(room.id).emit('chat_broadcast', { message: `All-in情况下发完所有公共牌: ${gs.communityCards.join(' ')}` });
            // 触发分池界面
            const t = actionTimers.get(room.id);
            if (t) { clearTimeout(t); actionTimers.delete(room.id); }
            io.to(room.id).emit('distribution_start');
            return;
          }
        }
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
          // 进入河牌阶段
          gs.round = 3;
          gs.communityCards.push(gs.deck.pop()!);
        } else {
          // 线下分池阶段：停止定时器，通知前端
          if (!room.online) {
            const t = actionTimers.get(room.id);
            if (t) { clearTimeout(t); actionTimers.delete(room.id); }
            io.to(room.id).emit('distribution_start');
            return;
          }
          // 摊牌：侧池与主池分配
          const inPlayers = room.participants!.filter(id => !gs.folded.includes(id));

          // 展示所有未fold玩家的底牌
          io.to(roomId).emit('chat_broadcast', { message: '摊牌阶段，揭示底牌:' });
          inPlayers.forEach(id => {
            const player = room.players.find(p => p.id === id)!;
            const hand = gs.playerHands[id] || [];
            io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname}底牌 ${hand.join(' ')}]` });
          });

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
          handleGameOver(room);
          return;
        }
        // 重置下注
        gs.currentBet = 0;
        gs.bets = {};
        // 清空已行动列表，进入下一轮
        gs.acted = [];
        // 获取参与游戏的玩家列表
        const participatingPlayers = room.players.filter(p => room.participants!.includes(p.id));
        // 指向庄家后首位有效玩家（在参与者中）
        let participantIdx = (gs.dealerIndex + 1) % participatingPlayers.length;
        while (gs.folded.includes(participatingPlayers[participantIdx].id) || participatingPlayers[participantIdx].chips === 0) {
          participantIdx = (participantIdx + 1) % participatingPlayers.length;
        }
        // 找到该玩家在整个房间玩家列表中的索引
        const globalIdx = room.players.findIndex(p => p.id === participatingPlayers[participantIdx].id);
        gs.currentTurn = globalIdx;
        io.to(roomId).emit('game_state', { communityCards: gs.communityCards, pot: gs.pot, bets: gs.bets, currentTurn: gs.currentTurn, dealerIndex: gs.dealerIndex, round: gs.round, currentBet: gs.currentBet });
        io.to(roomId).emit('action_request', { playerId: players[gs.currentTurn].id, seconds: 30 });
        // 设置超时定时器
        const timeout = setTimeout(() => handleTimeout(roomId), 30000);
        actionTimers.set(roomId, timeout);
      } else {
        // 下一个玩家 - 只在参与游戏的玩家中循环
        const participatingPlayers = room.players.filter(p => room.participants!.includes(p.id));
        const currentPlayerInParticipants = participatingPlayers.findIndex(p => p.id === players[playerIndex].id);
        let nextParticipantIdx = (currentPlayerInParticipants + 1) % participatingPlayers.length;
        while (gs.folded.includes(participatingPlayers[nextParticipantIdx].id) || participatingPlayers[nextParticipantIdx].chips === 0) {
          nextParticipantIdx = (nextParticipantIdx + 1) % participatingPlayers.length;
          // 防止死循环：如果找不到合适的下一个玩家，结束游戏
          if (nextParticipantIdx === currentPlayerInParticipants) {
            io.to(roomId).emit('chat_broadcast', { message: '无法找到下一个行动玩家，游戏结束' });
            handleGameOver(room);
            return;
          }
        }
        // 找到该玩家在整个房间玩家列表中的索引
        const nextGlobalIdx = room.players.findIndex(p => p.id === participatingPlayers[nextParticipantIdx].id);
        gs.currentTurn = nextGlobalIdx;
        io.to(roomId).emit('game_state', { communityCards: gs.communityCards, pot: gs.pot, bets: gs.bets, currentTurn: gs.currentTurn, dealerIndex: gs.dealerIndex, round: gs.round, currentBet: gs.currentBet });
        io.to(roomId).emit('action_request', { playerId: players[gs.currentTurn].id, seconds: 30 });
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
        player = {
          id: playerId,
          nickname,
          chips: 0,
          socketId: socket.id,
          lastHeartbeat: Date.now(),
          inGame: true,
          cashinCount: 0 // 初始化cashin次数
        };
        room.players.push(player);
      } else {
        // 找到现有玩家，替换session
        const oldSocketId = player.socketId;

        // 通知旧session被踢出
        if (oldSocketId !== socket.id) {
          io.to(oldSocketId).emit('kicked_out', { message: '您的账号在其他地方登录，已被踢出' });
          io.sockets.sockets.get(oldSocketId)?.disconnect();
        }

        // 更新player信息
        player.socketId = socket.id;
        player.lastHeartbeat = Date.now();
        player.inGame = true; // 重新上线

        io.to(roomId).emit('chat_broadcast', {
          message: `${player.nickname} 重新上线`,
          type: 'system'
        });
      }

      socket.join(roomId);
      // 广播房间更新
      io.to(roomId).emit('room_update', room);
    });

    // 断线重连或刷新页面的重建会话
    socket.on('reconnect_room', ({ roomId, playerId, nickname }) => {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        return;
      }
      // 查找原有玩家
      const player = room.players.find(p => p.id === playerId);
      if (!player) {
        // 会话过期或未加入，踢出
        socket.emit('kicked_out', { message: '会话过期，请重新进入房间' });
        socket.disconnect();
        return;
      }
      // 更新玩家连接信息
      player.socketId = socket.id;
      player.lastHeartbeat = Date.now();
      player.inGame = true;
      // 加入房间
      socket.join(roomId);
      // 向该客户端发送房间状态
      socket.emit('room_update', room);

      // 如果游戏正在进行中，同步游戏状态
      if (room.gameState && room.participants && room.participants.length > 0) {
        const gs = room.gameState;
        // 发送游戏状态
        socket.emit('game_state', {
          communityCards: gs.communityCards,
          pot: gs.pot,
          bets: gs.bets,
          currentTurn: gs.currentTurn,
          dealerIndex: gs.dealerIndex,
          round: gs.round,
          currentBet: gs.currentBet
        });

        // 同步倒计时
        const deadline = actionDeadlines.get(roomId);
        if (deadline) {
          const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
          socket.emit('time_update', { seconds: remain });
        }

        // 如果该玩家参与游戏，发送手牌
        if (room.participants.includes(playerId) && gs.playerHands[playerId]) {
          socket.emit('deal_hand', { hand: gs.playerHands[playerId] });
        }

        // 通知前端游戏已开始
        socket.emit('game_started');

        // 如果当前轮到该玩家行动，发送行动请求
        if (room.players[gs.currentTurn]?.id === playerId) {
          const deadline = actionDeadlines.get(roomId) || Date.now();
          const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
          socket.emit('action_request', { playerId, seconds: remain });
        }
      }
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
    // 自动Check或Fold
    const playerBet = gs.bets[player.id] || 0;
    const toCall = gs.currentBet - playerBet;
    if (toCall === 0) {
      // 自动Check
      if (!gs.acted.includes(player.id)) gs.acted.push(player.id);
      io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname} 超时自动Check]` });
    } else {
      // 自动Fold
      gs.folded.push(player.id);
      if (!gs.acted.includes(player.id)) gs.acted.push(player.id);
      io.to(roomId).emit('chat_broadcast', { message: `[玩家${player.nickname} 超时自动Fold]` });
    }
    // 清理定时器
    const t = actionTimers.get(roomId);
    if (t) { clearTimeout(t); actionTimers.delete(roomId); }

    // 检查剩余玩家数量
    const activeIds = room.participants!.filter(id => !gs.folded.includes(id));
    const activePlayers = activeIds.map(id => room.players.find(p => p.id === id)!);

    if (activePlayers.length === 1) {
      // 只剩一个玩家，直接胜出
      const winner = activePlayers[0];
      winner.chips += gs.pot;
      io.to(roomId).emit('chat_broadcast', { message: `${winner.nickname} 赢得底池 ${gs.pot}` });
      io.to(roomId).emit('room_update', room);
      handleGameOver(room);
      return;
    }

    if (activePlayers.length === 0) {
      // 所有人都fold了，游戏异常结束
      io.to(roomId).emit('chat_broadcast', { message: '所有玩家都已弃牌，游戏结束' });
      handleGameOver(room);
      return;
    }

    // 下一个玩家 - 只在参与游戏的玩家中循环
    const participatingPlayers = room.players.filter(p => room.participants!.includes(p.id));
    const currentPlayerInParticipants = participatingPlayers.findIndex(p => p.id === players[idx].id);
    let nextParticipantIdx = (currentPlayerInParticipants + 1) % participatingPlayers.length;
    while (gs.folded.includes(participatingPlayers[nextParticipantIdx].id) || participatingPlayers[nextParticipantIdx].chips === 0) {
      nextParticipantIdx = (nextParticipantIdx + 1) % participatingPlayers.length;
      // 防止死循环：如果找不到合适的下一个玩家，结束游戏
      if (nextParticipantIdx === currentPlayerInParticipants) {
        io.to(roomId).emit('chat_broadcast', { message: '无法找到下一个行动玩家，游戏结束' });
        handleGameOver(room);
        return;
      }
    }
    // 找到该玩家在整个房间玩家列表中的索引
    const nextGlobalIdx = room.players.findIndex(p => p.id === participatingPlayers[nextParticipantIdx].id);
    gs.currentTurn = nextGlobalIdx;
    io.to(roomId).emit('game_state', { communityCards: gs.communityCards, pot: gs.pot, bets: gs.bets, currentTurn: gs.currentTurn, dealerIndex: gs.dealerIndex, round: gs.round, currentBet: gs.currentBet });
    io.to(roomId).emit('action_request', { playerId: players[gs.currentTurn].id, seconds: 30 });
    // 新超时定时器
    const timeout = setTimeout(() => handleTimeout(roomId), 30000);
    actionTimers.set(roomId, timeout);
  }

  // 处理离线玩家的自动操作
  function handleOfflineAction(roomId: string) {
    const room = rooms.find(r => r.id === roomId);
    if (!room || !room.gameState) return;
    const gs = room.gameState;
    const player = room.players[gs.currentTurn];
    const currentBet = gs.currentBet;
    const playerBet = gs.bets[player.id] || 0;
    const toCall = currentBet - playerBet;
    if (toCall === 0) {
      // 自动Check
      io.to(room.id).emit('chat_broadcast', { message: `[玩家${player.nickname} 离线自动Check]` });
      gs.acted.push(player.id);
    } else {
      // 自动Fold
      gs.folded.push(player.id);
      io.to(room.id).emit('chat_broadcast', { message: `[玩家${player.nickname} 离线自动Fold]` });
      gs.acted.push(player.id);
    }
    // 同步状态
    io.to(room.id).emit('room_update', room);
    io.to(room.id).emit('game_state', { communityCards: gs.communityCards, pot: gs.pot, bets: gs.bets, currentTurn: gs.currentTurn, dealerIndex: gs.dealerIndex, round: gs.round, currentBet: gs.currentBet });
    // 下一步逻辑：调用handleTimeout以进入下一玩家/阶段
    handleTimeout(roomId);
  }

  // 游戏结束处理
  function handleGameOver(room: Room) {
    // 清空参与者列表表示游戏结束
    room.participants = [];

    // 立即同步房间状态，让前端移除"游戏中"标记
    io.to(room.id).emit('room_update', room);

    // 游戏结束后立即检查并T离线玩家
    checkAndRemoveOfflinePlayers(room);

    // 发送游戏结束事件
    io.to(room.id).emit('game_over');

    // 自动开始下一局逻辑
    if (room.autoStart) {
      const nextParticipants = room.players.filter(p => p.chips > 0 && p.inGame).map(p => p.id);
      if (nextParticipants.length >= 2) {
        room.participants = nextParticipants;
        io.to(room.id).emit('chat_broadcast', { message: '自动开始新一局游戏' });
        startGame(room);
      }
    }

    // TODO: 检查自动开始（需要前端状态支持）
    // checkAutoStart(room);
  }
}