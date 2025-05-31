import { parentPort, workerData } from 'worker_threads';
import { Room } from '../models/Room';
import { Player } from '../models/Player';
import { GameTask, GameTaskResponse } from '../models/GameTask';
import { createDeck, shuffleDeck } from '../utils/deck';
import { evaluateHand } from '../utils/handEvaluator';

if (!parentPort) {
  throw new Error('这个文件只能在Worker线程中运行');
}

// 房间数据
let room: Room = workerData.room;
const roomId: string = workerData.roomId;

// 动作超时定时器和截止时间
let actionTimer: NodeJS.Timeout | null = null;
let actionDeadline: number | null = null;

// 向主线程发送响应
function sendResponse(taskId: string, success: boolean, data?: any, error?: string) {
  parentPort!.postMessage({
    taskId,
    success,
    data,
    error
  } as GameTaskResponse);
}

// 向主线程发送事件
function emitToRoom(event: string, data: any) {
  parentPort!.postMessage({
    taskId: 'emit',
    success: true,
    data: {
      type: 'emit',
      event,
      roomId,
      data
    }
  });
}

// 向特定玩家发送事件
function emitToPlayer(socketId: string, event: string, data: any) {
  parentPort!.postMessage({
    taskId: 'emit',
    success: true,
    data: {
      type: 'emit_to_socket',
      event,
      socketId,
      data
    }
  });
}

// 同步游戏状态给重连的玩家
function syncGameStateToPlayer(socketId: string, playerId: string) {
  // 先发送房间更新，确保前端有正确的players列表
  emitToPlayer(socketId, 'room_update', room);

  // 如果游戏未开始，不需要同步
  if (!room.gameState || !room.participants || room.participants.length === 0) {
    return;
  }
  
  const gs = room.gameState;
  
  // 发送游戏开始事件
  emitToPlayer(socketId, 'game_started', {});
  
  // 发送游戏状态
  emitToPlayer(socketId, 'game_state', {
    communityCards: gs.communityCards,
    pot: gs.pot,
    bets: gs.bets,
    currentTurn: gs.currentTurn,
    dealerIndex: gs.dealerIndex,
    round: gs.round,
    currentBet: gs.currentBet
  });
  
  // 如果该玩家参与游戏并且是线上房间，发送手牌
  if (room.participants.includes(playerId) && gs.playerHands && gs.playerHands[playerId] && room.online) {
    emitToPlayer(socketId, 'deal_hand', { hand: gs.playerHands[playerId] });
  }

  emitToPlayer(socketId, 'action_request', { 
    playerId: room.players[gs.currentTurn].id, 
    seconds: (actionDeadline && actionDeadline > Date.now())? Math.ceil((actionDeadline - Date.now()) / 1000): 0
  });
}

// 开始游戏
function startGame() {
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
  gs.playerHands = {};

  // 获取参与游戏的玩家列表
  const participatingPlayers = room.players.filter(p => room.participants!.includes(p.id));

  if (participatingPlayers.length < 2) {
    emitToRoom('chat_broadcast', { message: '参与游戏的玩家不足，无法开始' });
    return;
  }

  // 如果线上房间，洗牌并发牌；线下不发牌
  if (room.online) {
    gs.deck = shuffleDeck(createDeck());
    participatingPlayers.forEach(p => {
      const card1 = gs.deck.pop()!;
      const card2 = gs.deck.pop()!;
      gs.playerHands[p.id] = [card1, card2];
      emitToPlayer(p.socketId, 'deal_hand', { hand: gs.playerHands[p.id] });
    });
  }

  // 初始化回合参数
  gs.dealerIndex = (gs.dealerIndex + 1) % participatingPlayers.length;
  const sbIndex = (gs.dealerIndex + 1) % participatingPlayers.length;
  const bbIndex = (sbIndex + 1) % participatingPlayers.length;
  gs.sbIndex = sbIndex;
  gs.bbIndex = bbIndex;
  const sbPlayer = participatingPlayers[sbIndex];
  const bbPlayer = participatingPlayers[bbIndex];

  // 确保玩家有足够筹码下盲注
  if (sbPlayer.chips < gs.blinds.sb) {
    emitToRoom('chat_broadcast', { message: `${sbPlayer.nickname} 筹码不足以下小盲注，游戏无法开始` });
    room.participants = [];
    return;
  }
  if (bbPlayer.chips < gs.blinds.bb) {
    emitToRoom('chat_broadcast', { message: `${bbPlayer.nickname} 筹码不足以下大盲注，游戏无法开始` });
    room.participants = [];
    return;
  }

  sbPlayer.chips -= gs.blinds.sb;
  bbPlayer.chips -= gs.blinds.bb;
  gs.bets[sbPlayer.id] = gs.blinds.sb;
  gs.bets[bbPlayer.id] = gs.blinds.bb;
  gs.pot = gs.blinds.sb + gs.blinds.bb;
  gs.totalBets[sbPlayer.id] = gs.blinds.sb;
  gs.totalBets[bbPlayer.id] = gs.blinds.bb;
  gs.currentBet = gs.blinds.bb;

  // 下一个行动的玩家是大盲后的第一个参与者
  const nextPlayerIndex = (bbIndex + 1) % participatingPlayers.length;
  const nextPlayer = participatingPlayers[nextPlayerIndex];
  gs.currentTurn = room.players.findIndex(p => p.id === nextPlayer.id);

  // 同步状态
  emitToRoom('room_update', room);
  emitToRoom('game_started', {});
  emitToRoom('game_state', {
    communityCards: gs.communityCards,
    pot: gs.pot,
    bets: gs.bets,
    currentTurn: gs.currentTurn,
    dealerIndex: gs.dealerIndex,
    round: gs.round,
    currentBet: gs.currentBet
  });

  // 请求第一个玩家行动
  emitToRoom('action_request', { playerId: nextPlayer.id, seconds: 30 });
  
  // 清除已有定时器并立即启动新的
  clearActionTimer();
  actionDeadline = Date.now() + 30000;
  actionTimer = setTimeout(() => {
    actionDeadline = null;
    handleTimeout();
  }, 30000);
}

