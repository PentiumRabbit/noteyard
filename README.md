# noteyard

A local-first Notion alternative — block editor, database views, formula engine, all running on your machine.

[中文](README_CN.md) · GitHub: [PentiumRabbit/noteyard](https://github.com/PentiumRabbit/noteyard) · Gitee mirror (China): [PentiumRabbit/noteyard](https://gitee.com/PentiumRabbit/noteyard)

![CI](https://github.com/PentiumRabbit/noteyard/actions/workflows/ci.yml/badge.svg)
![Release](https://img.shields.io/github/v/release/PentiumRabbit/noteyard)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Go](https://img.shields.io/badge/go-1.21+-00ADD8.svg)

---

> **Note**
>
> This project is entirely generated and maintained by AI. **Pull Requests are not accepted.** If you find a bug or have a suggestion, please [open an Issue](../../issues).

---

## Features

- **Block Editor** — Powered by BlockNote; supports paragraphs, headings, lists, code blocks, quotes, and more
- **Database Multi-View** — Switch between Table, Kanban, Gallery, Calendar, Timeline, and List views on the same database
- **Rich Field Types** — Text, number, select, multi-select, date, relation, formula, phone, people, status, and more
- **Formula Engine** — Built-in recursive-descent formula engine with arithmetic, comparison operators, string functions, and cross-field references
- **Local SQLite Storage** — Data lives at `~/.local/share/noteyard/noteyard.db`; fully offline, fully private
- **Tauri Desktop App** — Native app for macOS, Windows, and Linux; zero external dependencies

---

## Installation

### Homebrew (macOS)

```bash
brew install --cask PentiumRabbit/tap/noteyard
```

### Desktop App

Download the installer for your platform from the [Releases](../../releases) page:

| Platform | Format |
|----------|--------|
| macOS | `.dmg` |
| Windows | `.exe` (installer) |
| Linux (deb) | `.deb` |
| Linux (generic) | `.AppImage` |

Install and run — data is stored locally with no additional setup required.

### Build from Source

**Prerequisites:** Go 1.21+, Node.js 18+

```bash
git clone https://github.com/PentiumRabbit/noteyard.git
cd noteyard

# Start dev servers (backend :8080, frontend :5173)
make dev

# Production build → bin/noteyard (serves frontend + API on :8080)
make build
./bin/noteyard
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + BlockNote |
| Backend | Go + chi router |
| Database | SQLite (WAL mode, foreign keys enabled) |
| Desktop | Tauri 2 |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development setup, branching strategy, and commit conventions.

---

## License

This project is licensed under the [MIT License](LICENSE).
