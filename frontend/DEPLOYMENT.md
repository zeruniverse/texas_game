# 静态服务器部署说明

本项目已配置为支持在静态服务器（如 GitHub Pages）上托管。

## 路由模式

- 使用 Hash 路由模式 (`createWebHashHistory`)
- 路径格式：`/#/` (主页) 和 `/#/room/roomx` (房间页面)
- 这样可以避免在静态服务器上出现 404 错误

## 后端服务器配置

前端会根据环境自动选择后端地址：

### 开发环境
- 自动连接到 `http://localhost:3000`

### 生产环境
- 使用环境变量 `VITE_SOCKET_URL` 配置后端地址
- 如果未配置，默认为 `wss://your-backend-domain.com`

### 配置方法

1. **通过环境变量文件**：
   创建 `.env.production` 文件：
   ```
   VITE_SOCKET_URL=wss://your-backend-domain.com
   ```

2. **通过构建时环境变量**：
   ```bash
   VITE_SOCKET_URL=wss://api.yourdomain.com npm run build
   ```

3. **直接修改配置文件**：
   编辑 `src/config.ts` 中的生产环境配置

## 构建和部署

1. 配置后端服务器地址（见上方）

2. 构建项目：
   ```bash
   npm run build
   ```

3. 将 `dist` 目录的内容上传到静态服务器

## GitHub Pages 部署

### 手动部署
1. 在 GitHub 仓库设置中启用 Pages
2. 选择 "Deploy from a branch"
3. 选择包含构建文件的分支和文件夹

### 自动部署 (GitHub Actions)
创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
        cache-dependency-path: frontend/package-lock.json
    
    - name: Install dependencies
      run: |
        cd frontend
        npm ci
    
    - name: Build
      env:
        VITE_SOCKET_URL: wss://your-backend-domain.com
      run: |
        cd frontend
        npm run build
    
    - name: Deploy to GitHub Pages
      uses: peaceiris/actions-gh-pages@v3
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        publish_dir: frontend/dist
```

## 访问路径

- 主页：`https://your-domain.com/#/`
- 房间页面：`https://your-domain.com/#/room/room1`

## 注意事项

- 确保后端 WebSocket 服务器支持 CORS 并允许来自你的域名的连接
- 如果使用 HTTPS 部署前端，后端也需要支持 HTTPS (wss://)
- 确认后端服务器的 Socket.IO 配置允许跨域连接
- GitHub Pages 只支持静态文件，不能运行后端服务，需要单独部署后端 