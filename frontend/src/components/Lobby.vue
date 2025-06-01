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
        <el-button type="primary" size="large" @click="showHelp" class="help-btn">
          游戏帮助
        </el-button>
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
      <!-- 游戏帮助对话框 -->
      <el-dialog
        v-model="helpDialogVisible"
        title="玩家帮助"
        width="60%"
        center
      >
        <div class="help-content">
          <h3>平台操作指南</h3>
          <ul>
            <li>进入游戏：在房间列表点击"进入"，输入昵称后进入对应房间。</li>
            <li>预游戏阶段（房间内）：
              <ul>
                <li>开始游戏：当有筹码的人数≥2时，可点击"开始游戏"。</li>
                <li>充值（Cash In）：点击即可充值1000筹码。</li>
                <li>退出（Cash Out）：点击退出房间并清除本地状态。</li>
                <li>自动开始：可在大厅或房间内开启/关闭自动开始功能。</li>
                <li>房间锁定：房主可锁定或解锁房间，防止其他玩家加入。</li>
              </ul>
            </li>
            <li>游戏进行时：
              <ul>
                <li>延时（Extend）：在行动前可延长倒计时。</li>
                <li>智能快捷按钮：
                  <ul>
                    <li>当可Check时，第二个按钮显示"Bet x"或"All-in"，第三个按钮显示"Check"。</li>
                    <li>当不可Check时，第二个按钮显示"Call x"或"All-in"，第三个按钮显示"Fold"。</li>
                  </ul>
                </li>
                <li>分池阶段（仅线下游戏）：输入Take数量后点击"Take"或"All-in"分走底池。</li>
                <li>聊天：右侧聊天栏实时聊天和系统消息展示。</li>
              </ul>
            </li>
          </ul>
          <h3>德州扑克规则</h3>
          <ul>
            <li>发牌：每人两张底牌，随后依次展示翻牌（3张）、转牌（1张）、河牌（1张）。</li>
            <li>轮次：翻前、翻后、转牌、河牌，每轮玩家按顺序行动。</li>
            <li>行动选项：Fold（弃牌）、Check（过牌）、Call（跟注）、Bet/Raise（下注/加注）、All-in（全押）。</li>
            <li>胜负判定：摊牌比牌型，从大到小分别是同花顺、四条、葫芦、同花、顺子、三条、两对、对子、高牌。</li>
            <li>平局：若牌型相同，比较最大组成牌点值，仍相同则平分底池。</li>
          </ul>
        </div>
        <template #footer>
          <span class="dialog-footer">
            <el-button @click="helpDialogVisible = false">关闭</el-button>
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
const helpDialogVisible = ref(false);

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

// 显示游戏帮助对话框
function showHelp() {
  helpDialogVisible.value = true;
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

.help-btn {
  margin-right: 10px;
}

.help-content {
  padding: 20px;
}
</style>