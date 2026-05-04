// Unit tests for VAL-CORE-009: Summary metrics are generic DSL metrics.
// Summary computes count, sum, ratio, top-N, and group-by over the
// current effective query using user-configured fields.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function compilePure() {
  const result = spawnSync(
    "npx",
    [
      "esbuild",
      "src/query/summary.ts",
      "--bundle",
      "--format=esm",
      "--platform=node",
      "--outdir=test/.compiled",
      "--loader:.ts=ts",
    ],
    { cwd: process.cwd(), stdio: "pipe", encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error("esbuild compile failed:\n" + result.stderr);
  }
}

let compileErr = null;
try {
  compilePure();
} catch (e) {
  compileErr = e;
}

// ── Helpers ──

function effectiveTask(overrides = {}) {
  const base = {
    id: "test.md:L1",
    path: "test.md",
    line: 0,
    indent: "",
    checkbox: " ",
    status: "todo",
    title: "Test task",
    rawTitle: "Test task",
    rawLine: "- [ ] Test task",
    tags: [],
    scheduled: null,
    deadline: null,
    start: null,
    completed: null,
    cancelled: null,
    created: null,
    recurrence: null,
    priority: null,
    calloutDepth: 0,
    inlineFields: {},
    durationFields: {},
    estimate: null,
    actual: null,
    parentLine: null,
    parentIndex: null,
    childrenLines: [],
    hash: "abcdef123456",
    mtime: 1000,
    inheritsTerminal: false,
    inheritedTerminalKind: null,
    effectiveStatus: "todo",
    effectiveScheduled: null,
    effectiveDeadline: null,
    effectiveCreated: null,
    terminalInheritedFrom: null,
    renderParentId: null,
    isTopLevelInQuery: true,
    ...overrides,
  };
  return base;
}

// ── VAL-CORE-009: count metric ──

test("VAL-CORE-009: count returns number of tasks", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1" }),
    effectiveTask({ id: "test.md:L2" }),
    effectiveTask({ id: "test.md:L3" }),
  ];

  const result = computeSummary(tasks, [{ type: "count" }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "count");
  assert.equal(result[0].value, 3);
});

test("VAL-CORE-009: count on empty array returns 0", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const result = computeSummary([], [{ type: "count" }]);
  assert.equal(result[0].value, 0);
});

// ── VAL-CORE-009: sum metric ──

test("VAL-CORE-009: sum over user-configured field from durationFields", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({
      id: "test.md:L1",
      durationFields: { planned: 30, spent: 20 },
    }),
    effectiveTask({
      id: "test.md:L2",
      durationFields: { planned: 60, spent: 45 },
    }),
    effectiveTask({
      id: "test.md:L3",
      durationFields: { planned: 15 },
    }),
  ];

  const result = computeSummary(tasks, [{ type: "sum", field: "planned" }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "sum");
  assert.equal(result[0].field, "planned");
  assert.equal(result[0].value, 105); // 30 + 60 + 15
});

test("VAL-CORE-009: sum over inline fields (string values parsed as minutes)", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({
      id: "test.md:L1",
      inlineFields: { planned: ["30m"], spent: ["20m"] },
      durationFields: { planned: 30 },
    }),
    effectiveTask({
      id: "test.md:L2",
      inlineFields: { planned: ["1h"], spent: ["45m"] },
      durationFields: { planned: 60 },
    }),
  ];

  const result = computeSummary(tasks, [{ type: "sum", field: "planned" }]);
  assert.equal(result[0].value, 90); // 30 + 60
});

test("VAL-CORE-009: sum over non-existent field returns 0", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", durationFields: {} }),
    effectiveTask({ id: "test.md:L2", durationFields: {} }),
  ];

  const result = computeSummary(tasks, [{ type: "sum", field: "nonexistent" }]);
  assert.equal(result[0].value, 0);
});

// ── VAL-CORE-009: sum with duration format ──

test("VAL-CORE-009: sum with format=duration returns formatted string", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({
      id: "test.md:L1",
      durationFields: { actual: 30 },
    }),
    effectiveTask({
      id: "test.md:L2",
      durationFields: { actual: 90 },
    }),
  ];

  const result = computeSummary(tasks, [
    { type: "sum", field: "actual", format: "duration" },
  ]);
  assert.equal(result[0].value, 120);
  assert.ok(typeof result[0].formatted === "string");
  assert.ok(result[0].formatted.length > 0);
});

// ── VAL-CORE-009: ratio metric ──

