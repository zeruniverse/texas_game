import { Worker } from 'worker_threads';
import { Room } from '../models/Room';
import { GameTask, GameTaskResponse } from '../models/GameTask';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export class RoomThreadManager {
  private workers: Map<string, Worker> = new Map();
  private tasks: Map<string, { resolve: (value: any) => void; reject: (reason: any) => void; timeout: NodeJS.Timeout }> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  private rooms: Room[];
  private onMessage?: (data: any) => void;

  constructor(rooms: Room[], eventHandler?: (data: any) => void) {
    this.rooms = rooms;
    this.onMessage = eventHandler;
    
    // 定期检查并清理空闲线程
    this.cleanupInterval = setInterval(() => {
      this.checkAndCleanupIdleThreads();
    }, 30000); // 每30秒检查一次
  }

  // 获取Worker文件的正确路径
  private getWorkerPath(): string {
    // 检查是否在生产环境（编译后的代码中）
    if (__filename.endsWith('.js')) {
      // 生产环境：从 dist/services/ 到 dist/workers/
      return path.join(__dirname, '../workers/roomWorker.js');
    } else {
      // 开发环境：从 src/services/ 到 dist/workers/
      return path.join(__dirname, '../../dist/workers/roomWorker.js');
    }
  }

  // 启动房间线程
  async startRoomThread(roomId: string): Promise<boolean> {
    const room = this.rooms.find(r => r.id === roomId);
    if (!room) {
      console.error(`房间 ${roomId} 不存在`);
      return false;
    }

    if (this.workers.has(roomId)) {
      console.log(`房间 ${roomId} 的线程已存在`);
      return true;
    }

    try {
      const worker = new Worker(this.getWorkerPath(), {
        workerData: { roomId, room }
      });

      // 设置消息监听
      worker.on('message', (response: GameTaskResponse) => {
        // 处理事件转发
        if (response.taskId === 'emit' && this.onMessage) {
          this.onMessage(response.data);
          return;
        }
        
        // 处理任务响应
        const task = this.tasks.get(response.taskId);
        if (task) {
          task.resolve(response);
          this.tasks.delete(response.taskId);
        }
      });

      worker.on('error', (error) => {
        console.error(`房间 ${roomId} 线程出错:`, error);
        this.stopRoomThread(roomId);
      });

      worker.on('exit', (code) => {
        console.log(`房间 ${roomId} 线程退出，代码: ${code}`);
        this.workers.delete(roomId);
        // 更新房间状态
        const room = this.rooms.find(r => r.id === roomId);
        if (room) {
          room.threadStatus = 'idle';
          room.threadId = undefined;
        }
      });

      this.workers.set(roomId, worker);
      
      // 更新房间状态
      room.threadStatus = 'running';
      room.threadId = uuidv4();
      room.lastActiveTime = Date.now();

      console.log(`房间 ${roomId} 线程启动成功`);
      return true;
    } catch (error) {
      console.error(`启动房间 ${roomId} 线程失败:`, error);
      return false;
    }
  }

  // 停止房间线程
  async stopRoomThread(roomId: string): Promise<boolean> {
    const worker = this.workers.get(roomId);
    if (!worker) {
      return true;
    }

    const room = this.rooms.find(r => r.id === roomId);
    if (room) {
      room.threadStatus = 'stopping';
    }

    try {
      await worker.terminate();
      this.workers.delete(roomId);
      
      if (room) {
        room.threadStatus = 'idle';
        room.threadId = undefined;
      }
      
      console.log(`房间 ${roomId} 线程已停止`);
      return true;
    } catch (error) {
      console.error(`停止房间 ${roomId} 线程失败:`, error);
      return false;
    }
  }

  // 向房间线程发送任务
  async sendTask(roomId: string, task: Omit<GameTask, 'id' | 'timestamp'>): Promise<GameTaskResponse> {
    const worker = this.workers.get(roomId);
    if (!worker) {
      throw new Error(`房间 ${roomId} 线程不存在`);
    }

    const fullTask: GameTask = {
      ...task,
      id: uuidv4(),
      timestamp: Date.now()
    };

    const promise = new Promise<GameTaskResponse>((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        this.tasks.delete(fullTask.id);
        reject(new Error('任务超时'));
      }, 10000); // 10秒超时

      this.tasks.set(fullTask.id, { resolve, reject, timeout });

      worker.postMessage(fullTask);
    });

    // 更新房间活跃时间
    const room = this.rooms.find(r => r.id === roomId);
    if (room) {
      room.lastActiveTime = Date.now();
    }

    return promise;
  }

  // 检查并清理空闲线程
  private checkAndCleanupIdleThreads() {
    const now = Date.now();
    const IDLE_TIMEOUT = 60 * 1000; // 1分钟

    for (const room of this.rooms) {
      if (room.threadStatus === 'running' && room.players.length === 0) {
        const idleTime = now - room.lastActiveTime;
        if (idleTime > IDLE_TIMEOUT) {
          console.log(`房间 ${room.id} 空闲超过1分钟，准备清理线程`);
          this.stopRoomThread(room.id);
        }
      }
    }
  }

  // 获取房间线程状态
  getRoomThreadStatus(roomId: string): 'idle' | 'running' | 'stopping' | 'not_found' {
    const room = this.rooms.find(r => r.id === roomId);
    if (!room) return 'not_found';
    return room.threadStatus;
  }

  // 确保房间线程运行
  async ensureRoomThreadRunning(roomId: string): Promise<boolean> {
    const status = this.getRoomThreadStatus(roomId);
    if (status === 'running') {
      return true;
    } else if (status === 'idle' || status === 'not_found') {
      return await this.startRoomThread(roomId);
    }
    return false;
  }

  // 关闭所有线程
  async shutdown() {
    const promises = Array.from(this.workers.keys()).map(roomId => 
      this.stopRoomThread(roomId)
    );
    await Promise.all(promises);
  }
} 