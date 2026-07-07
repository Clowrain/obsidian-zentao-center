# ARCHITECTURE

> 本文只描述 Zentao Center 如何支撑 [USER_STORIES.md](./USER_STORIES.md) 与 [UX.md](./UX.md)：数据模型、模块边界、读写路径、缓存、性能、测试与发布约束。
>
> 需求不在本文新增；实现不应绕过本文定义的对象模型。

## 0. 架构原则

1. **Markdown 是唯一事实源**：任务数据只存在于 vault 的 Markdown 行中；内存缓存、Query、summary、view 都是派生结果。（US-401）
2. **字节级写回**：改名、移动、嵌套、改期、完成、放弃都必须最小化改动目标行 / 目标块，保留未知 emoji、inline field、tag、block id、wikilink anchor 与用户原文。（US-407 / US-409）
3. **一份 Query DSL**：filters、view、summary、tab preset、GUI 可视化编辑、GUI DSL 直编、CLI query 管理共用同一份 schema 与校验。（US-109t / US-219）
4. **Tab 是持久 Query**：不存在独立持久化的“current query”。运行时只有 tab saved query、tab draft、effective query。（US-109u）
5. **View 不拥有业务集合**：list / week / month / matrix 只消费 Query 结果并提供对应操作；TODO、今日、未排期、已完成等都是 QueryPreset。（US-100 / US-109k）
6. **GUI 与 CLI 共用业务层**：解析、筛选、summary、写回、嵌套、QueryPreset CRUD 都必须通过同一服务层，不允许 CLI 和 GUI 各自实现。（US-201~219）
7. **缓存是唯一读入口**：状态栏、看板、CLI 不直接扫 vault；所有任务读取经 TaskCache。（US-404）
8. **事件增量优先**：文件变更只重解析该文件；打开看板 / list / stats / hash disambiguation 才允许显式全量 ensure。（US-404）
9. **移动端不是降级桌面**：业务语义共用，交互适配层分离；移动端没有拖拽、dwell、hover、快捷键。（US-501 / US-507）
10. **可测试纯逻辑优先**：解析、Query、继承、summary、writer plan、CLI formatter 都应是无 DOM 纯逻辑。

## 1. 核心数据模型

### 1.1 ParsedTask

`ParsedTask` 表示 Markdown 中一行任务及其派生信息。

```ts
type TaskStatus = "todo" | "done" | "dropped" | "in_progress" | "cancelled" | "custom";

interface ParsedTask {
  id: string;              // stable id: "path:L42"，展示使用 1-based line
  path: string;
  line: number;            // 0-based
  hash: string;            // 标题 + 路径派生的短 hash，用于行号漂移找回

  rawLine: string;         // 原始整行
  rawTitle: string;        // checkbox 后完整内容
  indent: string;          // 空白 + callout prefix
  marker: "-" | "+" | "*";
  checkbox: string;

  status: TaskStatus;
  title: string;           // 去掉 Obsidian Tasks token / tag / inline field 后的标题
  tags: string[];          // 合法 hashtag，字面保留，含 #

  scheduled: string | null; // ⏳ 或 [scheduled:: YYYY-MM-DD]；两者都有时 ⏳ 优先
  deadline: string | null;  // 📅
  start: string | null;     // 🛫
  completed: string | null; // ✅
  dropped: string | null;   // ❌
  created: string | null;   // ➕
  recurrence: string | null;// 🔁 原样片段
  priority: string | null;  // 🔺⏫🔼🔽⏬ 原样片段

  inlineFields: Record<string, string[]>;
  durationFields: Record<string, number>; // 可解析为分钟的 inline field

  parentLine: number | null;
  childrenLines: number[];
  calloutDepth: number;

  mtime: number;
}
```

解析器必须忽略空标题任务，例如只有 `- [ ]` 的行不进入 Zentao Center。（US-107）

### 1.2 EffectiveTask

继承、终态、独立日期子任务属于派生层，不写入 `ParsedTask` 本身。

```ts
interface EffectiveTask extends ParsedTask {
  effectiveStatus: TaskStatus;
  effectiveScheduled: string | null;
  effectiveDeadline: string | null;
  effectiveCreated: string | null;
  terminalInheritedFrom: string | null; // ancestor id
  renderParentId: string | null;        // 当前 view 上是否嵌在父卡里
  isTopLevelInQuery: boolean;
}
```

`deriveEffectiveTasks(tasks)` 负责：

- 子任务继承父级未定义属性。（US-144）
- 父终态使未完成子任务继承完成 / 放弃状态。（US-145 / US-144a）
- 父可见时隐藏重复顶层子任务。（US-143）
- 子任务有不同 `⏳` 时拆成对应日期上下文的独立顶层卡。（US-148 / US-149）

### 1.3 QueryPreset

```ts
type QueryViewType = "list" | "week" | "month" | "matrix";
type TaskStateFilter = "todo" | "done" | "dropped";

type DateToken =
  | "all"
  | "today"
  | "tomorrow"
  | "week"
  | "next-week"
  | "month"
  | "unscheduled"
  | `${number}-${number}-${number}`
  | `${string}..${string}`;

interface QueryFilters {
  search?: string;
  tags?: { values: string[]; mode: "and" | "or" };
  status?: TaskStateFilter[]; // undefined = 全部
  time?: {
    scheduled?: DateToken; // ⏳；unscheduled = is empty
    deadline?: DateToken | "overdue" | "next-7-days";
    completed?: DateToken;
    dropped?: DateToken;
    created?: DateToken;
  };
}

interface QuerySection {
  id: string;
  title: string;
  when: QueryFilters;
  orderBy?: string[];
  limit?: number;
  emptyText?: string;
}

interface QueryTray {
  enabled: boolean;
  title: string;
  filters: QueryFilters;
  orderBy?: string[];
}

interface MatrixAxis {
  id: string;
  title: string;
  buckets: MatrixBucket[];
}

interface MatrixBucket {
  id: string;
  title: string;
  when: QueryFilters;
}

interface QueryViewConfig {
  type: QueryViewType;
  sections?: QuerySection[];     // list / today preset
  tray?: QueryTray;              // week / month 附加未排期区
  orderBy?: string[];
  firstDayOfWeek?: "monday" | "sunday";
  monthDensity?: "compact" | "cards";
  matrix?: {
    x: MatrixAxis;
    y: MatrixAxis;
    unmatched: "show" | "hide";
    multiMatch: "first" | "duplicate";
    showEmptyBuckets: boolean;
  };
}

interface QuerySummaryMetric {
  id: string;
  type: "count" | "sum" | "ratio" | "top-n" | "group-by";
  field?: string;
  numerator?: string;
  denominator?: string;
  by?: "tag" | string;
  limit?: number;
}

interface QueryPreset {
  id: string;
  name: string;
  builtin: boolean;
  hidden: boolean;
  filters: QueryFilters;
  view: QueryViewConfig;
  summary: QuerySummaryMetric[];
}
```

