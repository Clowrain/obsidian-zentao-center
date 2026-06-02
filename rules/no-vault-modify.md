---
id: local.no-vault-modify
title: "禁止用 vault.modify 写任务 Markdown"
language: typescript
level: warn
tags: [local, typescript, obsidian, writer]
---

# 禁止用 vault.modify 写任务 Markdown

Task Center 的任务数据只有 Markdown 行这一份事实源。涉及任务写回时，应通过 `app.vault.process` 做 per-file 原子更新，避免用 `app.vault.modify` 覆盖整份文件导致并发编辑、未知字段和原文保留更难验证。

依据：`ARCHITECTURE.md` 的 US-401 / US-403 / US-407，以及 `src/writer.ts` 的写回边界。

```grit
language js
`$vault.modify($file, $data)` where {
  $filename <: r".*src/.*\.ts"
}
```

## Bad

```typescript
await app.vault.modify(file, nextMarkdown);
```

## Good

```typescript
await app.vault.process(file, (data) => {
  const lines = data.split("\n");
  lines[line] = nextLine;
  return lines.join("\n");
});
```
