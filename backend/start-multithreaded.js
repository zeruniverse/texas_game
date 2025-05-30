#!/usr/bin/env node

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server: SocketIOServer } = require('socket.io');
const { roomController } = require('./dist/controllers/roomController');

console.log('🚀 启动多线程德州扑克服务器...');

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// 初始化多线程房间控制器
console.log('🔧 初始化多线程架构...');
roomController(io);

// 健康检查接口
app.get('/', (_req, res) => {
  res.json({
    message: 'Texas Holdem Server (多线程版本) 运行中',
    architecture: 'Multi-threaded',
    features: [
      '房间状态完全隔离',
      '操作原子性保证', 
      '智能线程生命周期管理',
      '按需资源分配'
    ]
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    architecture: 'multi-threaded'
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`✅ 多线程服务器启动成功！`);
  console.log(`🌐 服务器地址: http://localhost:${PORT}`);
  console.log(`📋 架构特性:`);
  console.log(`   - 每个房间运行在独立的Worker线程中`);
  console.log(`   - 房间状态完全隔离，确保数据安全`);
  console.log(`   - 线程按需启动，空闲1分钟后自动回收`);
  console.log(`   - 支持并发处理多个房间的游戏逻辑`);
  console.log(`🎮 准备接受玩家连接...`);
});

// 优雅关闭处理
process.on('SIGTERM', () => {
  console.log('📴 收到SIGTERM信号，正在优雅关闭服务器...');
  httpServer.close(() => {
    console.log('✅ 服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📴 收到SIGINT信号，正在优雅关闭服务器...');
  httpServer.close(() => {
    console.log('✅ 服务器已关闭');
    process.exit(0);
  });
}); 