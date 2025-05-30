<template>
  <div class="chat-wrapper">
    <el-card ref="chatContainer" class="chat-messages">
      <div v-for="(msg, idx) in store.messages" :key="idx"
           :style="{ color: getMessageColor(msg.type) }">
        <span v-html="formatMessage(msg.message || msg)"></span>
      </div>
    </el-card>
    <div class="chat-input">
      <el-input v-model="input" @keyup.enter="send" placeholder="输入消息" style="flex:1; margin-right:8px;" />
      <el-button type="primary" @click="send">发送</el-button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, nextTick, watch } from 'vue';
import { useMainStore } from '../store';

const store = useMainStore();
const input = ref('');
const chatContainer = ref<HTMLElement>();

// 滚动到底部
const scrollToBottom = () => {
  nextTick(() => {
    if (chatContainer.value) {
      const element = chatContainer.value as any;
      const scrollElement = element.$el || element;
      scrollElement.scrollTop = scrollElement.scrollHeight;
    }
  });
};

// 获取消息颜色
const getMessageColor = (type: string) => {
  if (type === 'cashin' || type === 'cashout') {
    return '#f56c6c'; // 红色
  }
  return undefined; // 默认颜色
};

// 格式化消息内容，处理扑克牌颜色
const formatMessage = (message: string): string => {
  if (!message) return '';
  
  // 匹配扑克牌格式：数字(包括10)/字母 + 花色符号
  const cardRegex = /(10|[2-9JQKA])(♠|♥|♣|♦)/g;
  
  return message.replace(cardRegex, (match, value, suit) => {
    let color = '';
    if (suit === '♠' || suit === '♣') {
      color = 'black';
    } else if (suit === '♥' || suit === '♦') {
      color = 'red';
    }
    return `<span style="color: ${color};">${value}${suit}</span>`;
  });
};

// 监听 store.messages 变化，保持滚动到底部
watch(
  () => store.messages.length,
  () => {
    scrollToBottom();
  }
);

function send() {
  if (store.socket && store.currentRoom && input.value) {
    const msg = `${store.nickname}: ${input.value}`;
    store.socket.emit('chat_msg', { roomId: store.currentRoom, message: msg });
    input.value = '';
  }
}
</script>

<style scoped>
.chat-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  min-height: 300px;
}

.chat-messages {
  flex: 1;
  overflow: auto;
  margin-bottom: 8px;
  min-height: 250px;
  max-height: 500px; /* 设置最大高度为500px */
}

.chat-input {
  display: flex;
  padding: 8px 0;
  flex-shrink: 0;
}

/* 确保在移动设备上正确显示 */
@media (max-width: 991px) {
  .chat-wrapper {
    min-height: 350px;
  }

  .chat-messages {
    min-height: 300px;
    max-height: 400px; /* 移动设备上设置较小的最大高度 */
  }
  
  /* 移动端输入框改为两行布局 */
  .chat-input {
    flex-direction: column;
    gap: 8px;
    padding: 12px 0;
  }
  
  .chat-input .el-input {
    margin-right: 0 !important;
  }
  
  .chat-input .el-button {
    align-self: stretch;
    height: 40px;
  }
}

/* 大屏幕优化 */
@media (min-width: 1200px) {
  .chat-messages {
    max-height: 600px; /* 大屏幕上设置更大的最大高度 */
  }
}
</style>