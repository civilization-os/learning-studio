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

同时生成并填写登录令牌签名密钥（**生产环境必填**，缺失后端会启动失败）：

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

把输出写入 `.env` 的 `JWT_SECRET`。

DeepSeek 和 Tavily 密钥可以留空，部署后在应用“设置”页面填写；也可以直接写入服务器环境变量。

## 旧版数据迁移（store.json → SQLite）

新版本改用 SQLite 存储。如果是从旧版本升级，且旧数据还在 `server/data/store.json`（或你自定义的 `APP_STORE_PATH`），升级后第一次注册的账号会自动继承这些数据（项目、AI/搜索设置、已加密的 API Key），`store.json` 会被重命名为 `store.json.migrated`。

如果旧数据应归某个**已存在**的账号，请手动迁移：

```bash
npm run server:build
node scripts/migrate-store.mjs --email user@example.com
# 或按用户名: node scripts/migrate-store.mjs --username alice
```

## 邮件验证码（SMTP）配置

注册验证码通过 SMTP 发送，全部可选。不配置时，生产环境发送验证码会返回“邮件服务尚未配置”。

在 `.env` 中配置：

```dotenv
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_ALLOW_INSECURE_TLS=false
MAIL_ECHO_CODE=false
```

- `SMTP_HOST`：SMTP 服务器地址。**不要求是 163/QQ 等正规邮箱服务**，自建 Mailpit / MailHog / smtp4dev 等假邮箱站点、或任意外部 SMTP 都可以，只要地址和端口可达。
- `SMTP_SECURE`：465 端口或使用 SSL 时设为 `true`。
- `SMTP_USER` / `SMTP_PASSWORD`：发件账号；无认证的假 SMTP 站点可留空。
- `SMTP_FROM`：发件人显示地址（如 `noreply@your-domain.com`），可以是**不存在的假地址**——邮件被接收方归入垃圾邮件不影响功能。
- `SMTP_ALLOW_INSECURE_TLS`：连接自签证书/无有效证书的假 SMTP 站点时设为 `true`，跳过证书校验。
- `MAIL_ECHO_CODE`：测试用开关。完全没有 SMTP 时设为 `true`，验证码会直接回显在页面上并写入后端日志（等同本地开发模式），适合临时部署验证；生产对外服务不建议开启。

修改后重新启动生效：

```bash
docker compose up -d
```

## CI 发布与快速部署（可选，推荐）

推送 `v*` tag 后，GitHub Actions 会自动构建 **linux/amd64 + linux/arm64** 两个架构的镜像，推送到 GitHub Container Registry（GHCR），并创建 Release。部署机直接拉取现成镜像，**不用在服务器上本地构建**（省掉 npm ci + 编译时间，秒级部署）。

发布新版本：

```bash
npm version 0.4.1          # 更新 package.json 版本号
git push origin 你的分支     # 提交代码（合并进 main 后）
git tag v0.4.1              # tag 名必须带 v 前缀
git push origin v0.4.1      # 触发 workflow
```

workflow 完成后（可在仓库 Actions 页查看进度），部署机快速部署：

```bash
APP_VERSION=v0.4.1 docker compose pull
APP_VERSION=v0.4.1 docker compose up -d
```

也可以继续用本地构建的方式（不指定 `APP_VERSION`，默认 `latest`）：

```bash
docker compose up -d --build
```

注意：

- GHCR 镜像的可见性跟随仓库：公开仓库的镜像可直接拉取；私有仓库需要在部署机执行 `docker login ghcr.io -u <用户名> -p <PAT>`（PAT 需 `read:packages` 权限）。
- 多架构镜像是同一份镜像，部署机（x86 或 ARM）会自动拉取匹配自己架构的层，无需区分系统。

## 2. 启动

```bash
docker compose up -d --build
```

默认访问地址：

```text
https://127.0.0.1:8443
```

首次访问会提示"证书不受信任/连接不是私密连接"——这是自签证书的正常现象，点"继续访问/高级→继续前往"即可进入。想消除提示，见下文"自签 HTTPS"。

访问 `http://127.0.0.1:8080` 会自动 301 跳转到上面的 HTTPS 地址。

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
HTTPS_PORT=8443
```

然后重新启动：

```bash
docker compose up -d
```

局域网访问地址：`https://<服务器IP>:8443`。如果浏览器仍然警告证书不受信任，请重新生成包含该 IP 的证书（见下方"自签 HTTPS"），或在每台访问设备上导入证书。

## 自签 HTTPS

部署自带一份自签证书（`deploy/certs/cert.pem` + `key.pem`），有效期约两年，开箱即用。

- 生成/更换证书（例如把局域网 IP 加进证书，让警告页的"不受信任"更少）：

  ```bash
  node scripts/gen-selfsigned-cert.mjs --ip 192.168.1.9
  docker compose up -d   # 重新挂载
  ```

- 想让浏览器不再警告：在**每台访问设备**上把 `deploy/certs/cert.pem` 导入"受信任的根证书颁发机构"：
  - Windows：双击 `cert.pem` → 安装证书 → 本地计算机 → 选择"受信任的根证书颁发机构"→ 完成。
  - macOS：双击导入钥匙串 → 找到该证书 → 设为"始终信任"。
  - Android/iOS：安装证书文件 → 设置中启用"信任用户证书"。

- 自签证书**仅适合内网/测试**。公开到互联网必须改用受信任证书（Let's Encrypt / Caddy 自动证书等）。

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