Schema 约束：

- `filters / view / summary` 是一个对象的三个分区。
- 今日是 `view.type = "list"` + sections，不是新 view 类型。（US-720）
- 未排期 tray 是 `view.tray`，数据来源是单独 query，不改变主日期区集合。（US-109j）
- `unscheduled` 属于 `time.scheduled is empty`，不是日期范围 token。（US-109e）
- View 配置不能硬编码业务分类；section、axis、bucket 名称和条件来自 DSL。（US-109f / US-103a）

### 1.4 TabState 与 Settings

```ts
interface RuntimeTabState {
  activeTabId: string;
  draftByTabId: Record<string, Partial<QueryPreset>>;
  viewCursorByTabId: Record<string, {
    weekStart?: string;
    month?: string;
    scrollTop?: number;
    expanded?: string[];
  }>;
}

interface PluginSettings {
  openBoardOnStartup: boolean;
  defaultTabId: string;
  firstDayOfWeek: "monday" | "sunday";
  forceMobileLayout: boolean;
  queryPresets: QueryPreset[];
  hiddenBuiltinTabIds: string[];
  lastActiveTabId?: string;
  stampCreatedByDefault: boolean;
  taskFormatFlavor: "tasks" | "dataview";
  /** 任务源文件夹路径列表（相对于 vault 根）。空数组 = 读取整个 vault。（US-900） */
  taskSourceFolders: string[];
}
```

持久化设置必须兼容旧 `data.json` 字段；删除旧设置项时可忽略但不能导致启动失败。（US-118）

## 2. 模块边界

建议结构：

```text
src/
├─ parser.ts              # Markdown / Obsidian Tasks 行解析，纯函数
├─ task-tree.ts           # 父子关系、继承、独立日期子任务，纯函数
├─ query/
│  ├─ schema.ts           # QueryPreset 类型、默认预设、版本迁移
│  ├─ validate.ts         # GUI / CLI 共用校验
│  ├─ normalize.ts        # DSL 规范化、默认值填充
│  ├─ filter.ts           # filterTasks
│  ├─ summary.ts          # computeSummary
│  └─ presets.ts          # builtin preset factory
├─ cache.ts               # TaskCache，唯一 vault 读缓存
├─ writer.ts              # 单行 / 块级写回与 undo op plan
├─ api.ts                 # TaskCenterApi，GUI / CLI 共用业务入口
├─ cli.ts                 # CLI 参数解析与输出格式化
├─ view/
│  ├─ task-center-view.ts # ItemView 外壳
│  ├─ tabs.ts             # tab strip / menus
│  ├─ query-editor.ts     # 可视化 + DSL 编辑
│  ├─ filters.ts          # filter popovers
│  ├─ summary.ts          # summary render
│  ├─ views/list.ts
│  ├─ views/week.ts
│  ├─ views/month.ts
│  ├─ views/matrix.ts
│  ├─ card.ts
│  ├─ source-dialog.ts
│  ├─ dnd.ts
│  ├─ mobile-actions.ts
│  └─ undo.ts
├─ quickadd.ts
├─ status-bar.ts
├─ settings.ts
├─ deps.ts                # Daily Notes / task-format companion 依赖健康
├─ dates.ts
├─ i18n.ts
├─ styles.ts?             # 若需要 TS class 常量，不放颜色
└─ main.ts
```

### 2.1 依赖规则

| 模块 | 可以依赖 | 禁止依赖 |
| --- | --- | --- |
| parser | 标准库、Obsidian 类型定义 | App、DOM、cache、writer |
| task-tree | ParsedTask、日期工具 | DOM、App |
| query | ParsedTask / EffectiveTask、日期工具 | DOM、writer、view |
| cache | parser、Obsidian App/Vault/MetadataCache | view、writer、cli |
| writer | parser、dates、Obsidian Vault process | view、cache |
| api | cache、writer、query、task-tree、settings store | DOM |
| cli | api、formatter、i18n | view、DOM |
| view | api、i18n、Obsidian UI | parser 直接扫 vault |
| status-bar | api/cache readonly、deps、i18n | writer、view |
| settings | settings store、query presets、deps | task writer |

任何模块若需要“所有任务”，必须通过 `TaskCenterApi.list()` 或 `TaskCache.ensureAll()` 间接获得，不能自行 `app.vault.getMarkdownFiles()`。

## 3. 读取与缓存

### 3.1 TaskCache 职责

```ts
interface FileEntry {
  path: string;
  mtime: number;
  hasTaskListItem: boolean;
  tasks: ParsedTask[];
}

class TaskCache {
  ensureFile(path: string): Promise<FileEntry>;
  ensureAll(options?: { signal?: AbortSignal }): Promise<ParsedTask[]>;
  flatten(): ParsedTask[];
  invalidateFile(path: string): void;
  removeFile(path: string): void;
  renameFile(oldPath: string, newPath: string): void;
  resolveRef(ref: TaskRef): Promise<ParsedTask>;
  onChanged(cb: (change: CacheChange) => void): () => void;
}
```

缓存维护：

- `byPath: Map<string, FileEntry>`。
- `byHash: Map<string, ParsedTask[]>`。
- `flattenCache: ParsedTask[] | null`，文件变更后标脏。
- `pendingParseByPath` 防止同一文件并发重复解析。

### 3.2 事件路径

```text
Obsidian vault/metadata event
  → TaskCache.invalidateFile(path)
  → 单文件解析完成
  → 更新 byPath / byHash / flattenCache
  → emit cache.changed(paths)
  → status-bar / open views / tests 订阅刷新
```

只有 `cache.ts` 订阅原始 vault / metadata 事件。view、status-bar、CLI 不订阅 `metadataCache.on("resolved")`，也不直接重扫。（US-404）

事件策略：

| 事件 | 处理 |
| --- | --- |
| modify | eager 重解析该文件 |
| create | 如果是 markdown，解析该文件 |
| delete | 移除该 path 的缓存与 hash 索引 |
| rename | 更新 path；必要时重解析新文件 |
| metadata changed | 只 invalidate 对应文件 |

### 3.3 全量 ensure 的边界

允许触发 `ensureAll()` 的路径：

- 用户打开看板且当前 query 需要全集。
- CLI `list` / `stats`。
- hash ref 解析且当前 hash 索引无法证明唯一。
- Query 编辑器需要候选 tag / field 统计。

不允许触发 `ensureAll()` 的路径：

- 插件 onload。
- 状态栏首次渲染。
- 单个写命令的 `path:Lnnn` ref。
- 每次 metadata resolved。

大 vault 启动时状态栏可以在缓存未全量化前显示部分计数；打开看板后全量化并变准确。这是避免“启用插件即卡住”的设计取舍。（US-404）

### 3.4 文件筛选与并发

`ensureAll()` 遍历 markdown 文件时，执行两层筛选：

**路径筛选（US-414 / US-416）：**

