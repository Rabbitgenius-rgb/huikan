# Huikan Codex 本机适配

这个插件通过本机 STDIO MCP 把用户明确指定的原文保存到回看工作台，读取某个 Codex 线程的既有摘录，并切换浮窗到该线程。它不会扫描 Codex 会话文件、读取账号密钥或自动采集整段聊天。

在仓库根目录运行 `node codex-plugin/scripts/build.mjs` 后，`dist/server.cjs` 是包含本机通信依赖的独立入口。使用源码插件需要 Node.js 22；桌面安装包的设置可注册内置运行环境，无需额外安装 Node。

Codex 的 MCP 配置支持本地 STDIO command/args。配置后需要重启连接；安装了配置不等于已经验证连接。插件清单使用 portable `plugin.json`、`mcp.json` 和 `skills/`；本目录没有需要用户信任的生命周期 hook。

每次与线程相关的调用都需要明确的技术 `threadId`，归属标记为 `caller-supplied`。当前执行环境的 `CODEX_THREAD_ID` 可作为兼容入口，但并非官方保证的稳定公开接口；不存在时需由用户提供线程链接，不回退到根 session 或最近聊天。`show_recalls` 只在明确调用后切换，不能保证随前台标签页自动切换。回跳只打开 Codex 线程，不定位具体消息。

保存只在 `status: "saved"` 时完成。遇到 `pending`/超时应保留原文并复用 `requestId` 重试；相同内容全局去重会保留首次保存的来源。
