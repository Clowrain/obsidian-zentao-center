[根目录](../../CLAUDE.md) > **src**

# src — 插件核心源码

## 模块职责

obsidian-zentao-center 的完整插件实现。基于 esbuild 打包为单个 `main.js`（CJS 格式，目标 ES2020），入口为 `src/main.ts`。

插件提供三大能力：
1. **可视化看板**（Today / Week / Month / Matrix / List 视图 + 父子任务渲染）
2. **自然语言 Quick Add**（解析自然语言创建任务）
3. **Obsidian CLI 处理器**（`task-center:list/show/add/done/drop/…` 等动词，需 Obsidian >= 1.12.2）

## 入口与启动

- **入口**: `main.ts` — `TaskCenterPlugin extends Plugin`
- **启动流程** (`onload`):
  1. 加载设置 (`loadSettings`)
  2. 初始化 `TaskCache`，绑定 vault/metadataCache 事件
  3. 注册视图 (`TaskCenterView`，类型 `task-center-board`)
  4. 注册命令面板命令 (open / quick-add / reload-tasks)
  5. 注册 CLI 处理器（条件：Obsidian >= 1.12.2）
  6. 初始化状态栏 (`StatusBar`) 和依赖健康检查 (`DepHealthBanner`)
  7. 可选：启动时自动打开看板 (`openOnStartup`)
- **关闭** (`onunload`): 释放 status-bar、dep-health、cache 资源

## 架构分层

| 层 | 文件 | 职责 |
|---|---|---|
| **插件入口** | `main.ts` | 生命周期、命令注册、CLI verb 路由 |
| **数据模型** | `types.ts` | `ParsedTask`, `TaskCenterSettings`, `QueryPreset` 等类型定义 |
| **解析器** | `parser.ts` | Markdown 行级解析（checkbox、emoji date、inline field、tag、priority、recurrence） |
| **写入器** | `writer.ts` | 原子写入操作（setScheduled, markDone, nestUnder, addTask 等），通过 `app.vault.process` 保证文件级原子性 |
| **缓存** | `cache.ts` | `TaskCache` — 全仓任务的单一数据源，基于 mtime 增量更新，path + hash 双索引 |
| **任务树** | `task-tree.ts` | `EffectiveTask` 派生（状态继承、日期继承、终端级联、独立日期子任务拆分） |
| **CLI API** | `cli.ts` | `TaskCenterApi` — 所有 CLI verb 的业务实现，list/show/stats/brief/review/add/done/drop/nest/rename/tag/schedule/deadline/estimate/actual/query-* |
| **查询引擎** | `query/filter.ts`, `query/projection.ts`, `query/summary.ts` | 纯函数：过滤器执行、视图投影（list/week/month/matrix）、摘要计算（count/sum/ratio/top_n/group_by） |
| **保存视图** | `saved-views.ts` | `QueryPreset` DSL 的 CRUD、验证、序列化，内置视图管理 |
| **视图** | `view.ts` | `TaskCenterView extends ItemView` — 看板主视图，5438 行，包含全部 UI 渲染逻辑 |
| **视图辅助** | `view/*.ts` | 拖拽驻留 (`dnd`)、手势 (`touch`)、底部弹出 (`bottom-sheet`)、撤销栈 (`undo`)、筛选弹窗 (`filter-popover`)、源码编辑 (`source-dialog`)、布局 (`layout`)、状态 (`state`)、查询DSL编辑器 (`query-dsl-modal`)、命名弹窗 (`saved-view-name-modal`) |
| **Quick Add** | `quickadd.ts` | `QuickAddModal` — 自然语言任务创建，支持 chip 预填、日期解析、tag 追加 |
| **日期工具** | `dates.ts` | ISO 日期操作（todayISO, addDays, shiftMonth, startOfWeek 等） |
| **时间过滤** | `time-filter.ts`, `date-filter.ts` | 时间 token 匹配 (today/tomorrow/week/month/overdue/range) 和日期显示标签格式化 |
| **i18n** | `i18n.ts` | 微型 i18n shim，基于 `obsidian.getLanguage()` 自动检测中英文 |
| **标签** | `tags.ts` | Markdown hashtag 提取/剥离，区分真实 tag 和 wikilink/block-ref |
| **分组** | `grouping.ts` | 分组标签标准化，CLI stats 中的 tag 前缀聚合 |
| **动画** | `anim.ts` | Web Animations API 卡片移除动画（fade + scale + collapse） |
| **平台** | `platform.ts` | `isMobileMode()` — 移动端检测 + e2e 测试强制切换钩子 |
| **状态栏** | `status-bar.ts` | 底部状态栏小组件，显示今日任务数和逾期数 |
| **依赖健康** | `dep-health.ts` | Daily Notes / task-format 依赖缺失告警 |
| **设置面板** | `settings.ts` | `TaskCenterSettingTab` — Obsidian 设置页 |
| **日期选择器** | `dateprompt.ts` | `DatePromptModal` — YYYY-MM-DD 或自然语言日期输入 |

