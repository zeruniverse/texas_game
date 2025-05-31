<template>
  <el-container>
    <el-header><h2>房间列表</h2></el-header>
    <el-main>
      <el-row :gutter="20">
        <el-col v-for="room in rooms" :key="room.id" :xs="24" :sm="24" :md="8">
          <el-card>
            <h3>{{ room.name }}</h3>
            <p>人数: {{ room.current }} / 20{{ room.locked ? ' 🔒' : '' }}</p>
            <p>类型: {{ room.online ? '线上游戏' : '线下游戏' }}</p>
            <el-button type="primary" @click="enter(room.id)">进入</el-button>
          </el-card>
        </el-col>
      </el-row>
    </el-main>
  </el-container>
</template>

<script lang="ts" setup>
import { onMounted } from 'vue';
import { useMainStore } from '../store';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';

const store = useMainStore();
const { rooms } = storeToRefs(store);
const router = useRouter();

onMounted(() => {
  // 确保socket已初始化，但如果已存在且连接正常，则不重新初始化
  if (!store.socket || !store.socket.connected) {
    store.initSocket();
  }
});

function enter(roomId: string) {
  const nickname = prompt('请输入昵称');
  if (nickname) {
    store.joinRoom(roomId, nickname);
    router.push({ name: 'Room', params: { id: roomId } });
  }
}
</script>