- 若 `settings.taskSourceFolders` 为空数组：遍历整个 vault。
- 若配置了路径：只遍历路径匹配的文件。匹配规则：`file.path` 以任一配置路径开头（前缀匹配），例如配置 `["Projects"]` 后，`Projects/task.md` 和 `Projects/Sub/notes.md` 都匹配，但 `Archive/old.md` 不匹配。
- 路径匹配在 `app.vault.getMarkdownFiles()` 返回的文件列表上执行，先过滤再进入 metadata 检查。

**metadata 筛选（US-404）：**

- 已索引且明确没有 task list item：跳过。
- 未索引或未知：解析文件，不能当作无任务。
- 有 task list item：解析文件。

**配置变更后：**

- 路径配置变更后，`TaskCache` 标脏 `flattenCache` 并在下次读取时重扫。
- 不立即触发全量重扫；通过 `settings.onChanged` 回调标脏，避免配置页频繁修改导致卡顿。

解析并发限制为固定池（默认 16 或 32，可根据测试调整）。单文件解析失败只记录 warning 和 stats，不让整个 vault 空白。

## 4. Query 执行管线

### 4.1 主流程

```text
TaskCache.flatten()
  → parse-level ParsedTask[]
  → deriveEffectiveTasks()
  → applyQueryFilters(filters)
  → applyViewProjection(view)
  → computeSummary(summary)
  → render surface / CLI format
```

### 4.2 Filter 语义

`applyQueryFilters` 必须按用户故事实现：

- `search`：标题关键字匹配。
- `tags`：合法 hashtag，默认 AND。
- `status`：todo / done / dropped 多选；undefined 表示全部。
- `time.scheduled`：只看有效 `⏳`；`unscheduled` 表示有效排期为空。
- `time.deadline`：只看 `📅`；`overdue` 属于 deadline。
- `time.completed`：只看 `✅`。
- `time.dropped`：只看 `❌`。
- `time.created`：只看 `➕`。

所有日期比较都使用 ISO `YYYY-MM-DD` 规范化；显示层再按 locale 格式化。（US-411）

### 4.3 View Projection

View projection 不再筛选业务集合，只把 query 结果投影成渲染模型。

```ts
type ViewModel =
  | { type: "list"; sections: ListSectionModel[] }
  | { type: "week"; days: DayColumnModel[]; tray?: ListSectionModel }
  | { type: "month"; cells: MonthCellModel[]; tray?: ListSectionModel }
  | { type: "matrix"; buckets: MatrixCellModel[]; unmatched: EffectiveTask[] };
```

- List：按 sections 分组；无 sections 时使用一个默认 section。
- Week：按有效 `scheduled` 落入 7 天；无有效 scheduled 不进日期区，可进入 tray。移动端折叠状态只影响 day row body 可见性，不改变 day model。
- Month：按有效 `scheduled` 落入月历日期格；移动端只改变渲染密度，并把当前选中日期的任务列表作为月历下方内联 panel 渲染。
- Matrix：按用户配置 bucket 条件匹配；未命中进入 unmatched。

### 4.4 Summary

`computeSummary(tasks, metrics)` 对过滤后的集合计算：

- count。
- sum(field)：读取 `durationFields[field]` 或可解析的 inline field。
- ratio(numerator, denominator)。
- top-n(by)：tag 或用户字段。
- group-by(by)。

字段名是用户配置，不允许视图层硬编码 `estimate` / `actual` 分支；默认 preset 可以使用这些字段名作为配置值。（US-302 / US-303）

### 4.5 移动端布局适配层

View 层负责把同一份 Query / ViewModel 投射成桌面或移动端 DOM，不允许通过移动端分支改变任务集合、Query DSL 或写回语义。（US-109k / US-117）

移动端布局状态分两层：

- `data-mobile-layout="true"`：窄屏或用户强制移动布局，用于切换 tabs、toolbar、week/month/card/sheet 的移动端排版。
- `data-obsidian-mobile="true"`：真实 Obsidian Mobile 环境，用于额外预留 Obsidian 底部工具栏避让空间。窄屏桌面不能自动套用这层底部避让。

`BottomSheet` 是移动端复杂操作的共享 shell，但调用方可以传入语义 class，使 Query 编辑、父任务选择、日期选择、任务动作 sheet 使用不同高度和 footer 策略。sheet 只能承载视图适配和交互编排；筛选、summary、嵌套、写回仍调用既有 query / writer / api 路径。

父任务选择的候选数据来自已缓存的 EffectiveTask 集合和当前 DOM 可见任务 id。排序、搜索、禁用当前任务及后代都在 view 层完成；真正嵌套写回仍通过 `api.nest(childId, parentId)`。

## 5. 写路径

### 5.1 Writer 不变量

所有写操作走 `app.vault.process(file, mutate)`，保证单文件原子写。（US-403）

`writer.ts` 提供纯规划函数和执行函数：

- `setEmojiDate` / `clearEmojiDate`。
- `setCheckbox`。
- `addTag` / `removeTag`。
- `setInlineField`。
- `renameTaskLine`（CLI/API 用；GUI 标题编辑走源 Markdown 编辑层）。
- `planSameFileNest`。
- `planCrossFileNest`。
- `appendTaskToDailyNote`。
- `applyUndoOps`。

Writer 只修改目标 token：

- 改期只替换 / 插入 / 删除该行自己的 `⏳`。
- 清空排期只清空该行自己的 `⏳`，不改继承来源。
- 完成写 `[x]` 和 `✅ YYYY-MM-DD`。
- 放弃写 `[-]` 和 `❌ YYYY-MM-DD`。
- 同父级同日创建的子任务不重复写 `➕`。（US-146）

### 5.2 幂等与 before/after

每个写动词返回：

```ts
interface WriteResult {
  ok: true;
  unchanged: boolean;
  before: string[];
  after: string[];
  undoOps: UndoOp[];
}
```

如果目标状态已满足，返回 `unchanged: true`，不写文件；CLI 格式化为 `ok … unchanged`。（US-203 / US-204）

### 5.3 行号漂移与 ref 解析

```ts
type TaskRef =
  | { kind: "line"; path: string; line0: number }
  | { kind: "hash"; hash: string };
```

`resolveRef` 规则：

- `path:Lnnn`：先解析该文件并检查行号。
- 若行号不再是同一任务，尝试用 hash 找回；找回则返回 warn `out_of_date`。
- hash 多候选返回 `ambiguous_slug` + 候选列表，绝不猜。（US-208 / US-214）
- 找不到返回 `not_found`。

Writer 在 `vault.process` 内再次校验目标 rawLine，防止读取后被外部修改。

### 5.4 嵌套

GUI 拖拽嵌套与 CLI `nest ref=A under=B` 共用同一函数。（US-125 / US-228）

语义：

1. 解析被移动任务整棵子树。
2. 拒绝移动到自己或后代。（US-126）
3. 把子树物理移动到目标父任务所在位置。
4. 重新缩进为目标父级子任务。
5. 清空被移动 root 自己行的 `⏳`。
6. 保留所有子孙任务自己的 `⏳` / emoji / inline fields / tag / 原文。

