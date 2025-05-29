<template>
  <el-container style="height: 100vh;">
    <el-header>
      <!-- 游戏未开始时的按钮 -->
      <template v-if="!store.gameActive">
        <el-button type="success" @click="onStartGame">开始游戏</el-button>
        <el-button @click="onCashIn">Cash In</el-button>
        <el-button type="danger" @click="onCashOut">Cash Out</el-button>
      </template>
      <!-- 线上游戏进行时的快捷操作 -->
      <template v-else-if="online">
        <el-button @click="extendTime" :disabled="!isMyTurn">延时</el-button>
        <el-button @click="callAction" :disabled="!canCall">Call {{ toCall }}</el-button>
        <el-button @click="checkAction" :disabled="!canCheck">Check</el-button>
      </template>
      <!-- 线下游戏进行时的 take 操作 -->
      <template v-else>
        <el-input-number v-model="takeAmount" :min="0" :max="store.pot" placeholder="Take 数量" style="margin-right:8px;" />
        <el-button type="primary" @click="onTake" :disabled="takeAmount < 0">Take</el-button>
        <el-button type="warning" @click="onTakeAll" :disabled="store.pot === 0">Take All</el-button>
      </template>
    </el-header>
    <el-main>
      <!-- 游戏信息展示 -->
      <el-card style="margin: 16px;">
        <div>我的底牌: {{ store.hand.join(' ') }}</div>
        <div>公共牌: {{ store.communityCards.join(' ') }}</div>
        <div>底池: {{ store.pot }}</div>
        <div>当前行动: {{ store.currentTurn === store.nickname ? '我' : store.currentTurn }}</div>
        <div>阶段: {{ roundText }}</div>
        <div>剩余时间: {{ store.timeLeft }}s</div>
      </el-card>
      <el-row style="height:100%">
        <el-col :xs="24" :sm="24" :md="6" style="display:flex; flex-direction:column; height:100%">
          <Chat style="flex:1" />
        </el-col>
        <el-col :xs="24" :sm="24" :md="18" style="display:flex; flex-direction:column; height:100%">
          <PlayerList />
          <ActionBar />
        </el-col>
      </el-row>
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
const { round, timeLeft } = storeToRefs(store);
const router = useRouter();
const route = useRoute();
const roomId = route.params.id as string;
const roundText = computed(() => ['翻前','翻后','转牌','河牌'][round.value] || '');

// 如果未加入此房间，则返回大厅
onMounted(() => {
  if (!store.currentRoom || store.currentRoom !== roomId) {
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
    router.push({ name: 'Lobby' });
  }
}
function onStartGame() {
  if (confirm('确定要开始游戏吗？')) {
    store.socket?.emit('start_game', { roomId });
  }
}

// 快捷操作计算属性和方法
const isMyTurn = computed(() => store.currentTurn === store.nickname);
const toCall = computed(() => store.currentBet - (store.bets[store.nickname] || 0));
const ownPlayer = computed(() => store.players.find((p: any) => p.id === store.nickname));
const canCall = computed(() => isMyTurn.value && toCall.value > 0 && ownPlayer.value && ownPlayer.value.chips > toCall.value);
const canCheck = computed(() => isMyTurn.value && toCall.value === 0);
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
    store.socket.emit('take', { roomId, amount: takeAmount.value });
    takeAmount.value = 0;
  }
}
function onTakeAll() {
  if (store.socket && store.currentRoom) {
    const amt = store.pot;
    store.socket.emit('take', { roomId, amount: amt });
  }
}

// 计算 currentRoom 和 online 标识
const currentRoomInfo = computed(() => store.rooms.find(r => r.id === roomId));
const online = computed(() => currentRoomInfo.value?.online || false);
</script>