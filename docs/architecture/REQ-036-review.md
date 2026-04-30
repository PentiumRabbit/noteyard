# REQ-036 架构评审 — 公式列功能增强

**需求**: 新增 P1 函数：IF、CONCAT、ROUND、ABS、NOT；支持嵌套；语法错误显示 `#ERROR`；函数名大小写不敏感；向后兼容
**评审日期**: 2026-04-30
**状态**: 待实现

---

## 一、现状分析

### 1.1 公式引擎分布

公式求值**同时存在于前后端**，两套引擎独立运行：

| 层 | 文件 | 求值时机 | 语法 |
|---|---|---|---|
| 后端 | `server/internal/repository/sqlite/formula_eval.go` + `database_repo.go` | `ListRows` API 响应时 | `{列名}` 占位符 + 四则运算 |
| 前端 | `web/src/components/database/DatabaseView.tsx` `evalFormula()` (L39-56) | 表格渲染时（客户端求值）+ 公式编辑实时预览 | `prop("列名")` 占位符 + `new Function()` 执行 JS 表达式 |

两套引擎**语法不统一**：后端用 `{列名}`，前端用 `prop("列名")`，表格展示实际走前端引擎，API 返回的 cells 中公式列的值由后端 `evalFormula` 填充（`database_repo.go` L195-203），前端再用自己的 `evalFormula` **覆盖渲染**（L588-591）。

### 1.2 后端公式引擎结构

`formula_eval.go` 是一个**手写递归下降解析器**，纯 Go，无第三方库：

```
evalExpr(expr string) → (float64, error)
  └── parser.parseExpr()      // 处理 +/-
        └── parser.parseTerm()    // 处理 *//
              └── parser.parseFactor()  // 处理括号、一元负号
                    └── parser.parseNumber()  // 读取浮点数
```

**限制**：
- 只能返回 `float64`，不支持字符串类型
- 不支持函数调用语法（无 identifier 解析）
- 不支持布尔值
- 错误时 `evalFormula` 返回原始表达式字符串（非 `#ERROR`）

### 1.3 前端公式引擎结构

`evalFormula()` (L39-56)：
1. 将 `prop("列名")` 替换为实际值（数字列用数值，其他列用双引号包裹的字符串）
2. 调用 `new Function("return (" + expr + ")")()` 执行任意 JS 表达式
3. 错误时返回 `"⚠"`（当前不是 `#ERROR`）

**问题**：
- `new Function` 等同于 `eval`，存在 XSS 注入风险（单元格内容注入）
- 与后端语法不一致，无法共用公式字符串
- `IF/CONCAT/ROUND/ABS/NOT` 在 JS 中有原生对应但大小写不敏感无法自动满足

### 1.4 循环引用检测

后端 `checkFormulaLoop`（`database_repo.go` L230-275）使用 DFS 检测有向图，但 `extractRefs` 用 `{...}` 正则提取引用，与前端 `prop("...")` 语法冲突——**循环引用检测对前端语法完全失效**。

---

## 二、核心问题诊断

| 问题 | 严重度 | 说明 |
|---|---|---|
| 前后端语法双轨 | 高 | `prop("x")` vs `{x}`，同一 formula 字符串两端解释不同 |
| 前端 new Function XSS | 高 | 任何单元格值都可注入 JS 代码 |
| 后端引擎只支持数值 | 高 | CONCAT/IF 需要字符串返回，架构需扩展 |
| 循环引用检测失效 | 中 | 后端检测针对 `{x}` 语法，前端实际用 `prop("x")` |
| 错误显示不统一 | 低 | 后端返回原始表达式，前端返回 `⚠`，需统一为 `#ERROR` |

---

## 三、扩展方案

### 3.1 策略选择

**推荐方案：统一前端求值，后端仅存储/透传**

原因：
- 公式结果已经由前端覆盖渲染，后端计算的值实际未被使用（前端重算覆盖）
- 前端实现新函数比后端更灵活，无需重启服务
- 消除双轨维护成本

**具体做法**：
1. 统一公式语法为 `prop("列名")` 语法（前端已用，用户侧已有）
2. 前端用**手写解析器**替换 `new Function`，消除 XSS
3. 后端 `evalFormula` 降级为 stub（直接返回空字符串），保留接口不改
4. 后端 `extractRefs` 改为解析 `prop("...")` 语法，修复循环引用检测

