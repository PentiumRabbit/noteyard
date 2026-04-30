# STARTUP.md — AI 启动入口

启动时需在上下文中提供以下文件（支持自动加载则自动生效，否则手动提供）：

```
必须加载（按顺序）：
1. ai-pro/STARTUP.md                             ← 团队启动协议（角色、流程、委派规则）
2. ai-pro/docs/engineering/rules/all.md          ← 跨角色强制规则
3. ai-pro/docs/engineering/rules/{role}.md       ← 本角色专属规则（替换 {role}）
4. 本项目 PROJECT.md                             ← 项目约束

可选但推荐：
5. ai-pro/docs/engineering/DELEGATION.md         ← 委派流程细则
```

角色标签对照：`[lead]` `[pm]` `[arch]` `[rd]` `[eng]` `[te]` `[td]`  
规则文件位于：`ai-pro/docs/engineering/rules/{role}.md`
