# 抽签系统 · 生产镜像
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

# 只有云端持久库模式需要 @libsql/client（本地模式延迟加载，可不装）
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY db.js server.js migrate-to-turso.js ./
COPY public ./public

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "--experimental-sqlite", "server.js"]
