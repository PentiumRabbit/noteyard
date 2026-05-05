# noteyard 模块角色分配

> 版本: 1.1　更新日期: 2026-05-05　制定人: dev-lead

---

## 模块树

> **命名规则**：`{父模块}-{子模块}-…-{角色}-{编号}`，名字本身即上报链。
> 模块内角色（模块组长、模块架构师、模块工程师）由各模块组长按规范自行安排。

```
研发负责人: dev-lead
├── frontend                     （web/src/）
│     ├── frontend/editor        （web/src/components/editor）
│     ├── frontend/sidebar       （web/src/components/sidebar）
│     └── frontend/settings      （web/src/components/settings + stores/settings）
│
├── backend                      （server/internal/）
│     ├── backend/handler        （server/internal/handler）
│     └── backend/repository     （server/internal/repository）
│
└── tauri                        （src-tauri/）
```

---

## 递归终止条件

满足任一条，不再向下设子模块：
- 子模块单人可直接执行
- 子模块数 ≤ 1 个工程师可独立完成
- 用户明确指定不需要继续拆分

拆分上限（强制）：同一层级子模块数不得超过 6 个；超出须先归组再拆分

---

## 变更记录

| 日期 | 变更内容 | 裁决人 |
|------|---------|--------|
| 2026-05-05 | 初始制定 | dev-lead |
| 2026-05-05 | 简化：只划分模块树，角色由各模块组长自行安排 | dev-lead |
