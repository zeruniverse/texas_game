<template>
  <el-container class="room-container">
    <!-- 快捷操作按钮 - 固定在顶部 -->
    <div class="floating-header">
      <!-- 只有在未开始游戏且已在房间的玩家显示开始/CashIn/CashOut -->
      <template v-if="store.stage === 'idle' && isInRoom">
        <el-button type="success" @click="onStartGame"
                   :class="{ 'colored-border': true, 'disabled-border': !canStartGame }">
          开始游戏
        </el-button>
        <el-button @click="onCashIn" :class="{ 'colored-border': true }">
          Cash In
        </el-button>
        <el-button type="danger" @click="onCashOut" :class="{ 'colored-border': true }">
          Cash Out
        </el-button>
      </template>
      <!-- 游戏进行时，需要玩家行动的快捷操作（不包含分池阶段） -->
      <template v-if="store.stage === 'playing' && isInGame && isMyTurn">
        <!-- 第一个按钮：延时 -->
        <el-button @click="extendTime"
                   :class="{ 'colored-border': true }">
          延时
        </el-button>
        <!-- 第二个按钮：根据情况显示 Bet X/Call X/All-in -->
        <el-button @click="handleSecondQuickButton"
                   :class="{ 'colored-border': true }">
          {{ secondQuickButtonText }}
        </el-button>
        <!-- 第三个按钮：根据情况显示 Check/Fold -->
        <el-button @click="handleThirdQuickButton"
                   :class="{ 'colored-border': true }">
          {{ thirdQuickButtonText }}
        </el-button>
      </template>
      <!-- 线下分池阶段显示Take/TakeAll -->
      <template v-if="store.stage === 'distribution' && isInGame && !online">
        <el-input v-model.number="takeAmount" type="number" placeholder="Take 数量" style="width: 80px; margin-right:8px;" />
        <el-button type="primary" @click="onTake"
                   :disabled="takeAmount < 0"
                   :class="{ 'colored-border': takeAmount >= 0, 'disabled-border': takeAmount < 0 }">
          Take
        </el-button>
        <el-button type="warning" @click="onTakeAll"
                   :disabled="store.pot === 0"
                   :class="{ 'colored-border': store.pot > 0, 'disabled-border': store.pot === 0 }">
          Take All
        </el-button>
      </template>
    </div>

    <el-main class="game-main">
      <!-- 游戏信息展示 -->
      <el-card class="game-info">
        <div>我的底牌: <span v-if="store.stage === 'playing' && !isInGame">未参与游戏</span>
          <span v-else-if="online">
            <span v-if="store.hand.length > 0" v-html="formatCards(store.hand)"></span>
            <span v-else>-</span>
          </span>
          <span v-else>线下发牌</span>
        </div>
        <div>公共牌: <span v-html="formatCards(store.communityCards)"></span></div>
        <div>底池: {{ store.pot }}</div>
        <div>当前行动: {{ store.currentTurn === store.nickname ? '我' : store.currentTurn }}</div>
        <div>阶段: {{ roundText }}</div>
        <div>剩余时间: {{ store.timeLeft }}s</div>
      </el-card>

      <!-- 大屏幕：使用行布局 -->
      <div class="desktop-layout">
        <div class="left-panel">
          <PlayerList />
          <!-- 分池阶段 -->
          <template v-if="store.stage === 'distribution' && isInGame && !online">
            <div class="take-controls">
              <el-input v-model.number="takeAmount" type="number" placeholder="Take 数量" class="take-input" />
              <el-button type="primary" @click="onTake"
                         :disabled="takeAmount < 0"
                         :class="{ 'colored-border': takeAmount >= 0, 'disabled-border': takeAmount < 0 }"
                         class="take-btn">
                Take
              </el-button>
              <el-button type="warning" @click="onTakeAll"
                         :disabled="store.pot === 0"
                         :class="{ 'colored-border': store.pot > 0, 'disabled-border': store.pot === 0 }"
                         class="take-btn">
                Take All
              </el-button>
            </div>
          </template>
          <!-- 正常操作阶段 -->
          <template v-else-if="store.stage === 'playing' && isInGame">
            <ActionBar />
          </template>
          <div class="control-buttons">
            <el-button size="small" @click="toggleAutoStart"
                       :type="store.autoStart ? 'warning' : 'info'"
                       :class="{ 'colored-border': true }">
              {{ store.autoStart ? '关闭自动开始' : '开启自动开始' }}
            </el-button>
            <el-button size="small" @click="toggleRoomLock"
                       :type="store.roomLocked ? 'danger' : 'success'"
                       :class="{ 'colored-border': true }">
              {{ store.roomLocked ? '解锁房间' : '锁定房间' }}
            </el-button>
          </div>
        </div>
        <div class="chat-container">
          <Chat class="chat-component" />
        </div>
      </div>

      <!-- 小屏幕：平级布局 -->
      <div class="mobile-layout">
        <!-- 玩家列表和操作按钮 -->
        <div class="mobile-section">
          <PlayerList />
          <!-- 分池阶段 -->
          <template v-if="store.stage === 'distribution' && isInGame && !online">
            <div class="take-controls-mobile">
              <el-input v-model.number="takeAmount" type="number" placeholder="Take 数量" class="take-input-mobile" />
              <el-button type="primary" @click="onTake"
                         :disabled="takeAmount < 0"
                         :class="{ 'colored-border': takeAmount >= 0, 'disabled-border': takeAmount < 0 }"
                         class="take-btn-mobile">
                Take
              </el-button>
              <el-button type="warning" @click="onTakeAll"
                         :disabled="store.pot === 0"
                         :class="{ 'colored-border': store.pot > 0, 'disabled-border': store.pot === 0 }"
                         class="take-btn-mobile">
                Take All
              </el-button>
            </div>
          </template>
          <!-- 正常操作阶段 -->
          <template v-else-if="store.stage === 'playing' && isInGame">
            <ActionBar />
          </template>
          <div class="control-buttons-mobile">
            <el-button size="small" @click="toggleAutoStart"
                       :type="store.autoStart ? 'warning' : 'info'"
                       :class="{ 'colored-border': true }">
              {{ store.autoStart ? '关闭自动开始' : '开启自动开始' }}
            </el-button>
            <el-button size="small" @click="toggleRoomLock"
                       :type="store.roomLocked ? 'danger' : 'success'"
                       :class="{ 'colored-border': true }">
              {{ store.roomLocked ? '解锁房间' : '锁定房间' }}
            </el-button>
          </div>
        </div>

        <!-- 聊天窗口 -->
        <div class="mobile-section">
          <Chat class="mobile-chat" />
        </div>
      </div>
    </el-main>
  </el-container>