test("VAL-CORE-009: ratio over user-configured numerator/denominator fields", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({
      id: "test.md:L1",
      durationFields: { actual: 30, estimate: 60 },
      status: "done",
    }),
    effectiveTask({
      id: "test.md:L2",
      durationFields: { actual: 45, estimate: 90 },
      status: "done",
    }),
  ];

  const result = computeSummary(tasks, [
    { type: "ratio", numerator: "actual", denominator: "estimate" },
  ]);
  assert.equal(result[0].type, "ratio");
  // (30+45) / (60+90) = 75/150 = 0.5 → 50%
  assert.equal(result[0].value, 50);
  assert.equal(result[0].numeratorSum, 75);
  assert.equal(result[0].denominatorSum, 150);
});

test("VAL-CORE-009: ratio with format=percent returns percentage", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({
      id: "test.md:L1",
      durationFields: { actual: 50, estimate: 100 },
    }),
  ];

  const result = computeSummary(tasks, [
    { type: "ratio", numerator: "actual", denominator: "estimate", format: "percent" },
  ]);
  // 50/100 = 0.5 * 100 = 50%
  assert.equal(result[0].value, 50);
  assert.equal(result[0].formatted, "50%");
});

// ── VAL-CORE-009: top_n metric ──

test("VAL-CORE-009: top_n by tag returns top N tags with counts", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L2", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L3", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L4", tags: ["#personal"] }),
    effectiveTask({ id: "test.md:L5", tags: ["#personal"] }),
    effectiveTask({ id: "test.md:L6", tags: ["#urgent"] }),
  ];

  const result = computeSummary(tasks, [
    { type: "top_n", by: "tag", limit: 2 },
  ]);
  assert.equal(result[0].type, "top_n");
  assert.ok(Array.isArray(result[0].items));
  assert.equal(result[0].items.length, 2, "Top 2 tags");
  assert.equal(result[0].items[0].key, "#work");
  assert.equal(result[0].items[0].count, 3);
  assert.equal(result[0].items[1].key, "#personal");
  assert.equal(result[0].items[1].count, 2);
});

// ── VAL-CORE-009: group_by metric ──

test("VAL-CORE-009: group_by tag returns count per tag", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", tags: ["#work", "#urgent"] }),
    effectiveTask({ id: "test.md:L2", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L3", tags: ["#personal"] }),
  ];

  const result = computeSummary(tasks, [
    { type: "group_by", by: "tag" },
  ]);
  assert.equal(result[0].type, "group_by");
  assert.ok(Array.isArray(result[0].groups));

  const workGroup = result[0].groups.find((g) => g.key === "#work");
  assert.ok(workGroup, "Should have #work group");
  assert.equal(workGroup.count, 2);

  const personalGroup = result[0].groups.find((g) => g.key === "#personal");
  assert.ok(personalGroup, "Should have #personal group");
  assert.equal(personalGroup.count, 1);
});

// ── VAL-CORE-009: group_by user-configured field ──

test("VAL-CORE-009: group_by custom inline field", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({
      id: "test.md:L1",
      title: "Task A",
      inlineFields: { priority: ["high"] },
    }),
    effectiveTask({
      id: "test.md:L2",
      title: "Task B",
      inlineFields: { priority: ["high"] },
    }),
    effectiveTask({
      id: "test.md:L3",
      title: "Task C",
      inlineFields: { priority: ["low"] },
    }),
  ];

  const result = computeSummary(tasks, [
    { type: "group_by", by: "priority" },
  ]);
  assert.equal(result[0].type, "group_by");

  const highGroup = result[0].groups.find((g) => g.key === "high");
  assert.ok(highGroup);
  assert.equal(highGroup.count, 2);

  const lowGroup = result[0].groups.find((g) => g.key === "low");
  assert.ok(lowGroup);
  assert.equal(lowGroup.count, 1);
});

// ── VAL-CORE-009: Multiple metrics ──

test("VAL-CORE-009: multiple metrics computed together", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({
      id: "test.md:L1",
      tags: ["#work"],
      durationFields: { actual: 30, planned: 60 },
      status: "done",
    }),
    effectiveTask({
      id: "test.md:L2",
      tags: ["#work"],
      durationFields: { actual: 45, planned: 90 },
      status: "done",
    }),
    effectiveTask({
      id: "test.md:L3",
      tags: ["#personal"],
      durationFields: { actual: 120, planned: 120 },
      status: "done",
    }),
  ];

  const result = computeSummary(tasks, [
    { type: "count" },
    { type: "sum", field: "actual", format: "duration" },
    { type: "ratio", numerator: "actual", denominator: "planned", format: "percent" },
    { type: "top_n", by: "tag", limit: 2 },
  ]);

  assert.equal(result.length, 4);

  // count
  assert.equal(result[0].type, "count");
  assert.equal(result[0].value, 3);

  // sum
  assert.equal(result[1].type, "sum");
  assert.equal(result[1].field, "actual");
  assert.equal(result[1].value, 195); // 30 + 45 + 120

  // ratio
  assert.equal(result[2].type, "ratio");
  assert.equal(result[2].value, 72); // (30+45+120)/(60+90+120) = 195/270 ≈ 72%

  // top_n
  assert.equal(result[3].type, "top_n");
  assert.equal(result[3].items[0].key, "#work");
  assert.equal(result[3].items[0].count, 2);
});

