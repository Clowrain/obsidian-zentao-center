[根目录](../CLAUDE.md) > **test**

# test — 测试套件

## 模块职责

obsidian-zentao-center 的完整测试套件，分为单测（`.test.mjs`）和 e2e（`.e2e.ts`）两层。

## 测试结构

### 单测 (node --test, .mjs 格式)

位于 `test/` 根目录，直接运行编译后的 `main.js` 中的导出函数。

| 文件 | 覆盖模块 |
|------|----------|
| `parser.test.mjs` | `src/parser.ts` — 任务行解析、日期提取、tag/inline-field/priority/recurrence |
| `writer.test.mjs` | `src/writer.ts` — 写入操作（setScheduled, markDone, nestUnder, addTask, rebuildTaskLineWithNewTitle 等） |
| `cli.test.mjs` | `src/cli.ts` — CLI API 业务层（list/show/stats/brief/review/filterTasks） |
| `quickadd.test.mjs` | `src/quickadd.ts` — 自然语言 Quick Add 解析 |
| `cache.test.mjs` | `src/cache.ts` — TaskCache 增量更新、hash 索引、resolveRef |
| `task-tree.test.mjs` | `src/task-tree.ts` — EffectiveTask 派生、状态继承、终端级联 |
| `i18n.test.mjs` | `src/i18n.ts` — 国际化 |
| `dep-health.test.mjs` | `src/dep-health.ts` — 依赖健康检查 |
| `saved-views.test.mjs` | `src/saved-views.ts` — QueryPreset CRUD/验证 |
| `date-filter.test.mjs` | `src/date-filter.ts` — 日期过滤标签 |
| `time-filter.test.mjs` | `src/time-filter.ts` — 时间 token 匹配 |
| `layout.test.mjs` | `src/view/layout.ts` — 布局计算 |
| `filter-popover.test.mjs` | `src/view/filter-popover.ts` — 筛选弹窗逻辑 |
| `tags.test.mjs` | `src/tags.ts` — Markdown tag 提取/剥离 |
| `query-filter.test.mjs` | `src/query/filter.ts` — 查询过滤 |
| `query-projection.test.mjs` | `src/query/projection.ts` — 视图投影 |
| `query-summary.test.mjs` | `src/query/summary.ts` — 摘要计算 |
| `query-dsl.test.mjs` | `src/saved-views.ts` (DSL 解析部分) |
| `main-lifecycle.test.mjs` | `src/main.ts` — 插件生命周期 |
| `source-dialog-api.test.mjs` | `src/view/source-dialog.ts` |
| `source-open-state.test.mjs` | `src/view/source-open-state.ts` |
| `github-workflows.test.mjs` | `.github/workflows/` CI 配置验证 |
| `release-metadata.test.mjs` | `manifest.json` / `versions.json` 一致性 |
| `task32-daily-folder.test.mjs` | Daily Notes 文件夹解析 |
| `wdio-versions.test.mjs` | WebdriverIO 版本兼容性 |
| `wdio-local-guard.test.mjs` | 本地 e2e 运行守卫 |

### e2e (WebdriverIO, .ts 格式)

位于 `test/e2e/specs/`，在真实 Obsidian 实例中运行。

| 文件 | 覆盖范围 |
|------|----------|
| `board-basics.e2e.ts` | 看板基本渲染、tab 切换、状态更新 |
| `cli.e2e.ts` | CLI 命令执行 |
| `dataview-format.e2e.ts` | Dataview 格式兼容性 |
| `dep-health.e2e.ts` | 依赖健康检查 UI |
| `dep-tasks.e2e.ts` | 依赖任务 |
| `drag.e2e.ts` | 拖拽操作 |
| `ime.e2e.ts` | 输入法兼容性 |
| `mobile-coverage.e2e.ts` | 移动端覆盖 |
| `mobile-entry.e2e.ts` | 移动端入口 |
| `mobile-filter-ui.e2e.ts` | 移动端筛选 UI |
| `mobile-force-layout.e2e.ts` | 强制移动布局 |
| `parent-child.e2e.ts` | 父子任务 |
| `quickadd.e2e.ts` | Quick Add |
| `render-children.e2e.ts` | 子任务渲染 |
| `saved-views.e2e.ts` | 保存视图 |
| `settings-daily-folder.e2e.ts` | 设置 - Daily Notes 文件夹 |
| `source-edit-dialog.e2e.ts` | 源码编辑对话框 |
| `source-editor-spike.e2e.ts` | 源码编辑器探索 |
| `subtask.e2e.ts` | 子任务操作 |
| `today-view.e2e.ts` | Today 视图 |

### 测试基础设施

- `test/obsidian-stub.mjs` — Obsidian API 最小模拟（App, TFile, metadataCache 等）
- `test/e2e/vaults/` — e2e 测试 vault（`simple/` 目录包含测试 Markdown 文件）
- `wdio.conf.mts` — WebdriverIO 配置
- `wdio-local-guard.mts` / `wdio-versions.mts` — 本地运行守卫和版本检查

## 运行命令

- **单测**: `pnpm test` 或 `pnpm test:unit`
- **e2e**: `pnpm e2e`（需要先构建 `pnpm build`）
- **e2e CI**: `pnpm test:e2e:ci`（指定子集规格）

## 关键约定

- 单测使用 `import { ... } from "./main.js"` 直接导入 esbuild 产物
- `test/.compiled/` 被 `.gitignore` 忽略
- e2e 测试通过 `plugin.__forFlush()` 等待缓存和视图刷新完成（避免 DOM 轮询）
- e2e 测试通过 `plugin.__setTestForceMobile(true)` 在桌面 Chromium 上模拟移动端行为

## 相关文件清单

```
test/
  obsidian-stub.mjs           # Obsidian API 模拟
  parser.test.mjs             # 解析器测试
  writer.test.mjs             # 写入器测试
  cli.test.mjs                # CLI API 测试
  quickadd.test.mjs           # Quick Add 测试
  cache.test.mjs              # 缓存测试
  task-tree.test.mjs          # 任务树测试
  i18n.test.mjs               # 国际化测试
  dep-health.test.mjs         # 依赖健康测试
  saved-views.test.mjs        # 保存视图测试
  date-filter.test.mjs        # 日期过滤测试
  time-filter.test.mjs        # 时间过滤测试
  layout.test.mjs             # 布局测试
  filter-popover.test.mjs     # 筛选弹窗测试
  tags.test.mjs               # 标签测试
  query-filter.test.mjs       # 查询过滤测试
  query-projection.test.mjs   # 投影测试
  query-summary.test.mjs      # 摘要测试
  query-dsl.test.mjs          # DSL 测试
  main-lifecycle.test.mjs     # 生命周期测试
  source-dialog-api.test.mjs  # 源码编辑 API 测试
  source-open-state.test.mjs  # 源码状态测试
  github-workflows.test.mjs   # CI 配置测试
  release-metadata.test.mjs   # 发布元数据测试
  task32-daily-folder.test.mjs # Daily Notes 测试
  wdio-versions.test.mjs      # WDIO 版本测试
  wdio-local-guard.test.mjs   # 本地守卫测试
  e2e/
    specs/                    # e2e 测试规格 (21 个文件)
    vaults/                   # 测试 vault
```

## 变更记录 (Changelog)

- 2026-06-09: 初始生成
