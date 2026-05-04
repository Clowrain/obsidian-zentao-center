// Unit tests for VAL-CORE-008: View projection does not own business collections.
// List/week/month/matrix project the same filtered task set into layout models.
// Today/TODO/Unscheduled/Completed/Dropped are QueryPresets, not view types.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function compilePure() {
  const result = spawnSync(
    "npx",
    [
      "esbuild",
      "src/query/projection.ts",
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

// ── VAL-CORE-008: List projection ──

test("VAL-CORE-008: list view — all tasks in a single default section", async () => {
  if (compileErr) throw compileErr;

  const { applyViewProjection } = await import("../test/.compiled/projection.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", title: "Task A", effectiveScheduled: "2026-05-04" }),
    effectiveTask({ id: "test.md:L2", title: "Task B", effectiveScheduled: null }),
    effectiveTask({ id: "test.md:L3", title: "Task C", effectiveScheduled: "2026-05-05" }),
  ];

  const model = applyViewProjection(tasks, { type: "list" }, 1);
  assert.equal(model.type, "list");
  assert.ok(Array.isArray(model.sections));
  assert.equal(model.sections.length, 1, "One default section");
  assert.equal(model.sections[0].tasks.length, 3);
});

test("VAL-CORE-008: list view — tasks sorted by orderBy", async () => {
  if (compileErr) throw compileErr;

  const { applyViewProjection } = await import("../test/.compiled/projection.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", title: "ZZZ Task", effectiveScheduled: null }),
    effectiveTask({ id: "test.md:L2", title: "AAA Task", effectiveScheduled: null }),
    effectiveTask({ id: "test.md:L3", title: "MMM Task", effectiveScheduled: null }),
  ];

  const model = applyViewProjection(
    tasks,
    { type: "list", orderBy: ["title_asc"] },
    1,
  );
  assert.equal(model.sections[0].tasks[0].title, "AAA Task");
  assert.equal(model.sections[0].tasks[1].title, "MMM Task");
  assert.equal(model.sections[0].tasks[2].title, "ZZZ Task");
});

// ── VAL-CORE-008: Week projection ──

test("VAL-CORE-008: week view — 7 day columns with tasks grouped by effectiveScheduled", async () => {
  if (compileErr) throw compileErr;

  const { applyViewProjection } = await import("../test/.compiled/projection.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", effectiveScheduled: "2026-05-04" }), // Monday
    effectiveTask({ id: "test.md:L2", effectiveScheduled: "2026-05-04" }), // Monday
    effectiveTask({ id: "test.md:L3", effectiveScheduled: "2026-05-06" }), // Wednesday
    effectiveTask({ id: "test.md:L4", effectiveScheduled: "2026-05-10" }), // Sunday
    effectiveTask({ id: "test.md:L5", effectiveScheduled: null }),          // unscheduled — not in any column
  ];

  const model = applyViewProjection(
    tasks,
    { type: "week" },
    1,
    "2026-05-04",
  );

  assert.equal(model.type, "week");
  assert.ok(Array.isArray(model.days));
  assert.equal(model.days.length, 7);

  // Monday (2026-05-04) should have 2 tasks
  const monday = model.days[0];
  assert.equal(monday.date, "2026-05-04");
  assert.equal(monday.tasks.length, 2);

  // Wednesday (2026-05-06) should have 1 task
  const wednesday = model.days[2];
  assert.equal(wednesday.date, "2026-05-06");
  assert.equal(wednesday.tasks.length, 1);

  // Total tasks in columns = 4 (null-scheduled task excluded)
  const totalInColumns = model.days.reduce((sum, d) => sum + d.tasks.length, 0);
  assert.equal(totalInColumns, 4);
});

test("VAL-CORE-008: week view — unscheduled tasks go to tray", async () => {
  if (compileErr) throw compileErr;

  const { applyViewProjection } = await import("../test/.compiled/projection.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", effectiveScheduled: "2026-05-04" }),
    effectiveTask({ id: "test.md:L2", effectiveScheduled: null }),
    effectiveTask({ id: "test.md:L3", effectiveScheduled: null }),
  ];

  const model = applyViewProjection(
    tasks,
    { type: "week" },
    1,
    "2026-05-04",
  );

  // Tray contains unscheduled tasks
  assert.ok(model.tray, "Week should have a tray for unscheduled tasks");
  assert.equal(model.tray.tasks.length, 2);
  assert.equal(model.tray.tasks[0].id, "test.md:L2");
});

