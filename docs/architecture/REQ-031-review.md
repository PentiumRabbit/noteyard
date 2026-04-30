# 架构评审 — REQ-031 Formula 编辑器

**评审日期**: 2026-04-30
**评审人**: 总架构师
**结论**: ✅ 通过，无高风险项

---

## 模块影响分析

| 模块 | 影响 | 说明 |
|------|------|------|
| `DatabaseView.tsx` | 修改 | 列头菜单增加"编辑公式"入口；新增公式弹层组件 |
| `DatabaseView.css` | 修改 | 公式弹层样式 |
| 后端 | 无 | formula 字段已存在于 `DBColumn.formula`，`updateColumn` API 已支持 |
| `types/index.ts` | 无 | `DBColumn.formula: string` 已定义 |

---

## 实现方案

### 公式计算引擎（纯前端）

公式存储在 `DBColumn.formula`（字符串），渲染时对每行实时求值。

**求值流程**：
1. 将公式中所有 `prop("列名")` 替换为该行对应列的实际值（number 类型转为数值，其他转为字符串）
2. 用安全求值（`Function` 构造器白名单 or 自实现递归解析）计算结果
3. 计算异常时单元格显示 `⚠`

**安全求值**：使用 `new Function("return " + expr)()` 并 catch 异常。表达式已由 `prop()` 替换后只含数字字面量和运算符，无用户可控字符串拼接，风险可控。

### 公式弹层

- 触发：列头菜单 → "编辑公式 ƒ"
- 弹层内容：`<textarea>` 输入公式 + 可引用列 chip 列表（点击插入 `prop("列名")`）+ 预览区
- 预览：取第一行数据实时求值并展示
- 保存：调用 `api.databases.updateColumn`（更新 `formula` 字段），然后 `reload()`

### 状态管理

新增 `formulaPopover: { colId: string; x: number; y: number } | null` 状态，与现有 `colMenu` / `addColPopover` 模式一致，不引入新依赖。

---

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| `new Function` XSS | 低 | 公式经过 prop() 替换后只含数字和运算符；catch 所有异常 |
| 列名含特殊字符 | 低 | prop() 替换时做字符串 escape，只替换精确匹配 |
| 循环引用（formula 引用 formula） | 低 | 本期只替换非 formula 列，formula 列跳过 |

---

## 任务拆分

| Task | 负责 | 内容 |
|------|------|------|
| Task-01 | 前端工程师 | 公式求值函数 `evalFormula(formula, row, cols)` |
| Task-02 | 前端工程师 | 列头菜单增加"编辑公式"入口 + 公式弹层组件 |
| Task-03 | 前端工程师 | formula 单元格渲染改为实时求值 |
| Task-04 | CSS工程师 | 公式弹层样式（对齐 Notion formula editor） |
| Task-05 | TE | 验收：预览/保存/错误处理/循环引用跳过 |
