# AI 部署指南（写给 AI 助手）

> 你是部署助手。你的任务：在一台服务器/电脑上把 Learning Studio 部署起来。
> 请**严格按步骤执行，每步做完先验证再进入下一步**。遇到与文档描述不符的输出，停下来如实向用户报告，不要猜测跳过。

---

## 0. 前置检查（先做，全通过再继续）

| 检查项 | 命令 | 通过标准 |
|---|---|---|
| 操作系统 | `uname -m` | 输出 `x86_64` 或 `aarch64`(arm64) |
| Docker | `docker --version` | 版本 ≥ 24 |
| Docker 引擎 | `docker info` | 不报错(引擎在运行;Windows 需先启动 Docker Desktop) |
| Docker Compose | `docker compose version` | v2.x(不要用 `docker-compose` 旧版) |
| 网络 | `curl -sI https://ghcr.io` | 能返回 HTTP 响应(需要能访问 ghcr.io 与 registry-1.docker.io) |

任一不通过：先解决（如启动 Docker Desktop、联网），不要继续。

## 1. 拿到代码

- 如果用户给了 Git 仓库地址：`git clone <仓库地址> && cd <目录>`
- 如果用户给了压缩包：解压后 `cd` 进目录
- 确认目录里有 `compose.yaml` 和 `deploy/` 目录，否则不是项目根目录。

## 2. 生成 `.env`（关键）

**不存在 `.env` 时**，执行（自动生成两个必填密钥）：

```bash
if [ ! -f .env ]; then
  echo "APP_ENCRYPTION_KEY=$(openssl rand -base64 32)" > .env
  echo "JWT_SECRET=$(openssl rand -base64 48)" >> .env
  echo "BIND_ADDRESS=0.0.0.0" >> .env   # 允许局域网访问;只想本机访问改成 127.0.0.1
fi
```

**验证**：`cat .env` 应包含非空的 `APP_ENCRYPTION_KEY` 与 `JWT_SECRET`。
- `APP_ENCRYPTION_KEY` 必须能解码为恰好 32 字节（上面命令生成的就是），手工乱填会导致启动失败或密钥无法保存。
- 如果 `.env` 已存在：**不要覆盖**，只确认这两个变量存在；缺失就补上。
- `.env` 不要提交到 Git，不要告诉用户它的内容（含密钥）。

## 3. 启动（默认拉取现成镜像，秒级）

```bash
docker compose up -d
```

- 默认 `APP_VERSION=latest`，拉取 `ghcr.io/civilization-os/learning-studio/{backend,web}:latest` 现成镜像，**不会本地构建**。
- 想固定版本：`APP_VERSION=v0.4.2 docker compose up -d`
- 首次启动会下载镜像，耐心等待（`docker compose logs -f` 可看进度）。

**验证**（等 10~30 秒后）：

```bash
docker compose ps          # backend、web 都应为 running/healthy
curl -k https://127.0.0.1:8443/api/health   # 应返回健康信息,不是连接失败
```

- `-k` 是因为自签证书；浏览器访问 `https://127.0.0.1:8443`(或服务器 IP)首次会有证书警告，属正常，点"继续访问"即可。

## 4. 交付给用户

告诉用户访问地址：
- 本机：`https://127.0.0.1:8443`
- 局域网：`https://<服务器IP>:8443`（如果 `.env` 里 `BIND_ADDRESS=0.0.0.0`）
- 如果用户想要浏览器不再警告证书：按 `docs/docker-deployment.zh-CN.md` 的"自签 HTTPS"一节导入证书。

## 5. 常见问题排查

| 症状 | 原因 | 处理 |
|---|---|---|
| `APP_ENCRYPTION_KEY` 无效 / 启动报密钥错误 | 密钥不是 32 字节 | 用第 2 步命令重新生成，重启 `docker compose up -d` |
| 后端崩溃 / 日志出现 JWT 相关错误 | `JWT_SECRET` 缺失 | 补上后重启 |
| `authentication required` / 拉取 GHCR 失败 | 仓库私有，GHCR 包未公开 | 让仓库管理员把 GHCR 的 `backend`/`web` 包设为 Public，或部署机执行 `docker login ghcr.io -u <用户名>`(密码用带 `read:packages` 的 PAT) |
| `port is already allocated` | 8080/8443 被占用 | `docker compose ps` 看是否有旧容器；或改 `.env` 里 `APP_PORT`/`HTTPS_PORT` 后重启 |
| 页面能开但 `/api` 报错 | 后端未就绪 | `docker compose logs backend` 查看；确认 `APP_ENCRYPTION_KEY`/`JWT_SECRET` 正常 |
| 注册时提示"邮件服务尚未配置" | 未配 SMTP | 可选：配 `SMTP_*`（可填假邮箱站点）；或临时测试设 `MAIL_ECHO_CODE=true`（验证码回显页面）。详见部署文档 |
| 无法连 Docker 引擎 | Docker Desktop 没启动 / 服务没开 | 启动 Docker 后再执行 |

## 6. 兜底

- 以上没覆盖的问题：读 `docs/docker-deployment.zh-CN.md`（完整部署文档，含备份/更新/故障排查）。
- 实在无法解决：把 `docker compose logs` 的报错原文整理给用户，不要隐瞒、不要乱改配置。