// 清除动作定时器
function clearActionTimer() {
  // 清除动作定时器，保证环境干净
  if (actionTimer) {
    clearTimeout(actionTimer);
    actionTimer = null;
  }
  actionDeadline = null;
}

// 处理超时
function handleTimeout() {
  const gs = room.gameState;
  if (!gs) return;
  
  // 检查游戏是否已经结束（参与者列表为空）
  if (!room.participants || room.participants.length === 0) {
    console.log('游戏已结束，忽略超时处理');
    return;
  }
  
  const players = room.players;
  const idx = gs.currentTurn;
  const player = players[idx];
  
  // 检查当前玩家是否还在参与游戏
  if (!player || !room.participants.includes(player.id)) {
    console.log('当前玩家已不在游戏中，忽略超时处理');
    return;
  }
  
  // 自动Check或Fold
  const playerBet = gs.bets[player.id] || 0;
  const toCall = gs.currentBet - playerBet;
  
  if (toCall === 0) {
    // 自动Check
    if (!gs.acted.includes(player.id)) gs.acted.push(player.id);
    emitToRoom('chat_broadcast', { message: `[玩家${player.nickname} 超时自动Check]` });
  } else {
    // 自动Fold
    gs.folded.push(player.id);
    if (!gs.acted.includes(player.id)) gs.acted.push(player.id);
    emitToRoom('chat_broadcast', { message: `[玩家${player.nickname} 超时自动Fold]` });
  }

  clearActionTimer();

  // 检查剩余玩家数量
  const activeIds = room.participants!.filter(id => !gs.folded.includes(id));
  const activePlayers = activeIds.map(id => room.players.find(p => p.id === id)!);

  if (activePlayers.length === 1) {
    // 只剩一个玩家，直接胜出
    const winner = activePlayers[0];
    winner.chips += gs.pot;
    emitToRoom('chat_broadcast', { message: `${winner.nickname} 赢得底池 ${gs.pot}` });
    emitToRoom('room_update', room);
    handleGameOver();
    return;
  }

  if (activePlayers.length === 0) {
    // 所有人都fold了，游戏异常结束
    emitToRoom('chat_broadcast', { message: '所有玩家都已弃牌，游戏结束' });
    handleGameOver();
    return;
  }

  // 继续下一个玩家
  continueToNextPlayer();
}

// 继续到下一个玩家
function continueToNextPlayer() {
  const gs = room.gameState!;
  const participatingPlayers = room.players.filter(p => room.participants!.includes(p.id));
  const currentPlayerInParticipants = participatingPlayers.findIndex(p => p.id === room.players[gs.currentTurn].id);
  
  // 寻找下一个可以行动的玩家
  let nextParticipantIdx = (currentPlayerInParticipants + 1) % participatingPlayers.length;
  let attempts = 0;
  
  while (attempts < participatingPlayers.length) {
    const nextPlayer = participatingPlayers[nextParticipantIdx];
    
    // 如果玩家没有弃牌，并且要么有筹码，要么需要决定是否跟注
    if (!gs.folded.includes(nextPlayer.id)) {
      const playerBet = gs.bets[nextPlayer.id] || 0;
      const needToCall = gs.currentBet - playerBet;
      
      // 玩家有筹码，或者是全下但当前投注不足（需要决定是否能跟注）
      if (nextPlayer.chips > 0 || (nextPlayer.chips === 0 && needToCall > 0)) {
        break;
      }
    }
    
    nextParticipantIdx = (nextParticipantIdx + 1) % participatingPlayers.length;
    attempts++;
  }
  
  // 如果找不到可行动的玩家，先同步当前游戏状态以更新 pot/bets 等
  if (attempts >= participatingPlayers.length) {
    // 同步当前游戏状态
    emitToRoom('game_state', {
      communityCards: gs.communityCards,
      pot: gs.pot,
      bets: gs.bets,
      currentTurn: gs.currentTurn,
      dealerIndex: gs.dealerIndex,
      round: gs.round,
      currentBet: gs.currentBet
    });
    
    // 检查并进入下一阶段或结束游戏
    checkRoundEnd();
    return;
  }
  
  const nextGlobalIdx = room.players.findIndex(p => p.id === participatingPlayers[nextParticipantIdx].id);
  gs.currentTurn = nextGlobalIdx;
  
  // 广播游戏状态更新并请求下一个玩家行动
  emitToRoom('game_state', {
    communityCards: gs.communityCards,
    pot: gs.pot,
    bets: gs.bets,
    currentTurn: gs.currentTurn,
    dealerIndex: gs.dealerIndex,
    round: gs.round,
    currentBet: gs.currentBet
  });
  emitToRoom('action_request', { playerId: room.players[gs.currentTurn].id, seconds: 30 });
  
  // 清除已有定时器并立即启动新的
  clearActionTimer();
  actionDeadline = Date.now() + 30000;
  actionTimer = setTimeout(() => {
    actionDeadline = null;
    handleTimeout();
  }, 30000);
}

