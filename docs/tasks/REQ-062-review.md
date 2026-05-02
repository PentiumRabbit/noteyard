# REQ-062 架构评审：设置页改为独立界面

> 架构师: 总架构师#46
> REQ: REQ-062
> 日期: 2026-05-02
> 状态: 已确认

---

## 一、需求摘要

将设置入口由 `Sidebar` 内部弹出的绝对定位浮层（`SettingsPanel.tsx`）改为主内容区整体切换的独立设置页面，侧边栏保持可见，提供明确的关闭入口；所有现有功能（字体、主题、数据目录、备份配置）完整保留。

---

## 二、模块影响分析

| 模块/文件 | 变更类型 | 说明 |
|-----------|---------|------|
| `web/src/App.tsx` | 修改 | 新增 `view: 'editor' \| 'settings'` 状态；新增 `openSettings` / `closeSettings` 回调；修改 `<main>` 渲染逻辑；处理 Esc 快捷键；修改 `handleSelect` 在进入编辑器时关闭设置页 |
| `web/src/components/settings/SettingsPage.tsx` | 新增 | 设置独立页面组件，含左侧分类导航 + 右侧内容区 + 关闭按钮 |
| `web/src/components/settings/SettingsPage.css` | 新增 | 设置页样式 |
| `web/src/components/sidebar/Sidebar.tsx` | 修改 | 移除 `settingsOpen` state 和 `<SettingsPanel>` 渲染；将「设置」按钮 onClick 改为调用 `onOpenSettings` prop；接收 `settingsActive` prop 控制激活态 |
| `web/src/components/sidebar/Sidebar.css` | 修改 | 新增「设置」按钮激活态样式 |
| `web/src/components/settings/SettingsPanel.tsx` | 删除/废弃 | 原浮层逻辑不再需要；确认无其他引用后删除 |
| `web/src/components/settings/SettingsPanel.css` | 删除/废弃 | 同上 |

**模块边界判断：**
- `SettingsPage.tsx` 内部实现、CSS 样式：完全在新模块边界内，安全。
- `App.tsx` 新增 `view` 状态和回调：在 `App` 层扩展，未跨越现有模块边界，但需要向 `Sidebar` 传新 prop，属于接口变更，需协调。
- `Sidebar.tsx` Props 变更：Sidebar 对外接口扩展（新增 `onOpenSettings`、`settingsActive`），属于受控变更，向后兼容（TypeScript 强类型保障）。

---

## 三、功能分层设计

| 功能点 | 落层 | 理由 |
|--------|------|------|
| `view` 状态（editor/settings 切换） | 业务逻辑层（App.tsx） | 全局视图状态，控制两个模块的显示，不属于纯 UI |
| 分类导航选中状态 | UI 层（SettingsPage 内部） | 仅影响设置页内部渲染，不对外暴露 |
| 字体/主题切换逻辑 | 业务逻辑层（settingsStore + loadResource） | 已有实现，直接复用 |
| 数据目录/备份阈值表单状态 | UI 层（SettingsPage 内部） | 表单本地状态，提交前不持久化 |
| `/api/config` 调用 | API 层 | 与后端通信，保持在组件内部（复用现有 fetchConfig/saveConfig 函数） |
| Esc 快捷键监听 | 业务逻辑层（App.tsx） | 全局键盘事件，与视图状态联动 |
| 侧边栏激活态样式 | UI 层（Sidebar.tsx + Sidebar.css） | 纯渲染表现 |

---

## 四、状态管理设计

**新增/修改的状态：**

| 状态名 | 类型 | 归属组件/层 | 共享范围 | 说明 |
|--------|------|------------|---------|------|
| `view` | `'editor' \| 'settings'` | App.tsx | App + Sidebar + SettingsPage | 控制主内容区显示哪个视图 |
| `activeCategory` | `'appearance' \| 'data'` | SettingsPage（内部） | 仅 SettingsPage | 控制左侧导航选中 + 右侧内容渲染 |

**移除的状态：**
- `Sidebar.tsx` 中的 `settingsOpen: boolean` — 迁移至 App 层 `view` 状态

