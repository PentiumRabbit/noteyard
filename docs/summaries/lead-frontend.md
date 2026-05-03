# lead-frontend 摘要

> 角色: 研发负责人（lead）
> 最后更新: 2026-05-03
> 覆盖需求: REQ-062（设置页改为独立界面）、FEAT001（数据库视图横向滚动）

---

## 当前架构要点

### 视图状态管理（App.tsx）
- `view: 'editor' | 'settings'` 状态控制主内容区渲染
- `openSettings()` / `closeSettings()` 回调通过 props 传给 Sidebar 和 SettingsPage
- 编辑器始终挂载，进入设置时用 `display:none` 隐藏（不卸载，保留 BlockNote 实例和 selectedPageId 上下文）
- `handleSelect()` 选中页面时自动切换回 editor 视图
- 全局 keydown：Esc 关闭设置页（INPUT/TEXTAREA 内不响应）

### 设置页组件（SettingsPage.tsx）
- 路径：`web/src/components/settings/SettingsPage.tsx`
- 双栏布局：左侧分类导航（外观 / 数据&备份）+ 右侧内容区 + 右上角关闭按钮
- Props：`onClose: () => void`
- 内部状态：`activeCategory: 'appearance' | 'data'`
- 字体/主题：复用 `useSettings` hook（SettingsContext）
- 数据&备份：本地 fetchConfig/saveConfig，挂载时加载，保存按钮显式触发

### Sidebar（Sidebar.tsx）
- Props 扩展：新增 `onOpenSettings: () => void` 和 `settingsActive: boolean`
- 「设置」按钮 onClick → 调用 `onOpenSettings`
- 激活态：`.sidebar-new-page-btn.active` CSS 类
- 已移除：`settingsOpen` state、`<SettingsPanel>` 渲染、`settingsBtnRef`、SettingsPanel import

### 已删除
- `web/src/components/settings/SettingsPanel.tsx`（原浮层实现）
- `web/src/components/settings/SettingsPanel.css`

---

## 关键文件路径

| 文件 | 说明 |
|------|------|
| `web/src/App.tsx` | 视图状态、openSettings/closeSettings、Esc 处理 |
| `web/src/components/settings/SettingsPage.tsx` | 独立设置页组件（新增） |
| `web/src/components/settings/SettingsPage.css` | 设置页样式（新增） |
| `web/src/components/sidebar/Sidebar.tsx` | 侧边栏，含 onOpenSettings / settingsActive |
| `web/src/components/sidebar/Sidebar.css` | 新增 .active 激活态样式 |
| `web/src/settings/settingsStore.ts` | SettingsContext / useSettings hook |
| `web/src/settings/fontConfig.ts` | FONTS 配置 |
| `web/src/settings/themeConfig.ts` | THEMES 配置 |

---

## 重要约束

- **编辑器必须用 `display:none` 隐藏，不得用条件渲染卸载**，否则 BlockNote 实例销毁触发 flush，违反场景 10 验收
- Esc 快捷键判断 `activeElement.tagName !== 'INPUT' && !== 'TEXTAREA'`，避免干扰输入框
- `handleSelect` 选中页面时必须调用 `setView('editor')`，实现场景 6（设置页内点击侧边栏页面自动关闭）

---

## 上次变更摘要（FEAT001 · #125 — 数据库视图横向滚动）

修改 `DatabaseView.css`：
- 移除 `.db-wrap` 上的 `overflow-x: auto`，避免标题/工具栏/视图切换器随表格一起横向滚动。
- `.db-scroll` 保留 `overflow-x: auto`，并补充 `-webkit-overflow-scrolling: touch` 支持移动端惯性滚动。
- `.db-table` 由 `width: 100%` 改为 `width: max-content; min-width: 100%`：列多时表格按自然宽度展开，`.db-scroll` 提供横向滚动条；列少时 `min-width: 100%` 保证填满容器，无白边。
- 表头与内容在同一 `<table>` 元素内，横向滚动时天然同步，无错位风险。

---

## 上次变更摘要（REQ-062）

将设置从侧边栏浮层（SettingsPanel）改为独立界面（SettingsPage），主内容区整体切换，侧边栏保持可见。所有设置功能（字体、主题、数据目录、备份配置）完整保留。
