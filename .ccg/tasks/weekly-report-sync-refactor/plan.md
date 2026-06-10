# 实施计划：周报数据来源调整 + 同步任务存储逻辑重构

## 需求

1. 周报本周工作从 Obsidian markdown 缓存获取已完成任务
2. 同步任务存储逻辑：projectName === executionName 或无 executionName 时，以 projectName 为文件夹，建同名 md 文件
3. 生成本周工作前先同步禅道

## 方案

采用 **方案 A（最小改动）** 作为第一阶段：
- 周报按钮先执行同步 → 缓存刷新 → 本周工作从缓存获取
- 下周工作继续从禅道 API 获取（第一阶段不改动）
- 添加 executionName 字段，抽取路径解析函数

## 步骤

### 1. src/zentao/mapper.ts — 添加 executionName 字段
- 在 ZentaoTask 接口添加 `executionName?: string`

### 2. src/zentao/client.ts — 获取 executionName
- 在 convertClassicTask 中添加 `executionName: raw.executionName ?? ""`

### 3. src/zentao/sync.ts — 修改存储路径逻辑
- 抽取 `resolveSyncTargetPath(task, folder)` 函数：
  - 若 executionName 缺失或 === projectName → `${folder}/${projectName}/${projectName}.md`
  - 否则 → `${folder}/${projectName}/${executionName}.md`
- 替换现有的 `${folder}/${safeName}.md` 逻辑

### 4. src/zentao/weekly-report.ts — 修改数据来源
- 新增参数接收 cache/app 用于获取本地任务
- 新增 `filterCompletedFromCache()` 函数：
  - 从缓存获取有 `[zentao::]` 标签的任务
  - 筛选 status=done/closed 且 completed 在本周范围
- 修改 generateWeeklyReport：
  - 本周工作从缓存获取
  - 下周工作仍从禅道 API

### 5. src/view.ts — 修改周报按钮逻辑
- 点击时先调用 syncZentaoTasks()
- 同步完成后触发缓存刷新
- 然后生成周报

## 影响范围

- 修改: mapper.ts, client.ts, sync.ts, weekly-report.ts, view.ts
- 新增: 无
- 测试: 需要手动测试周报生成流程

## 验收标准

1. 周报本周工作显示已完成任务（从 markdown 缓存读取）
2. 同步任务按 projectName 文件夹 + 同名 md 文件存储（当 projectName === executionName 或无 executionName）
3. 周报生成前自动同步禅道