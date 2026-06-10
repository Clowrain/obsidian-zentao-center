# Commits History

## 2026-06-10

### feat(zentao): 周报数据来源调整 + 同步任务存储重构
- **Branch**: main
- **Files**: src/zentao/mapper.ts, src/zentao/client.ts, src/zentao/sync.ts, src/zentao/weekly-report.ts, src/view.ts
- **Decisions**:
  - 周报本周工作从 Obsidian 缓存获取已完成任务
  - 同步任务存储: projectName === executionName 或无 executionName 时写入 projectName/projectName.md
  - 添加 ZentaoTask.executionName 字段
