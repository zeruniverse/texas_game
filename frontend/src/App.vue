<template>
  <!-- 主题切换 -->
  <el-switch v-model="darkMode" active-text="暗色" inactive-text="亮色" @change="toggleTheme" style="position: fixed; top: 1rem; right: 1rem; z-index: 1000;" />
  <router-view />
</template>

<script setup lang="ts">
import { ref } from 'vue';
const darkMode = ref(false);
function toggleTheme(val: boolean) {
  if (val) document.documentElement.classList.add('dark-mode');
  else document.documentElement.classList.remove('dark-mode');
}
</script>

<style>
/* 全局样式 */
</style>
