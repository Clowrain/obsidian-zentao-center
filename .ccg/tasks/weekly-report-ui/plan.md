# 实施计划：周报 UI 调整 + 格式重构

## 需求

### 需求 A：周报按钮位置
- 目标：Week 视图看板添加周报按钮
- 约束：仅在 Week 视图显示，禅道配置完整时才显示
- 设置页：移除生成周报按钮，保留周报目录配置

### 需求 B：周报格式调整
新格式：
```markdown
# 本周工作
## 项目名称1
### 任务名称1（周一 完成）
## 项目名称2 （周二 完成）
### 任务名称1（周一 完成）

# 下周工作
## 项目名称1 （周一 完成）
### 任务名称1（8h 周一）
### 任务名称2（2h 周二）
```

**关键规则**：
- 本周工作：项目标题显示该组任务的完成日期（取最晚）
- 下周工作：项目标题显示该组任务的截止日期（取最早）
- 任务行：本周显示（周几 完成），下周显示（工时 周几）

## 方案

**最小侵入式改造**：
1. UI：view.ts 工具栏添加按钮（仅 Week 视图）
2. 逻辑复用：提取共享生成入口
3. 格式重构：weekly-report.ts 添加分组层

## 步骤

### Step 1: 格式重构
- [src/zentao/weekly-report.ts] — 重构周报格式
  - 新增 `groupTasksByProject(tasks): Map<string, ZentaoTask[]>`
  - 新增 `formatWeekday(date: string, weekStartsOn): string` — 周一/周二...
  - 新增 `formatHours(hours: string): string` — 8h/2h
  - 重构 `renderWeeklyReport`：按项目分组 + 新格式输出
  - 本周工作：任务显示（周几 完成）
  - 下周工作：任务显示（工时 周几）

### Step 2: UI 添加按钮
- [src/view.ts] — Week 视图添加周报按钮
  - 在 `renderToolbar` 的 utility 区域添加按钮
  - 条件：`this.state.tab === "week"` && 禅道配置完整
  - 调用共享生成入口
  - 显示 Notice（成功/失败）

### Step 3: 移除设置页按钮
- [src/settings.ts] — 移除生成周报按钮
  - 移除第 449-459 行的按钮设置项
  - 保留周报目录配置（第 434-447 行）

### Step 4: 导入整合
- [src/view.ts] — 添加导入
  - `import { generateWeeklyReport } from "./zentao/weekly-report"`
  - `import { ZENTAO_PASSWORD_KEY } from "./zentao/types"`

## 影响范围

- 修改: src/view.ts, src/zentao/weekly-report.ts, src/settings.ts
- 测试: 新增 test/zentao-weekly-report.test.mjs 覆盖分组逻辑