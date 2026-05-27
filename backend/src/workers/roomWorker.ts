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

  // 如果游戏状态不存在，不需要同步
  if (!room.gameState) {
    return;
  }

  const gs = room.gameState;

  // 如果游戏正在进行中，发送游戏开始事件
  if (room.participants && room.participants.length > 0) {
    emitToPlayer(socketId, 'game_started', {});
  }

  // 发送游戏状态
  emitToPlayer(socketId, 'game_state', {
    communityCards: gs.communityCards,
    pot: gs.pot,
    bets: gs.bets,
    currentTurn: gs.currentTurn,
    dealerIndex: gs.dealerIndex,
    round: gs.round,
    currentBet: gs.currentBet,
    stage: gs.stage
  });

  // 如果该玩家有手牌记录并且是线上房间，发送手牌（便于复盘）
  if (gs.playerHands && gs.playerHands[playerId] && room.online) {
    emitToPlayer(socketId, 'deal_hand', { hand: gs.playerHands[playerId] });
  }

  // 只有游戏进行中才发送行动请求
  if (room.participants && room.participants.length > 0 && gs.currentTurn >= 0 && gs.currentTurn < room.players.length) {
    emitToPlayer(socketId, 'action_request', {
      playerId: room.players[gs.currentTurn].id,
      seconds: (actionDeadline && actionDeadline > Date.now())? Math.ceil((actionDeadline - Date.now()) / 1000): 0
    });
  }
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
  gs.stage = 'playing';

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

  // 初始化回合参数 - dealerIndex 始终保持在 participatingPlayers 索引空间
  const prevDealerIdx = (gs.dealerIndex >= 0) ? gs.dealerIndex : -1;
  const dealerIdx = (prevDealerIdx + 1) % participatingPlayers.length;
  gs.dealerIndex = dealerIdx;  // participatingPlayers 中的索引

  const sbIndex = (dealerIdx + 1) % participatingPlayers.length;
  const bbIndex = (sbIndex + 1) % participatingPlayers.length;
  gs.sbIndex = sbIndex;
  gs.bbIndex = bbIndex;
  const sbPlayer = participatingPlayers[sbIndex];
  const bbPlayer = participatingPlayers[bbIndex];

  // 下盲注（盲注检查已在handleStartGame中完成）
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
    currentBet: gs.currentBet,
    stage: gs.stage
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

  // 安全检查：currentTurn 有效性
  if (gs.currentTurn < 0 || gs.currentTurn >= room.players.length) {
    console.log('currentTurn 无效，忽略超时处理');
    return;
  }

  const player = room.players[gs.currentTurn];
  if (!player || !room.participants.includes(player.id)) {
    console.log('当前玩家已不在游戏中，忽略超时处理');
    return;
  }

  // 自动Check或Fold
  const playerBet = gs.bets[player.id] || 0;
  const toCall = gs.currentBet - playerBet;

  clearActionTimer();

  if (toCall === 0) {
    // 自动Check
    if (!gs.acted.includes(player.id)) gs.acted.push(player.id);
    emitToRoom('chat_broadcast', { message: `[玩家${player.nickname} 超时自动Check]` });
    continueToNextPlayer();
  } else {
    // 自动Fold - 修复：统一使用 handleFold 处理
    emitToRoom('chat_broadcast', { message: `[玩家${player.nickname} 超时自动Fold]` });
    handleFold(player.id);
  }
}

