// Unit tests for Zentao mapper (US-813~815).
// Pure functions — no Obsidian dependency. Node built-in test runner.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function compilePure() {
  const result = spawnSync(
    "npx",
    [
      "esbuild",
      "src/zentao/mapper.ts",
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

compilePure();
const { mapZentaoTask, extractZentaoId, hasTaskChanged } = await import("../test/.compiled/mapper.js");

// ── Test data ──

const baseTask = {
  id: 42,
  project: 1,
  execution: 3,
  parent: 0,
  name: "开发电容光敏监测模块",
  type: "devel",
  pri: 1,
  status: "wait",
  deadline: "2025-12-30",
  estStarted: "2025-12-25",
  estimate: "1.0",
  consumed: "0.0",
  assignedTo: "admin",
  openedBy: "admin",
  openedDate: "2026-03-25 09:11:38",
  finishedBy: "",
  finishedDate: "",
  closedDate: "",
  desc: "",
};

// ── mapZentaoTask ──

test("maps a basic todo task with Tasks flavor", () => {
  const line = mapZentaoTask(baseTask, { taskFormatFlavor: "tasks" });
  assert.match(line, /^- \[ \] 开发电容光敏监测模块/);
  assert.match(line, /📅 2025-12-30/);
  assert.match(line, /🛫 2025-12-25/);
  assert.match(line, /\[estimate:: 1h\]/);
  assert.match(line, /\[zentao:: 42\]/);
  assert.match(line, /#zentao-devel/);
  assert.match(line, /⬆/); // priority emoji for pri=1
});

test("maps a basic todo task with Dataview flavor", () => {
  const line = mapZentaoTask(baseTask, { taskFormatFlavor: "dataview" });
  assert.match(line, /^- \[ \] 开发电容光敏监测模块/);
  assert.match(line, /\[due:: 2025-12-30\]/);
  assert.match(line, /\[start:: 2025-12-25\]/);
  assert.match(line, /\[priority:: high\]/);
  assert.match(line, /\[zentao:: 42\]/);
  assert.match(line, /#zentao-devel/);
  // Should NOT contain emoji tokens
  assert.doesNotMatch(line, /📅/);
  assert.doesNotMatch(line, /🛫/);
});

test("maps a done task with completion date", () => {
  const doneTask = {
    ...baseTask,
    status: "done",
    finishedDate: "2025-12-28 15:30:00",
  };
  const line = mapZentaoTask(doneTask, { taskFormatFlavor: "tasks" });
  assert.match(line, /^- \[x\]/);
  assert.match(line, /✅ 2025-12-28/);
});

test("maps a cancelled task with Dataview flavor", () => {
  const cancelTask = {
    ...baseTask,
    status: "cancel",
    closedDate: "2025-12-29 10:00:00",
  };
  const line = mapZentaoTask(cancelTask, { taskFormatFlavor: "dataview" });
  assert.match(line, /^- \[-\]/);
  assert.match(line, /\[cancelled:: 2025-12-29\]/);
});

test("handles tasks with no deadline", () => {
  const noDeadline = { ...baseTask, deadline: "" };
  const line = mapZentaoTask(noDeadline, { taskFormatFlavor: "tasks" });
  assert.doesNotMatch(line, /📅/);
  assert.doesNotMatch(line, /\[due::/);
});

test("handles tasks with zero/empty deadline (0000-00-00)", () => {
  const zeroDate = { ...baseTask, deadline: "0000-00-00" };
  const line = mapZentaoTask(zeroDate, { taskFormatFlavor: "tasks" });
  assert.doesNotMatch(line, /📅/);
});

test("handles tasks with no estimate", () => {
  const noEst = { ...baseTask, estimate: "0", consumed: "0" };
  const line = mapZentaoTask(noEst, { taskFormatFlavor: "tasks" });
  assert.doesNotMatch(line, /\[estimate::/);
  assert.doesNotMatch(line, /\[actual::/);
});

test("formats fractional hours correctly", () => {
  const fracTask = { ...baseTask, estimate: "1.5" };
  const line = mapZentaoTask(fracTask, { taskFormatFlavor: "tasks" });
  assert.match(line, /\[estimate:: 1h30m\]/);
});

test("maps all priority levels", () => {
  const flavors = ["tasks", "dataview"];
  const priExpected = [
    { pri: 1, tasks: "⬆", dv: "high" },
    { pri: 2, tasks: "🔼", dv: "medium" },
    { pri: 3, tasks: "🔽", dv: "low" },
    { pri: 4, tasks: "⬇", dv: "lowest" },
  ];
  for (const { pri, dv } of priExpected) {
    const task = { ...baseTask, pri };
    const dvLine = mapZentaoTask(task, { taskFormatFlavor: "dataview" });
    assert.match(dvLine, new RegExp(`\\[priority:: ${dv}\\]`));
  }
});

test("includes zentao type as tag", () => {
  const task = { ...baseTask, type: "test" };
  const line = mapZentaoTask(task, { taskFormatFlavor: "tasks" });
  assert.match(line, /#zentao-test/);
});

test("handles task with no type", () => {
  const task = { ...baseTask, type: "" };
  const line = mapZentaoTask(task, { taskFormatFlavor: "tasks" });
  assert.doesNotMatch(line, /#zentao-/);
});

// ── extractZentaoId ──

test("extracts zentao ID from existing line", () => {
  const line = "- [ ] Task name [zentao:: 42] #zentao-devel";
  assert.equal(extractZentaoId(line), 42);
});

test("returns null for line without zentao ID", () => {
  assert.equal(extractZentaoId("- [ ] Regular task"), null);
  assert.equal(extractZentaoId(""), null);
});

test("extracts zentao ID from line with other inline fields", () => {
  const line = "- [ ] Task [estimate:: 1h] [zentao:: 99] [actual:: 30m]";
  assert.equal(extractZentaoId(line), 99);
});

// ── hasTaskChanged ──

test("detects when task has changed", () => {
  const oldLine = mapZentaoTask(baseTask, { taskFormatFlavor: "tasks" });
  const updatedTask = { ...baseTask, deadline: "2026-01-15" };
  assert.equal(hasTaskChanged(updatedTask, oldLine, { taskFormatFlavor: "tasks" }), true);
});

test("detects when task has NOT changed", () => {
  const line = mapZentaoTask(baseTask, { taskFormatFlavor: "tasks" });
  assert.equal(hasTaskChanged(baseTask, line, { taskFormatFlavor: "tasks" }), false);
});

test("whitespace normalization in change detection", () => {
  const line = mapZentaoTask(baseTask, { taskFormatFlavor: "tasks" });
  const withExtraSpaces = line.replace(/  /g, "   ");
  assert.equal(hasTaskChanged(baseTask, withExtraSpaces, { taskFormatFlavor: "tasks" }), false);
});
