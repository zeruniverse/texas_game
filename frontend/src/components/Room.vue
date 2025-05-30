<template>
  <el-container class="room-container">
    <!-- 快捷操作按钮 - 固定在顶部 -->
    <div class="floating-header">
      <!-- 只有在未开始游戏且已在房间的玩家显示开始/CashIn/CashOut -->
      <template v-if="!store.gameActive && isInRoom">
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
      <!-- 游戏进行时，参与游戏的玩家快捷操作（线上与线下翻牌前） -->
      <template v-if="store.gameActive && isInGame && !store.distributionActive">
        <el-button @click="extendTime"
                   :disabled="!isMyTurn || !canExtendTime"
                   :class="{ 'colored-border': isMyTurn && canExtendTime, 'disabled-border': !isMyTurn || !canExtendTime }">
          延时
        </el-button>
        <el-button @click="callAction"
                   :disabled="!canCall"
                   :class="{ 'colored-border': canCall, 'disabled-border': !canCall }">
          Call {{ toCall }}
        </el-button>
        <el-button @click="checkAction"
                   :disabled="!canCheck"
                   :class="{ 'colored-border': canCheck, 'disabled-border': !canCheck }">
          Check
        </el-button>
      </template>
      <!-- 线下分池阶段显示Take/TakeAll -->
      <template v-if="store.distributionActive && isInGame && !online">
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
        <div>我的底牌: <span v-if="!isInGame">未参与游戏</span>
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
          <template v-if="store.distributionActive && isInGame && !online">
            <el-input v-model.number="takeAmount" type="number" placeholder="Take 数量" style="width: 80px; margin:8px 0;" />
            <el-button type="primary" @click="onTake"
                       :disabled="takeAmount < 0"
                       :class="{ 'colored-border': takeAmount >= 0, 'disabled-border': takeAmount < 0 }"
                       style="margin-bottom:8px;">
              Take
            </el-button>
            <el-button type="warning" @click="onTakeAll"
                       :disabled="store.pot === 0"
                       :class="{ 'colored-border': store.pot > 0, 'disabled-border': store.pot === 0 }"
                       style="margin-bottom:8px;">
              Take All
            </el-button>
          </template>
          <!-- 正常操作阶段 -->
          <template v-else-if="store.gameActive && isInGame && !store.distributionActive">
            <ActionBar style="position:relative; z-index:100;" />
          </template>
          <el-button size="small" @click="toggleAutoStart"
                     :type="store.autoStart ? 'warning' : 'info'"
                     style="align-self:flex-start; position:relative; z-index:100;"
                     :class="{ 'colored-border': true }">
            {{ store.autoStart ? '关闭自动开始' : '开启自动开始' }}
          </el-button>
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
          <template v-if="store.distributionActive && isInGame && !online">
            <el-input v-model.number="takeAmount" type="number" placeholder="Take 数量" style="width: 80px; margin:8px 0;" />
            <el-button type="primary" @click="onTake"
                       :disabled="takeAmount < 0"
                       :class="{ 'colored-border': takeAmount >= 0, 'disabled-border': takeAmount < 0 }"
                       style="margin-bottom:8px;">
              Take
            </el-button>
            <el-button type="warning" @click="onTakeAll"
                       :disabled="store.pot === 0"
                       :class="{ 'colored-border': store.pot > 0, 'disabled-border': store.pot === 0 }"
                       style="margin-bottom:8px;">
              Take All
            </el-button>
          </template>
          <!-- 正常操作阶段 -->
          <template v-else-if="store.gameActive && isInGame && !store.distributionActive">
            <ActionBar />
          </template>
          <el-button size="small" @click="toggleAutoStart"
                     :type="store.autoStart ? 'warning' : 'info'"
                     :class="{ 'colored-border': true }">
            {{ store.autoStart ? '关闭自动开始' : '开启自动开始' }}
          </el-button>
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
import { onMounted, computed, ref } from 'vue';
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
  // 确保socket已初始化
  if (!store.socket) {
    store.initSocket();
  }

  if (store.nickname) {
    // 设置当前房间ID
    store.currentRoom = roomId;
    localStorage.setItem('texas_currentRoom', roomId);

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

  if (store.socket) {
    store.socket.on('deal_hand', (data: { hand: string[] }) => {
      store.hand = data.hand;
    });
  }
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
  if (confirm('确定要开始游戏吗？')) {
    store.socket?.emit('start_game', { roomId });
  }
}

// 切换自动开始
function toggleAutoStart() {
  if (store.socket && store.currentRoom) {
    store.socket.emit('toggle_auto_start', { roomId: store.currentRoom });
  }
}

// 快捷操作计算属性和方法
const isMyTurn = computed(() => store.currentTurn === store.nickname);
const toCall = computed(() => store.currentBet - (store.bets[store.nickname] || 0));
const ownPlayer = computed(() => store.players.find((p: any) => p.id === store.nickname));
const canCall = computed(() => isMyTurn.value && toCall.value > 0 && ownPlayer.value && ownPlayer.value.chips > toCall.value);
const canCheck = computed(() => isMyTurn.value && toCall.value === 0);
const canExtendTime = computed(() => {
  // 游戏未开始时不能延时
  if (!store.gameActive) return false;
  // 不在游戏中的玩家不能延时
  if (!isInGame.value) return false;
  return true;
});
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
function callAction() {
  if (store.socket && store.currentRoom) store.socket.emit('action', { roomId, action: 'call' });
}
function checkAction() {
  if (store.socket && store.currentRoom) store.socket.emit('action', { roomId, action: 'check' });
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
</style>