// 游戏结束处理
function handleGameOver() {
  // 立即清除所有定时器，防止延迟执行
  clearActionTimer();
  
  // 清空参与者列表和重置游戏状态，表示游戏结束
  room.participants = [];
  
  // 重置游戏状态中的关键字段
  if (room.gameState) {
    room.gameState.currentTurn = -1; // 设置为无效值
    room.gameState.acted = [];
    room.gameState.folded = [];
  }
  
  // 立即同步房间状态
  emitToRoom('room_update', room);
  emitToRoom('game_over', {});
  
  // 自动开始下一局逻辑
  if (room.autoStart) {
    const nextParticipants = room.players.filter(p => p.chips > 0 && p.inGame).map(p => p.id);
    if (nextParticipants.length >= 2) {
      room.participants = nextParticipants;
      emitToRoom('chat_broadcast', { message: '自动开始新一局游戏' });
      startGame();
    }
  }
}

// 检查并移除离线玩家
function checkAndRemoveOfflinePlayers() {
  const now = Date.now();
  const toRemove: string[] = [];
  
  room.players.forEach(player => {
    const offlineTime = now - player.lastHeartbeat;
    if (player.chips > 0 && offlineTime > 15 * 60 * 1000) {
      emitToRoom('chat_broadcast', { message: `${player.nickname} 因长时间离线被自动 cash out 并踢出房间` });
      toRemove.push(player.id);
    } else if (player.chips === 0 && offlineTime > 10 * 1000) {
      emitToRoom('chat_broadcast', { message: `${player.nickname} 因长时间离线被踢出房间` });
      toRemove.push(player.id);
    }
  });
  
  if (toRemove.length > 0) {
    room.players = room.players.filter(p => {
      if (toRemove.includes(p.id)) {
        p.cashinCount = 0;
        return false;
      }
      return true;
    });
    emitToRoom('room_update', room);
  }
}

// 处理任务
parentPort.on('message', (task: GameTask) => {
  try {
    switch (task.type) {
      case 'join_room':
        handleJoinRoom(task);
        break;
      case 'cash_in':
        handleCashIn(task);
        break;
      case 'cash_out':
        handleCashOut(task);
        break;
      case 'start_game':
        handleStartGame(task);
        break;
      case 'player_action':
        handlePlayerAction(task);
        break;
      case 'chat_message':
        handleChatMessage(task);
        break;
      case 'heartbeat':
        handleHeartbeat(task);
        break;
      case 'reconnect':
        handleReconnect(task);
        break;
      case 'extend_time':
        handleExtendTime(task);
        break;
      case 'toggle_auto_start':
        handleToggleAutoStart(task);
        break;
      case 'take':
        handleTake(task);
        break;
      case 'take_all':
        handleTakeAll(task);
        break;
      case 'player_offline':
        handlePlayerOffline(task);
        break;
      default:
        sendResponse(task.id, false, null, `未知任务类型: ${task.type}`);
    }
  } catch (error) {
    console.error(`处理任务 ${task.type} 时出错:`, error);
    sendResponse(task.id, false, null, `任务处理失败: ${error}`);
  }
});

