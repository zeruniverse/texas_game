# 多线程架构优化说明

## 概述

本项目已完成多线程架构优化，实现了以下目标：

1. **房间隔离**：每个房间的游戏逻辑运行在独立的Worker线程中，确保房间之间状态完全隔离
2. **原子性保证**：房间内所有操作在同一线程中执行，保证操作的原子性
3. **智能生命周期管理**：线程在第一个用户进入时启动，在房间空闲1分钟后自动销毁
4. **任务转发**：主线程只负责任务转发和线程生命周期管理

## 架构设计

### 主要组件

1. **RoomThreadManager** (`src/services/RoomThreadManager.ts`)
   - 管理所有房间线程的生命周期
   - 负责线程的启动、停止和清理
   - 处理主线程与房间线程之间的消息传递

2. **roomWorker** (`src/workers/roomWorker.ts`)
   - 每个房间的独立Worker线程
   - 处理该房间的所有游戏逻辑
   - 维护房间状态和玩家数据

3. **roomController** (`src/controllers/roomController.ts`)
   - 主线程控制器，只负责任务转发
   - 处理Socket.IO连接和消息路由
   - 不再直接处理游戏逻辑

### 数据模型更新

- **Room模型**：添加了线程相关字段
  - `threadId`: 线程唯一标识
  - `lastActiveTime`: 最后活跃时间
  - `threadStatus`: 线程状态 ('idle' | 'running' | 'stopping')

- **GameTask模型**：定义了任务消息格式
  - 用于主线程与房间线程之间的通信

## 线程生命周期

### 启动条件
- 当第一个玩家加入房间时自动启动对应的房间线程
- 通过 `threadManager.ensureRoomThreadRunning()` 确保线程运行

### 销毁条件
- 房间内玩家数量为0且持续1分钟以上
- 通过定时检查机制 (`checkAndCleanupIdleThreads`) 实现
- 每30秒检查一次所有房间的活跃状态

### 状态管理
- `idle`: 线程未运行
- `running`: 线程正常运行
- `stopping`: 线程正在停止

## 消息传递机制

### 任务类型
房间线程支持以下任务类型：
- `join_room`: 玩家加入房间
- `leave_room`: 玩家离开房间
- `cash_in`: 玩家买入筹码
- `cash_out`: 玩家退出并带走筹码
- `start_game`: 开始游戏
- `player_action`: 玩家游戏行动
- `chat_message`: 聊天消息
- `heartbeat`: 心跳更新
- `reconnect`: 断线重连
- `extend_time`: 延长思考时间
- `toggle_auto_start`: 切换自动开始
- `take`: 线下房间取筹码
- `take_all`: 线下房间取所有筹码
- `get_room_state`: 获取房间状态

### 事件转发
房间线程可以向主线程发送事件：
- `emit`: 向房间内所有玩家广播
- `emit_to_socket`: 向特定玩家发送

## 性能优化

### 内存隔离
- 每个房间的数据完全隔离在独立线程中
- 避免了单线程中大量房间数据的内存竞争

### 并发处理
- 不同房间的操作可以并行处理
- 提高了系统整体吞吐量

### 资源管理
- 空闲房间线程自动回收，节省系统资源
- 智能的线程启动机制，按需分配资源

## 错误处理

### 线程异常
- Worker线程异常时自动重启
- 错误信息记录到日志

### 任务超时
- 每个任务设置10秒超时
- 超时任务自动清理回调

### 优雅关闭
- 服务器关闭时自动停止所有房间线程
- 支持SIGTERM和SIGINT信号

## 使用示例

```typescript
// 启动服务器
import { roomController } from './controllers/roomController';
import { Server } from 'socket.io';

const io = new Server(httpServer);
roomController(io); // 自动初始化多线程架构

// 线程会在玩家加入时自动启动
// 线程会在房间空闲1分钟后自动销毁
```

## 监控和调试

### 日志输出
- 线程启动/停止事件
- 任务处理状态
- 错误信息

### 状态查询
```typescript
// 获取房间线程状态
const status = threadManager.getRoomThreadStatus(roomId);
// 返回: 'idle' | 'running' | 'stopping' | 'not_found'
```

## 注意事项

1. **编译要求**：Worker文件需要编译为JavaScript才能运行
2. **路径配置**：确保Worker文件路径正确指向编译后的JS文件
3. **依赖管理**：Worker线程中的依赖需要正确导入
4. **状态同步**：房间状态变更需要通过消息机制同步到主线程

## 兼容性

- Node.js 12+ (支持Worker Threads)
- TypeScript 4.0+
- 所有现有的前端代码无需修改，API保持兼容 