</template>

<script lang="ts" setup>
import { onMounted, computed, ref, onUnmounted } from 'vue';
import { useMainStore } from '../store';
import { storeToRefs } from 'pinia';
import { useRouter, useRoute } from 'vue-router';
import Chat from './Chat.vue';
import PlayerList from './PlayerList.vue';
import ActionBar from './ActionBar.vue';

const store = useMainStore();
// 房间内玩家判断，用于控制预游戏按钮显示
const isInRoom = computed(() => store.players.some((p: any) => p.id === store.nickname));
const { round } = storeToRefs(store);
const router = useRouter();
const route = useRoute();
const roomId = route.params.id as string;
const roundText = computed(() => ['翻前','翻后','转牌','河牌'][round.value] || '');

// 如果未加入此房间，则尝试重新加入
onMounted(() => {
  // 确保socket已初始化，但如果已存在且连接正常，则不重新初始化
  if (!store.socket || !store.socket.connected) {
    store.initSocket();
  }

  if (store.nickname) {
    // 设置当前房间ID
    store.currentRoom = roomId;
    localStorage.setItem('texas_currentRoom', roomId);

    // 检查是否是从大厅新加入的（通过URL参数或状态判断）
    // 如果是刚从大厅join_room过来的，就不需要reconnect_room了
    const isNewJoin = sessionStorage.getItem('texas_newJoin') === 'true';
    if (isNewJoin) {
      // 清除标记，避免下次页面加载时误判
      sessionStorage.removeItem('texas_newJoin');
      return;
    }

    // 如果socket已连接，直接重建会话；否则等待connect事件
    if (store.socket && store.socket.connected) {
      store.socket.emit('reconnect_room', { roomId, playerId: store.nickname, nickname: store.nickname });
    } else if (store.socket) {
      const onConnect = () => {
        store.socket?.emit('reconnect_room', { roomId, playerId: store.nickname, nickname: store.nickname });
        store.socket?.off('connect', onConnect);
      };
      store.socket.on('connect', onConnect);
    }
  } else {
    router.push({ name: 'Lobby' });
  }
});

// 添加组件卸载时的清理
onUnmounted(() => {
  // 组件卸载时不断开socket连接，因为用户可能只是切换到大厅页面
  // socket连接的管理交给store统一处理
});

function onCashIn() {
  if (confirm('确定要充值1000筹码吗？')) {
    store.socket?.emit('cash_in', { roomId });
  }
}
function onCashOut() {
  if (confirm('确定要 Cash Out 并退出房间吗？')) {
    store.socket?.emit('cash_out', { roomId });
    
    // 清理所有状态
    store.resetGameState();
    
    // 清理本地存储
    localStorage.removeItem('texas_currentRoom');
    store.currentRoom = null;
    router.push({ name: 'Lobby' });
  }
}
function onStartGame() {
  if (store.socket && store.currentRoom) {
    store.socket.emit('start_game', { roomId: store.currentRoom });
  }
}

