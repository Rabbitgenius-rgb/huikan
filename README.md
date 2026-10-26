# 回看 · Huikan

**把 AI 对话中值得留下的内容，变成以后找得到、看得懂、能继续使用的资料。**

回看是一个以本机保存为核心的 AI 对话留存与回看工具。当前重点是 DeepSeek Harness 接入，后续推进 Codex 适配与用户可定制组件。

![回看工作台示例](docs/workbench.png)

## 已有能力

- 从支持的 DeepSeek Harness 对话中主动保存整条消息或选中文字，保留原文和来源。
- 按来源线程浏览，搜索摘录，记录已读状态。
- 重复内容去重、失败重试、归档与恢复。
- Electron 浮窗和便签，以及来源回跳的插件接口。
- 保存过程通过本机通信连接，不需要额外的模型请求。

可选的 AI 主题整理复用 Harness 配置的模型服务，会把待整理摘录发送给该服务。公开版默认使用 Electron 浮窗；本机历史原生浮窗的独立二进制与宿主 Harness 运行时不包含在仓库中。

**阶段：早期开发版。** 当前验证以 macOS 为主，尚未提供签名安装包。完整 Codex 留存适配、组件接口与社区组件分享属于后续计划，详见 [发展计划](docs/ROADMAP.md)。

## 快速体验界面

需要 Node.js 22 或更新版本、npm。

```sh
git clone https://github.com/Rabbitgenius-rgb/huikan.git
cd huikan
npm --prefix ui ci
npm --prefix ui run dev
```

打开终端显示的本机地址。默认是空工作台；添加 `?demo=1` 可体验独立示例数据。示例使用独立存储身份，不导入正式摘录。

## 运行桌面工作台和浮窗

```sh
npm ci
npm --prefix ui ci
npm run build
npm start
```

另开终端，在仓库根目录运行：

```sh
npm run companion
```

开发启动器把桌面资料、浮窗缓存与桥接分别放在仓库 `.local/` 下，默认与已有安装版资料隔离。它们都被 Git 忽略，不应上传。

## 接入 DeepSeek Harness

当前适配 `0.2.0-rc.2`、`0.2.1-rc.3`，其他版本会明确拒绝留存。构建、打包和宿主配置说明见 [插件文档](harness-plugin/README.md)。

在启动 Harness 前，需让它使用与开发启动器相同的桥接目录，例如在仓库根目录的终端中：

```sh
export MENGCANG_RECALL_BRIDGE_DIR="$PWD/.local/bridge"
```

安装本地插件包后重新加载宿主页面。普通留存不要求模型密钥；可选主题整理使用宿主已有模型配置。源码不包含任何账户凭据。

## 开发与测试

```sh
npm test
npm run build
```

根目录测试不依赖 Harness 运行时，覆盖事务、去重、归档恢复、请求来源和退出保存。插件的宿主集成测试另外需要对应版本的 Harness SDK，见插件文档。

| 目录 | 内容 |
| --- | --- |
| `ui/` | React 回看工作台与兼容存储模块 |
| `desktop/` | Electron 桌面入口与本机桥接 |
| `harness-plugin/` | Harness Host / Client 插件 |
| `companion/` | Electron 浮窗与便签 |
| `shared/`、`core/` | 本机通信和来源协议 |
| `tests/` | 保存、来源、恢复与退出回归检查 |

连接方式见 [架构说明](docs/ARCHITECTURE.md)。欢迎通过 Issue 和 Pull Request 参与，见 [贡献说明](CONTRIBUTING.md)。

## 开源许可

项目源码采用 [MIT License](LICENSE)。第三方组件保留其各自许可，见 [第三方声明](THIRD_PARTY_NOTICES.md)。
