# 测试报告：REQ-028 database 块数据层

**测试执行者**: test-engineer
**测试日期**: 2026-04-30
**测试环境**: localhost:8080，Go server + SQLite WAL
**结论**: ✅ 验收通过（修复 ISS-002 后）

---

## 测试用例执行结果

| ID | 场景 | 预期 | 实际 | 结果 |
|----|------|------|------|------|
| TC-01 | 创建 database（关联已有 block） | HTTP 201，返回 id | HTTP 201 | ✅ |
| TC-02 | 添加普通列（text/number） | HTTP 201，返回列 id | HTTP 201 | ✅ |
| TC-03 | 添加 formula 列（无循环引用） | HTTP 201 | HTTP 201 | ✅ |
| TC-04 | formula 自引用循环（应拒绝） | HTTP 400 | HTTP 400 | ✅ |
| TC-05 | formula 间接循环 A→B→A（应拒绝） | HTTP 400 | HTTP 400 | ✅ |
| TC-06 | 添加行 | HTTP 201，返回行 id | HTTP 201 | ✅ |
| TC-07 | 批量更新单元格（upsert） | HTTP 204 | HTTP 204 | ✅ |
| TC-08 | 查询行列表（含 formula 计算） | 小计=单价×数量=50 | 50 | ✅ |
| TC-09 | 获取 database（含列定义） | HTTP 200，columns 数量正确 | HTTP 200，5列 | ✅ |
| TC-10 | 更新列定义 | HTTP 200 | HTTP 200 | ✅ |
| TC-11 | 删除行（级联删 cells） | HTTP 204，行消失 | HTTP 204，rows=0 | ✅ |
| TC-12 | 删除列（级联删 cells） | HTTP 204 | HTTP 204 | ✅ |
| TC-13 | 删除 database（级联全部删除） | HTTP 204，GET 后 404 | HTTP 204 / 404 | ✅ |

---

## 发现问题

- **ISS-002**：formula 自引用循环检测漏洞（TC-04 初次失败）
  - 已修复，commit `a548ce8`，重测通过

---

## 结论

REQ-028 场景矩阵全部条目验收通过，ISS-002 已修复并回归。
可发出 N3。
