# Literacy Assessment Server

v0.5.0 组织版 MVP 服务端。单组织、教师邀请码/设备令牌、框架下发、组织 DeepSeek 网关与额度。

## 技术栈

- Node.js 22
- TypeScript / Fastify 5
- PostgreSQL 16
- 服务端模板管理后台

## 本地开发

```bash
cd server
cp .env.example .env
npm install
npm run build
npm test
```

本地需要 PostgreSQL 16。生成密钥：

```bash
openssl rand -base64 48
openssl rand -base64 48
```

分别填入 `AUTH_SECRET` 和 `MASTER_KEY`。

## 数据库

```bash
npm run migrate
npm run bootstrap -- --org "白日梦行动" --username admin
```

`bootstrap` 只允许创建一次组织。管理员密码至少 12 位；也可用 `ADMIN_PASSWORD` 环境变量避免交互输入。

## 启动

```bash
npm run dev
# 或
npm run build && npm start
```

健康检查：

```bash
curl http://127.0.0.1:3010/health
```

## 管理后台

```text
https://plan.dreamook.com/admin/login
```

- 管理员账号密码；
- TOTP 可选（通过数据库/后续设置页开启）；
- 教师加入不走后台账号，使用邀请码。

管理员后台目前支持：

- 总览；
- 成员列表；
- 邀请码生成；
- 框架上传/发布/停用；
- 组织预算与 DeepSeek Key 配置。

## 组织 API

```text
POST /api/auth/redeem-invite
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/me
GET  /api/frameworks
GET  /api/frameworks/:frameworkId
POST /api/ai/chat
POST /api/ai/ocr
POST /api/ai/asr
GET  /api/usage/me
```

组织 Key 只存在服务端，网关负责解密、转发与用量记录；不会写入日志或返回插件。

## 框架上传

管理员上传 Markdown 框架，服务端校验：

- `framework_id` / `version`；
- `路径`；
- 目标 ID 唯一；
- 路径唯一且无空层级；
- 至少两个 level 列。

保存为草稿后，在后台点击发布。插件下载最新发布版本。

## Docker 部署

独立 PostgreSQL 容器，不碰现有 rlc 容器：

```bash
cd /opt/literacy
cp server/.env.example server/.env
# 修改 server/.env 的 DATABASE_URL、AUTH_SECRET、MASTER_KEY、POSTGRES_PASSWORD
docker compose -f server/compose.yml up -d --build
```

`compose.yml` 中的数据库只在 `literacy-net` 内可见；API 只绑定 `127.0.0.1:3010`，由宿主机 nginx 反代。

nginx vhost 示例：

```nginx
server {
    listen 443 ssl http2;
    server_name plan.dreamook.com;

    ssl_certificate /etc/letsencrypt/live/plan.dreamook.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/plan.dreamook.com/privkey.pem;

    client_max_body_size 110m;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

证书：

```bash
certbot --nginx -d plan.dreamook.com
```

## 备份

```bash
docker exec literacy-db pg_dump -U literacy literacy | gzip > backups/literacy-$(date +%F).sql.gz
```

保留 14 天；备份文件权限 600。迁移服务器时复制 `/opt/literacy` 与 `literacy_pgdata` volume（或备份恢复）。

## 安全

- `.env` 不入库、权限 600；
- 组织 Key 使用 `MASTER_KEY` 加密；
- 请求体不写日志；
- 邀请码和 refresh token 只存 hash；
- 管理后台 cookie 为 HttpOnly + SameSite=Strict；
- 服务端不保存学生素材、证据、报告正文；
- 教师/管理员所有接口都有成员或管理员校验。
