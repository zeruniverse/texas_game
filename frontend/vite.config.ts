import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: './', // 使用相对路径，适用于静态服务器托管
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