test("VAL-CORE-008: week view — respects weekStartsOn=0 (Sunday)", async () => {
  if (compileErr) throw compileErr;

  const { applyViewProjection } = await import("../test/.compiled/projection.js");

  // 2026-05-04 is Monday. With weekStartsOn=0 (Sunday), the week starts on May 3.
  const tasks = [
    effectiveTask({ id: "test.md:L1", effectiveScheduled: "2026-05-03" }), // Sunday
    effectiveTask({ id: "test.md:L2", effectiveScheduled: "2026-05-04" }), // Monday
  ];

  const model = applyViewProjection(tasks, { type: "week" }, 0, "2026-05-04");

  assert.equal(model.days[0].date, "2026-05-03");
  assert.equal(model.days[0].tasks.length, 1);
  assert.equal(model.days[1].date, "2026-05-04");
  assert.equal(model.days[1].tasks.length, 1);
});

// ── VAL-CORE-008: Month projection ──

test("VAL-CORE-008: month view — calendar grid with tasks per date", async () => {
  if (compileErr) throw compileErr;

  const { applyViewProjection } = await import("../test/.compiled/projection.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", effectiveScheduled: "2026-05-01" }),
    effectiveTask({ id: "test.md:L2", effectiveScheduled: "2026-05-15" }),
    effectiveTask({ id: "test.md:L3", effectiveScheduled: "2026-05-31" }),
  ];

  const model = applyViewProjection(
    tasks,
    { type: "month" },
    1,
    "2026-05-04",
  );

  assert.equal(model.type, "month");
  assert.ok(Array.isArray(model.cells));

  // Find cells with tasks
  const populatedCells = model.cells.filter((c) => c.tasks.length > 0);
  assert.equal(populatedCells.length, 3);
});

test("VAL-CORE-008: month view — empty cells still have date", async () => {
  if (compileErr) throw compileErr;

  const { applyViewProjection } = await import("../test/.compiled/projection.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", effectiveScheduled: "2026-05-01" }),
  ];

  const model = applyViewProjection(tasks, { type: "month" }, 1, "2026-05-04");

  // May 2026 has 31 days. Cells should cover the full month.
  assert.ok(model.cells.length >= 28, "At least 28 cells for a month");
  // Each cell has a date property
  for (const cell of model.cells) {
    assert.ok(cell.date, "Each cell has a date");
  }
});

test("VAL-CORE-008: month view — tray for unscheduled tasks", async () => {
  if (compileErr) throw compileErr;

  const { applyViewProjection } = await import("../test/.compiled/projection.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", effectiveScheduled: "2026-05-01" }),
    effectiveTask({ id: "test.md:L2", effectiveScheduled: null }),
  ];

  const model = applyViewProjection(tasks, { type: "month" }, 1, "2026-05-04");

  assert.ok(model.tray, "Month should have a tray for unscheduled tasks");
  assert.equal(model.tray.tasks.length, 1);
  assert.equal(model.tray.tasks[0].id, "test.md:L2");
});

// ── VAL-CORE-008: Matrix projection ──

test("VAL-CORE-008: matrix view — tasks grouped by tag into buckets", async () => {
  if (compileErr) throw compileErr;

  const { applyViewProjection } = await import("../test/.compiled/projection.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", title: "Work task", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L2", title: "Personal task", tags: ["#personal"] }),
    effectiveTask({ id: "test.md:L3", title: "Both", tags: ["#work", "#personal"] }),
    effectiveTask({ id: "test.md:L4", title: "Neither", tags: [] }),
  ];

  // Matrix with one axis: tags
  const model = applyViewProjection(
    tasks,
    {
      type: "matrix",
      matrix: {
        x: {
          id: "x-tags",
          title: "Tags",
          buckets: [
            { id: "b-work", title: "Work", when: { tags: ["#work"] } },
            { id: "b-personal", title: "Personal", when: { tags: ["#personal"] } },
          ],
        },
        y: { id: "y-status", title: "Status", buckets: [] },
        unmatched: "show",
        multiMatch: "first", // first match wins
        showEmptyBuckets: true,
      },
    },
    1,
  );

  assert.equal(model.type, "matrix");
  assert.ok(Array.isArray(model.buckets));
  assert.ok(Array.isArray(model.unmatched));

  // Tasks with #work
  const workBucket = model.buckets.find((b) => b.id === "b-work");
  assert.ok(workBucket, "Work bucket exists");
  assert.ok(workBucket.tasks.length >= 1);

  // Unmatched tasks (neither tag)
  const unmatchedIds = model.unmatched.map((t) => t.id);
  assert.ok(unmatchedIds.includes("test.md:L4"));
});

