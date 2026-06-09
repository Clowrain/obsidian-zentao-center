// Unit tests for Zentao sync pure functions (US-810, US-816).
// Only tests getDateRangeForTab and filterTasksByDeadline — no Obsidian dependency.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Extract pure functions to avoid obsidian dependency in sync.ts
// We compile only dates.ts and inline the pure functions for testing.

function compilePure() {
  const result = spawnSync(
    "npx",
    [
      "esbuild",
      "src/dates.ts",
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
const { todayISO, startOfWeek, endOfWeek, addDays, shiftMonth } = await import("../test/.compiled/dates.js");

// ── Inline pure logic from sync.ts for testing ──
// (avoids pulling in obsidian/Vault dependencies)

function getDateRangeForTab(tabPreset, weekStartsOn = 1) {
  const today = todayISO();
  switch (tabPreset) {
    case "today":
      return { start: today, end: today };
    case "week":
      return { start: startOfWeek(today, weekStartsOn), end: endOfWeek(today, weekStartsOn) };
    case "month": {
      const [y, m] = today.split("-").map(Number);
      const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
      const monthEnd = shiftMonth(monthStart, 1);
      return { start: monthStart, end: addDays(monthEnd, -1) };
    }
    default:
      return null;
  }
}

function filterTasksByDeadline(tasks, range) {
  return tasks.filter((t) => {
    if (!t.deadline || t.deadline === "0000-00-00") return false;
    const d = t.deadline.slice(0, 10);
    return d >= range.start && d <= range.end;
  });
}

// ── getDateRangeForTab ──

test("returns null for non-time tabs", () => {
  assert.equal(getDateRangeForTab(undefined), null);
  assert.equal(getDateRangeForTab("todo"), null);
  assert.equal(getDateRangeForTab("unscheduled"), null);
});

test("today range is a single day", () => {
  const range = getDateRangeForTab("today");
  assert.ok(range);
  assert.equal(range.start, range.end);
  assert.match(range.start, /^\d{4}-\d{2}-\d{2}$/);
});

test("week range spans 7 days (Monday first)", () => {
  const range = getDateRangeForTab("week", 1);
  assert.ok(range);
  const start = new Date(range.start);
  const end = new Date(range.end);
  const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  assert.equal(diffDays, 6);
});

test("week range spans 7 days (Sunday first)", () => {
  const range = getDateRangeForTab("week", 0);
  assert.ok(range);
  const start = new Date(range.start);
  const end = new Date(range.end);
  const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  assert.equal(diffDays, 6);
});

test("month range starts on first day of current month", () => {
  const range = getDateRangeForTab("month");
  assert.ok(range);
  assert.match(range.start, /^\d{4}-\d{2}-01$/);
  const [y, m] = range.start.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  assert.equal(Number(range.end.split("-")[2]), lastDay);
});

// ── filterTasksByDeadline ──

const makeTask = (deadline) => ({
  id: 1, project: 1, execution: 1, parent: 0,
  name: "Test", type: "devel", pri: 3, status: "wait",
  deadline, estStarted: "", estimate: "0", consumed: "0",
  assignedTo: "admin", openedBy: "admin", openedDate: "",
  finishedBy: "", finishedDate: "", closedDate: "", desc: "",
});

test("filters tasks by deadline within range", () => {
  const tasks = [
    makeTask("2025-12-28"),
    makeTask("2025-12-30"),
    makeTask("2026-01-05"),
  ];
  const filtered = filterTasksByDeadline(tasks, { start: "2025-12-29", end: "2026-01-03" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].deadline, "2025-12-30");
});

test("excludes tasks with empty deadline", () => {
  const tasks = [makeTask(""), makeTask("2025-12-30")];
  const filtered = filterTasksByDeadline(tasks, { start: "2025-12-25", end: "2025-12-31" });
  assert.equal(filtered.length, 1);
});

test("excludes tasks with 0000-00-00 deadline", () => {
  const tasks = [makeTask("0000-00-00"), makeTask("2025-12-30")];
  const filtered = filterTasksByDeadline(tasks, { start: "2025-12-25", end: "2025-12-31" });
  assert.equal(filtered.length, 1);
});

test("includes tasks on boundary dates (inclusive)", () => {
  const tasks = [makeTask("2025-12-25"), makeTask("2025-12-31")];
  const filtered = filterTasksByDeadline(tasks, { start: "2025-12-25", end: "2025-12-31" });
  assert.equal(filtered.length, 2);
});

test("returns empty for no matching tasks", () => {
  const tasks = [makeTask("2025-11-30")];
  const filtered = filterTasksByDeadline(tasks, { start: "2025-12-01", end: "2025-12-31" });
  assert.equal(filtered.length, 0);
});
