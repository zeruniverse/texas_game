<template>
  <div>
    <el-card style="height:80%; overflow:auto;">
      <div v-for="(msg, idx) in messages" :key="idx">{{ msg }}</div>
    </el-card>
    <el-input v-model="input" @keyup.enter="send" placeholder="输入消息" />
    <el-button @click="send">发送</el-button>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import { useMainStore } from '../store';

const messages = ref<string[]>([]);
const input = ref('');
const store = useMainStore();

onMounted(() => {
  if (store.socket) {
    store.socket.on('chat_broadcast', (data: { message: string }) => {
      messages.value.push(data.message);
    });
    store.socket.on('error', (msg: string) => {
      messages.value.push(`[系统] ${msg}`);
    });
    store.socket.on('game_over', () => {
      messages.value.push('[系统] 游戏结束，请点击开始游戏开始新局');
    });
  }
});

function send() {
  if (store.socket && store.currentRoom && input.value) {
    const msg = `${store.nickname}: ${input.value}`;
    store.socket.emit('chat_msg', { roomId: store.currentRoom, message: msg });
    input.value = '';
  }
}
</script>