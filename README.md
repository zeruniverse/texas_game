# Texas Holdem 在线德州扑克

本项目包含前端和后端两部分：

- `frontend`：Vue3 + TypeScript 前端，使用 Vite、Pinia、Element Plus。
- `backend`：Node.js + Express + socket.io 后端，数据保存在内存。

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

```bash
cd backend
npm install
npm run dev
```

#### Docker 部署

```bash
cd backend
docker build -t texas-holdem-backend .
docker run -d --name texas-backend -p 3000:3000 texas-holdem-backend
```

后端服务监听 `3000` 端口。

## 版本控制

已配置 `.gitignore`，请使用 Git 管理本项目。