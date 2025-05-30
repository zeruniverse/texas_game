// 环境配置
const config = {
  // 开发环境配置
  development: {
    socketUrl: 'http://localhost:3000'
  },
  // 生产环境配置
  production: {
    // 在静态部署时，可以通过环境变量或这里直接配置后端地址
    socketUrl: import.meta.env.VITE_SOCKET_URL || 'wss://your-backend-domain.com'
  }
};

// 获取当前环境
const isDevelopment = import.meta.env.DEV;

// 导出当前环境的配置
export const API_CONFIG = isDevelopment ? config.development : config.production;

// 导出 socket URL
export const SOCKET_URL = API_CONFIG.socketUrl; 