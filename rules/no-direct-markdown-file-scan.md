---
id: local.no-direct-markdown-file-scan
title: "禁止在缓存模块外直接扫描全库 Markdown"
language: typescript
level: warn
tags: [local, typescript, obsidian, cache]
---

# 禁止在缓存模块外直接扫描全库 Markdown

TaskCache 是状态栏、看板和 CLI 的唯一任务读取入口。不要直接调用 `vault.getMarkdownFiles()` 扫描全库，否则会绕过增量缓存并重新引入大 vault 性能回归。

依据：`ARCHITECTURE.md` 的“缓存是唯一读入口”和“事件增量优先”约束。

```grit
language js
`$vault.getMarkdownFiles()` where {
  $filename <: r".*src/.*\.ts"
}
```

## Bad

```typescript
const files = app.vault.getMarkdownFiles();
const tasks = await Promise.all(files.map((file) => parseFileTasks(app, file)));
```

## Good

```typescript
const tasks = taskCache.flatten();
```