### 3.2 前端新解析器设计

新建 `web/src/components/database/formulaEngine.ts`，实现递归下降解析器：

```
parseExpr()         → +/-
  parseTerm()       → *//
    parseFactor()   → 一元运算、括号、函数调用、字符串字面量、数字字面量、prop引用
      parseCall()   → FUNCNAME( arg, arg, ... )
```

**值类型**：引入 `type FormulaValue = number | string | boolean`

**函数注册表**（大小写不敏感，通过 `name.toUpperCase()` 分发）：

| 函数 | 签名 | 返回类型 |
|---|---|---|
| `IF(cond, t, f)` | (bool/number, any, any) → any | 与分支一致 |
| `CONCAT(a, b, ...)` | (...any) → string | string |
| `ROUND(n, d?)` | (number, number?) → number | number |
| `ABS(n)` | (number) → number | number |
| `NOT(v)` | (any) → boolean | boolean |

**嵌套处理**：`parseCall` 递归调用 `parseExpr` 解析每个参数，天然支持任意深度嵌套，如 `IF(ABS(prop("x")) > 10, CONCAT("大:", prop("y")), "小")`。

**错误处理**：解析或求值任何异常统一 catch，返回 `"#ERROR"`（替换现有 `"⚠"`）。

### 3.3 后端改动（最小化）

**`formula_eval.go`**：保留文件，`evalExpr` 可保持不变（历史数据兼容），`evalFormula` 中对 formula 列改为返回空字符串（前端负责求值）。

**`database_repo.go`**：
- `extractRefs` 改用 `prop\("([^"]+)"\)` 正则，修复循环引用检测

**`sort_filter.go`**：公式列已被排除在排序/筛选之外（L486、L506 前端已过滤），后端无需改动。

---

## 四、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| 新解析器引入 bug 导致现有公式失效 | 中 | 高 | T01 先补充现有公式单测，T04 覆盖回归 |
| 前端解析器不支持旧有 `{列名}` 语法 | 低 | 中 | 后端语法历史上未对用户暴露（UI 用 `prop("...")`），无迁移问题 |
| IF 嵌套性能问题 | 低 | 低 | 纯前端 JS 运算，行数有限，可忽略 |
| 后端 evalFormula 返回空导致 API 消费方异常 | 低 | 中 | 确认无其他 API 消费方依赖公式计算结果后再改 |

---

## 五、任务拆分

| 编号 | 任务 | 文件 | 估时 |
|---|---|---|---|
| T01 | 补充 `formula_eval_test.go`，覆盖现有四则运算行为（回归基线） | `server/internal/repository/sqlite/` | 0.5d |
| T02 | 后端 `extractRefs` 改为 `prop("...")` 正则，修复循环引用检测 | `database_repo.go` | 0.5d |
| T03 | 新建 `web/src/components/database/formulaEngine.ts`，实现递归下降解析器 + 函数注册表（IF/CONCAT/ROUND/ABS/NOT + prop引用 + 字符串字面量 + 嵌套） | `formulaEngine.ts`（新文件） | 2d |
| T04 | 补充 `formulaEngine.test.ts`，覆盖：基础四则、五个新函数、嵌套、大小写不敏感、`#ERROR` | `formulaEngine.test.ts`（新文件） | 1d |
| T05 | `DatabaseView.tsx` 替换 `evalFormula`：调用新引擎，错误返回 `#ERROR`，更新预览样式 | `DatabaseView.tsx` | 0.5d |
| T06 | 后端 `evalFormula` 降级（可选，公式列返回空字符串），清理双轨 | `database_repo.go`、`formula_eval.go` | 0.5d |

**依赖顺序**：T01 → T02 → T03 → T04 → T05 → T06（T06 可延后）

---

## 六、附：公式语法示例（新引擎）

```
// 基础四则（向后兼容）
prop("价格") * prop("数量")

// 新函数
IF(prop("分数") >= 60, "及格", "不及格")
CONCAT(prop("姓"), prop("名"))
ROUND(prop("金额") / 3, 2)
ABS(prop("差值"))
IF(NOT(prop("已完成")), "待处理", "完成")

// 嵌套
IF(ABS(prop("误差")) > 0.1, CONCAT("偏差:", ROUND(prop("误差"), 2)), "正常")

// 大小写不敏感
if(prop("x") > 0, round(prop("y"), 1), abs(prop("z")))
```