跨文件没有真正事务。策略：先写 parent 文件，再写 child 文件。若第二步失败，宁可产生可见重复也不丢任务；返回 `nest_partial` 并提供可撤销 parent 插入的 undo op。

### 5.5 Quick Add 写入

Quick Add / CLI add 的默认路径由 Daily Notes 依赖解析：

```text
Daily Notes enabled + folder configured
  → today daily note path
  → append `- [ ] title ➕ YYYY-MM-DD [tokens...]`
```

Daily Notes 不可用时，add 失败并保留输入；不写 fallback 文件。（US-163 / US-701）

任务格式读取固定兼容 Tasks emoji 与 Dataview bracket inline fields：日期字段映射为 `⏳`/`[scheduled::]`、`📅`/`[due::]`、`🛫`/`[start::]`、`➕`/`[created::]`、`✅`/`[completion::]`、`❌`/`[cancelled::]`，并读取 `🔁`/`[repeat::]` 与 priority emoji / `[priority::]`。若同一字段两种格式并存，Tasks emoji 是有效来源。写回由 `settings.taskFormatFlavor` 决定：`tasks` 写 emoji 字段，`dataview` 写 bracket inline fields。`setScheduled` / `setDeadline` / `markDone` / `markDropped` / `addTask` 是格式敏感写入入口；写入某一字段前必须清理该字段的另一种语法，清空排期则同时清理 `⏳` 与 `[scheduled::]`，避免读取优先级导致旧日期继续生效。（US-111 / US-407 / US-409）

`stamp-created=true|false` 由 CLI 单次参数覆盖全局默认。（US-213）

## 6. Undo

```ts
interface UndoOp {
  path: string;
  line: number;
  before: string[];
  after: string[];
}

interface UndoEntry {
  label: string;
  ops: UndoOp[];
}
```

Undo 栈：

- 只属于看板 UI；CLI 写不入栈。
- 深度 20。
- 关闭 leaf / 重启后清空。
- 应用撤销前对目标区域做内容比对：当前文件中的 `after` 必须仍在原位置；否则拒绝撤销并提示内容已外部修改。

`Ctrl/Cmd+Z` 只在当前 active leaf 是 TaskCenterView 且 undo 栈非空时拦截；其它情况下交给 Obsidian 编辑器处理，避免破坏笔记编辑撤销。（US-128）

## 7. GUI 架构

### 7.1 TaskCenterView

`TaskCenterView` 负责：

- 读取 active tab id 与 draft。
- 调用 `api.evaluateQuery(tabId)` 得到 view model + summary。
- 渲染 Header、Tab Strip、Toolbar、Summary、View Body。
- 路由卡片 click、context menu、drag、mobile actions。
- 维护 per-tab view cursor：weekStart、month、scroll、expanded、mobile selected month day。
- 暴露测试属性 `data-test-cache-version`。

不允许 View 直接解析 vault 或手写 writer mutation。

### 7.2 Query Editor

Query Editor 操作 `draftByTabId[activeTabId]`：

```text
visual controls → update draft → validate → effective query → render preview
DSL editor     → parse/validate → update same draft → controls rehydrate
```

保存动作：

- `updateCurrentTab(tabId)`：覆盖 saved query。
- `saveAsNewTab(effectiveQuery, sourceTabId?)`：创建新 id；`sourceTabId` 只用于复制来源元数据或默认命名，不改变用户语义。
- `discardDraft(tabId)`：删除 draft。

不实现单独的 `saveTab()` / `saveCurrentQuery()` 用户动作。无来源 query 的首次保存也调用 `saveAsNewTab`，因为用户结果同样是“创建一个新的 Query Tab”。所有动作走 `QueryPresetService`，CLI query 动词调用同一个 service。

### 7.3 Source Markdown 编辑层

点击卡片调用：

```text
TaskCenterView.openSourceEditor(taskId)
  → api.resolveTask(taskId)
  → SourceDialog.open(task.path, task.line)
  → 使用 Obsidian 编辑器能力定位任务行
  → 文件保存 / modify event
  → cache invalidate
  → view refresh 后保持原 tab / filter / scroll
```

SourceDialog 不实现自己的 Markdown parser/writer，不用 textarea 冒充完整编辑体验。若 Obsidian public API 无法安全嵌入原生 MarkdownView，必须记录降级边界并保留后续修复任务；不能把只读 preview 当完成。（US-168f）

桌面端 `SourceDialog` 可以通过临时 `WorkspaceLeaf` 承载真实 `MarkdownView`。移动端不复用该 overlay：`TaskCenterView.openSourceEditShell()` 在移动布局下调用 Obsidian 官方 `WorkspaceLeaf.openFile()` 打开源文件，并在 `MarkdownView.editor` 上设置 cursor / scrollIntoView 定位任务行。这样移动端的键盘、安全区、编辑滚动和返回行为都交给 Obsidian 原生编辑器处理。（US-168g / US-506）

桌面端 `SourceDialog` 的”打开（新标签页）”动作先保存并释放 overlay 内的临时 `MarkdownView`，再通过 `workspace.getLeaf(“tab”).openFile(file, { active: true, eState: { line } })` 打开 Obsidian 原生 Markdown 标签页，并复用同一套 cursor / scrollIntoView 定位逻辑。该动作不恢复 Zentao Center leaf 焦点，因为用户已明确选择离开浮层进入原文标签页。（US-168h）

移动端 tag 编辑是视图层的差异化输入面板：从 `EffectiveTask.tags` 和当前任务集合推导当前 / 候选 tag，保存时对比初始集合，依次调用 `TaskCenterApi.tag(id, tag)` 或 `TaskCenterApi.tag(id, tag, true)`。写回仍由 writer 做字节级最小修改，不在视图层解析整行 Markdown。（US-506b / US-409）

移动端父任务选择器是视图层的差异化选择面板：候选来自当前 `TaskCache` 派生出的任务集合，按当前视图、同文件和搜索结果分组展示。选择器只返回目标父任务 id，不直接改 Markdown；确认后仍调用 `TaskCenterApi.nest(childId, parentId)`，由 writer 共用桌面 / CLI 的嵌套 planner，保证跨文件移动、清空被移动 root 自己 `⏳`、保留子孙字段和 undo 操作一致。（US-507b / US-125 / US-228）

旧入口必须删除：hover popover、dblclick 打开源文件、右键打开源文件、卡片 inline title input。（US-168d / US-161）

### 7.4 DnD Controller

`view/dnd.ts` 只负责桌面拖拽状态机：

- drag start threshold。
- drop target hit test。
- tab dwell。
- 落点优先级。
- 调用 API 写动作。
- 入 undo 栈。
- 动画 class 编排。

移动端不加载拖拽行为；移动端动作由 `mobile-actions.ts` 调用同一 API。（US-501 / US-507）

### 7.5 DOM 选择器契约