**状态通信方式：**
- [x] props 传递：`App` → `Sidebar`（`onOpenSettings`、`settingsActive`）；`App` → `SettingsPage`（`onClose`）
- [x] 回调函数：`Sidebar` → `App`（`onOpenSettings` 触发 `setView('settings')`）；`SettingsPage` → `App`（`onClose` 触发 `setView('editor')`）
- [ ] Context — 不新增，`fontId/themeId` 继续通过已有 `SettingsContext` 传递

---

## 五、数据流设计

```
[用户点击侧边栏「设置」按钮]
  │
  ▼
Sidebar.onOpenSettings()
  │
  ▼
App: setView('settings')
  │
  ▼
<main> 渲染 <SettingsPage onClose={closeSettings} />
  编辑器组件通过条件渲染隐藏（不卸载，保留 selectedPageId）

[用户点击关闭按钮 / Esc / 点击侧边栏页面]
  │
  ▼
closeSettings() / handleSelect()
  │
  ▼
App: setView('editor')
  │
  ▼
<main> 恢复渲染编辑器视图

[SettingsPage 内部：字体/主题切换]
  用户点击字体选项 → handleFont(id) → setFont(id)（SettingsContext）→ 即时生效

[SettingsPage 内部：数据&备份保存]
  用户修改表单 → 本地 state → 点击「保存」→ PUT /api/config → 更新 appConfig state
```

**API 调用策略：**
- 字体/主题：乐观更新（先更新 state，资源加载完成后确认），与原逻辑一致
- 数据&备份配置：显式触发（点击保存按钮），阻塞 UI（loading 状态）直到响应
- `/api/config` 读取：SettingsPage 挂载时一次性加载（useEffect on mount）

---

## 六、接口契约

**修改的组件 Props：**

```ts
// Sidebar.tsx — 新增两个 prop
interface SidebarProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;   // 新增：点击「设置」按钮时调用
  settingsActive: boolean;      // 新增：设置页是否激活（控制按钮高亮）
}

// SettingsPage.tsx — 新组件
interface SettingsPageProps {
  onClose: () => void;  // 关闭设置页
}
```

**App.tsx 新增状态和回调：**

```ts
const [view, setView] = useState<'editor' | 'settings'>('editor');
const openSettings = () => setView('settings');
const closeSettings = () => setView('editor');
```

**主内容区渲染逻辑变更（App.tsx）：**

```tsx
// 编辑器用 CSS 隐藏而非卸载，保留 selectedPageId 上下文
<main className="main">
  {view === 'settings' && <SettingsPage onClose={closeSettings} />}
  <div style={{ display: view === 'settings' ? 'none' : 'contents' }}>
    {/* 原有编辑器渲染逻辑保持不变 */}
  </div>
</main>
```

> 注意：编辑器必须用 `display:none` 隐藏而非条件渲染移除，否则 Editor 组件卸载会触发 flush，重置编辑器状态（违反场景 10 验收）。

---

## 七、可复用组件 / 公共逻辑识别

| 候选项 | 当前位置 | 复用场景 | 提取建议 |
|--------|---------|---------|---------|
| `fetchConfig` / `saveConfig` | `SettingsPanel.tsx` | `SettingsPage.tsx` 唯一使用 | 留原位（迁移到 SettingsPage，不单独提取） |
| `handleFont` / `handleTheme` 逻辑 | `SettingsPanel.tsx` | `SettingsPage.tsx` 唯一使用 | 留原位（迁移到 SettingsPage） |
| `formatBackupTime` | `SettingsPanel.tsx` | `SettingsPage.tsx` 唯一使用 | 留原位（迁移到 SettingsPage） |

**提取决策（架构师拍板）：**
- 不提取：所有逻辑仅在设置页单处使用，提取为独立文件会增加间接层而无收益；直接将代码从 `SettingsPanel.tsx` 迁移到 `SettingsPage.tsx` 即可。

---

## 八、方案对比

