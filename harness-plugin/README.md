# 回看 Harness 插件

为支持的 DeepSeek Harness 版本添加「留作回看」动作和选区右键入口，保存原文与来源，并通过本机回看服务回到来源消息。

## 构建与安装

在仓库根目录运行：

```sh
npm run plugin:build
npm run plugin:pack
```

安装包位于 `harness-plugin/packages/`。通过支持本地 npm 插件包的 Harness 插件管理流程安装。插件包名是 `@mengcang/harness-recall`，`cordis.patch.yml` 声明挂载入口；包内不包含 Harness 运行时。安装完成后重新加载已打开的 Harness 页面。

当前适配版本：`0.2.0-rc.2` 与 `0.2.1-rc.3`。未知版本会拒绝留存。宿主版本升级可能需要重新适配正文 DOM 和来源定位接口。

## 自动连接

配合回看 0.2.1 桌面版，插件自动发现同一用户运行中的回看桥接。macOS 推荐从回看“连接与识别设置”中点击“安装 / 更新回看插件”，正常重启 Harness 后启用插件。首次安装前需打开过一次 Harness，使宿主初始化桌面 profile。

Host 每次请求会重新解析发现信息；可选主题服务也会跟随本机桥接变化。macOS 的发现文件位于 `~/Library/Application Support/Huikan/connection.json`，Windows 位于 `%LOCALAPPDATA%\Huikan\connection.json`，目录和文件分别限制为当前用户可访问。该文件不含正文、账号或模型密钥。

已有 `bridgeDirectory` 插件配置、`MENGCANG_RECALL_BRIDGE_DIR` 环境变量仍优先，用于调试或兼容旧部署。显式配置指向旧实例时不会被自动发现覆盖。隔离测试可用 `HUIKAN_DISCOVERY_FILE` 指定独立发现文件。

Windows 使用配套 0.2.1 插件包，按宿主支持的本地插件安装流程导入并启用；不使用 macOS 的 `.app` 选择及安装器。Windows 宿主图形界面的完整安装、留存入口与来源回跳仍需在对应宿主版本中验证。

## 实现边界

- 用户主动保存整条已完成消息或单条消息中的选中文字。
- 从宿主 Session / Conversation 接口取得来源，前端选区适配附带上下文校验。
- Client 经宿主 RPC 调用 Host；Host 通过同用户、带认证的本机 IPC 连接浮窗（macOS/Linux 为 Unix Socket，Windows 为命名管道）。
- 保存完成由工作台持久化回执确认；等待写入与失败重试保留原请求 ID。
- 来源回跳会核对消息和实际定位结果，无法确认时返回失败。
- 可选主题整理复用宿主已配置的模型；这会向该模型服务发送待整理的摘录。普通留存和回看不依赖模型调用。

## 测试

仓库根目录的 `npm test` 检查保存事务、去重、归档恢复和桌面桥接，无需 Harness 运行时。

本子包的 `npm test` / `npm run test:host` 还需要目标 Harness SDK（见 `peerDependencies`）；在已配置 SDK 的开发环境中构建插件后运行。公开仓库不包含宿主运行时、真实会话、用户配置和凭据。

MIT 许可证见 [LICENSE](LICENSE)。