E2E 和 UI 自动化依赖稳定 `data-*`，不依赖 CSS 类名或文案：

| 选择器 | 含义 |
| --- | --- |
| `[data-task-id="path:Lnnn"]` | 卡片或子任务行 |
| `[data-tab-id="<query-id>"]` | Query tab |
| `[data-date="YYYY-MM-DD"]` | week 列 / month 日期格 |
| `[data-view="list|week|month|matrix"]` | view body |
| `[data-query-editor]` | Query 编辑器 |
| `[data-drop-zone="abandon"]` | 桌面放弃目标区 |
| `[data-drop-zone="unscheduled-tray"]` | 未排期 tray |
| `[data-card-action="open|done|drop|menu|reschedule-tomorrow"]` | 卡片动作 |
| `[data-parent-picker]` | 移动端父任务选择器 |
| `[data-parent-candidate-id="path:Lnnn"]` | 父任务候选行 |
| `[data-parent-confirm]` | 父任务选择确认按钮 |
| `[data-dep-warning="task-format-companion-missing|task-format-companion-disabled"]` | Tasks / Dataview companion 依赖警告 |
| `[data-test-cache-version="n"]` | cache 刷新版本 |

变更这些契约必须同步改 e2e。

## 8. CLI 架构

CLI 注册到 Obsidian CLI 命名空间，不提供独立二进制。（US-201）

根命令 `task-center` 只输出静态帮助文本，不读写 vault，不初始化额外状态。帮助文本必须覆盖任务动词、Query Tab 动词和 AI skill 安装命令。（US-201a / US-215）

### 8.1 Task 动词

Task 动词薄封装 `TaskCenterApi`：

- `list` / `stats`：显式 ensureAll。
- `done` / `drop` / `schedule` / `actual` / `nest`：按 ref 解析，单文件优先。
- `add`：走 Daily Notes append。
- `list parent=<id>`：resolve parent 后基于 task tree 输出子任务。（US-212）

输出格式由 `cli.ts` 统一处理，保证：

- 第一列稳定 id。
- 写操作 `ok / before / after`。
- 幂等 unchanged 仍为 ok。
- 错误 `error <code>` + 一句人话。

### 8.2 Query 动词

QueryPreset 动词调用 `QueryPresetService`：

- `query-list`：列出 id、name、builtin、hidden、default。
- `query-show id=<id>`：输出完整 DSL。
- `query-run id=<id> [view=list|week|month|matrix] [anchor=YYYY-MM-DD]`：执行 QueryPreset filters，计算 summary，并按 view projection 输出结果；`view` 只覆盖本次展示，不写回 preset。
- `query-create`：读取 DSL 创建 tab。
- `query-update id=<id>`：校验后覆盖。
- `query-rename` / `query-copy` / `query-hide` / `query-delete` / `query-set-default`。

删除自定义 tab 不删除任务；预设 tab 不允许永久删除，只允许隐藏 / 恢复。（US-216~219）

### 8.3 错误码

固定英文错误码至少包含：

```ts
type ErrorCode =
  | "not_found"
  | "ambiguous_slug"
  | "out_of_date"
  | "invalid_date"
  | "invalid_query"
  | "write_conflict"
  | "daily_notes_missing"
  | "daily_notes_folder_missing"
  | "invalid_nest"
  | "nest_partial";
```

错误码不翻译；后接人话跟随 Obsidian 语言。（US-211 / US-412）

## 9. 依赖健康

`deps.ts` 负责检测：

- Daily Notes 核心插件启用状态。
- Daily Notes folder 配置。
- task-format companion 安装 / 启用状态：Tasks 或 Dataview 任意一个启用即健康。

检测结果提供给：

- Header / 状态栏警告。
- Quick Add submit guard。
- CLI add guard。
- 设置页说明。

配置变化后，依赖状态自动刷新，不要求重启。（US-701c）

## 10. i18n 与日期

### 10.1 i18n

`i18n.ts` 提供：

```ts
t(key: string, vars?: Record<string, string | number>): string;
getLocale(): "zh-CN" | "en" | string;
onLocaleChanged(cb: () => void): () => void;
```

切换语言只触发 UI 重渲染，不重扫 vault；`ParsedTask` 不依赖 locale。（US-408）

禁止翻译：

- 用户 Markdown 字面。
- hashtag。
- inline field 字段名。
- Obsidian Tasks emoji 字段。
- CLI error code。

允许翻译：UI 文案、toast、设置项、错误人话、默认预设显示名。

### 10.2 日期

`dates.ts` 负责：

- ISO 写回：永远 `YYYY-MM-DD`。（US-411）
- locale 显示。
- 周一 / 周日起始日。
- token 解析：`today / tomorrow / yesterday / week / next-week / month / next-month / YYYY-MM-DD / FROM..TO`。
- 中文自然语言：今天、明天、昨天、周一至周日、本周、下周、本月、下月。（US-410）

无法识别日期时返回“无日期”，不猜测。

### 10.3 IME Guard

所有 Enter 提交输入框必须使用统一 helper：

```ts
function shouldSubmitEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" && !e.isComposing && e.keyCode !== 229;
}
```

适用：tab rename、Quick Add、DSL editor save、搜索 / filter 需要 Enter 的场景。（US-413）

## 11. 性能预算

| 场景 | 预算 | 策略 |
| --- | --- | --- |
| 插件 onload | 不触发全量扫描 | 创建空 cache，状态栏被动刷新 |
| 首次打开看板 | ≤ 1.5s 目标；超时显示 skeleton / 进度 | metadata 快速跳过 + 限并发解析 |
| 二次打开看板 | ≤ 200ms | flatten cache 命中 |
| 单文件修改后刷新 | ≤ 1s | 单文件 invalidate + debounce render |
| 桌面拖拽落定反馈 | ≤ 100ms 感知反馈 | 先视觉反馈，写入后 cache 刷新确认 |
| 移动端输入搜索 | debounce ≥100ms | 避免每键全量 render |

渲染约束：

- 父子查找使用 Map，不在 render 热路径中 `Array.find` 全表扫描。
- DataTransfer types 用 `.contains()`，不 `Array.from(...).includes()`。
- 移动端卡片设置 `touch-action: pan-y`。
- 移动端首屏不挂载桌面搜索输入和筛选控件；Query 编辑 bottom sheet 复用同一套 filter controls，避免双份状态。
- 移动端 toolbar、body、week row、card 的布局必须基于父容器宽度收缩，不依赖横向滚动承载主路径控件。
- 移动端 Query tab strip 是例外的横向 pan 区：设置横向 overflow、固定高度、隐藏纵向 overflow，并禁用 tab 拖拽 / dwell / 快捷键提示。
- 列表容器设置 `overscroll-behavior: contain`。
- CSS 禁止 `transition: all`。
- reduced motion 下动画时长 ≤ 50ms 但保留状态变化。

## 12. 样式架构

`styles.css` 只使用 Obsidian CSS 变量和插件自定义语义变量；不写硬编码颜色。

