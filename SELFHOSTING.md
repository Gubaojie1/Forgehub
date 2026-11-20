# ForgeHub 独立部署

本部署方式用于 Linux + Docker 演示环境。结构化数据保存在 `/data/forgehub.sqlite`，上传文件保存在 `/data/files`，二者由 Docker 数据卷持久化。

1. 将 `selfhost.env.example` 复制为 `.env.selfhost`。
2. 设置至少 10 位的 `ADMIN_PASSWORD` 和至少 32 位的随机 `SESSION_SECRET`。
3. 执行 `docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build`。
4. 使用 `docker compose -f docker-compose.selfhost.yml logs -f` 查看启动日志。

演示环境默认通过 HTTP 访问，`COOKIE_SECURE=false`。接入域名和 HTTPS 后改为 `COOKIE_SECURE=true`。