// ── VAL-CORE-009: Default summary (empty metrics) ──

test("VAL-CORE-009: empty metrics returns empty result", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [effectiveTask({ id: "test.md:L1" })];
  const result = computeSummary(tasks, []);
  assert.deepEqual(result, []);
});

// ── VAL-CORE-009: Summary uses user-configured fields not hardcoded ──

test("VAL-CORE-009: sum over custom field name (not estimate/actual)", async () => {
  if (compileErr) throw compileErr;

  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({
      id: "test.md:L1",
      durationFields: { storyPoints: 5, bugPoints: 3 },
    }),
    effectiveTask({
      id: "test.md:L2",
      durationFields: { storyPoints: 8 },
    }),
  ];

  const result = computeSummary(tasks, [{ type: "sum", field: "storyPoints" }]);
  assert.equal(result[0].value, 13); // 5 + 8
});

// ── fix-m3-direct-taskcenterview-dom-tests: top_n by UI edit changes computeSummary output ──
// These tests verify that editing a top_n metric's `by` or `limit` parameter
// produces a different computeSummary/computeTopN result — the exact behavior
// required when the Query Editor Summary visual controls dispatch change events.

test("VAL-CORE-009 round6: top_n by=tag → top two tags returned by computeSummary", async () => {
  if (compileErr) throw compileErr;
  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L2", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L3", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L4", tags: ["#personal"] }),
    effectiveTask({ id: "test.md:L5", tags: ["#personal"] }),
    effectiveTask({ id: "test.md:L6", tags: ["#urgent"] }),
  ];

  const result = computeSummary(tasks, [
    { type: "top_n", by: "tag", limit: 2 },
  ]);

  assert.equal(result[0].type, "top_n");
  assert.equal(result[0].items.length, 2);
  assert.equal(result[0].items[0].key, "#work");
  assert.equal(result[0].items[0].count, 3);
  assert.equal(result[0].items[1].key, "#personal");
  assert.equal(result[0].items[1].count, 2);
});

test("VAL-CORE-009 round6: top_n limit=3 returns three tags instead of two", async () => {
  if (compileErr) throw compileErr;
  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L2", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L3", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L4", tags: ["#personal"] }),
    effectiveTask({ id: "test.md:L5", tags: ["#personal"] }),
    effectiveTask({ id: "test.md:L6", tags: ["#urgent"] }),
  ];

  // Same tasks, different limit → different output
  const result = computeSummary(tasks, [
    { type: "top_n", by: "tag", limit: 3 },
  ]);

  assert.equal(result[0].type, "top_n");
  assert.equal(result[0].items.length, 3, "limit=3 returns 3 items");
  assert.equal(result[0].items[0].key, "#work");
  assert.equal(result[0].items[0].count, 3);
  assert.equal(result[0].items[1].key, "#personal");
  assert.equal(result[0].items[1].count, 2);
  assert.equal(result[0].items[2].key, "#urgent");
  assert.equal(result[0].items[2].count, 1);
});

test("VAL-CORE-009 round6: top_n by=custom-inline-field groups by user-configured inline field", async () => {
  if (compileErr) throw compileErr;
  const { computeSummary } = await import("../test/.compiled/summary.js");

  // top_n `by` supports "tag" (built-in) and user-configured inline fields.
  // Non-tag values are looked up in task.inlineFields. Use `by: "priority"`
  // to group by a custom `[priority::high]` / `[priority::low]` inline field.
  const tasks = [
    effectiveTask({ id: "test.md:L1", inlineFields: { priority: ["high"] } }),
    effectiveTask({ id: "test.md:L2", inlineFields: { priority: ["high"] } }),
    effectiveTask({ id: "test.md:L3", inlineFields: { priority: ["high"] } }),
    effectiveTask({ id: "test.md:L4", inlineFields: { priority: ["medium"] } }),
    effectiveTask({ id: "test.md:L5", inlineFields: { priority: ["medium"] } }),
    effectiveTask({ id: "test.md:L6", inlineFields: { priority: ["low"] } }),
  ];

  const result = computeSummary(tasks, [
    { type: "top_n", by: "priority", limit: 3 },
  ]);

  assert.equal(result[0].type, "top_n");
  assert.equal(result[0].items.length, 3);
  assert.equal(result[0].items[0].key, "high");
  assert.equal(result[0].items[0].count, 3);
  assert.equal(result[0].items[1].key, "medium");
  assert.equal(result[0].items[1].count, 2);
  assert.equal(result[0].items[2].key, "low");
  assert.equal(result[0].items[2].count, 1);
});