允许来源：

- `--background-primary` / `--background-secondary` / `--background-secondary-alt`
- `--background-modifier-border` / `--background-modifier-hover`
- `--interactive-accent`
- `--color-red` / `--color-yellow` / `--color-green`
- `--text-normal` / `--text-muted` / `--text-faint`
- `--shadow-s` / `--shadow-l`

TS 不写 inline 常量颜色。动画时长通过 CSS custom properties 管理，统一响应 `prefers-reduced-motion`。

## 13. 测试策略

### 13.1 单元测试

必须覆盖纯逻辑：

- parser：Obsidian Tasks 字段、tag、inline field、callout、空标题任务忽略。
- writer：字节级保留、emoji date、checkbox、inline field、tag、嵌套 plan、undo ops。
- task-tree：继承、父终态、独立日期子任务、顶层去重。
- query：filter、date token、view projection、summary、matrix bucket。
- dates：中英自然语言日期、周起始日、ISO 写回。
- cli formatter：ok / unchanged / before-after / error code。
- i18n：用户字面不翻译。
- **task-source-folders**：路径匹配规则（前缀匹配、空配置、多路径）、配置变更后标脏、CLI 只返回范围内任务。（US-900~907 / US-414）

### 13.2 集成测试

使用 fake App / fake Vault 覆盖：

- cache ensureAll 跳过无任务文件。
- 单文件 invalidate 只重解析目标文件。
- 写动作后 cache changed 时序。
- Quick Add Daily Notes guard。
- QueryPresetService GUI / CLI 共用 CRUD。
- 跨文件 nest 部分失败和 undo。
- path ref 不触发 ensureAll；hash disambiguation 可触发 ensureAll。
- **任务源文件夹路径过滤**：配置路径后 ensureAll 只解析匹配文件、配置变更后 flattenCache 标脏、文件移动到范围外后从缓存移除、移动回范围内后重新解析。（US-414）

### 13.3 E2E

E2E 覆盖 UX 主路径：

- Query Tab CRUD、更多、隐藏、恢复、默认 tab。
- Query 编辑器可视化 / DSL 往返。
- 今日三组、改到明天、空状态。
- Week / Month 未排期 tray 改期与清空。
- List / Matrix 配置渲染。
- 源 Markdown 编辑层定位、编辑、保存、刷新。
- Quick Add 成功 / Daily Notes 失败保留输入。
- 桌面拖拽改期、放弃、嵌套、非法目标、跨 tab dwell、undo。
- 移动端 week row、month inline day panel、swipe、任务详情 sheet、长按 action sheet、点选式日期 sheet、父任务选择器。
- CLI task 与 query 动词。
- i18n 热切换。

E2E 等待 cache 刷新时使用 `data-test-cache-version`，不使用固定 sleep。

## 14. 发布与 CI

发版要求来自 US-601~605：

- 严格 semver tag，不带 `v`，不带 pre-release。
- pre-flight gate：typecheck、lint、unit test、e2e。
- 每次发版更新 `versions.json`。
- Release body 从 PR / issue 标题按 conventional 前缀分组生成，可手动覆写。
- Release asset 挂 `main.js`、`manifest.json`、`styles.css`；禁止 build 产物 commit 回 main。
- Release job 在上传 asset 前为 `main.js`、`manifest.json`、`styles.css` 生成 GitHub artifact attestation；workflow 需要 `id-token: write` 与 `attestations: write` 权限。

CI 额外建议检查：

- 非 cache 模块不直接 `getMarkdownFiles()` 全量扫。
- 无 `metadataCache.on("resolved")` 新订阅。
- 视图 / 业务路径无硬编码示例 tag 或方法论字面。
- CSS 无硬编码颜色、无 `transition: all`。
- i18n 字符串不包含示例 hashtag / inline field 语法。

## 15. 禅道任务集成

### 15.1 架构定位

禅道集成是**外部数据导入通道**，不改变核心架构原则。导入后的任务与手动创建的任务完全等价，受同一份 Query DSL、同一套 View、同一个 Writer 管理。

关键约束：

1. **不引入新数据源**：禅道任务导入后转为标准 Markdown 任务行，此后与 Obsidian 原生任务无区别。（US-813）
2. **不改变缓存架构**：导入通过 `writer.ts` 写入文件，触发正常的 vault modify → cache invalidate 链路。（US-818）
3. **不引入后台常驻**：无定时器、无轮询。用户点击按钮触发一次性同步。（US-809）
4. **可测试纯逻辑优先**：API 客户端、映射、同步、加密均为无 DOM 纯逻辑，可独立单测。

### 15.2 新增模块

```text
src/
├─ zentao/
│  ├─ crypto.ts        # AES-256-GCM 加密/解密（US-802 / US-821）
│  ├─ client.ts        # 禅道 HTTP 客户端：认证、项目/执行列表、任务拉取（US-801~806）
│  ├─ mapper.ts        # 禅道任务 → Obsidian 任务行映射（US-813~815）
│  └─ sync.ts          # 同步编排：去重、增量、写入（US-816~818）
├─ settings.ts         # 扩展：禅道连接配置区（US-801~808）
├─ view.ts             # 扩展：工具栏加载按钮（US-809~812）
├─ types.ts            # 扩展：ZentaoSettings 类型
└─ i18n.ts             # 扩展：禅道相关文案
```

### 15.3 数据模型扩展

#### 15.3.1 ZentaoSettings

```ts
interface ZentaoSettings {
  /** 禅道服务器地址，如 https://zentao.example.com */
  serverUrl: string;
  /** AES-256-GCM 加密后的密码（base64） */
  encryptedPassword: string;
  /** 加密 IV（base64），每次加密随机生成 */
  encryptionIv: string;
  /** 禅道账号 */
  account: string;
  /** 同步模式：手动选执行 / 全部指派给我 */
  syncMode: "manual" | "assignedtome";
  /** 手动模式选中的执行 ID 列表 */
  selectedExecutionIds: number[];
  /** 同步目标：daily-note 或指定文件路径 */
  syncTarget: "daily-note" | "specified-file";
  /** 指定文件模式的 vault 相对路径 */
  specifiedFilePath: string;
  /** 执行列表缓存（避免每次打开设置都请求） */
  executionListCache: ZentaoExecution[] | null;
  /** 执行列表缓存时间戳 */
  executionListCacheTime: number | null;
}
```

`ZentaoSettings` 嵌入 `PluginSettings`：

```ts
interface PluginSettings {
  // ... 现有字段 ...
  zentao: ZentaoSettings | null; // null = 未配置禅道
}
```

#### 15.3.2 禅道 API 响应类型

