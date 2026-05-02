# noteyard

> 本地运行的 Notion 替代品 — A local-first Notion alternative

![CI](https://github.com/PentiumRabbit/noteyard/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Go](https://img.shields.io/badge/go-1.21+-00ADD8.svg)

---

## 简介

noteyard 是一款本地优先的笔记与知识管理工具，对标 Notion，数据完全存储在本地 SQLite 数据库，无需联网、无需账号。

- 国内镜像（Gitee）：https://gitee.com/PentiumRabbit/noteyard
- GitHub（国际）：https://github.com/PentiumRabbit/noteyard

## 功能列表

- **块编辑器** — 基于 BlockNote，支持段落、标题、列表、代码块、引用等多种块类型，所见即所得
- **数据库多视图** — 同一数据库可切换表格、看板、画廊、日历、时间轴、列表六种视图
- **多种字段类型** — 文本、数字、单选、多选、日期、关联、公式、电话、负责人、状态等十余种字段
- **公式引擎** — 内置递归下降公式引擎，支持四则运算、比较运算、字符串函数及跨字段引用
- **本地 SQLite 存储** — 数据存于 `~/.local/share/noteyard/noteyard.db`，隐私可控，离线可用
- **Tauri 桌面客户端** — 支持 macOS、Windows、Linux，安装包开箱即用，无需额外依赖

## 截图 Screenshots

![页面编辑](docs/screenshots/editor.png)
![数据库表格视图](docs/screenshots/database-table.png)
![数据库看板视图](docs/screenshots/database-kanban.png)

## 快速开始

### Web 部署

**前置条件：** Go 1.21+、Node.js 18+

```bash
# 克隆仓库
git clone https://github.com/PentiumRabbit/noteyard.git
cd noteyard

# 安装前端依赖并启动开发服务器（后端 :8080，前端 :5173）
make dev

# 或分步操作
make install        # 安装前端依赖
make build          # 构建前端 + 后端二进制（输出到 bin/noteyard）
./bin/noteyard      # 启动后端服务（默认 :8080）
```

生产构建后，前端静态文件由后端服务一并提供，访问 http://localhost:8080 即可。

### 桌面客户端

从 [Releases](https://github.com/PentiumRabbit/noteyard/releases) 页下载对应平台安装包：

| 平台 | 文件格式 |
|------|---------|
| macOS | `.dmg` |
| Windows | `.exe`（安装向导）|
| Linux (deb) | `.deb` |
| Linux (通用) | `.AppImage` |

下载后直接安装运行，数据自动存储在本地，无需任何配置。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + TypeScript + Vite + BlockNote |
| 后端 | Go + chi router |
| 数据库 | SQLite（WAL 模式，外键约束开启） |
| 桌面端 | Tauri 2 |

## 开发

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解本地开发环境搭建、分支策略与提交规范。

## 协议

本项目基于 [MIT License](LICENSE) 开源。

---

## Introduction

![CI](https://github.com/PentiumRabbit/noteyard/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Go](https://img.shields.io/badge/go-1.21+-00ADD8.svg)

noteyard is a local-first note-taking and knowledge management tool, designed as a Notion alternative. All data is stored in a local SQLite database — no internet connection required, no account needed.

- GitHub (International): https://github.com/PentiumRabbit/noteyard
- Gitee (China Mirror): https://gitee.com/PentiumRabbit/noteyard

## Features

- **Block Editor** — Powered by BlockNote; supports paragraphs, headings, lists, code blocks, quotes, and more
- **Database Multi-View** — Switch between Table, Kanban, Gallery, Calendar, Timeline, and List views on the same database
- **Rich Field Types** — Text, number, select, multi-select, date, relation, formula, phone, people, status, and more
- **Formula Engine** — Built-in recursive-descent formula engine with arithmetic, comparison operators, string functions, and cross-field references
- **Local SQLite Storage** — Data lives at `~/.local/share/noteyard/noteyard.db`; fully offline, fully private
- **Tauri Desktop App** — Native app for macOS, Windows, and Linux; zero external dependencies

## Getting Started

### Web Deployment

**Prerequisites:** Go 1.21+, Node.js 18+

```bash
# Clone the repository
git clone https://github.com/PentiumRabbit/noteyard.git
cd noteyard

# Install frontend dependencies and start dev servers (backend :8080, frontend :5173)
make dev

# Production build
make build          # builds frontend + backend binary → bin/noteyard
./bin/noteyard      # serves everything on :8080
```

### Desktop App

Download the installer for your platform from the [Releases](https://github.com/PentiumRabbit/noteyard/releases) page:

| Platform | Format |
|----------|--------|
| macOS | `.dmg` |
| Windows | `.exe` (installer) |
| Linux (deb) | `.deb` |
| Linux (generic) | `.AppImage` |

Install and run — data is stored locally with no additional setup required.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + BlockNote |
| Backend | Go + chi router |
| Database | SQLite (WAL mode, foreign keys enabled) |
| Desktop | Tauri 2 |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development setup, branching strategy, and commit conventions.

## License

This project is licensed under the [MIT License](LICENSE).
