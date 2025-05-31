import express, { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { roomController } from './controllers/roomController';
import { config } from './config';

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

// 存储重置函数的引用
let resetServerFunction: (() => Promise<boolean>) | null = null;

// 设置重置函数的方法
export function setResetServerFunction(resetFn: () => Promise<boolean>) {
  resetServerFunction = resetFn;
}

// 初始化房间控制器
roomController(io);

// 健康检查接口
app.get('/', (_req: Request, res: Response) => {
  res.send('Texas Holdem Server running');
});

// 重置服务器接口（HTTP POST）
app.post('/api/reset-server', async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    
    // 验证密码
    if (!password || password !== config.resetPassword) {
      res.status(401).json({
        success: false,
        error: '密码错误'
      });
      return;
    }

    console.log('收到重置服务器HTTP请求，密码验证通过');

    // 检查重置函数是否可用
    if (!resetServerFunction) {
      res.status(500).json({
        success: false,
        error: '重置功能未初始化'
      });
      return;
    }

    // 执行重置操作
    const resetSuccess = await resetServerFunction();
    
    if (resetSuccess) {
      res.json({
        success: true,
        message: '服务器重置成功'
      });
      console.log('通过HTTP接口重置服务器成功');
    } else {
      res.status(500).json({
        success: false,
        error: '重置服务器失败'
      });
    }
  } catch (error) {
    console.error('HTTP重置服务器错误:', error);
    res.status(500).json({
      success: false,
      error: '服务器内部错误'
    });
  }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});