<template>
  <div style="padding: 16px;">
    <el-button @click="extendTime"
               :disabled="!store.gameActive || !isMyTurn || !isInGame"
               :class="{ 'colored-border': store.gameActive && isMyTurn && isInGame, 'disabled-border': !store.gameActive || !isMyTurn || !isInGame }">
      延时
    </el-button>
    <el-button :disabled="!canCheck"
               @click="action('check')"
               :class="{ 'colored-border': canCheck, 'disabled-border': !canCheck }">
      Check
    </el-button>
    <el-button :disabled="!store.gameActive || !canCall || !isInGame"
               @click="action('call')"
               :class="{ 'colored-border': store.gameActive && canCall && isInGame, 'disabled-border': !store.gameActive || !canCall || !isInGame }">
      Call {{ toCall }}
    </el-button>
    <el-input v-model.number="raiseAmount" type="number" placeholder="输入加注金额"
              :disabled="!store.gameActive || !isMyTurn || !isInGame"
              style="width: 100px; margin: 0 8px;" />
    <el-button type="warning"
               :disabled="!store.gameActive || !isMyTurn || !isInGame"
               @click="raise"
               :class="{ 'colored-border': store.gameActive && isMyTurn && isInGame, 'disabled-border': !store.gameActive || !isMyTurn || !isInGame }">
      Raise
    </el-button>
    <el-button type="primary"
               :disabled="!store.gameActive || !isMyTurn || !isInGame"
               @click="action('allin')"
               :class="{ 'colored-border': store.gameActive && isMyTurn && isInGame, 'disabled-border': !store.gameActive || !isMyTurn || !isInGame }">
      All-in
    </el-button>
    <el-button type="danger"
               :disabled="!store.gameActive || !isMyTurn || !isInGame"
               @click="action('fold')"
               :class="{ 'colored-border': store.gameActive && isMyTurn && isInGame, 'disabled-border': !store.gameActive || !isMyTurn || !isInGame }">
      Fold
    </el-button>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import { useMainStore } from '../store';

const store = useMainStore();
const raiseAmount = ref(0);
const toCall = computed(() => store.currentBet - (store.bets[store.nickname] || 0));
const ownPlayer = computed(() => store.players.find((p: any) => p.id === store.nickname));
const canCall = computed(() => store.currentTurn === store.nickname && toCall.value > 0 && ownPlayer.value && ownPlayer.value.chips > toCall.value && isInGame.value);
const canCheck = computed(() => isMyTurn.value && toCall.value === 0);
const isMyTurn = computed(() => store.currentTurn === store.nickname && isInGame.value);
const isInGame = computed(() => store.participants.includes(store.nickname));

function action(type: string) {
  if (!store.socket || !store.currentRoom || !store.gameActive || !isInGame.value) return;
  store.socket.emit('action', { roomId: store.currentRoom, action: type });
}

function raise() {
  if (!store.socket || !store.currentRoom || !store.gameActive || !isInGame.value) return;
  const val = Math.floor(raiseAmount.value);
  if (isNaN(val) || val <= 0) {
    alert('请输入合法的正整数加注金额');
    return;
  }
  store.socket.emit('action', { roomId: store.currentRoom, action: 'raise', amount: val });
}

function extendTime() {
  if (!store.gameActive || !isInGame.value) return;
  store.extendTime();
}
</script>

<style scoped>
.colored-border {
  border: 2px solid #409eff !important;
}

.disabled-border {
  border: 2px solid #c0c4cc !important;
}
</style>