test("VAL-CORE-008: matrix view — multiMatch=duplicate puts task in all matching buckets", async () => {
  if (compileErr) throw compileErr;

  const { applyViewProjection } = await import("../test/.compiled/projection.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", title: "Both", tags: ["#work", "#personal"] }),
  ];

  const model = applyViewProjection(
    tasks,
    {
      type: "matrix",
      matrix: {
        x: {
          id: "x-tags",
          title: "Tags",
          buckets: [
            { id: "b-work", title: "Work", when: { tags: ["#work"] } },
            { id: "b-personal", title: "Personal", when: { tags: ["#personal"] } },
          ],
        },
        y: { id: "y-none", title: "None", buckets: [] },
        unmatched: "show",
        multiMatch: "duplicate",
        showEmptyBuckets: true,
      },
    },
    1,
  );

  const workBucket = model.buckets.find((b) => b.id === "b-work");
  const personalBucket = model.buckets.find((b) => b.id === "b-personal");
  assert.ok(workBucket, "Work bucket exists");
  assert.ok(personalBucket, "Personal bucket exists");
  assert.equal(workBucket.tasks.length, 1, "Task in work bucket");
  assert.equal(personalBucket.tasks.length, 1, "Task also in personal bucket");
});

test("VAL-CORE-008: matrix view — unmatched=hide removes unmatched tasks", async () => {
  if (compileErr) throw compileErr;

  const { applyViewProjection } = await import("../test/.compiled/projection.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", title: "Has tag", tags: ["#work"] }),
    effectiveTask({ id: "test.md:L2", title: "No tag", tags: [] }),
  ];

  const model = applyViewProjection(
    tasks,
    {
      type: "matrix",
      matrix: {
        x: {
          id: "x-tags",
          title: "Tags",
          buckets: [
            { id: "b-work", title: "Work", when: { tags: ["#work"] } },
          ],
        },
        y: { id: "y-none", title: "None", buckets: [] },
        unmatched: "hide",
        multiMatch: "first",
        showEmptyBuckets: true,
      },
    },
    1,
  );

  assert.equal(model.unmatched.length, 0);
});

// ── VAL-CORE-008: Same tasks projected to different views ──

test("VAL-CORE-008: same filtered tasks projected to list, week, month produce different models", async () => {
  if (compileErr) throw compileErr;

  const { applyViewProjection } = await import("../test/.compiled/projection.js");

  const tasks = [
    effectiveTask({ id: "test.md:L1", effectiveScheduled: "2026-05-04" }),
    effectiveTask({ id: "test.md:L2", effectiveScheduled: "2026-05-05" }),
    effectiveTask({ id: "test.md:L3", effectiveScheduled: null }),
  ];

  const listModel = applyViewProjection(tasks, { type: "list" }, 1);
  const weekModel = applyViewProjection(tasks, { type: "week" }, 1, "2026-05-04");
  const monthModel = applyViewProjection(tasks, { type: "month" }, 1, "2026-05-04");

  assert.equal(listModel.type, "list");
  assert.equal(weekModel.type, "week");
  assert.equal(monthModel.type, "month");

  // All contain the same 3 tasks (just organized differently)
  const listTaskIds = listModel.sections[0].tasks.map((t) => t.id).sort();
  const weekTaskIds = weekModel.days
    .flatMap((d) => d.tasks)
    .concat(weekModel.tray?.tasks ?? [])
    .map((t) => t.id)
    .sort();
  const monthTaskIds = monthModel.cells
    .flatMap((c) => c.tasks)
    .concat(monthModel.tray?.tasks ?? [])
    .map((t) => t.id)
    .sort();

  assert.deepEqual(listTaskIds, ["test.md:L1", "test.md:L2", "test.md:L3"]);
  assert.deepEqual(weekTaskIds, ["test.md:L1", "test.md:L2", "test.md:L3"]);
  assert.deepEqual(monthTaskIds, ["test.md:L1", "test.md:L2", "test.md:L3"]);
});
