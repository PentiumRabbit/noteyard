# 架构评审：REQ-028 Database 块数据层

**评审人**: 总架构师
**评审日期**: 2026-04-30
**关联需求**: REQ-028
**状态**: ✅ 通过

---

## 一、模块影响分析

| 模块 | 影响类型 | 说明 |
|------|---------|------|
| `server/internal/model` | 新增 | 4 个新 struct：Database / DBColumn / DBRow / DBCell |
| `server/internal/repository` | 新增接口 | DatabaseRepository 接口，不修改已有接口 |
| `server/internal/repository/sqlite` | 新增实现 | database_repo.go + formula_eval.go，不修改已有文件 |
| `server/internal/handler` | 新增 | database_handler.go，不修改已有 handler |
| `server/cmd/main.go` | 小改 | 注册新路由，注入 DatabaseRepo |
| `001_init.sql` | 不改 | 新增独立 migration 文件 002_database.sql |

**结论**：完全向后兼容，不修改任何已有接口和表结构。

---

## 二、数据模型设计

### 表结构

```
blocks (已有)
  └─ id ──1:1──► databases
                    ├─ database_columns (列定义)
                    └─ database_rows    (行记录)
                         └─ database_cells (单元格值)
```

### 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| databases.id 与 blocks.id 共用 | 是 | 1:1 关系，避免额外 JOIN；block 删除时级联删除 database |
| cell 值统一存 TEXT | 是 | 读取时按列类型解释，避免多列类型字段；schema 变更成本低 |
| formula 结果不存储 | 是 | 派生值，存储会引入一致性问题；GET rows 时实时计算 |
| formula 表达式格式 | `{列名}` 占位符 | 直观，易于解析，与 Notion 习惯接近 |
| 循环引用检测 | 有向图 DFS | 列数通常 < 20，DFS 开销可忽略；写入时检测，不影响读取性能 |

---

## 三、API 设计

```
POST   /api/databases                          创建 database（关联 block）
GET    /api/databases/:id                      获取 database（含列定义）
DELETE /api/databases/:id                      删除 database（级联）

POST   /api/databases/:id/columns              添加列
PUT    /api/databases/:id/columns/:col_id      更新列定义
DELETE /api/databases/:id/columns/:col_id      删除列（级联删 cells）

POST   /api/databases/:id/rows                 添加行
DELETE /api/databases/:id/rows/:row_id         删除行（级联删 cells）
GET    /api/databases/:id/rows                 获取所有行（含计算后的 formula 值）
PATCH  /api/databases/:id/rows/:row_id/cells   批量更新单元格
```

---

## 四、风险与约束

| 风险 | 等级 | 处理方式 |
|------|------|---------|
| formula 循环引用 | 中 | 写入时 DFS 检测，返回 400 拒绝 |
| formula 除零 | 低 | evalExpr 检测，返回错误字符串而非崩溃 |
| formula 引用不存在列名 | 低 | 替换为 "0" 参与计算 |
| cell 值类型不匹配 | 低 | 服务端不做类型校验，由前端保证；后端统一存 TEXT |
| 大量行时 ListRows 性能 | 低（一期） | 一期无分页需求；行数预计 < 1000，可接受 |

---

## 五、不在本期范围

- 前端自定义块组件
- 排序 / 筛选 / 分组
- 关联列（Relation）
- 汇总列（Rollup）
- 分页查询

---

## 六、实现任务拆分

由研发负责人按角色分配，各角色独立 commit：

| # | 角色 | 交付物 |
|---|------|-------|
| 1 | 软件工程师-A | `002_database.sql` migration |
| 2 | 软件工程师-B | model 定义 + DatabaseRepository 接口 + sqlite 实现（含 formula 检测） |
| 3 | 软件工程师-C | database_handler.go + 路由注册 |
| 4 | 测试工程师 | curl 验证脚本，覆盖场景矩阵全部条目 |