test("VAL-CORE-009 round6: top_n with multiple metrics — top_n by tag and by custom field compute independently", async () => {
  if (compileErr) throw compileErr;
  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", tags: ["#work"], inlineFields: { priority: ["high"] } }),
    effectiveTask({ id: "test.md:L2", tags: ["#work"], inlineFields: { priority: ["high"] } }),
    effectiveTask({ id: "test.md:L3", tags: ["#work"], inlineFields: { priority: ["medium"] } }),
    effectiveTask({ id: "test.md:L4", tags: ["#personal"], inlineFields: { priority: ["medium"] } }),
    effectiveTask({ id: "test.md:L5", tags: ["#personal"], inlineFields: { priority: ["low"] } }),
    effectiveTask({ id: "test.md:L6", tags: ["#urgent"], inlineFields: { priority: ["medium"] } }),
  ];

  const result = computeSummary(tasks, [
    { type: "top_n", by: "tag", limit: 3 },
    { type: "top_n", by: "priority", limit: 2 },
  ]);

  // First metric: top_n by tag (limit=3)
  assert.equal(result[0].type, "top_n");
  assert.equal(result[0].items.length, 3);
  assert.equal(result[0].items[0].key, "#work");
  assert.equal(result[0].items[0].count, 3);
  assert.equal(result[0].items[1].key, "#personal");
  assert.equal(result[0].items[1].count, 2);
  assert.equal(result[0].items[2].key, "#urgent");
  assert.equal(result[0].items[2].count, 1);

  // Second metric: top_n by custom field "priority" (limit=2)
  assert.equal(result[1].type, "top_n");
  assert.equal(result[1].items.length, 2);
  assert.equal(result[1].items[0].key, "medium");
  assert.equal(result[1].items[0].count, 3);
  assert.equal(result[1].items[1].key, "high");
  assert.equal(result[1].items[1].count, 2);
});

test("VAL-CORE-009 round6: editing top_n by from 'tag' to custom field changes computeSummary output", async () => {
  if (compileErr) throw compileErr;
  const { computeSummary } = await import("../test/.compiled/summary.js");

  // Same task set, but top_n groups by different field → different output
  const tasks = [
    effectiveTask({ id: "test.md:L1", tags: ["#work"], inlineFields: { project: ["alpha"] } }),
    effectiveTask({ id: "test.md:L2", tags: ["#work"], inlineFields: { project: ["alpha"] } }),
    effectiveTask({ id: "test.md:L3", tags: ["#personal"], inlineFields: { project: ["beta"] } }),
    effectiveTask({ id: "test.md:L4", tags: ["#personal"], inlineFields: { project: ["beta"] } }),
  ];

  // Before edit: by="tag"
  const byTag = computeSummary(tasks, [
    { type: "top_n", by: "tag", limit: 2 },
  ]);
  // Tags are lowercased by collectFieldValues, so #personal comes before #work alphabetically
  assert.equal(byTag[0].items.length, 2);

  // After edit: by="project" (custom inline field)
  const byProject = computeSummary(tasks, [
    { type: "top_n", by: "project", limit: 2 },
  ]);
  assert.equal(byProject[0].items.length, 2);

  // Assert the outputs differ — proving the edit changed computeSummary behavior
  // The grouped keys must be different (tags vs project names)
  const tagKeys = byTag[0].items.map((i) => i.key);
  const projectKeys = byProject[0].items.map((i) => i.key);
  assert.ok(
    tagKeys.some((k) => k.startsWith("#")),
    "tag grouping keys start with #",
  );
  assert.ok(
    projectKeys.every((k) => !k.startsWith("#")),
    "project grouping keys don't start with #",
  );
  assert.notDeepEqual(
    tagKeys,
    projectKeys,
    "editing top_n by from 'tag' to 'project' must produce different groups",
  );
});

