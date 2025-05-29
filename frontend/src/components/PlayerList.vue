<template>
  <el-table :data="players" style="width:100%">
    <el-table-column prop="nickname" label="玩家"></el-table-column>
    <el-table-column prop="chips" label="筹码"></el-table-column>
    <el-table-column prop="bet" label="本轮下注"></el-table-column>
  </el-table>
</template>

<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import { useMainStore } from '../store';

interface PlayerInfo {
  nickname: string;
  chips: number;
  bet: number;
}

const players = ref<PlayerInfo[]>([]);
const store = useMainStore();

onMounted(() => {
  if (store.socket) {
    store.socket.on('room_update', (room: any) => {
      // room.players 结构: Player[]; 需映射 bet 字段
      players.value = room.players.map((p: any) => ({ nickname: p.nickname, chips: p.chips, bet: room.gameState?.bets[p.id] || 0 }));
    });
  }
});
</script>