// 处理加入房间
function handleJoinRoom(task: GameTask) {
  const { playerId, nickname, socketId } = task.data;
  
  // 检查是否已存在
  const existingPlayer = room.players.find(p => p.id === playerId);
  if (existingPlayer) {
    // 更新连接信息
    existingPlayer.socketId = socketId;
    existingPlayer.lastHeartbeat = Date.now();
    existingPlayer.inGame = true;
    emitToRoom('chat_broadcast', { message: `${existingPlayer.nickname} 重新上线`, type: 'system' });
  } else {
    // 检查房间是否已满
    if (room.players.length >= room.maxPlayers) {
      sendResponse(task.id, false, null, '房间已满');
      return;
    }
    
    // 创建新玩家
    const newPlayer: Player = {
      id: playerId,
      nickname,
      chips: 0,
      socketId,
      lastHeartbeat: Date.now(),
      inGame: true,
      cashinCount: 0
    };
    
    room.players.push(newPlayer);
    emitToRoom('chat_broadcast', { message: `${nickname} 加入房间`, type: 'system' });
  }
  
  // 更新房间活跃时间
  room.lastActiveTime = Date.now();
  
  emitToRoom('room_update', room);
  
  // 同步游戏状态给新加入或重新上线的玩家
  syncGameStateToPlayer(socketId, playerId);
  
  sendResponse(task.id, true, { room });
}

// 处理cash in
function handleCashIn(task: GameTask) {
  const { playerId } = task.data;
  
  const player = room.players.find(p => p.id === playerId);
  if (!player) {
    sendResponse(task.id, false, null, '玩家不存在');
    return;
  }
  
  player.chips += 1000;
  player.cashinCount += 1;
  room.lastActiveTime = Date.now();
  
  emitToRoom('chat_broadcast', { message: `${player.nickname} cash in 1000`, type: 'cashin' });
  emitToRoom('room_update', room);
  
  sendResponse(task.id, true);
}

// 处理cash out
function handleCashOut(task: GameTask) {
  const { playerId } = task.data;
  
  const playerIndex = room.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    sendResponse(task.id, false, null, '玩家不存在');
    return;
  }
  
  const player = room.players[playerIndex];
  room.players.splice(playerIndex, 1);
  
  emitToRoom('chat_broadcast', { message: `${player.nickname} cash out 并退出房间`, type: 'cashout' });
  emitToRoom('room_update', room);
  
  sendResponse(task.id, true);
}

// 处理开始游戏
function handleStartGame(task: GameTask) {
  if (room.participants && room.participants.length > 0) {
    sendResponse(task.id, false, null, '游戏已在进行中');
    return;
  }
  
  const participants = room.players.filter(p => p.chips > 0 && p.inGame).map(p => p.id);
  if (participants.length < 2) {
    sendResponse(task.id, false, null, '至少需要2名玩家才能开始游戏');
    return;
  }
  
  room.participants = participants;
  room.lastActiveTime = Date.now();
  
  emitToRoom('chat_broadcast', { message: '游戏已开始' });
  emitToRoom('game_started', {});
  emitToRoom('room_update', room);
  
  startGame();
  sendResponse(task.id, true);
}

// 其他处理函数的实现...
function handlePlayerAction(task: GameTask) {
  const { playerId, action, amount } = task.data;
  const gs = room.gameState;
  
  if (!gs || !room.participants || room.participants.length === 0) {
    sendResponse(task.id, false, null, '游戏未开始');
    return;
  }
  
  const player = room.players.find(p => p.id === playerId);
  if (!player) {
    sendResponse(task.id, false, null, '玩家不存在');
    return;
  }
  
  // 检查是否轮到该玩家
  if (room.players[gs.currentTurn].id !== playerId) {
    sendResponse(task.id, false, null, '不是你的回合');
    return;
  }
  
  // 检查玩家是否已经fold
  if (gs.folded.includes(playerId)) {
    sendResponse(task.id, false, null, '你已经弃牌');
    return;
  }
  
  // 检查玩家是否已经全下且投注足够（不需要再行动）
  if (player.chips === 0) {
    const currentBet = gs.bets[playerId] || 0;
    if (currentBet >= gs.currentBet) {
      sendResponse(task.id, false, null, '你已经全下且投注足够');
      return;
    }
  }
  
  // 清除动作定时器
  clearActionTimer();
  
  const currentBet = gs.bets[playerId] || 0;
  const toCall = gs.currentBet - currentBet;
  
  switch (action.toLowerCase()) {
    case 'fold':
      handleFold(playerId);
      break;
    case 'check':
      if (toCall > 0) {
        sendResponse(task.id, false, null, '无法check，需要跟注或弃牌');
        return;
      }
      handleCheck(playerId);
      break;
    case 'call':
      if (toCall <= 0) {
        sendResponse(task.id, false, null, '无需跟注');
        return;
      }
      handleCall(playerId, toCall);
      break;
    case 'raise':
      if (!amount || amount <= gs.currentBet) {
        sendResponse(task.id, false, null, '加注金额必须大于当前最高注');
        return;
      }
      handleRaise(playerId, amount);
      break;
    case 'all-in':
    case 'allin':
      handleAllIn(playerId);
      break;
    default:
      sendResponse(task.id, false, null, '未知的行动');
      return;
  }
  
  // 添加到已行动列表
  if (!gs.acted.includes(playerId)) {
    gs.acted.push(playerId);
  }
  
  // 检查回合是否结束
  checkRoundEnd();
  
  sendResponse(task.id, true);
}

