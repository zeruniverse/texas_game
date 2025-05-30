<template>
  <el-table :data="mappedPlayers" style="width:100%">
    <el-table-column prop="nickname" label="玩家"></el-table-column>
    <el-table-column prop="chips" label="筹码"></el-table-column>
    <el-table-column prop="bet" label="本轮下注"></el-table-column>
    <el-table-column prop="cashinCount" label="Cashin次数"></el-table-column>
    <el-table-column prop="status" label="当前状态"></el-table-column>
  </el-table>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { useMainStore } from '../store';

interface PlayerInfo {
  id: string;
  nickname: string;
  chips: number;
  bet: number;
  cashinCount: number;
  status: string;
}

const store = useMainStore();

// 计算玩家状态
const getPlayerStatus = (player: any, room: any) => {
  const isInGame = room.participants && room.participants.includes(player.id);
  const isOnline = player.inGame;

  if (isInGame) {
    return isOnline ? '在线（游戏中）' : '离线（游戏中）';
  } else {
    return isOnline ? '在线' : '离线';
  }
};

const mappedPlayers = computed<PlayerInfo[]>(() => {
  const room = { ...store }; // store包含必要字段
  return store.players.map((p: any) => ({
    id: p.id,
    nickname: p.nickname,
    chips: p.chips,
    bet: store.bets[p.id] || 0,
    cashinCount: p.cashinCount || 0,
    status: getPlayerStatus(p, { participants: store.participants, players: store.players })
  }));
});
</script>