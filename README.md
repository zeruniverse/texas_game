# Texas Holdem 在线德州扑克

本项目包含前端和后端两部分：

- `frontend`：Vue3 + TypeScript 前端，使用 Vite、Pinia、Element Plus。
- `backend`：Node.js + Express + socket.io 后端，采用多线程架构，数据保存在内存。

## 运行

### 前端

```bash
cd frontend
npm install
npm run dev
```

打开浏览器访问 `http://localhost:5173`。

### 后端

#### 本地开发

**重要：** 由于后端使用了Worker线程加载编译后的JavaScript文件，在开发环境中需要先编译TypeScript代码。

```bash
cd backend
npm install

# 首次运行或代码修改后需要编译
npm run build

# 启动开发服务器
npm run dev
```

**开发流程说明：**
1. 修改TypeScript代码后，需要重新运行 `npm run build` 编译
2. Worker线程会加载 `dist/workers/roomWorker.js` 文件
3. 如果只修改了主线程代码（如controllers），nodemon会自动重启
4. 如果修改了Worker代码（如workers/roomWorker.ts），需要手动重新编译

**快速开发模式：**
```bash
# 监听文件变化并自动编译
npm run build:watch &

# 启动开发服务器
npm run dev
```

#### Docker 部署

**生产环境构建：**
```bash
cd backend

# 多阶段构建，自动处理编译和依赖优化
docker build -t texas-holdem-backend .

# 运行容器
docker run -d --name texas-backend -p 3000:3000 texas-holdem-backend
```

**构建说明：**
- 构建阶段：安装所有依赖 → 编译TypeScript → 生成`dist`目录
- 运行阶段：仅安装生产依赖 → 复制编译后的代码 → 启动服务
- Worker线程路径：自动适配开发/生产环境的不同目录结构

**手动生产部署：**
```bash
# 1. 编译代码
npm run build

# 2. 安装生产依赖
npm ci --production

# 3. 启动服务
node dist/server.js
```

后端服务监听 `3000` 端口。

## 架构说明

### 多线程架构
- **主线程**：处理Socket.IO连接、任务分发、线程生命周期管理
- **房间线程**：每个房间独立的Worker线程，处理游戏逻辑、状态管理
- **线程管理**：房间空闲1分钟后自动销毁线程，节省资源

### 文件结构
```
backend/
├── src/
│   ├── controllers/     # 主线程控制器
│   ├── workers/         # Worker线程实现
│   ├── services/        # 线程管理服务
│   ├── models/          # 数据模型
│   └── utils/           # 工具函数
├── dist/               # 编译输出目录
└── ...
```

### 生产环境路径处理
- **开发环境**：Worker路径为 `src/services/ → ../../dist/workers/`
- **生产环境**：Worker路径为 `dist/services/ → ../workers/`
- **自动检测**：通过 `__filename` 判断环境并使用正确路径

## 版本控制

已配置 `.gitignore`，请使用 Git 管理本项目。