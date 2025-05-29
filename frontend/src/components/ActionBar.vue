<template>
  <div style="padding: 16px;">
    <el-button @click="extendTime">延时</el-button>
    <el-button :disabled="!isMyTurn" @click="action('check')">Check</el-button>
    <el-button :disabled="!canCall" @click="action('call')">Call {{ toCall }}</el-button>
    <el-input v-model.number="raiseAmount" type="number" placeholder="输入加注金额" :disabled="!isMyTurn" style="width: 100px; margin: 0 8px;" />
    <el-button type="warning" :disabled="!isMyTurn" @click="raise">Raise</el-button>
    <el-button type="primary" :disabled="!isMyTurn" @click="action('allin')">All-in</el-button>
    <el-button type="danger" :disabled="!isMyTurn" @click="action('fold')">Fold</el-button>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import { useMainStore } from '../store';
import { storeToRefs } from 'pinia';

const store = useMainStore();
const raiseAmount = ref(0);
const toCall = computed(() => store.currentBet - (store.bets[store.nickname] || 0));
const ownPlayer = computed(() => store.players.find((p: any) => p.id === store.nickname));
const canCall = computed(() => store.currentTurn === store.nickname && toCall.value > 0 && ownPlayer.value && ownPlayer.value.chips > toCall.value);
const isMyTurn = computed(() => store.currentTurn === store.nickname);
const { timeLeft } = storeToRefs(store);

function action(type: string) {
  if (!store.socket || !store.currentRoom) return;
  store.socket.emit('action', { roomId: store.currentRoom, action: type });
}

function raise() {
  if (!store.socket || !store.currentRoom) return;
  const val = Math.floor(raiseAmount.value);
  if (isNaN(val) || val <= 0) {
    alert('请输入合法的正整数加注金额');
    return;
  }
  store.socket.emit('action', { roomId: store.currentRoom, action: 'raise', amount: val });
}

function extendTime() {
  store.extendTime();
}
</script>