# Commits History

## 2026-06-10

### refactor(zentao): 周报项目名称去重——文件名与文件夹名相同时只保留文件名
- **Branch**: main
- **Files**: src/zentao/weekly-report.ts
- **Decisions**:
  - extractProjectNameFromPath 增加 folder/folder 去重逻辑
  - 当文件名与直接父文件夹名相同时，只返回文件名而非完整路径

### fix(zentao): 周报项目名称路径解析逻辑调整
- **Branch**: main
- **Files**: src/zentao/weekly-report.ts
- **Decisions**:
  - 从缓存获取下周工作任务
  - 项目名称格式: projectName/executionName，相同则只返回一个
  - 开头添加空行避免 YAML front matter 问题
  - 任务前后添加空行

### feat(zentao): 周报数据来源调整 + 同步任务存储重构
- **Branch**: main
