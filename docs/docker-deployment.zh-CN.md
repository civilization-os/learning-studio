# Docker 一键部署指南

这套部署会启动两个容器：

- `web`：Nginx 提供前端静态文件，并将 `/api` 转发给后端。
- `backend`：运行 TypeScript 后端，只在 Docker 内部网络开放。

项目数据保存在 Docker volume `learning-studio-data` 中。DeepSeek 和 Tavily 密钥使用部署者提供的 `APP_ENCRYPTION_KEY` 通过 AES-256-GCM 加密后持久化。

## 环境要求

- Docker Engine 24+ 或 Docker Desktop
- Docker Compose v2

## 1. 准备配置

从仓库根目录执行：

```bash
cp deploy/docker.env.example .env
```

Windows PowerShell：

```powershell
Copy-Item deploy/docker.env.example .env
```

生成 32 字节部署密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

把输出写入 `.env` 的 `APP_ENCRYPTION_KEY`。这个值用于解密已保存的 API Key：

- 不要提交到 Git。
- 不要在重启或升级时更换。
- 请存入密码管理器或服务器密钥管理服务。
- 丢失后，已保存的 DeepSeek/Tavily 密钥无法恢复，只能重新填写。

DeepSeek 和 Tavily 密钥可以留空，部署后在应用“设置”页面填写；也可以直接写入服务器环境变量。

## 2. 启动

```bash
docker compose up -d --build
```

默认访问地址：

```text
http://127.0.0.1:8080
```

查看状态与日志：

```bash
docker compose ps
docker compose logs -f
```

停止服务：

```bash
docker compose down
```

`docker compose down` 不会删除学习数据。只有显式执行 `docker compose down -v` 才会删除数据卷。

## 3. 局域网或服务器访问

默认只绑定 `127.0.0.1`，避免未授权用户直接访问设置和生成接口。

如需在局域网或服务器上开放，在 `.env` 中修改：

```dotenv
BIND_ADDRESS=0.0.0.0
APP_PORT=8080
```

然后重新启动：

```bash
docker compose up -d
```

公开到互联网前，必须在外层反向代理、VPN 或零信任网关中增加 HTTPS 与身份验证。CORS 不是访问控制，不能用于保护 API Key 和生成接口。

推荐拓扑：

```text
Internet
  -> HTTPS / 身份验证 / 防火墙
  -> Learning Studio web:8080
  -> Docker 内部 backend:8787
```

## 4. 更新

```bash
git pull
docker compose up -d --build
docker image prune -f
```

更新不会删除 `learning-studio-data` 数据卷。升级前仍建议备份：

```bash
docker run --rm \
  -v learning-studio_learning-studio-data:/data \
  -v "$PWD":/backup \
  alpine tar czf /backup/learning-studio-data.tar.gz -C /data .
```

Compose 项目名或目录名变化时，先通过 `docker volume ls` 确认实际卷名。

## 5. 常见问题

### 提示 `APP_ENCRYPTION_KEY` 无效

密钥必须解码为正好 32 字节。建议重新使用文档中的 Node.js 命令生成，不要手工编写。

### 页面可打开但 API 不可用

执行：

```bash
docker compose ps
docker compose logs backend
docker compose logs web
```

后端健康检查地址为 `/api/health`，Nginx 健康检查地址为 `/healthz`。

### 更换了 `APP_ENCRYPTION_KEY`

旧密钥无法再解密。恢复原值，或者在设置页面重新保存 DeepSeek/Tavily 密钥。
