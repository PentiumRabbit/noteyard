# Issues

## ISS-001: 切换页面时编辑内容丢失

| 字段 | 内容 |
|------|------|
| Issue ID | ISS-001 |
| 严重程度 | P1 |
| 状态 | 修复中 |
| 指派给 | 研发负责人 |

**标题**: 切换页面时编辑内容丢失，自动保存未可靠生效

**复现步骤**:
1. 创建页面 A，输入内容
2. 800ms 内切换到页面 B
3. 切回页面 A

**实际结果**: 页面 A 内容丢失

**预期结果**: 内容自动保存，切换后内容保留

**根因分析**:
1. `BatchUpdate` 只做 `UPDATE`，新建页面块从未 `INSERT`，`UPDATE` 找不到行，静默失败
2. 防抖 800ms timer 在页面切换时被 React unmount 丢弃，`save()` 从未执行
3. `beforeunload` 使用 `fetch`，浏览器卸载时异步请求被截断

**修复方案**:
1. 服务端 `BatchUpdate` 改为 `INSERT OR REPLACE`（upsert）
2. Editor unmount 时同步 flush 未保存内容
3. 防抖从 800ms 延长至 1s，更自然
4. 额外加 30s 定时兜底保存
5. `beforeunload` 改用 `sendBeacon`，不会被浏览器截断
6. App 层持有 flush ref，切换页面前主动调用