// 处理弃牌
function handleFold(playerId: string) {
  const gs = room.gameState!;
  const player = room.players.find(p => p.id === playerId)!;
  
  gs.folded.push(playerId);
  emitToRoom('chat_broadcast', { message: `${player.nickname} 弃牌` });
  
  // 检查是否只剩一个玩家
  const activeIds = room.participants!.filter(id => !gs.folded.includes(id));
  if (activeIds.length === 1) {
    const winner = room.players.find(p => p.id === activeIds[0])!;
    winner.chips += gs.pot;
    emitToRoom('chat_broadcast', { message: `${winner.nickname} 赢得底池 ${gs.pot}` });
    emitToRoom('room_update', room);
    handleGameOver();
    return;
  }
  
  // 继续下一个玩家
  continueToNextPlayer();
}

// 处理看牌
function handleCheck(playerId: string) {
  const player = room.players.find(p => p.id === playerId)!;
  emitToRoom('chat_broadcast', { message: `${player.nickname} 看牌` });
  continueToNextPlayer();
}

// 处理跟注
function handleCall(playerId: string, callAmount: number) {
  const gs = room.gameState!;
  const player = room.players.find(p => p.id === playerId)!;
  
  const actualCall = Math.min(callAmount, player.chips);
  player.chips -= actualCall;
  gs.bets[playerId] = (gs.bets[playerId] || 0) + actualCall;
  gs.pot += actualCall;
  gs.totalBets[playerId] = (gs.totalBets[playerId] || 0) + actualCall;
  
  if (actualCall < callAmount) {
    emitToRoom('chat_broadcast', { message: `${player.nickname} 全下 ${actualCall}` });
  } else {
    emitToRoom('chat_broadcast', { message: `${player.nickname} 跟注 ${actualCall}` });
  }
  
  emitToRoom('room_update', room);
  continueToNextPlayer();
}

// 处理加注
function handleRaise(playerId: string, raiseAmount: number) {
  const gs = room.gameState!;
  const player = room.players.find(p => p.id === playerId)!;
  
  const currentBet = gs.bets[playerId] || 0;
  const needToPay = raiseAmount - currentBet;
  
  if (needToPay > player.chips) {
    // 全下
    handleAllIn(playerId);
    return;
  }
  
  player.chips -= needToPay;
  gs.bets[playerId] = raiseAmount;
  gs.pot += needToPay;
  gs.totalBets[playerId] = (gs.totalBets[playerId] || 0) + needToPay;
  gs.currentBet = raiseAmount;
  
  // 重置已行动列表，除了当前玩家
  gs.acted = [playerId];
  
  emitToRoom('chat_broadcast', { message: `${player.nickname} 加注到 ${raiseAmount}` });
  emitToRoom('room_update', room);
  continueToNextPlayer();
}

// 处理全下
function handleAllIn(playerId: string) {
  const gs = room.gameState!;
  const player = room.players.find(p => p.id === playerId)!;
  
  if (player.chips === 0) {
    emitToRoom('chat_broadcast', { message: `${player.nickname} 已经全下` });
    continueToNextPlayer();
    return;
  }
  
  const currentBet = gs.bets[playerId] || 0;
  const allInAmount = currentBet + player.chips;
  
  gs.pot += player.chips;
  gs.totalBets[playerId] = (gs.totalBets[playerId] || 0) + player.chips;
  gs.bets[playerId] = allInAmount;
  player.chips = 0;
  
  if (allInAmount > gs.currentBet) {
    gs.currentBet = allInAmount;
    // 重置已行动列表，除了当前玩家
    gs.acted = [playerId];
  }
  
  emitToRoom('chat_broadcast', { message: `${player.nickname} 全下 ${allInAmount}` });
  emitToRoom('room_update', room);
  continueToNextPlayer();
}

// 检查回合是否结束
function checkRoundEnd() {
  const gs = room.gameState!;
  const participatingPlayers = room.players.filter(p => room.participants!.includes(p.id));
  const activeIds = room.participants!.filter(id => !gs.folded.includes(id));
  const activePlayers = activeIds.map(id => room.players.find(p => p.id === id)!);
  
  // 检查是否所有活跃玩家都已行动且投注一致
  let allActed = true;
  let allBetsEqual = true;
  
  for (const player of activePlayers) {
    if (!gs.acted.includes(player.id)) {
      allActed = false;
      break;
    }
    
    // 检查投注是否一致（除非玩家已全下）
    const playerBet = gs.bets[player.id] || 0;
    if (player.chips > 0 && playerBet !== gs.currentBet) {
      allBetsEqual = false;
      break;
    }
  }
  
  if (allActed && allBetsEqual) {
    // 回合结束，进入下一阶段
    nextRound();
  }
}

