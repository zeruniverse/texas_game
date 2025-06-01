import { Worker, WorkerOptions } from 'worker_threads';
import { Room } from '../models/Room';
import { GameTask, GameTaskResponse } from '../models/GameTask';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';

export class RoomThreadManager {
  private workers: Map<string, Worker> = new Map();
  private tasks: Map<string, { resolve: (value: any) => void; reject: (reason: any) => void; timeout: NodeJS.Timeout }> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  private rooms: Room[];
  private onMessage?: (data: any) => void;

  constructor(rooms: Room[], eventHandler?: (data: any) => void) {
    this.rooms = rooms;
    this.onMessage = eventHandler;
    
    // 如果配置要求保留线程，则服务启动时预创建与房间数相同的线程
    if (config.roomThreadPreserve) {
      rooms.forEach(r => {
        this.startRoomThread(r.id).catch(error => {
          console.error(`启动房间线程 ${r.id} 失败:`, error);
        });
      });
    }

    // 定期检查并清理空闲线程
    this.cleanupInterval = setInterval(() => {
      this.checkAndCleanupIdleThreads();
    }, 30000); // 每30秒检查一次
  }

  // 获取Worker文件的正确路径，支持开发环境加载 TS 源文件以便调试
  private getWorkerPath(): string {
    if (__filename.endsWith('.js')) {
      // 生产环境：加载编译后的 JS
      return path.join(__dirname, '../workers/roomWorker.js');
    } else {
      // 开发环境：加载 TS 源文件
      return path.join(__dirname, '../workers/roomWorker.ts');
    }
  }

  // 重置房间到初始状态
  private resetRoomToInitialState(room: Room): void {
    room.players = [];
    room.participants = [];
    room.autoStart = false;
    room.locked = false;
    room.gameState = {
      deck: [], 
      communityCards: [], 
      pot: 0, 
      bets: {}, 
      totalBets: {}, 
      currentTurn: 0, 
      dealerIndex: 0, 
      blinds: { sb: 5, bb: 10 }, 
      sbIndex: 0, 
      bbIndex: 1, 
      playerHands: {}, 
      currentBet: 10, 
      folded: [], 
      round: 0, 
      acted: [],
      stage: 'idle'
    };
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
      // 配置 Worker 选项
      const workerOptions: WorkerOptions = {
        workerData: { roomId, room }
      };
      // 如果是 TS 环境，则通过 ts-node/register 加载源文件
      if (__filename.endsWith('.ts')) {
        workerOptions.execArgv = ['-r', 'ts-node/register'];
      }
      const worker = new Worker(this.getWorkerPath(), workerOptions);

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
        // 更新房间状态并重置到初始状态
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

    // 如果配置保留线程，则仅重置房间状态，不终止 Worker
    if (config.roomThreadPreserve) {
      const room = this.rooms.find(r => r.id === roomId);
      if (room) {
        // 重置房间到初始状态，但保留线程运行
        this.resetRoomToInitialState(room);
        room.threadStatus = 'running';
        
        // 通知 Worker 线程也重置其内部的房间状态
        try {
          await this.sendTask(roomId, {
            type: 'reset_room',
            roomId,
            data: { roomState: room }
          });
        } catch (error) {
          console.error(`通知房间 ${roomId} 重置失败:`, error);
        }
      }
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
        
        // 重置房间到初始状态
        this.resetRoomToInitialState(room);
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
      if (room.threadStatus === 'running' && room.players.filter(p => p.inGame).length === 0) {
        const idleTime = now - room.lastActiveTime;
        if (idleTime > IDLE_TIMEOUT) {
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
    console.log('开始关闭所有房间线程...');
    
    // 清除定时器
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // 强制终止所有Worker，不管roomThreadPreserve配置
    const promises = Array.from(this.workers.entries()).map(async ([roomId, worker]) => {
      try {
        const room = this.rooms.find(r => r.id === roomId);
        if (room) {
          room.threadStatus = 'stopping';
        }
        
        await worker.terminate();
        this.workers.delete(roomId);
        
        if (room) {
          room.threadStatus = 'idle';
          room.threadId = undefined;
          // 重置房间到初始状态
          this.resetRoomToInitialState(room);
        }
        
        console.log(`房间 ${roomId} 线程已强制终止`);
      } catch (error) {
        console.error(`强制终止房间 ${roomId} 线程失败:`, error);
      }
    });
    
    await Promise.all(promises);
    console.log('所有房间线程已关闭');
  }

  // 更新房间引用（用于服务器重置时保留线程的情况）
  updateRooms(newRooms: Room[]) {
    this.rooms = newRooms;
    console.log('已更新RoomThreadManager中的房间引用');
  }
} 