| 维度 | 方案 A：`display:none` 隐藏编辑器 | 方案 B：条件渲染（卸载编辑器） |
|------|----------------------------------|-------------------------------|
| 描述 | 编辑器始终挂载，进入设置时用 CSS 隐藏 | 仅在 `view === 'editor'` 时渲染编辑器 |
| 优点 | 保留编辑器内部状态（draft、光标位置）；不触发 Editor flush；回到编辑器无感知 | 实现更简洁；减少不必要的 DOM 节点 |
| 缺点 | 设置页打开时编辑器仍占内存 | 每次进出设置页都卸载/重新挂载 Editor；触发 flush 可能导致编辑内容丢失；场景 10 不通过 |
| 适用条件 | 场景 10「进出设置页不丢失编辑器上下文」严格验收时 | 编辑器无内部 draft 状态时 |
| 推荐 | ✅ | ❌ |

**推荐方案：方案 A（display:none 隐藏编辑器）**

**推荐理由：**
Editor 组件持有内部 draft 状态和 BlockNote 实例，卸载会导致 flush 写入并清空 draft，与场景 10 验收直接冲突。方案 A 是唯一能保证「进出设置页前后编辑器无异常」的实现方式。

---

## 九、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| `display:none` 下 Editor 仍响应某些事件（如键盘） | 低 | 中 | Esc 事件处理已判断 `document.activeElement` 是否为 INPUT/TEXTAREA，不额外影响 |
| Esc 快捷键与 Editor 内部快捷键冲突 | 中 | 低 | 需在 App.tsx 的 keydown handler 中判断：`view === 'settings'` 且 `activeElement` 非输入元素才触发 closeSettings |
| TypeScript 类型错误（Sidebar Props 扩展） | 低 | 低 | 同步修改 Sidebar Props 接口定义，T5 之前保持新旧 prop 兼容过渡 |
| SettingsPanel 删除后残留 import | 低 | 低 | T5 删除前确认 `Sidebar.tsx` 中 import 已移除 |

---

## 十、实现任务拆分

> 供研发负责人直接使用，每行对应一个委派任务。

| # | 任务描述 | 负责角色 | 涉及文件 | 依赖 | 可并行 |
|---|---------|---------|---------|------|--------|
| T1 | App 层视图状态管理：新增 `view` state、`openSettings`/`closeSettings` 回调；修改 `<main>` 区域渲染（编辑器 display:none 隐藏）；修改 `handleSelect` 在选中页面时关闭设置页；修改 Sidebar 调用传入新 props | 前端工程师 | `web/src/App.tsx` | 无 | ✅ |
| T2 | SettingsPage 组件骨架与分类导航：新建 SettingsPage.tsx 和 SettingsPage.css，包含左侧导航（外观/数据&备份）、右侧内容占位、右上角关闭按钮；接收 `onClose` prop | 前端工程师 | `web/src/components/settings/SettingsPage.tsx`（新建）、`web/src/components/settings/SettingsPage.css`（新建） | T1 | ❌ |
| T3 | 迁移 SettingsPanel 功能至 SettingsPage：将字体/主题/数据&备份所有功能从 SettingsPanel 迁移到 SettingsPage 对应分类区；复用 fetchConfig/saveConfig/handleFont/handleTheme 逻辑 | 前端工程师 | `web/src/components/settings/SettingsPage.tsx`（修改） | T2 | ❌ |
| T4 | 关闭逻辑与 Esc 快捷键：在 App.tsx 添加 keydown 监听，`key === 'Escape'` 且 `view === 'settings'` 且 `activeElement` 非 INPUT/TEXTAREA 时调用 closeSettings | 前端工程师 | `web/src/App.tsx`（修改） | T2 | ❌ |
| T5 | Sidebar 入口改造与激活态样式：将「设置」按钮 onClick 改为调用 `onOpenSettings`；接收 `settingsActive` prop 控制按钮激活态；移除 `settingsOpen` state 和 `<SettingsPanel>` 渲染及 import | 前端工程师 | `web/src/components/sidebar/Sidebar.tsx`（修改）、`web/src/components/sidebar/Sidebar.css`（修改） | T3 | ❌ |
| T6 | 清理旧代码与验收测试：确认 SettingsPanel 无其他引用后删除文件；对照场景矩阵全部 11 条逐一验收；构建无 TypeScript 错误 | 测试执行者 | `web/src/components/settings/SettingsPanel.tsx`（删除）、`web/src/components/settings/SettingsPanel.css`（删除） | T1–T5 全部完成 | ❌ |
