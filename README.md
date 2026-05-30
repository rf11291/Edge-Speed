# Open Edge Speed v0.4.0-workers

Open Edge Speed 是一个 Cloudflare Workers Edge Speed 测速站，用于测量当前浏览器到 Cloudflare 边缘节点之间的下载速率、上传速率、空闲延迟、负载延迟、抖动、客户端网络信息和边缘节点信息。

这个版本已经从传统 Node.js HTTP 服务改造成 Workers 原生 `fetch` 入口，并使用 Workers Static Assets 托管前端静态文件。

## 主要变化

- 移除 `server.js`、Docker、Nginx 部署文件和传统端口监听模型。
- 新增 `src/worker.js`，使用 Cloudflare Workers 原生 Fetch API。
- 新增 `wrangler.toml`，通过 `assets = { directory = "./public", binding = "ASSETS" }` 挂载静态文件。
- 下载测速 `/__down` 使用 `ReadableStream` 在边缘节点流式输出二进制数据。
- 上传测速 `/__up` 使用 `request.body.getReader()` 统计请求体大小和耗时。
- `/api/config` 和 `/api/client` 返回 Cloudflare 边缘节点、客户端 IP、地理位置、ASN、浏览器等信息。
- 已移除单 IP 并发限制、全局并发限制和字节令牌桶；Workers 版本只保留上传/下载大小上限。

## 本地开发

```bash
npm install
npm run dev
```

Wrangler 会启动本地 Workers 开发环境。打开终端输出中的本地地址即可访问测速页面。

## 部署

```bash
npm install
npm run deploy
```

首次部署前需要登录 Cloudflare：

```bash
npx wrangler login
```

部署后测到的是：

```text
浏览器 <-> Cloudflare 边缘节点
```

不是浏览器到某台 VPS 或源站的链路。

## 配置

主要配置在 `wrangler.toml` 的 `[vars]` 中：

```toml
[vars]
SITE_NAME = "Open Edge Speed"
SERVER_REGION = ""
EXPOSE_CLIENT_IP = "1"
MAX_DOWNLOAD_BYTES = "512MiB"
MAX_UPLOAD_BYTES = "50MiB"
ALLOWED_ORIGINS = ""
IP_INFO_API_URL = ""
IP_INFO_TIMEOUT_MS = "1200"
IP_INFO_CACHE_TTL_SECONDS = "3600"
```

### 上传大小

默认 `MAX_UPLOAD_BYTES = "50MiB"`，这样更适合 Cloudflare Workers。Cloudflare 的请求体大小还受账户套餐限制；即使 Worker 配置更大，超出 Cloudflare 平台限制的请求也会在进入 Worker 前被拒绝。

### 下载大小

默认 `MAX_DOWNLOAD_BYTES = "512MiB"`。下载端点通过流式响应生成数据，并设置 `Cache-Control: no-store` 与 `Content-Encoding: identity`。

### IP 信息

不配置外部 IP API 时，站点会使用 Cloudflare `request.cf` 提供的国家/地区、城市、ASN、AS Organization 和边缘机房 `colo` 等信息。

如果要启用 ipinfo 这类外部 IP 数据源，可以设置：

```bash
npx wrangler secret put IP_INFO_API_TOKEN
```

然后在 `wrangler.toml` 中设置：

```toml
IP_INFO_API_URL = "https://ipinfo.io/{ip}/json?token={token}"
```

## 自检

```bash
npm run check
```

这个命令会做 JavaScript 语法检查。

部署后可访问：

```text
/healthz
/api/config
/api/client
/__down?bytes=1000000
```

## 注意事项

- 这个版本不做应用层并发限制和速率限制。
- Workers 是边缘运行环境，节点会随访问者位置和 Cloudflare 调度变化。
- 上传测试的最大体积建议保持在 Cloudflare 请求体限制以内。
- 如果你要测某台自有服务器或机房的真实带宽，请继续使用传统 Node/VPS/Docker 部署模型，而不是 Workers。