test("VAL-CORE-009 round6: editing top_n limit from 3 to 1 changes computeSummary output", async () => {
  if (compileErr) throw compileErr;
  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L2", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L3", tags: ["#personal"] }),
    effectiveTask({ id: "test.md:L4", tags: ["#urgent"] }),
  ];

  // Before edit: limit=3
  const limit3 = computeSummary(tasks, [
    { type: "top_n", by: "tag", limit: 3 },
  ]);
  assert.equal(limit3[0].items.length, 3);

  // After edit: limit=1
  const limit1 = computeSummary(tasks, [
    { type: "top_n", by: "tag", limit: 1 },
  ]);
  assert.equal(limit1[0].items.length, 1);
  assert.equal(limit1[0].items[0].key, "#work");
  assert.equal(limit1[0].items[0].count, 2);

  // Assert the output length changed
  assert.notEqual(limit3[0].items.length, limit1[0].items.length,
    "editing top_n limit from 3 to 1 must change number of returned items");
});

test("VAL-CORE-009 round6: removing top_n metric removes it from computeSummary output", async () => {
  if (compileErr) throw compileErr;
  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [effectiveTask({ id: "test.md:L1", tags: ["#work"] })];

  // Before removal: 2 metrics (count + top_n)
  const before = computeSummary(tasks, [
    { type: "count" },
    { type: "top_n", by: "tag", limit: 3 },
  ]);
  assert.equal(before.length, 2);
  assert.equal(before[1].type, "top_n");

  // After removal: only count metric (simulates removing top_n in editor)
  const after = computeSummary(tasks, [
    { type: "count" },
  ]);
  assert.equal(after.length, 1);
  assert.equal(after[0].type, "count");

  assert.notEqual(before.length, after.length,
    "removing top_n metric must reduce computeSummary output count");
});

test("VAL-CORE-009 round6: adding top_n metric adds it to computeSummary output", async () => {
  if (compileErr) throw compileErr;
  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L2", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L3", tags: ["#personal"] }),
  ];

  // Before add: only count metric
  const before = computeSummary(tasks, [{ type: "count" }]);
  assert.equal(before.length, 1);
  assert.equal(before[0].type, "count");

  // After add: count + top_n (simulates adding top_n in editor)
  const after = computeSummary(tasks, [
    { type: "count" },
    { type: "top_n", by: "tag", limit: 2 },
  ]);
  assert.equal(after.length, 2);
  assert.equal(after[0].type, "count");
  assert.equal(after[1].type, "top_n");
  assert.equal(after[1].items.length, 2);
  assert.equal(after[1].items[0].key, "#work");
  assert.equal(after[1].items[0].count, 2);

  assert.notEqual(before.length, after.length,
    "adding top_n metric must increase computeSummary output count");
});

test("VAL-CORE-009 round6: top_n by uses canonical 'by' parameter consumed by computeSummary", async () => {
  // Verify that computeSummary reads `by` (not `field`) for top_n grouping.
  // When `by` is missing, computeTopN defaults to "tag". But the canonical
  // parameter for customization is `by` — the GUI must write `by` for
  // user-configured grouping to work correctly.
  if (compileErr) throw compileErr;
  const { computeSummary } = await import("../test/.compiled/summary.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", tags: ["#work"], inlineFields: { project: ["alpha"] } }),
    effectiveTask({ id: "test.md:L2", tags: ["#work"], inlineFields: { project: ["alpha"] } }),
    effectiveTask({ id: "test.md:L3", tags: ["#personal"], inlineFields: { project: ["beta"] } }),
  ];

  // Correct: `by` is the canonical parameter — groups by custom field
  const byProject = computeSummary(tasks, [
    { type: "top_n", by: "project", limit: 2 },
  ]);
  assert.equal(byProject[0].items.length, 2);
  assert.equal(byProject[0].items[0].key, "alpha");
  assert.equal(byProject[0].items[0].count, 2);
  assert.equal(byProject[0].items[1].key, "beta");
  assert.equal(byProject[0].items[1].count, 1);

  // When `by` is absent, computeTopN defaults to "tag" grouping.
  // The GUI must always write `by` to allow non-tag custom grouping.
  const missingBy = computeSummary(tasks, [
    { type: "top_n", limit: 2 }, // no `by` → defaults to "tag"
  ]);
  assert.equal(missingBy[0].items[0].key, "#work");
  assert.equal(missingBy[0].items[1].key, "#personal");

  // The outputs differ because `by: "project"` ≠ default `by: "tag"`
  assert.notDeepEqual(
    byProject[0].items.map((i) => i.key),
    missingBy[0].items.map((i) => i.key),
    "top_n with by=project produces different groups than default by=tag",
  );
});