// 进入下一回合
function nextRound() {
  const gs = room.gameState!;
  
  // 重置已行动列表和投注
  gs.acted = [];
  gs.bets = {};
  gs.currentBet = 0;
  gs.round++;
  
  const activeIds = room.participants!.filter(id => !gs.folded.includes(id));
  const activePlayers = activeIds.map(id => room.players.find(p => p.id === id)!);
  
  if (activePlayers.length <= 1) {
    // 游戏结束
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      winner.chips += gs.pot;
      emitToRoom('chat_broadcast', { message: `${winner.nickname} 赢得底池 ${gs.pot}` });
    }
    emitToRoom('room_update', room);
    handleGameOver();
    return;
  }
  
  // 检查是否所有玩家都全下
  const playersWithChips = activePlayers.filter(p => p.chips > 0);
  if (playersWithChips.length <= 1) {
    // 直接开到河牌并结算
    while (gs.round < 4) {
      dealCommunityCards();
      gs.round++;
    }
    showdown();
    return;
  }
  
  // 发社区牌
  if (gs.round <= 3) {
    dealCommunityCards();
  }
  
  if (gs.round > 3) {
    // 河牌结束，进行摊牌
    showdown();
    return;
  }
  
  // 设置下一个行动玩家（从庄家左边开始）
  const participatingPlayers = room.players.filter(p => room.participants!.includes(p.id));
  const dealerPlayer = participatingPlayers[gs.dealerIndex];
  const dealerGlobalIndex = room.players.findIndex(p => p.id === dealerPlayer.id);
  
  let nextPlayerIndex = (dealerGlobalIndex + 1) % room.players.length;
  while (!activeIds.includes(room.players[nextPlayerIndex].id) || room.players[nextPlayerIndex].chips === 0) {
    nextPlayerIndex = (nextPlayerIndex + 1) % room.players.length;
  }
  
  gs.currentTurn = nextPlayerIndex;
  
  // 广播游戏状态
  emitToRoom('game_state', {
    communityCards: gs.communityCards,
    pot: gs.pot,
    bets: gs.bets,
    currentTurn: gs.currentTurn,
    dealerIndex: gs.dealerIndex,
    round: gs.round,
    currentBet: gs.currentBet
  });
  
  // 原子化定时器操作：清除旧定时器并立即启动新定时器
  clearActionTimer();
  // 设置新的截止时间
  actionDeadline = Date.now() + 30000;
  // 请求下一个玩家行动
  emitToRoom('action_request', { playerId: room.players[gs.currentTurn].id, seconds: 30 });
  // 启动行动超时定时器
  actionTimer = setTimeout(() => {
    actionDeadline = null;
    handleTimeout();
  }, 30000);
}

// 发社区牌
function dealCommunityCards() {
  const gs = room.gameState!;
  
  if (!room.online) {
    // 线下房间不自动发牌，但提示发牌阶段
    if (gs.round === 1) {
      emitToRoom('chat_broadcast', { message: '翻牌圈开始 - 请发3张公共牌', type: 'system' });
    } else if (gs.round === 2) {
      emitToRoom('chat_broadcast', { message: '转牌圈开始 - 请发第4张公共牌', type: 'system' });
    } else if (gs.round === 3) {
      emitToRoom('chat_broadcast', { message: '河牌圈开始 - 请发第5张公共牌', type: 'system' });
    }
    return;
  }
  
  if (gs.round === 1) {
    // 翻牌：发3张
    const flopCards: string[] = [];
    for (let i = 0; i < 3; i++) {
      if (gs.deck.length > 0) {
        const card = gs.deck.pop()!;
        gs.communityCards.push(card);
        flopCards.push(card);
      }
    }
    emitToRoom('chat_broadcast', { message: `翻牌圈开始 - 翻牌: ${flopCards.join(' ')}`, type: 'system' });
  } else if (gs.round === 2) {
    // 转牌：发1张
    if (gs.deck.length > 0) {
      const turnCard = gs.deck.pop()!;
      gs.communityCards.push(turnCard);
      emitToRoom('chat_broadcast', { message: `转牌圈开始 - 转牌: ${turnCard} (公共牌: ${gs.communityCards.join(' ')})`, type: 'system' });
    }
  } else if (gs.round === 3) {
    // 河牌：发1张
    if (gs.deck.length > 0) {
      const riverCard = gs.deck.pop()!;
      gs.communityCards.push(riverCard);
      emitToRoom('chat_broadcast', { message: `河牌圈开始 - 河牌: ${riverCard} (公共牌: ${gs.communityCards.join(' ')})`, type: 'system' });
    }
  }
}