// 切换自动开始
function toggleAutoStart() {
  if (store.socket && store.currentRoom) {
    store.socket.emit('toggle_auto_start', { roomId: store.currentRoom });
  }
}

// 切换房间锁定
function toggleRoomLock() {
  if (store.socket && store.currentRoom) {
    store.socket.emit('toggle_room_lock', { roomId: store.currentRoom });
  }
}

// 快捷操作计算属性和方法
const isMyTurn = computed(() => store.currentTurn === store.nickname);
const toCall = computed(() => store.currentBet - (store.bets[store.nickname] || 0));
const ownPlayer = computed(() => store.players.find((p: any) => p.id === store.nickname));
const canCheck = computed(() => isMyTurn.value && toCall.value === 0);
const canStartGame = computed(() => {
  const playersWithChips = store.players.filter(p => p.chips > 0 && p.inGame);
  return playersWithChips.length >= 2;
});
const isInGame = computed(() => {
  return store.participants.includes(store.nickname);
});

function extendTime() {
  store.extendTime();
}

// 新的智能快捷按钮逻辑
// 第二个快捷按钮的文本
const secondQuickButtonText = computed(() => {
  if (!isMyTurn.value || !isInGame.value) return '';
  
  if (canCheck.value) {
    // 玩家可以check的情况，显示 Bet X
    const betAmount = Math.floor(store.pot / 2);
    // 检查筹码是否足够下注这个金额
    if (betAmount >= ownPlayer.value?.chips) {
      return 'All-in';
    }
    return `Bet ${betAmount}`;
  } else {
    // 玩家不能check的情况，显示 Call X
    const callAmount = toCall.value;
    if (callAmount >= ownPlayer.value?.chips) {
      return 'All-in';
    }
    return `Call ${callAmount}`;
  }
});

// 第三个快捷按钮的文本
const thirdQuickButtonText = computed(() => {
  if (!isMyTurn.value || !isInGame.value) return '';
  
  if (canCheck.value) {
    return 'Check';
  } else {
    return 'Fold';
  }
});

// 处理第二个快捷按钮点击
function handleSecondQuickButton() {
  if (!store.socket || !store.currentRoom || !isMyTurn.value || !isInGame.value) return;
  
  if (canCheck.value) {
    // 玩家可以check的情况，执行 Bet X 或 All-in
    const betAmount = Math.floor(store.pot / 2);
    if (betAmount >= ownPlayer.value?.chips) {
      // All-in
      store.socket.emit('action', { roomId: store.currentRoom, action: 'allin' });
    } else {
      // Bet X - 本轮总下注为当前已下注 + betAmount
      const currentBet = store.bets[store.nickname] || 0;
      const totalBetAmount = currentBet + betAmount;
      store.socket.emit('action', { roomId: store.currentRoom, action: 'raise', amount: totalBetAmount });
    }
  } else {
    // 玩家不能check的情况，执行 Call X 或 All-in
    const callAmount = toCall.value;
    if (callAmount >= ownPlayer.value?.chips) {
      // All-in
      store.socket.emit('action', { roomId: store.currentRoom, action: 'allin' });
    } else {
      // Call
      store.socket.emit('action', { roomId: store.currentRoom, action: 'call' });
    }
  }
}

// 处理第三个快捷按钮点击
function handleThirdQuickButton() {
  if (!store.socket || !store.currentRoom || !isMyTurn.value || !isInGame.value) return;
  
  if (canCheck.value) {
    // Check
    store.socket.emit('action', { roomId: store.currentRoom, action: 'check' });
  } else {
    // Fold
    store.socket.emit('action', { roomId: store.currentRoom, action: 'fold' });
  }
}

// 线下 take 操作
const takeAmount = ref(0);
function onTake() {
  if (store.socket && store.currentRoom) {
    const val = Math.floor(takeAmount.value);
    if (isNaN(val) || val <= 0) {
      alert('请输入合法的正整数Take金额');
      return;
    }
    if (val > store.pot) {
      alert('Take金额不能超过奖池');
      return;
    }
    store.socket.emit('take', { roomId, amount: val });
    takeAmount.value = 0;
  }
}
function onTakeAll() {
  if (store.socket && store.currentRoom) {
    store.socket.emit('take_all', { roomId });
  }
}

// 计算 currentRoom 和 online 标识
const currentRoomInfo = computed(() => store.rooms.find(r => r.id === roomId));
const online = computed(() => currentRoomInfo.value?.online || false);

