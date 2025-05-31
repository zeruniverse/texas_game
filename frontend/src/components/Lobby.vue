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
      
      <!-- 重置服务器按钮 -->
      <div class="reset-server-section">
        <el-button 
          type="danger" 
          size="large"
          @click="showResetDialog"
          :loading="resetting"
          class="reset-server-btn"
        >
          重置服务器
        </el-button>
      </div>

      <!-- 重置服务器密码对话框 -->
      <el-dialog
        v-model="resetDialogVisible"
        title="重置服务器"
        width="400px"
        center
      >
        <div class="reset-dialog-content">
          <el-alert
            title="警告"
            type="warning"
            description="此操作将强制断开所有用户连接并重置所有房间，请谨慎操作！"
            :closable="false"
            show-icon
          />
          <el-form :model="resetForm" style="margin-top: 20px;">
            <el-form-item label="管理员密码">
              <el-input
                v-model="resetForm.password"
                type="password"
                placeholder="请输入管理员密码"
                show-password
                @keyup.enter="confirmReset"
              />
            </el-form-item>
          </el-form>
        </div>
        <template #footer>
          <span class="dialog-footer">
            <el-button @click="resetDialogVisible = false">取消</el-button>
            <el-button 
              type="danger" 
              @click="confirmReset"
              :loading="resetting"
            >
              确认重置
            </el-button>
          </span>
        </template>
      </el-dialog>
    </el-main>
  </el-container>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { useMainStore } from '../store';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { SOCKET_URL } from '../config';

const store = useMainStore();
const { rooms } = storeToRefs(store);
const router = useRouter();

// 重置服务器相关状态
const resetDialogVisible = ref(false);
const resetting = ref(false);
const resetForm = ref({
  password: ''
});

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

// 显示重置对话框
function showResetDialog() {
  resetForm.value.password = '';
  resetDialogVisible.value = true;
}

// 确认重置服务器
async function confirmReset() {
  if (!resetForm.value.password.trim()) {
    ElMessage.error('请输入管理员密码');
    return;
  }

  try {
    resetting.value = true;
    
    // 发送重置请求到后端
    const response = await fetch(`${getApiUrl()}/reset-server`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        password: resetForm.value.password
      })
    });

    const result = await response.json();

    if (result.success) {
      ElMessage.success('重置请求已发送，服务器即将重置...');
      resetDialogVisible.value = false;
      
      // 等待一下然后刷新页面
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } else {
      ElMessage.error(result.error || '重置失败');
    }
  } catch (error) {
    ElMessage.error('网络错误，请稍后重试');
    console.error('重置服务器错误:', error);
  } finally {
    resetting.value = false;
  }
}

// 获取API基础URL
function getApiUrl() {
  const baseUrl = SOCKET_URL.replace(/\/socket\.io.*$/, '');
  return `${baseUrl}/api`;
}
</script>

<style scoped>
.reset-server-section {
  margin-top: 40px;
  text-align: center;
  padding: 20px 0;
  border-top: 1px solid #ebeef5;
}

.reset-server-btn {
  font-size: 16px;
  padding: 12px 30px;
  border-radius: 8px;
}

.reset-dialog-content {
  padding: 20px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>