```ts
/** POST /tokens 响应 */
interface ZentaoTokenResponse {
  token: string;
}

/** 执行（迭代/Sprint）摘要 */
interface ZentaoExecution {
  id: number;
  project: number;
  name: string;
  status: string;   // wait | doing | suspended | closed
  begin: string;    // YYYY-MM-DD
  end: string;      // YYYY-MM-DD
}

/** 任务详情（v1 /v2 共用字段子集） */
interface ZentaoTask {
  id: number;
  project: number;
  execution: number;
  parent: number;
  name: string;
  type: string;       // devel | design | test | study | discuss | ui | affair | misc
  pri: number;        // 1~4
  status: string;     // wait | doing | done | closed | cancel
  deadline: string;   // YYYY-MM-DD 或空
  estStarted: string; // YYYY-MM-DD 或空
  estimate: string;   // 浮点数字符串，小时
  consumed: string;   // 浮点数字符串，小时
  left: string;
  desc: string;
  assignedTo: string; // 用户账号
  openedBy: string;
  openedDate: string;
  finishedBy: string;
  finishedDate: string;
}
```

### 15.4 加密方案

`zentao/crypto.ts` 负责 AES-256-GCM 加密/解密：

```ts
// 加密 key 派生：固定种子 + vault 路径 → SHA-256 → 256-bit key
async function deriveKey(vaultPath: string): Promise<CryptoKey>;

// 加密：明文密码 → base64(IV + ciphertext + authTag)
async function encrypt(plaintext: string, vaultPath: string): Promise<{ encrypted: string; iv: string }>;

// 解密：base64 → 明文密码
async function decrypt(encrypted: string, iv: string, vaultPath: string): Promise<string>;
```

实现约束：

- 使用 `crypto.subtle`（Obsidian 内置 Chromium/Node 均支持）。
- IV 每次 `crypto.getRandomValues(new Uint8Array(12))` 随机生成，与密文一起存储。
- 固定种子硬编码在插件代码中。虽然插件开源导致 key 可提取，但阻止 `data.json` 明文泄露。（US-821）
- `crypto.subtle` 不可用时（极端环境），降级为不存储密码，每次同步时弹出输入框。

### 15.5 HTTP 客户端

`zentao/client.ts` 封装所有禅道 API 调用：

```ts
class ZentaoClient {
  private token: string | null = null;

  constructor(private serverUrl: string, private account: string, private getPassword: () => Promise<string>) {}

  /** 登录获取 token；成功则缓存到 this.token */
  async login(): Promise<string>;

  /** 确保有有效 token；过期自动重登 */
  async ensureToken(): Promise<string>;

  /** GET /v1/projects */
  async getProjects(): Promise<ZentaoProject[]>;

  /** GET /v1/executions?project={id} 或遍历所有项目 */
  async getExecutions(projectId?: number): Promise<ZentaoExecution[]>;

  /** GET /v1/executions/{id}/tasks?status=assignedtome&recPerPage=1000 */
  async getExecutionTasks(executionId: number, status?: string): Promise<ZentaoTask[]>;

  /** 拉取指定执行列表中指派给我的所有任务 */
  async fetchAssignedToMeTasks(executionIds: number[]): Promise<ZentaoTask[]>;

  /** 拉取所有活跃执行中指派给我的任务（syncMode=assignedtome） */
  async fetchAllAssignedToMe(): Promise<ZentaoTask[]>;
}
```

实现约束：

- 使用 Obsidian `requestUrl`（`{method, url, headers, body, contentType}`），不使用 `fetch`。（Obsidian 插件标准做法，绕过 CORS）
- 请求超时 15 秒。（US-825）
- 401 自动重登一次；重登仍失败则抛出 `ZentaoAuthError`。（US-804）
- 所有网络错误包装为 `ZentaoNetworkError` / `ZentaoApiError`，不暴露原始异常。
- API URL 拼接：`{serverUrl}/api.php/v1/{path}`。v1 API 在开源版 ≥16.5 可用。（调研结论）

### 15.6 任务映射

`zentao/mapper.ts` 纯函数，禅道任务 → Obsidian 任务行字符串：

```ts
interface MapperOptions {
  taskFormatFlavor: "tasks" | "dataview";
}

/** 将禅道任务映射为 Obsidian 任务行 */
function mapZentaoTask(task: ZentaoTask, options: MapperOptions): string;

/** 从已有 Obsidian 任务行提取禅道任务 ID（用于去重） */
function extractZentaoId(line: string): number | null;

/** 比较禅道任务与已有 Obsidian 任务行是否有变更 */
function hasTaskChanged(zentaoTask: ZentaoTask, obsidianLine: string, options: MapperOptions): boolean;
```

映射规则（US-813）：

| 禅道字段 | Tasks flavor | Dataview flavor |
|---------|-------------|-----------------|
| `name` | 标题文本 | 标题文本 |
| `deadline`（非空） | `📅 YYYY-MM-DD` | `[due:: YYYY-MM-DD]` |
| `estStarted`（非空） | `🛫 YYYY-MM-DD` | `[start:: YYYY-MM-DD]` |
| `pri=1` | `⏫` | `[priority:: high]` |
| `pri=2` | `🔼` | `[priority:: medium]` |
| `pri=3` | `🔽` | `[priority:: low]` |
| `pri=4` | `⏬` | `[priority:: lowest]` |
| `estimate`（非零） | `[estimate:: Nh]` | `[estimate:: Nh]` |
| `consumed`（非零） | `[actual:: Nh]` | `[actual:: Nh]` |
| `id` | `[zentao:: {id}]` | `[zentao:: {id}]` |
| `type`（非空） | `#zentao-{type}` | `#zentao-{type}` |
| `status=done/closed` | `- [x] ✅ finishedDate` | `- [x] [completion:: finishedDate]` |
| `status=cancel` | `- [-] ❌ closedDate` | `- [-] [cancelled:: closedDate]` |

工时字段转换：禅道存储为小时浮点数，映射为 `Nh` 或 `NMm` 格式（与现有 `durationFields` 解析规则一致）。

### 15.7 同步编排

`zentao/sync.ts` 负责完整的同步流程：

```ts
interface SyncResult {
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/** 执行一次完整的禅道同步 */
async function syncZentaoTasks(
  client: ZentaoClient,
  settings: ZentaoSettings,
  vault: Vault,
  mapperOpts: MapperOptions,
  dateRange?: { start: string; end: string },  // YYYY-MM-DD
): Promise<SyncResult>;
```

同步流程：

```text
1. client.ensureToken()
2. 根据 syncMode 拉取任务：
   - manual: client.fetchAssignedToMeTasks(selectedExecutionIds)
   - assignedtome: client.fetchAllAssignedToMe()
3. 如果有 dateRange，客户端过滤 deadline ∈ [start..end]
4. 确定写入目标文件：
   - daily-note: 当天 Daily Note 路径
   - specified-file: specifiedFilePath
5. 读取目标文件已有任务行，构建 zentaoId → {line, rawLine} 索引
6. 遍历禅道任务：
   a. zentaoId 已存在且无变更 → skipped++
   b. zentaoId 已存在且有变更 → 替换该行 → updated++
   c. zentaoId 不存在 → 文件尾追加 → added++
7. 通过 vault.process 原子写入
8. 返回 SyncResult
```