// 继续到下一个玩家
function continueToNextPlayer() {
  const gs = room.gameState!;

  // 安全检查
  if (!room.participants || room.participants.length === 0) {
    return;
  }

  const participatingPlayers = room.players.filter(p => room.participants!.includes(p.id));

  // 安全检查：currentTurn 有效性
  if (gs.currentTurn < 0 || gs.currentTurn >= room.players.length) {
    console.log('continueToNextPlayer: currentTurn 无效');
    checkRoundEnd();
    return;
  }

  const currentPlayerInParticipants = participatingPlayers.findIndex(p => p.id === room.players[gs.currentTurn].id);

  // 如果所有活跃玩家都已行动且投注一致，则进入下一阶段
  {
    const activeIds = room.participants!.filter(id => !gs.folded.includes(id));
    const activePlayers = activeIds.map(id => room.players.find(p => p.id === id)).filter(Boolean) as Player[];
    let allActed = true;
    let allBetsEqual = true;
    for (const player of activePlayers) {
      if (!gs.acted.includes(player.id)) {
        allActed = false;
        break;
      }
      const playerBet = gs.bets[player.id] || 0;
      if (player.chips > 0 && playerBet !== gs.currentBet) {
        allBetsEqual = false;
        break;
      }
    }
    if (allActed && allBetsEqual) {
      nextRound();
      return;
    }
  }

  // 寻找下一个可以行动的玩家
  let nextParticipantIdx = (currentPlayerInParticipants + 1) % participatingPlayers.length;
  let attempts = 0;
  const maxAttempts = Math.max(participatingPlayers.length * 2, 1);

  while (attempts < maxAttempts) {
    const nextPlayer = participatingPlayers[nextParticipantIdx];

    // 安全检查：玩家存在且没有弃牌，且有筹码
    if (nextPlayer && !gs.folded.includes(nextPlayer.id) && nextPlayer.chips > 0) {
      break;
    }

    nextParticipantIdx = (nextParticipantIdx + 1) % participatingPlayers.length;
    attempts++;
  }

  if (attempts >= maxAttempts) {
    console.log('无法找到下一个可行动的玩家，尝试结束回合');
    checkRoundEnd();
    return;
  }

  if (attempts >= participatingPlayers.length) {
    emitToRoom('game_state', {
      communityCards: gs.communityCards,
      pot: gs.pot,
      bets: gs.bets,
      currentTurn: gs.currentTurn,
      dealerIndex: gs.dealerIndex,
      round: gs.round,
      currentBet: gs.currentBet,
      stage: gs.stage
    });
    checkRoundEnd();
    return;
  }

  const nextGlobalIdx = room.players.findIndex(p => p.id === participatingPlayers[nextParticipantIdx].id);
  if (nextGlobalIdx < 0) {
    console.log('无法找到下一个玩家的全局索引');
    checkRoundEnd();
    return;
  }
  gs.currentTurn = nextGlobalIdx;

  // 广播游戏状态更新并请求下一个玩家行动
  emitToRoom('game_state', {
    communityCards: gs.communityCards,
    pot: gs.pot,
    bets: gs.bets,
    currentTurn: gs.currentTurn,
    dealerIndex: gs.dealerIndex,
    round: gs.round,
    currentBet: gs.currentBet,
    stage: gs.stage
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
    room.gameState.currentTurn = -1;
    room.gameState.acted = [];
    room.gameState.folded = [];
    room.gameState.stage = 'idle';
  }

  // 同步最终的游戏状态（包括完整的公共牌）
  const gs = room.gameState;
  if (gs) {
    emitToRoom('game_state', {
      communityCards: gs.communityCards,
      pot: gs.pot,
      bets: gs.bets,
      currentTurn: gs.currentTurn,
      dealerIndex: gs.dealerIndex,
      round: gs.round,
      currentBet: gs.currentBet,
      stage: gs.stage
    });
  }

  // 立即同步房间状态
  emitToRoom('room_update', room);
  emitToRoom('game_over', {});

  // 自动开始下一局逻辑
  if (room.autoStart) {
    setTimeout(() => {
      const participants = room.players.filter(p => p.chips > 0 && p.inGame).map(p => p.id);
      if (participants.length >= 2) {
        // 提前检查盲注，避免前端进入错误状态
        const participatingPlayers = room.players.filter(p => participants.includes(p.id));
        const dealerIndex = ((room.gameState?.dealerIndex ?? -1) + 1) % participatingPlayers.length;
        const sbIndex = (dealerIndex + 1) % participatingPlayers.length;
        const bbIndex = (sbIndex + 1) % participatingPlayers.length;
        const sbPlayer = participatingPlayers[sbIndex];
        const bbPlayer = participatingPlayers[bbIndex];

        const blinds = room.gameState!.blinds;

        // 检查小盲注和大盲注玩家的筹码
        if (sbPlayer.chips >= blinds.sb && bbPlayer.chips >= blinds.bb) {
          room.participants = participants;
          room.lastActiveTime = Date.now();

          emitToRoom('chat_broadcast', { message: '自动开始新一局游戏' });
          startGame();
        } else {
          if (sbPlayer.chips < blinds.sb) {
            emitToRoom('chat_broadcast', { message: `${sbPlayer.nickname} 筹码不足以下小盲注，自动开始失败` });
          }
          if (bbPlayer.chips < blinds.bb) {
            emitToRoom('chat_broadcast', { message: `${bbPlayer.nickname} 筹码不足以下大盲注，自动开始失败` });
          }
        }
      }
    }, 0);
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
    } else if (player.chips === 0 && offlineTime > 3 * 60 * 1000) {
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
      case 'toggle_room_lock':
        handleToggleRoomLock(task);
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
      case 'reset_room':
        handleResetRoom(task);
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
    const wasOffline = !existingPlayer.inGame;
    existingPlayer.socketId = socketId;
    existingPlayer.lastHeartbeat = Date.now();
    existingPlayer.inGame = true;

    if (wasOffline) {
      emitToRoom('chat_broadcast', { message: `${existingPlayer.nickname} 重新上线`, type: 'system' });
    }
  } else {
    if (room.locked) {
      sendResponse(task.id, false, null, '房间已锁定，无法加入');
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      sendResponse(task.id, false, null, '房间已满');
      return;
    }

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

  room.lastActiveTime = Date.now();
  emitToRoom('room_update', room);
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

// 处理cash out - 修复：游戏中cash out自动fold + 调整currentTurn
function handleCashOut(task: GameTask) {
  const { playerId } = task.data;

  const playerIndex = room.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    sendResponse(task.id, false, null, '玩家不存在');
    return;
  }

  const player = room.players[playerIndex];
  const gs = room.gameState;

  // 如果游戏正在进行中且该玩家未fold，先fold
  if (room.participants && room.participants.includes(playerId) && gs && !gs.folded.includes(playerId)) {
    if (gs.currentTurn >= 0 && gs.currentTurn < room.players.length && room.players[gs.currentTurn].id === playerId) {
      // 是当前回合，通过handleFold统一处理（会推进游戏）
      handleFold(playerId);
    } else {
      // 不是当前回合，直接fold
      gs.folded.push(playerId);
      emitToRoom('chat_broadcast', { message: `${player.nickname} cash out 并自动弃牌`, type: 'system' });
    }
  }

  // 从房间中移除玩家
  const removedIndex = playerIndex;
  room.players.splice(playerIndex, 1);

  // 修复：调整currentTurn，因为splice改变了players数组的索引
  if (gs) {
    if (gs.currentTurn > removedIndex) {
      gs.currentTurn--;
    }
    // 确保currentTurn仍在有效范围内
    if (gs.currentTurn >= room.players.length) {
      gs.currentTurn = room.players.length > 0 ? 0 : -1;
    }
  }

  emitToRoom('chat_broadcast', { message: `${player.nickname} cash out 并退出房间`, type: 'cashout' });
  emitToRoom('room_update', room);

  sendResponse(task.id, true);
}

// 处理开始游戏 - 修复：移除重复的 game_started 和 room_update emit
function handleStartGame(task: GameTask) {
  if (room.participants && room.participants.length > 0) {
    sendResponse(task.id, false, null, '游戏已在进行中');
    return;
  }

  const participants = room.players.filter(p => p.chips > 0 && p.inGame).map(p => p.id);
  if (participants.length < 2) {
    sendResponse(task.id, false, null, '至少需要2名有筹码的玩家才能开始游戏');
    return;
  }

  // 提前检查盲注，避免前端进入错误状态
  const participatingPlayers = room.players.filter(p => participants.includes(p.id));
  const dealerIndex = ((room.gameState?.dealerIndex ?? -1) + 1) % participatingPlayers.length;
  const sbIndex = (dealerIndex + 1) % participatingPlayers.length;
  const bbIndex = (sbIndex + 1) % participatingPlayers.length;
  const sbPlayer = participatingPlayers[sbIndex];
  const bbPlayer = participatingPlayers[bbIndex];

  const blinds = room.gameState!.blinds;

  if (sbPlayer.chips < blinds.sb) {
    sendResponse(task.id, false, null, `${sbPlayer.nickname} 筹码不足以下小盲注，游戏无法开始`);
    return;
  }
  if (bbPlayer.chips < blinds.bb) {
    sendResponse(task.id, false, null, `${bbPlayer.nickname} 筹码不足以下大盲注，游戏无法开始`);
    return;
  }

  // 所有检查都通过，才设置participants并开始游戏
  room.participants = participants;
  room.lastActiveTime = Date.now();

  emitToRoom('chat_broadcast', { message: '游戏已开始' });
  // 修复：移除重复的 game_started 和 room_update emit，这些在 startGame() 中已经发送
  // emitToRoom('game_started', {});  -- 已移除
  // emitToRoom('room_update', room); -- 已移除

  startGame();
  sendResponse(task.id, true);
}

// 处理玩家行动 - 修复：移除末尾多余的 checkRoundEnd()
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

  // 安全检查：currentTurn 有效
  if (gs.currentTurn < 0 || gs.currentTurn >= room.players.length) {
    sendResponse(task.id, false, null, '当前没有活跃玩家回合');
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

  // 修复：移除 handlePlayerAction 末尾的 acted 管理代码。
  // 所有 action handler（handleCheck/handleCall/handleRaise/handleAllIn/handleFold）
  // 内部已经自行处理了 acted 列表的更新。在此额外添加 playerId 会导致：
  // 若 action handler 调用了 continueToNextPlayer() -> nextRound() 进入新轮次，
  // nextRound() 已将 gs.acted 重置为 []，而此处在其之后执行，会把 playerId
  // 错误地写入新轮次的 acted，导致该玩家在新轮次被跳过行动。
  //
  // 旧代码：
  // if (!gs.acted.includes(playerId)) {
  //   gs.acted.push(playerId);
  // }

  // 修复：移除末尾多余的 checkRoundEnd()。
  // 所有 action handler（fold/check/call/raise/allin）内部已经通过
  // continueToNextPlayer() 或 handleGameOver() 推进了游戏状态。
  // 额外的 checkRoundEnd() 可能导致 nextRound() 被调用两次。
  // if (room.participants && room.participants.length > 0) {
  //   checkRoundEnd();
  // }

  sendResponse(task.id, true);
}

// 处理弃牌
function handleFold(playerId: string) {
  const gs = room.gameState!;
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;

  if (!gs.folded.includes(playerId)) {
    gs.folded.push(playerId);
  }
  emitToRoom('chat_broadcast', { message: `${player.nickname} 弃牌` });

  // 检查是否只剩一个玩家
  const activeIds = room.participants!.filter(id => !gs.folded.includes(id));
  if (activeIds.length === 1) {
    const winner = room.players.find(p => p.id === activeIds[0]);
    if (winner) {
      winner.chips += gs.pot;
      emitToRoom('chat_broadcast', { message: `${winner.nickname} 赢得底池 ${gs.pot}` });
      emitToRoom('room_update', room);
      handleGameOver();
    }
    return;
  }

  if (activeIds.length === 0) {
    emitToRoom('chat_broadcast', { message: '所有玩家都已弃牌，游戏结束' });
    handleGameOver();
    return;
  }

  // 继续下一个玩家
  continueToNextPlayer();
}

// 处理看牌
function handleCheck(playerId: string) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;
  const gs = room.gameState!;
  // 修复：在 continueToNextPlayer 前确保 playerId 已加入 acted，
  // 否则 allActed 检查会看不到当前玩家，导致前一个玩家获得额外行动机会
  if (!gs.acted.includes(playerId)) gs.acted.push(playerId);
  emitToRoom('chat_broadcast', { message: `${player.nickname} 看牌` });
  continueToNextPlayer();
}

// 处理跟注
function handleCall(playerId: string, callAmount: number) {
  const gs = room.gameState!;
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;

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

  // 修复：在 continueToNextPlayer 前确保 playerId 已加入 acted
  if (!gs.acted.includes(playerId)) gs.acted.push(playerId);

  emitToRoom('room_update', room);
  continueToNextPlayer();
}

// 处理加注
function handleRaise(playerId: string, raiseAmount: number) {
  const gs = room.gameState!;
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;

  const currentBet = gs.bets[playerId] || 0;
  const needToPay = raiseAmount - currentBet;

  if (needToPay > player.chips) {
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
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;

  if (player.chips === 0) {
    // 修复：在 continueToNextPlayer 前确保 playerId 已加入 acted
    if (!gs.acted.includes(playerId)) gs.acted.push(playerId);
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
    gs.acted = [playerId];
  } else {
    // 修复：all-in 未超过当前最高注时，确保 playerId 已加入 acted
    if (!gs.acted.includes(playerId)) gs.acted.push(playerId);
  }

  emitToRoom('chat_broadcast', { message: `${player.nickname} 全下 ${allInAmount}` });
  emitToRoom('room_update', room);
  continueToNextPlayer();
}

// 检查回合是否结束
function checkRoundEnd() {
  const gs = room.gameState!;

  if (!room.participants || room.participants.length === 0) {
    return;
  }

  const activeIds = room.participants!.filter(id => !gs.folded.includes(id));
  const activePlayers = activeIds.map(id => room.players.find(p => p.id === id)).filter(Boolean) as Player[];

  // 如果所有活跃玩家都已全下（chips 都为 0），跳过投注阶段
  const playersWithChips = activePlayers.filter(p => p.chips > 0);
  if (playersWithChips.length === 0) {
    nextRound();
    return;
  }

  // 检查是否所有活跃玩家都已行动且投注一致
  let allActed = true;
  let allBetsEqual = true;

  for (const player of activePlayers) {
    if (!gs.acted.includes(player.id)) {
      allActed = false;
      break;
    }
    const playerBet = gs.bets[player.id] || 0;
    if (player.chips > 0 && playerBet !== gs.currentBet) {
      allBetsEqual = false;
      break;
    }
  }

  if (allActed && allBetsEqual) {
    nextRound();
  }
}

// 进入下一回合 - 修复：添加循环安全上限
function nextRound() {
  const gs = room.gameState!;

  // 重置已行动列表和投注
  gs.acted = [];
  gs.bets = {};
  gs.currentBet = 0;
  gs.round++;

  const activeIds = room.participants!.filter(id => !gs.folded.includes(id));
  const activePlayers = activeIds.map(id => room.players.find(p => p.id === id)).filter(Boolean) as Player[];

  if (activePlayers.length <= 1) {
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
    showdown();
    return;
  }

  // 设置下一个行动玩家（从庄家左边开始）
  const participatingPlayers = room.players.filter(p => room.participants!.includes(p.id));

  // 安全检查：dealerIndex 在有效范围内
  let dealerPlayer: Player | undefined;
  if (gs.dealerIndex >= 0 && gs.dealerIndex < participatingPlayers.length) {
    dealerPlayer = participatingPlayers[gs.dealerIndex];
  }

  if (!dealerPlayer) {
    console.log('警告：找不到庄家，使用第一个活跃玩家');
    const firstActive = room.players.find(p => activeIds.includes(p.id));
    if (firstActive) {
      gs.currentTurn = room.players.findIndex(p => p.id === firstActive.id);
    }
  } else {
    const dealerGlobalIndex = room.players.findIndex(p => p.id === dealerPlayer!.id);

    let nextPlayerIndex = (dealerGlobalIndex + 1) % room.players.length;
    let safetyCount = 0;
    const maxSafety = Math.max(room.players.length * 2, 1);

    while (safetyCount < maxSafety) {
      const np = room.players[nextPlayerIndex];
      if (np && activeIds.includes(np.id) && np.chips > 0) {
        break;
      }
      nextPlayerIndex = (nextPlayerIndex + 1) % room.players.length;
      safetyCount++;
    }

    if (safetyCount >= maxSafety) {
      console.log('警告：无法找到下一个行动玩家');
      // 回退到第一个活跃玩家
      const firstActive = room.players.find(p => activeIds.includes(p.id));
      if (firstActive) {
        gs.currentTurn = room.players.findIndex(p => p.id === firstActive.id);
      }
    } else {
      gs.currentTurn = nextPlayerIndex;
    }
  }

  // 广播游戏状态
  emitToRoom('game_state', {
    communityCards: gs.communityCards,
    pot: gs.pot,
    bets: gs.bets,
    currentTurn: gs.currentTurn,
    dealerIndex: gs.dealerIndex,
    round: gs.round,
    currentBet: gs.currentBet,
    stage: gs.stage
  });

  clearActionTimer();
  actionDeadline = Date.now() + 30000;
  emitToRoom('action_request', { playerId: room.players[gs.currentTurn].id, seconds: 30 });
  actionTimer = setTimeout(() => {
    actionDeadline = null;
    handleTimeout();
  }, 30000);
}

// 发社区牌
function dealCommunityCards() {
  const gs = room.gameState!;

  if (!room.online) {
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
    if (gs.deck.length > 0) {
      const turnCard = gs.deck.pop()!;
      gs.communityCards.push(turnCard);
      emitToRoom('chat_broadcast', { message: `转牌圈开始 - 转牌: ${turnCard} (公共牌: ${gs.communityCards.join(' ')})`, type: 'system' });
    }
  } else if (gs.round === 3) {
    if (gs.deck.length > 0) {
      const riverCard = gs.deck.pop()!;
      gs.communityCards.push(riverCard);
      emitToRoom('chat_broadcast', { message: `河牌圈开始 - 河牌: ${riverCard} (公共牌: ${gs.communityCards.join(' ')})`, type: 'system' });
    }
  }
}

// 摊牌比大小 - 修复：sbOrder使用participatingPlayers + 手牌空值检查
function showdown() {
  clearActionTimer();
  const gs = room.gameState!;
  const activeIds = room.participants!.filter(id => !gs.folded.includes(id));
  const activePlayers = activeIds.map(id => room.players.find(p => p.id === id)).filter(Boolean) as Player[];

  emitToRoom('chat_broadcast', { message: '=== 摊牌阶段 ===', type: 'system' });

  if (gs.communityCards.length > 0) {
    emitToRoom('chat_broadcast', { message: `公共牌: ${gs.communityCards.join(' ')}`, type: 'system' });
  }

  // 显示所有未弃牌玩家的手牌
  if (room.online && gs.playerHands) {
    activePlayers.forEach(player => {
      if (gs.playerHands[player.id]) {
        emitToRoom('chat_broadcast', { message: `${player.nickname}的手牌: ${gs.playerHands[player.id].join(' ')}`, type: 'system' });
      }
    });
  } else {
    emitToRoom('chat_broadcast', { message: '请各位玩家亮出手牌进行比较', type: 'system' });
  }

  if (room.online && gs.playerHands) {
    const pots = splitPotSidePots(gs.totalBets, activeIds);
    let totalDistributed = 0;

    // 获取参与玩家列表用于正确的sbOrder计算 - 修复：使用participatingPlayers而非activeIds
    const participatingPlayers = room.players.filter(p => room.participants!.includes(p.id));

    pots.forEach((pot: SidePot) => {
      if (pot.amount <= 0 || pot.eligibleIds.length === 0) {
        return;
      }

      let bestHand: number | null = null;
      let winners: Player[] = [];

      pot.eligibleIds.forEach((pid: string) => {
        // 修复：安全跳过没有手牌的玩家
        if (!gs.playerHands[pid] || gs.playerHands[pid].length === 0) {
          console.log(`警告：玩家 ${pid} 没有手牌数据，跳过`);
          return;
        }
        const player = room.players.find(p => p.id === pid);
        if (!player) return;
        const hand = [...gs.playerHands[pid], ...gs.communityCards];
        const hv = evaluateHand(hand);
        if (bestHand === null || hv > bestHand) {
          bestHand = hv;
          winners = [player];
        } else if (hv === bestHand) {
          winners.push(player);
        }
      });

      // 安全修复：如果没有赢家，跳过
      if (winners.length === 0) {
        console.log(`警告：奖池 ${pot.amount} 没有合格赢家`);
        return;
      }

      const baseWin = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - baseWin * winners.length;

      if (winners.length === 1) {
        emitToRoom('chat_broadcast', { message: `${winners[0].nickname} 赢得池子 ${pot.amount}`, type: 'system' });
      } else {
        const winnerNames = winners.map(w => w.nickname).join(', ');
        emitToRoom('chat_broadcast', { message: `${winnerNames} 平分池子 ${pot.amount}`, type: 'system' });
      }

      // 修复：使用participatingPlayers来正确计算sbOrder
      const sbOrder: string[] = [];
      let idx = gs.sbIndex;
      const maxIterations = Math.max(participatingPlayers.length * 2, 1);
      let iterations = 0;
      while (sbOrder.length < winners.length && iterations < maxIterations) {
        const p = participatingPlayers[idx % participatingPlayers.length];
        if (p && winners.some(w => w.id === p.id) && !sbOrder.includes(p.id)) {
          sbOrder.push(p.id);
        }
        idx++;
        iterations++;
      }

      winners.forEach(w => {
        w.chips += baseWin;
      });
      sbOrder.forEach(pid => {
        if (remainder > 0) {
          const p = room.players.find(p => p.id === pid);
          if (p) {
            p.chips++;
            remainder--;
          }
        }
      });
      totalDistributed += pot.amount;
    });

    emitToRoom('chat_broadcast', { message: `总计分配奖池: ${totalDistributed}`, type: 'system' });
    gs.pot = 0;
  } else {
    emitToRoom('chat_broadcast', { message: `奖池共计 ${gs.pot}，请各位玩家根据牌型大小自行分配奖金`, type: 'system' });
    emitToRoom('chat_broadcast', { message: '可使用 take 命令取奖金，或 take_all 取全部奖金', type: 'system' });

    gs.stage = 'distribution';
    emitToRoom('distribution_start', {});
  }

  emitToRoom('chat_broadcast', { message: '===============', type: 'system' });
  emitToRoom('room_update', room);

  if (room.online || activePlayers.length === 1) {
    handleGameOver();
  } else {
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
    if (room.locked) {
      sendResponse(task.id, false, null, '房间已锁定，无法重新连接');
    } else {
      sendResponse(task.id, false, null, '玩家不存在或会话已过期');
    }
    return;
  }

  player.socketId = socketId;
  player.lastHeartbeat = Date.now();
  player.inGame = true;
  room.lastActiveTime = Date.now();

  emitToRoom('chat_broadcast', { message: `${player.nickname} 重新连接`, type: 'system' });
  emitToRoom('room_update', room);
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

  if (!room.participants.includes(playerId)) {
    sendResponse(task.id, false, null, '你不在游戏中，无法延时');
    return;
  }

  if (!actionTimer || !actionDeadline) {
    sendResponse(task.id, false, null, '当前没有进行中的行动，无法延时');
    return;
  }

  const gs = room.gameState;

  // 安全检查：currentTurn 有效
  if (gs.currentTurn < 0 || gs.currentTurn >= room.players.length) {
    sendResponse(task.id, false, null, '当前没有活跃回合');
    return;
  }

  const currentPlayer = room.players[gs.currentTurn];

  if (player && currentPlayer) {
    if (currentPlayer.id === playerId) {
      emitToRoom('chat_broadcast', { message: `[玩家${player.nickname} 延时当前行动30s]` });
    } else {
      emitToRoom('chat_broadcast', { message: `[玩家${player.nickname} 为${currentPlayer.nickname}延时30s]` });
    }
  }

  clearActionTimer();
  actionDeadline = Date.now() + 30000;
  actionTimer = setTimeout(() => {
    actionDeadline = null;
    handleTimeout();
  }, 30000);

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

function handleToggleRoomLock(task: GameTask) {
  const { playerId } = task.data;
  const player = room.players.find(p => p.id === playerId);

  if (!player) {
    sendResponse(task.id, false, null, '玩家不存在');
    return;
  }

  room.locked = !room.locked;
  const status = room.locked ? '锁定' : '解锁';

  emitToRoom('chat_broadcast', { message: `[玩家${player.nickname} ${status}了房间]`, type: 'system' });
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
    currentBet: gs.currentBet,
    stage: gs.stage
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
    currentBet: gs.currentBet,
    stage: gs.stage
  });

  handleGameOver();
  sendResponse(task.id, true);
}

// 处理玩家离线 - 修复：游戏中离线自动fold
function handlePlayerOffline(task: GameTask) {
  const { playerId, socketId } = task.data;

  const player = room.players.find(p => p.id === playerId && p.socketId === socketId);
  if (player) {
    player.inGame = false;
    player.lastHeartbeat = Date.now();

    emitToRoom('chat_broadcast', { message: `${player.nickname} 离线`, type: 'system' });

    // 修复：如果玩家在游戏进行中，自动fold该玩家
    if (room.participants && room.participants.includes(playerId)) {
      const gs = room.gameState;
      if (gs && !gs.folded.includes(playerId)) {
        if (gs.currentTurn >= 0 && gs.currentTurn < room.players.length && room.players[gs.currentTurn].id === playerId) {
          // 是当前回合，通过handleFold统一处理
          emitToRoom('chat_broadcast', { message: `${player.nickname} 离线自动弃牌`, type: 'system' });
          handleFold(playerId);
        } else {
          // 不是当前回合，直接fold
          gs.folded.push(playerId);
          emitToRoom('chat_broadcast', { message: `${player.nickname} 离线自动弃牌`, type: 'system' });
        }
      }
    }

    emitToRoom('room_update', room);
  }

  sendResponse(task.id, true);
}

// 定期检查离线玩家
setInterval(() => {
  const gameInProgress = room.participants && room.participants.length > 0;
  if (!gameInProgress) {
    checkAndRemoveOfflinePlayers();
  }
}, 30000);

console.log(`房间 ${roomId} 工作线程已启动`);

// 内联侧池计算工具类型和函数
interface SidePot { amount: number; eligibleIds: string[]; }
function splitPotSidePots(
  totalBets: Record<string, number>,
  activeIds: string[]
): SidePot[] {
  if (!activeIds || activeIds.length === 0) {
    return [];
  }
  const entries = Object.entries(totalBets).map(([pid, amt]) => ({ pid, amt }));
  const uniqueAmounts = Array.from(new Set(entries.map(e => e.amt))).sort((a, b) => a - b);
  const sidePots: SidePot[] = [];
  let prev = 0;
  for (const amt of uniqueAmounts) {
    const eligibleAll = entries.filter(e => e.amt >= amt).map(e => e.pid);
    if (eligibleAll.length === 0) { prev = amt; continue; }
    const potAmt = (amt - prev) * eligibleAll.length;
    const eligibleActive = eligibleAll.filter(pid => activeIds.includes(pid));
    if (eligibleActive.length > 0 && potAmt > 0) {
      sidePots.push({ amount: potAmt, eligibleIds: eligibleActive });
    }
    prev = amt;
  }
  return sidePots;
}

// 处理房间重置
function handleResetRoom(task: GameTask) {
  const { roomState } = task.data;

  clearActionTimer();
  room = roomState;

  sendResponse(task.id, true);
}
