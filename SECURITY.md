# Security

Open Edge Speed v0.4.0-workers 面向 Cloudflare Workers Edge Speed 场景，核心目标是减少依赖、避免前端第三方资源，并清晰区分测速流量与静态资源。

## 默认防护

- 无 Cookie、无数据库、无第三方前端脚本。
- 前端静态资源由 Workers Static Assets 提供。
- 动态端点使用 Workers 原生 Fetch API。
- 同源 API 默认开启，CORS 需要显式配置 `ALLOWED_ORIGINS`。
- 严格安全响应头，包括 CSP、X-Frame-Options、X-Content-Type-Options、Referrer-Policy 和 Permissions-Policy。
- 上传和下载请求大小上限。
- 测速端点设置 `no-store`，下载响应声明 `Content-Encoding: identity`。
- IP 信息 API 默认关闭；未配置外部数据源时使用 Cloudflare `request.cf` 数据。

## 已移除的限制

Workers 版本不再包含：

- 单 IP 并发限制。
- 全局并发限制。
- 单 IP 字节令牌桶。

原因是这个版本的目标是测量浏览器到 Cloudflare 边缘节点的能力，应用层的跨边缘全局限流并不可靠；如需强限制，应使用 Cloudflare 平台级 Rate Limiting、WAF、Turnstile、Durable Objects 或其他边缘级策略。

## 生产检查清单

1. 确认 `MAX_UPLOAD_BYTES` 不超过你的 Cloudflare 账户请求体限制。
2. 确认 `/__down` 与 `/__up` 不被缓存。
3. 如开放跨域访问，显式设置 `ALLOWED_ORIGINS`，避免使用 `*`。
4. 如果启用外部 IP 信息 API，使用 `wrangler secret put IP_INFO_API_TOKEN` 存储 Token。
5. 评估 Workers 账户每日请求数、CPU、日志和告警设置。
6. 如需滥用防护，优先使用 Cloudflare 平台级防护，而不是在 Worker 内存中做伪全局限流。

## 报告问题

请附上版本、部署方式、`wrangler.toml` 差异、复现步骤和相关日志。不要在公开渠道提交 API Token、访问日志中的完整客户端 IP 或其他敏感信息。