function formatCards(cards: string[]): string {
  return cards.map(card => {
    // 使用正则表达式匹配扑克牌
    const match = card.match(/(10|[2-9JQKA])(♠|♥|♣|♦)/);
    if (!match) return card; // 如果不匹配，返回原始字符串
    
    const [, value, suit] = match;
    let color = '';
    if (suit === '♠' || suit === '♣') {
      color = 'black';
    } else if (suit === '♥' || suit === '♦') {
      color = 'red';
    }
    return `<span style="color: ${color};">${value}${suit}</span>`;
  }).join(' ');
}
</script>

<style scoped>
.colored-border {
  border: 2px solid #409eff !important;
}

.disabled-border {
  border: 2px solid #c0c4cc !important;
}

/* 浮动快捷操作按钮 */
.floating-header {
  position: fixed !important;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  padding: 8px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  /* 移除背景，让按钮真正浮在上面 */
  background: transparent;
  pointer-events: none; /* 让背景区域不拦截点击 */
}

.floating-header > * {
  pointer-events: auto; /* 恢复按钮的点击功能 */
}

/* 容器基础样式 */
.room-container {
  min-height: 100vh;
}

/* 基础布局 */
.game-main {
  display: flex;
  flex-direction: column;
  padding: 16px;
  padding-top: 70px; /* 为浮动按钮留出空间 */
}

.game-info {
  margin-bottom: 16px;
  flex-shrink: 0;
}

/* 大屏幕布局 */
.desktop-layout {
  display: flex;
  flex-direction: row;
  width: 100%;
  min-height: 500px;
  gap: 16px;
}

.desktop-layout .left-panel {
  flex: 1;
  width: 50%;
  display: flex;
  flex-direction: column;
}

.desktop-layout .chat-container {
  flex: 1;
  width: 50%;
  display: flex;
  flex-direction: column;
  min-height: 300px;
}

.desktop-layout .chat-component {
  flex: 1;
  min-height: 300px;
  width: 100%;
}

/* Take控件大屏幕样式 */
.take-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}

.take-input {
  width: 120px;
}

.take-btn {
  flex: 0 0 auto;
}

/* 控制按钮大屏幕样式 */
.control-buttons {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

/* 移动布局 */
.mobile-layout {
  display: none;
  flex-direction: column;
}

.mobile-section {
  margin-bottom: 16px;
  flex-shrink: 0;
}

.mobile-chat {
  min-height: 400px;
  height: 400px;
}

/* 大屏幕样式 */
@media (min-width: 992px) {
  .room-container {
    min-height: 100vh;
  }

  .game-main {
    min-height: calc(100vh - 70px);
    /* 移除固定高度和overflow，使用页面滚动 */
  }

  .desktop-layout {
    display: flex !important;
  }

  .mobile-layout {
    display: none !important;
  }
}

/* 小屏幕样式 */
@media (max-width: 991px) {
  .room-container {
    min-height: 100vh;
    height: auto;
  }

  .desktop-layout {
    display: none !important;
  }

  .mobile-layout {
    display: flex !important;
  }

  .game-main {
    min-height: calc(100vh - 70px);
  }

  /* 移动端section样式 */
  .mobile-section {
    background: white;
    border-radius: 4px;
    padding: 16px;
    margin-bottom: 16px;
    border: 1px solid #ebeef5;
  }

  .mobile-chat {
    width: 100%;
    min-height: 400px;
  }
  
  /* 移动端调整主内容区域的padding-top */
  .game-main {
    padding-top: 60px; /* 适应缩小后的快捷按钮高度 */
  }

  /* 移动端快捷按钮优化 */
  .floating-header {
    padding: 4px 8px;
    gap: 4px;
    justify-content: flex-start;
    align-items: center;
    min-height: 50px;
  }
  
  .floating-header .el-button {
    font-size: 12px !important;
    padding: 4px 8px !important;
    height: auto !important;
    min-height: 32px !important;
    flex: 0 0 auto;
    white-space: nowrap;
  }
  
  /* 确保按钮不会太宽 */
  .floating-header .el-button:not(.el-input-number) {
    max-width: calc(25% - 4px);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  /* 输入框特殊处理 */
  .floating-header .el-input {
    width: 80px !important;
    flex: 0 0 80px;
  }
}

/* Take控件移动端样式 */
.take-controls-mobile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0;
}

.take-input-mobile {
  width: 100%;
}

.take-btn-mobile {
  width: 100%;
}

/* 控制按钮移动端样式 */
.control-buttons-mobile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.control-buttons-mobile .el-button {
  width: 100%;
}
</style>