## 关键依赖与配置

- **Obsidian API**: `obsidian` 模块（开发依赖 `^1.5.7`），external 不打包
- **构建工具**: esbuild (`esbuild.config.mjs`)，`pnpm dev` 启动 watch 模式
- **TypeScript 严格模式**: `strictNullChecks`, `noImplicitAny`, `strict` 全部开启
- **测试**: Node.js 内置测试运行器 (`node --test`)，`.mjs` 格式；e2e 使用 WebdriverIO + wdio-obsidian-service
- **Lint**: ESLint + eslint-plugin-obsidianmd + harness-lint (GritQL)

## 数据模型核心

- `ParsedTask` — 从 Markdown 行解析的原始任务数据（id = `path:Lnnn`，包含 status/tags/scheduled/deadline/estimate/actual/recurrence/priority 等）
- `EffectiveTask extends ParsedTask` — 派生视图（继承父级日期/状态，计算 effectiveScheduled/effectiveDeadline/effectiveStatus）
- `QueryPreset` — 保存查询 DSL 模型（filters + view + summary），取代旧版 `SavedTaskView`
- `TaskCenterSettings` — 插件设置（默认视图、周起始日、taskFormatFlavor、移动端配置等）

## 测试与质量

- **单测**: `test/*.test.mjs` — 覆盖 parser/writer/cli/quickadd/cache/task-tree/i18n/saved-views/date-filter/time-filter/layout/filter-popover 等
- **e2e**: `test/e2e/specs/*.e2e.ts` — 21 个规格文件，覆盖看板基础、CLI、拖拽、Quick Add、父子任务、移动端、源码编辑、Dataview 格式等
- **测试 stub**: `test/obsidian-stub.mjs` — Obsidian API 最小模拟
- **harness-lint**: `harness.toml` 配置，GritQL 规则驱动 LDD

## 常见问题 (FAQ)

- **为什么 view.ts 这么大（5400+ 行）?** 看板主视图包含全部 UI 渲染逻辑（Today/Week/Month/Matrix/List/Completed/Unscheduled 视图、拖拽、筛选器、Tab 管理、Quick Add 触发）。复杂度高是因为 Obsidian ItemView 要求命令式 DOM 操作。
- **cache.ts 为什么是唯一订阅 metadataCache 的模块？** 防止大 vault 事件洪泛（#1/#3 大 vault 回归）。所有其他模块通过 `cache.on("changed")` 消费数据。
- **writer.ts 的原子性保证？** 所有写入通过 `app.vault.process` 完成——文件级原子提交或全回滚。

## 相关文件清单

```
src/
  main.ts              # 插件入口 (1230 行)
  types.ts             # 类型定义 (263 行)
  parser.ts            # Markdown 任务解析器 (404 行)
  writer.ts            # 原子写入操作 (1009 行)
  cache.ts             # 任务缓存 (574 行)
  task-tree.ts         # EffectiveTask 派生
  cli.ts               # CLI API 业务层
  saved-views.ts       # QueryPreset CRUD
  view.ts              # 看板主视图 (5438 行)
  quickadd.ts          # Quick Add 模态框
  query/
    filter.ts          # 查询过滤执行
    projection.ts      # 视图投影
    summary.ts         # 摘要计算
  view/
    bottom-sheet.ts    # 移动端底部弹出
    dnd.ts             # 拖拽驻留追踪
    filter-popover.ts  # 筛选弹窗逻辑
    layout.ts          # 布局计算
    query-dsl-modal.ts # 查询 DSL 编辑器
    saved-view-name-modal.ts # 视图命名弹窗
    source-dialog.ts   # 源码编辑外壳
    source-open-state.ts # 源码打开状态
    state.ts           # ViewState 类型定义
    touch.ts           # 移动端手势
    undo.ts            # 撤销栈
  dates.ts             # 日期工具
  date-filter.ts       # 日期过滤标签
  time-filter.ts       # 时间 token 匹配
  i18n.ts              # 国际化
  tags.ts              # Markdown tag 处理
  grouping.ts          # 分组标签
  anim.ts              # 卡片动画
  platform.ts          # 平台检测
  status-bar.ts        # 状态栏组件
  dep-health.ts        # 依赖健康检查
  settings.ts          # 设置面板
  dateprompt.ts        # 日期输入模态框
```

## 变更记录 (Changelog)

- 2026-06-09: 初始生成
