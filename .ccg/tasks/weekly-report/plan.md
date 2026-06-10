# 实施计划：周报生成功能

## 需求

实现周报生成功能：
- 点击「生成周报」按钮生成 Markdown 文件
- 内容：本周完成任务 + 下周计划任务
- 文件命名：`{weeklyReportFolder}/{YYYY-MM-DD（第N周）}.md`
- 写入位置：`ZentaoSettings.weeklyReportFolder` 设置项已存在

## 方案

**选定方案 C**：先同步，再基于 Markdown 事实源生成周报

**理由**：
1. 最符合 "Markdown 是唯一事实源" 的架构原则
2. 复用现有同步链路，不侵入 sync.ts
3. 把风险集中在报告生成模块

**关键决策**：
- "本周完成"：`status=done/closed` 且 `finishedDate` 在本周范围
- "下周计划"：`status=wait/doing` 且 `deadline` 在下周范围（暂按截止日期）
- 生成前：不自动同步（用户需先手动同步）
- 文件存在：覆盖更新

## 步骤

### Step 1: 补齐配置缺口
- [src/zentao/types.ts] — 添加 `weeklyReportFolder: "WeeklyReports"` 到 `DEFAULT_ZENTAO_SETTINGS`

### Step 2: 新建周报生成模块
- [新增 src/zentao/weekly-report.ts] — 核心逻辑
  - `getWeekNumber(date: string): number` — 计算周数
  - `getWeeklyDateRange(weekStartsOn: 0|1): { thisWeek: DateRange, nextWeek: DateRange }`
  - `filterCompletedThisWeek(tasks: ZentaoTask[], thisWeek: DateRange): ZentaoTask[]`
  - `filterPlannedNextWeek(tasks: ZentaoTask[], nextWeek: DateRange): ZentaoTask[]`
  - `renderWeeklyReport(completed: ZentaoTask[], planned: ZentaoTask[], weekNum: number, weekStart: string): string`
  - `generateWeeklyReport(client, settings, app, mapperOpts): Promise<{ success, path?, error? }>`

### Step 3: 实现设置页方法
- [src/settings.ts] — 实现 `generateWeeklyReport()` 方法
  - 读取 ZentaoSettings
  - 创建 ZentaoClient（复用现有密码获取逻辑）
  - 拉取任务（复用 `fetchAllAssignedToMe`）
  - 调用 `generateWeeklyReport` 生成内容
  - 写入文件（复用 vault.process 模式）
  - 显示 Notice

### Step 4: 导入集成
- [src/settings.ts] — 在顶部添加 `import { generateWeeklyReport } from "./zentao/weekly-report"`

## 影响范围

- 修改: `src/settings.ts`, `src/zentao/types.ts`
- 新增: `src/zentao/weekly-report.ts`
- 测试: 新增 `test/zentao-weekly-report.test.mjs`

## 周报格式模板

```markdown
# 周报 {weekStart}（第{weekNum}周）

## 本周完成

{completed tasks as checkbox list, empty → "无"}

## 下周计划

{planned tasks as checkbox list, empty → "无"}

---
生成时间：{timestamp}
```