// 摊牌比大小
function showdown() {
  // 清除所有定时器，进入摊牌阶段
  clearActionTimer();
  const gs = room.gameState!;
  const activeIds = room.participants!.filter(id => !gs.folded.includes(id));
  const activePlayers = activeIds.map(id => room.players.find(p => p.id === id)!);
  
  // 只有一个玩家时不需要摊牌
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    winner.chips += gs.pot;
    emitToRoom('chat_broadcast', { message: `${winner.nickname} 赢得底池 ${gs.pot}` });
  } else {
    // 多个玩家摊牌，显示公共牌和手牌信息
    emitToRoom('chat_broadcast', { message: '=== 摊牌阶段 ===', type: 'system' });
    
    // 显示公共牌
    if (gs.communityCards.length > 0) {
      const communityCardsStr = gs.communityCards.join(' ');
      emitToRoom('chat_broadcast', { message: `公共牌: ${communityCardsStr}`, type: 'system' });
    }
    
    // 显示所有未弃牌玩家的手牌
    if (room.online && gs.playerHands) {
      // 线上房间显示所有玩家手牌
      activePlayers.forEach(player => {
        if (gs.playerHands[player.id]) {
          const handCardsStr = gs.playerHands[player.id].join(' ');
          emitToRoom('chat_broadcast', { message: `${player.nickname}的手牌: ${handCardsStr}`, type: 'system' });
        }
      });
    } else {
      // 线下房间提示玩家亮牌
      emitToRoom('chat_broadcast', { message: '请各位玩家亮出手牌进行比较', type: 'system' });
    }
    
    // 比较手牌大小并决定胜负
    if (room.online && gs.playerHands) {
      // 线上房间，自动比较手牌大小
      let bestHand = null;
      let winners: Player[] = [];
      
      for (const player of activePlayers) {
        if (gs.playerHands[player.id]) {
          const hand = [...gs.playerHands[player.id], ...gs.communityCards];
          const handValue = evaluateHand(hand);
          
          if (!bestHand || handValue > bestHand) {
            bestHand = handValue;
            winners = [player];
          } else if (handValue === bestHand) {
            winners.push(player);
          }
        }
      }
      
      // 分配奖金
      const winningsPerPlayer = Math.floor(gs.pot / winners.length);
      winners.forEach(winner => {
        winner.chips += winningsPerPlayer;
      });
      
      if (winners.length === 1) {
        emitToRoom('chat_broadcast', { message: `🏆 ${winners[0].nickname} 赢得底池 ${gs.pot}`, type: 'system' });
      } else {
        const winnerNames = winners.map(w => w.nickname).join(', ');
        emitToRoom('chat_broadcast', { message: `🏆 ${winnerNames} 平分底池 ${gs.pot}`, type: 'system' });
      }
    } else {
      // 线下房间，不自动分配奖金，让玩家自行take
      emitToRoom('chat_broadcast', { message: `奖池共计 ${gs.pot}，请各位玩家根据牌型大小自行分配奖金`, type: 'system' });
      emitToRoom('chat_broadcast', { message: '可使用 take 命令取奖金，或 take_all 取全部奖金', type: 'system' });
      
      // 发送分池阶段开始事件，让前端显示take按钮
      emitToRoom('distribution_start', {});
    }
    
    emitToRoom('chat_broadcast', { message: '===============', type: 'system' });
  }
  
  emitToRoom('room_update', room);
  
  // 线下房间多人摊牌时不立即结束游戏，等待玩家自行分配奖池
  if (room.online || activePlayers.length === 1) {
    handleGameOver();
  } else {
    // 线下房间多人摊牌，不结束游戏，等待玩家take
    emitToRoom('chat_broadcast', { message: '游戏进入分奖池阶段，奖池分配完毕后请手动开始新一局', type: 'system' });
  }
}

function handleChatMessage(task: GameTask) {
  const { message } = task.data;
  emitToRoom('chat_broadcast', { message });
  sendResponse(task.id, true);
}

function handleHeartbeat(task: GameTask) {
  const { playerId } = task.data;
  const player = room.players.find(p => p.id === playerId);
  if (player) {
    player.lastHeartbeat = Date.now();
    room.lastActiveTime = Date.now();
  }
  sendResponse(task.id, true);
}

function handleReconnect(task: GameTask) {
  const { playerId, nickname, socketId } = task.data;
  
  const player = room.players.find(p => p.id === playerId);
  if (!player) {
    sendResponse(task.id, false, null, '玩家不存在或会话已过期');
    return;
  }
  
  // 更新连接信息
  player.socketId = socketId;
  player.lastHeartbeat = Date.now();
  player.inGame = true;
  
  // 更新房间活跃时间
  room.lastActiveTime = Date.now();
  
  emitToRoom('chat_broadcast', { message: `${player.nickname} 重新连接`, type: 'system' });
  
  // 先向所有房间内玩家发送房间更新
  emitToRoom('room_update', room);
  
  // 同步游戏状态给重连的玩家
  syncGameStateToPlayer(socketId, playerId);
  
  sendResponse(task.id, true, { room });
}

