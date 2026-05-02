# noteyard

本地优先的 Notion 替代品 — 块编辑器、数据库多视图、公式引擎，所有数据存储在你自己的机器上。

[English](README.md) · Gitee（国内）：[PentiumRabbit/noteyard](https://gitee.com/PentiumRabbit/noteyard) · GitHub（境外）：[PentiumRabbit/noteyard](https://github.com/PentiumRabbit/noteyard)

![CI](https://github.com/PentiumRabbit/noteyard/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Go](https://img.shields.io/badge/go-1.21+-00ADD8.svg)

---

> **说明**
>
> 本项目由 AI 全程生成并维护。**不接受 Pull Request。** 如有问题或建议，请 [提交 Issue](../../issues)。

---

## 功能特性

- **块编辑器** — 基于 BlockNote，支持段落、标题、列表、代码块、引用等多种块类型，所见即所得
- **数据库多视图** — 同一数据库可切换表格、看板、画廊、日历、时间轴、列表六种视图
- **多种字段类型** — 文本、数字、单选、多选、日期、关联、公式、电话、负责人、状态等十余种字段
- **公式引擎** — 内置递归下降公式引擎，支持四则运算、比较运算、字符串函数及跨字段引用
- **本地 SQLite 存储** — 数据存于 `~/.local/share/noteyard/noteyard.db`，隐私可控，离线可用
- **Tauri 桌面客户端** — 支持 macOS、Windows、Linux，安装包开箱即用，无需额外依赖

---

## 安装

### Homebrew（macOS）

```bash
brew install --cask PentiumRabbit/tap/noteyard
```

### 桌面客户端

从 [Releases](../../releases) 页下载对应平台安装包：

| 平台 | 文件格式 |
|------|---------|
| macOS | `.dmg` |
| Windows | `.exe`（安装向导）|
| Linux (deb) | `.deb` |
| Linux (通用) | `.AppImage` |

下载后直接安装运行，数据自动存储在本地，无需任何配置。

### 从源码构建

**前置条件：** Go 1.21+、Node.js 18+

```bash
git clone https://gitee.com/PentiumRabbit/noteyard.git
cd noteyard

# 启动开发服务器（后端 :8080，前端 :5173）
make dev

# 生产构建 → bin/noteyard（同时提供前端静态文件与 API）
make build
./bin/noteyard
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + TypeScript + Vite + BlockNote |
| 后端 | Go + chi router |
| 数据库 | SQLite（WAL 模式，外键约束开启） |
| 桌面端 | Tauri 2 |

---

## 参与贡献

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解本地开发环境搭建、分支策略与提交规范。

---

## 协议

本项目基于 [MIT License](LICENSE) 开源。
