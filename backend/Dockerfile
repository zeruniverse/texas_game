# 构建阶段
FROM node:18-alpine AS builder
WORKDIR /app

# 复制package文件并安装所有依赖（包括开发依赖）
COPY package*.json ./
RUN npm ci

# 复制源代码并构建
COPY . .
RUN npm run build

# 生产运行阶段
FROM node:18-alpine AS runner
WORKDIR /app

# 复制package文件并只安装生产依赖
COPY package*.json ./
RUN npm ci --production && npm cache clean --force

# 从构建阶段复制编译后的代码
COPY --from=builder /app/dist ./dist

# 创建非root用户
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# 更改文件所有权
USER nextjs

EXPOSE 3000

# 使用编译后的代码启动
CMD ["node", "dist/server.js"]