去重依据：目标文件中含 `[zentao:: {id}]` 的行。（US-816）

写入约束：

- 每个文件的写入走 `vault.process`，与现有 writer 一致。（US-818）
- 不删除已有任务行。禅道侧不再返回的任务保留在 Obsidian 中。（US-817）
- Daily Notes 不可用时，daily-note 模式报错并跳过，不写 fallback。（与 US-701 一致）

### 15.8 日期范围计算

看板加载按钮根据当前 Query Tab 类型计算截止日期范围：（US-810）

```ts
function getDateRangeForTab(tabId: string, presets: QueryPreset[]): { start: string; end: string } | null {
  // 今日 tab: deadline == today
  // 本周 tab: deadline ∈ [monday..sunday]
  // 本月 tab: deadline ∈ [month_start..month_end]
  // 其它: null（不限制日期范围）
}
```

使用 `dates.ts` 现有的 `todayISO`、`startOfWeek`、`addDays`、`shiftMonth` 等函数，不引入新日期逻辑。

### 15.9 与现有模块的集成点

| 现有模块 | 修改内容 | 影响范围 |
|---------|---------|---------|
| `types.ts` | 新增 `ZentaoSettings` 到 `PluginSettings` | 类型扩展，向后兼容 |
| `settings.ts` | 新增禅道连接配置区 | 纯 UI 新增，不影响现有设置 |
| `view.ts` | 工具栏新增加载按钮 | 按钮渲染 + 点击处理，不影响现有渲染逻辑 |
| `main.ts` | `onload` 中初始化 `ZentaoClient`（条件：配置完整时） | 可选初始化，不影响现有启动流程 |
| `writer.ts` | 不修改。同步模块直接使用 `vault.process` | 无侵入 |
| `cache.ts` | 不修改。写入触发正常 vault modify → cache invalidate | 无侵入 |
| `i18n.ts` | 新增禅道相关文案 | 纯数据新增 |

依赖规则：

| 新模块 | 可以依赖 | 禁止依赖 |
|-------|---------|---------|
| `zentao/crypto.ts` | 标准 `crypto.subtle` | Obsidian App、DOM |
| `zentao/client.ts` | `requestUrl`、crypto（仅 `getPassword` 回调） | DOM、cache、writer |
| `zentao/mapper.ts` | 纯函数，仅依赖类型定义 | Obsidian API、DOM |
| `zentao/sync.ts` | client、mapper、`vault.process` | view、cache 直接读取 |

### 15.10 错误体系

```ts
class ZentaoError extends Error {
  constructor(message: string, public code: ZentaoErrorCode) { super(message); }
}

type ZentaoErrorCode =
  | "network_error"       // 网络不可达 / 超时
  | "auth_failed"         // 账号密码错误
  | "token_expired"       // token 过期且重登失败
  | "api_error"           // 禅道返回非 2xx
  | "write_failed"        // 文件写入失败
  | "not_configured"      // 禅道未配置
  | "daily_notes_missing" // Daily Notes 不可用
  ;
```

所有错误在 UI 层通过 `Notice` 展示用户友好的中文消息。错误码用于内部判断（如 `token_expired` 触发重登），不暴露给用户。（US-824）

### 15.11 测试策略

#### 单元测试

新增 `test/zentao-crypto.test.mjs`、`test/zentao-mapper.test.mjs`、`test/zentao-sync.test.mjs`：

| 测试文件 | 覆盖内容 |
|---------|---------|
| `zentao-crypto.test.mjs` | 加密→解密往返、不同 vault 路径产生不同 key、空字符串、特殊字符 |
| `zentao-mapper.test.mjs` | 所有字段映射、Tasks/Dataview flavor 双路径、空值处理、工时转换、状态映射、`extractZentaoId`、`hasTaskChanged` |
| `zentao-sync.test.mjs` | 去重逻辑、增量更新、日期范围过滤、Daily Notes 不可用报错、写入原子性（mock vault.process） |

#### 集成测试

- `ZentaoClient` 使用 mock HTTP 响应测试登录、token 过期重登、错误处理。
- 完整同步流程使用 fake vault 测试端到端：拉取 → 映射 → 去重 → 写入 → 结果。

#### 不做 E2E

禅道集成涉及外部 API，E2e 无法在 CI 中稳定测试真实禅道服务器。通过单测 + 集成测试覆盖所有路径。

### 15.12 禅道集成的实现不变量

- [ ] 禅道配置为 `null` 时，不显示加载按钮，不初始化 client。
- [ ] 密码不以明文存入 `data.json`。
- [ ] 导入任务遵守 `taskFormatFlavor` 设置。
- [ ] 每个文件写入走 `vault.process`。
- [ ] 不删除已有任务行。
- [ ] 去重依据为 `[zentao:: {id}]` inline field。
- [ ] API 调用使用 `requestUrl`，不使用 `fetch`。
- [ ] 网络请求超时 15 秒。
- [ ] 401 自动重登最多一次，不无限循环。
- [ ] Daily Notes 不可用时 daily-note 模式报错，不写 fallback。
- [ ] 同步是同步阻塞的，但 UI 不阻塞（调用方在 async 上下文中使用）。
- [ ] `zentao/` 下模块均为可测试纯逻辑。

## 16. 实现不变量清单

每次实现或重构至少检查：

- [ ] Markdown 任务格式兼容 Obsidian Tasks 字段。
- [ ] 空标题任务不进入 Zentao Center。
- [ ] 未识别 token 字节级保留。
- [ ] Query filters / view / summary 共用同一 DSL。
- [ ] GUI Query 编辑器与 CLI Query 动词共用 schema 与校验。
- [ ] 没有独立持久化 current query。
- [ ] View 没有硬编码 TODO / 今日 / 未排期等业务分支；这些来自 QueryPreset。
- [ ] 未排期是 `time.scheduled is empty`，不是任务池。
- [ ] Week / Month tray 是 view 附加区，不污染主日期区集合。
- [ ] GUI / CLI 嵌套语义一致。
- [ ] 移动端不暴露拖拽 / hover / 快捷键。
- [ ] Daily Notes 不可用时不写 fallback。
- [ ] CLI error code 恆英文。
- [ ] 日期写回恒 ISO。
- [ ] Enter 提交守卫 IME composition。
- [ ] 所有写路径走 `vault.process`。
- [ ] 读路径走 TaskCache，不直接扫 vault。
- [ ] 任务源文件夹为空数组时读取整个 vault。
- [ ] 任务源文件夹路径匹配使用前缀匹配（US-416）。
- [ ] 路径配置变更后 flattenCache 标脏，不立即触发全量重扫。
- [ ] 路径过滤只在 ensureAll 遍历文件时执行，不影响单个文件的 invalidate。
- [ ] Quick Add / 禅道同步写入不受任务源文件夹约束（US-415）。
- [ ] CLI `list` / `stats` 只返回配置范围内的任务（US-904）。
