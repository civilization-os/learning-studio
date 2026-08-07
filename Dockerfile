# syntax=docker/dockerfile:1

FROM node:22-alpine AS source
WORKDIR /app
# better-sqlite3@13 的 npm 包自带全平台预编译二进制(含 linuxmusl),
# npm ci 不会触发源码编译,无需安装 python3/make/g++ 等编译工具
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

FROM source AS frontend-build
RUN npm run build

FROM source AS backend-build
RUN npm run server:build

FROM node:22-alpine AS backend
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    APP_STORE_PATH=/app/data/store.json \
    APP_DB_PATH=/app/data/learning-studio.db
COPY --from=backend-build /app/server/dist ./server/dist
# 运行时依赖 node_modules(ESM import drizzle-orm 等),否则 ERR_MODULE_NOT_FOUND
COPY --from=backend-build /app/node_modules ./node_modules
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8787
CMD ["node", "server/dist/index.js"]

FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist /usr/share/nginx/html
EXPOSE 80
