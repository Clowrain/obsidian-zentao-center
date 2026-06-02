---
id: local.no-metadata-resolved-event
title: "禁止订阅 metadataCache resolved 事件"
language: typescript
level: warn
tags: [local, typescript, obsidian, cache]
---

# 禁止订阅 metadataCache resolved 事件

不要订阅 `metadataCache.on("resolved")`。这个事件会在大 vault 中造成全库级事件洪泛；Task Center 的缓存只应绑定单文件 `metadataCache.on("changed")` 和必要的 vault 文件事件。

依据：`ARCHITECTURE.md` 的事件增量优先约束，以及 `src/cache.ts` 对大 vault 回归的注释。

```grit
language js
`$metadataCache.on("resolved", $handler)` where {
  $filename <: r".*src/.*\.ts"
}
```

## Bad

```typescript
this.app.metadataCache.on("resolved", () => {
  void this.cache.ensureAll();
});
```

## Good

```typescript
this.app.metadataCache.on("changed", (file) => {
  if (file instanceof TFile && file.extension === "md") {
    void this.cache.invalidateFile(file.path);
  }
});
```
