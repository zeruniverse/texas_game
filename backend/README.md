# 后端服务 (Texas Holdem Server)

本目录包含后端 Node.js 应用，使用 Express + socket.io 构建。

## 使用 Docker 部署

1. 构建镜像：

```bash
docker build -t texas-holdem-backend .
```

2. 运行容器：

```bash
docker run -d --name texas-backend -p 3000:3000 texas-holdem-backend
```

3. 停止并删除容器：

```bash
docker stop texas-backend && docker rm texas-backend
```

## 本地开发

```bash
npm install
npm run dev
```