function handleExtendTime(task: GameTask) {
  const { playerId } = task.data;
  const player = room.players.find(p => p.id === playerId);
  
  if (!room.gameState || !room.participants || room.participants.length === 0) {
    sendResponse(task.id, false, null, '游戏未开始，无法延时');
    return;
  }
  
  // 检查是否轮到该玩家行动
  const gs = room.gameState;
  if (room.players[gs.currentTurn].id !== playerId) {
    sendResponse(task.id, false, null, '不是你的回合，无法延时');
    return;
  }
  
  // 检查是否还有定时器在运行
  if (!actionTimer || !actionDeadline) {
    sendResponse(task.id, false, null, '当前没有进行中的行动，无法延时');
    return;
  }
  
  if (player) {
    emitToRoom('chat_broadcast', { message: `[玩家${player.nickname} 延时当前行动30s]` });
  }
  
  // 重置超时定时器
  clearActionTimer();
  actionDeadline = Date.now() + 30000;
  actionTimer = setTimeout(() => {
    actionDeadline = null;
    handleTimeout();
  }, 30000);
  
  // 重新发送行动请求，让前端更新倒计时
  emitToRoom('action_request', { playerId: room.players[gs.currentTurn].id, seconds: 30 });
  
  sendResponse(task.id, true);
}

function handleToggleAutoStart(task: GameTask) {
  const { playerId } = task.data;
  const player = room.players.find(p => p.id === playerId);
  
  if (!player) {
    sendResponse(task.id, false, null, '玩家不存在');
    return;
  }
  
  room.autoStart = !room.autoStart;
  const status = room.autoStart ? '开启' : '关闭';
  
  emitToRoom('chat_broadcast', { message: `[玩家${player.nickname} ${status}了自动开始游戏]`, type: 'system' });
  emitToRoom('room_update', room);
  
  sendResponse(task.id, true);
}

function handleTake(task: GameTask) {
  const { playerId, amount } = task.data;
  
  if (!room.gameState || room.online) {
    sendResponse(task.id, false, null, '只有线下房间支持take操作');
    return;
  }
  
  const player = room.players.find(p => p.id === playerId);
  if (!player) {
    sendResponse(task.id, false, null, '玩家不存在');
    return;
  }
  
  const takeAmt = Math.floor(amount);
  if (isNaN(takeAmt) || takeAmt < 0) {
    sendResponse(task.id, false, null, 'take 金额需为非负整数');
    return;
  }
  
  const gs = room.gameState;
  if (takeAmt > gs.pot) {
    sendResponse(task.id, false, null, 'take 金额不能超过奖池');
    return;
  }
  
  player.chips += takeAmt;
  gs.pot -= takeAmt;
  
  emitToRoom('chat_broadcast', { message: `[玩家${player.nickname} take ${takeAmt}]` });
  emitToRoom('room_update', room);
  emitToRoom('game_state', {
    communityCards: gs.communityCards,
    pot: gs.pot,
    bets: gs.bets,
    currentTurn: gs.currentTurn,
    dealerIndex: gs.dealerIndex,
    round: gs.round,
    currentBet: gs.currentBet
  });
  
  if (gs.pot === 0) {
    handleGameOver();
  }
  
  sendResponse(task.id, true);
}

function handleTakeAll(task: GameTask) {
  const { playerId } = task.data;
  
  if (!room.gameState || room.online) {
    sendResponse(task.id, false, null, '只有线下房间支持take_all操作');
    return;
  }
  
  const player = room.players.find(p => p.id === playerId);
  if (!player) {
    sendResponse(task.id, false, null, '玩家不存在');
    return;
  }
  
  const gs = room.gameState;
  if (gs.pot === 0) {
    sendResponse(task.id, false, null, '奖池已为空');
    return;
  }
  
  const takeAmt = gs.pot;
  player.chips += takeAmt;
  gs.pot = 0;
  
  emitToRoom('chat_broadcast', { message: `[玩家${player.nickname} take all ${takeAmt}]` });
  emitToRoom('room_update', room);
  emitToRoom('game_state', {
    communityCards: gs.communityCards,
    pot: gs.pot,
    bets: gs.bets,
    currentTurn: gs.currentTurn,
    dealerIndex: gs.dealerIndex,
    round: gs.round,
    currentBet: gs.currentBet
  });
  
  handleGameOver();
  sendResponse(task.id, true);
}

function handlePlayerOffline(task: GameTask) {
  const { playerId, socketId } = task.data;
  
  const player = room.players.find(p => p.id === playerId && p.socketId === socketId);
  if (player) {
    // 标记玩家为离线但不立即移除，等待可能的重连
    player.inGame = false;
    player.lastHeartbeat = Date.now(); // 记录离线时间
    
    emitToRoom('chat_broadcast', { message: `${player.nickname} 离线`, type: 'system' });
    
    // 更新房间状态但不立即移除玩家
    emitToRoom('room_update', room);
  }
  
  sendResponse(task.id, true);
}

// 定期检查离线玩家
setInterval(() => {
  // 只在游戏未开始或游戏结束时检查T人
  const gameInProgress = room.participants && room.participants.length > 0;
  if (!gameInProgress) {
    checkAndRemoveOfflinePlayers();
  }
}, 30000);

console.log(`房间 ${roomId} 工作线程已启动`); 