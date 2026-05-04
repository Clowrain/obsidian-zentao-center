// View projection — projects a filtered EffectiveTask[] into layout models
// for list, week, month, and matrix views.  Does NOT own business collections;
// Today/TODO/Unscheduled/Completed/Dropped are QueryPresets, not view types.
//
// ARCHITECTURE.md §4.3 defines the projection semantics.
// Pure functions, no DOM, no Obsidian dependency.

import type { EffectiveTask } from "../task-tree";
import type {
  QueryPresetViewConfig,
} from "../types";
import { applyQueryFilters } from "./filter";
import { startOfWeek, addDays, startOfMonth, endOfMonth, daysBetween, todayISO } from "../dates";

// ── View model types ──

export interface ListSectionModel {
  title: string;
  tasks: EffectiveTask[];
}

export interface DayColumnModel {
  date: string;
  tasks: EffectiveTask[];
}

export interface MonthCellModel {
  date: string;
  tasks: EffectiveTask[];
}

export interface MatrixBucketModel {
  id: string;
  title: string;
  tasks: EffectiveTask[];
}

export interface ListViewModel {
  type: "list";
  sections: ListSectionModel[];
}

export interface WeekViewModel {
  type: "week";
  days: DayColumnModel[];
  tray?: ListSectionModel;
}

export interface MonthViewModel {
  type: "month";
  cells: MonthCellModel[];
  tray?: ListSectionModel;
}

export interface MatrixViewModel {
  type: "matrix";
  buckets: MatrixBucketModel[];
  unmatched: EffectiveTask[];
}

export type ViewModel =
  | ListViewModel
  | WeekViewModel
  | MonthViewModel
  | MatrixViewModel;

// ── Sorting ──

type SortKey = "title_asc" | "title_desc" | "scheduled_asc" | "scheduled_desc"
  | "deadline_asc" | "deadline_desc" | "completed_desc" | "created_desc"
  | "deadline_risk" | "priority_desc";

function parseSortKey(raw: string): SortKey | null {
  const valid = new Set<string>([
    "title_asc", "title_desc", "scheduled_asc", "scheduled_desc",
    "deadline_asc", "deadline_desc", "completed_desc", "created_desc",
    "deadline_risk", "priority_desc",
  ]);
  return valid.has(raw) ? (raw as SortKey) : null;
}

function sortTasks(tasks: EffectiveTask[], orderBy?: string[]): EffectiveTask[] {
  if (!orderBy || orderBy.length === 0) return tasks;
  const keys = orderBy.map(parseSortKey).filter((k): k is SortKey => k !== null);
  if (keys.length === 0) return tasks;

  return [...tasks].sort((a, b) => {
    for (const key of keys) {
      const cmp = compareByKey(a, b, key);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

function compareByKey(a: EffectiveTask, b: EffectiveTask, key: SortKey): number {
  switch (key) {
    case "title_asc":
      return a.title.localeCompare(b.title);
    case "title_desc":
      return b.title.localeCompare(a.title);
    case "scheduled_asc":
      return (a.effectiveScheduled ?? "9999").localeCompare(b.effectiveScheduled ?? "9999");
    case "scheduled_desc":
      return (b.effectiveScheduled ?? "0000").localeCompare(a.effectiveScheduled ?? "0000");
    case "deadline_asc":
      return (a.effectiveDeadline ?? "9999").localeCompare(b.effectiveDeadline ?? "9999");
    case "deadline_desc":
      return (b.effectiveDeadline ?? "0000").localeCompare(a.effectiveDeadline ?? "0000");
    case "deadline_risk": {
      // Urgent (overdue) first, then nearest deadline, then no deadline
      const today = todayISO();
      const aRisk = deadlineRisk(a, today);
      const bRisk = deadlineRisk(b, today);
      if (aRisk !== bRisk) return aRisk - bRisk;
      return (a.effectiveDeadline ?? "9999").localeCompare(b.effectiveDeadline ?? "9999");
    }
    case "completed_desc":
      return (b.completed ?? "0000").localeCompare(a.completed ?? "0000");
    case "created_desc":
      return (b.effectiveCreated ?? "0000").localeCompare(a.effectiveCreated ?? "0000");
    case "priority_desc":
      return (priorityRank(b.priority) - priorityRank(a.priority));
    default:
      return 0;
  }
}

function deadlineRisk(t: EffectiveTask, today: string): number {
  if (!t.effectiveDeadline) return 3; // no deadline
  if (t.effectiveDeadline < today) return 0; // overdue
  const diff = daysBetween(today, t.effectiveDeadline);
  if (diff <= 3) return 1; // soon
  return 2; // later
}

function priorityRank(p: string | null): number {
  switch (p) {
    case "🔺": return 5;
    case "⏫": return 4;
    case "🔼": return 3;
    case "🔽": return 2;
    case "⏬": return 1;
    default: return 0;
  }
}

// ── Projections ──

function projectList(
  tasks: EffectiveTask[],
  view: QueryPresetViewConfig,
): ListViewModel {
  const sorted = sortTasks(tasks, view.orderBy);
  return {
    type: "list",
    sections: [{ title: "Tasks", tasks: sorted }],
  };
}

function projectWeek(
  tasks: EffectiveTask[],
  view: QueryPresetViewConfig,
  weekStartsOn: 0 | 1,
  anchorISO: string,
): WeekViewModel {
  const weekStart = startOfWeek(anchorISO, weekStartsOn);
  const days: DayColumnModel[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    days.push({ date, tasks: [] });
  }

  const unscheduled: EffectiveTask[] = [];

  const sorted = sortTasks(tasks, view.orderBy);
  for (const task of sorted) {
    if (task.effectiveScheduled) {
      const dayCol = days.find((d) => d.date === task.effectiveScheduled);
      if (dayCol) {
        dayCol.tasks.push(task);
        continue;
      }
    }
    unscheduled.push(task);
  }

  return {
    type: "week",
    days,
    ...(unscheduled.length > 0 ? { tray: { title: "Unscheduled", tasks: unscheduled } } : {}),
  };
}

function projectMonth(
  tasks: EffectiveTask[],
  view: QueryPresetViewConfig,
  anchorISO: string,
): MonthViewModel {
  const monthStart = startOfMonth(anchorISO);
  const monthEnd = endOfMonth(anchorISO);
  const totalDays = daysBetween(monthStart, monthEnd) + 1;

  // Build cells for every day in the month.
  const cells: MonthCellModel[] = [];
  for (let i = 0; i < totalDays; i++) {
    cells.push({ date: addDays(monthStart, i), tasks: [] });
  }

  const unscheduled: EffectiveTask[] = [];

  const sorted = sortTasks(tasks, view.orderBy);
  for (const task of sorted) {
    if (task.effectiveScheduled) {
      const cell = cells.find((c) => c.date === task.effectiveScheduled);
      if (cell) {
        cell.tasks.push(task);
        continue;
      }
    }
    unscheduled.push(task);
  }

  return {
    type: "month",
    cells,
    ...(unscheduled.length > 0 ? { tray: { title: "Unscheduled", tasks: unscheduled } } : {}),
  };
}

function projectMatrix(
  tasks: EffectiveTask[],
  view: QueryPresetViewConfig,
  weekStartsOn: 0 | 1,
): MatrixViewModel {
  const mx = view.matrix;
  if (!mx) {
    return { type: "matrix", buckets: [], unmatched: tasks };
  }

  const buckets: MatrixBucketModel[] = [];
  const matchedIds = new Set<string>();

  // Flatten all axis buckets.
  const allBuckets: { axis: "x" | "y"; bucket: NonNullable<typeof mx>["x"]["buckets"][number] }[] = [];
  if (mx.x?.buckets) {
    for (const b of mx.x.buckets) {
      allBuckets.push({ axis: "x", bucket: b });
    }
  }
  if (mx.y?.buckets) {
    for (const b of mx.y.buckets) {
      allBuckets.push({ axis: "y", bucket: b });
    }
  }

  for (const { bucket } of allBuckets) {
    // Use applyQueryFilters to check if a task matches the bucket's conditions.
    const bucketTasks = tasks.filter((task) => {
      const results = applyQueryFilters([task], bucket.when ?? {}, weekStartsOn);
      return results.length > 0;
    });

    for (const t of bucketTasks) {
      if (mx.multiMatch !== "duplicate" && matchedIds.has(t.id)) continue;
      matchedIds.add(t.id);
    }

    buckets.push({
      id: bucket.id,
      title: bucket.title,
      tasks: bucketTasks.filter((t) => mx.multiMatch === "duplicate" || !matchedIds.has(t.id) || bucketTasks.includes(t)),
    });
  }

  // Fix: for multiMatch=first, deduplicate after collecting
  if (mx.multiMatch !== "duplicate") {
    const seen = new Set<string>();
    for (const b of buckets) {
      b.tasks = b.tasks.filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
    }
  }

  // Unmatched tasks: those not in any bucket
  const allBucketTaskIds = new Set<string>();
  for (const b of buckets) {
    for (const t of b.tasks) allBucketTaskIds.add(t.id);
  }

  const unmatched = mx.unmatched === "hide"
    ? []
    : tasks.filter((t) => !allBucketTaskIds.has(t.id));

  return {
    type: "matrix",
    buckets,
    unmatched: sortTasks(unmatched, view.orderBy),
  };
}

// ── Main entry point ──

/**
 * Project a filtered EffectiveTask[] into a view layout model.
 *
 * The same task set can be projected into list, week, month, or matrix.
 * Views do not own business collections — they only organize the given tasks.
 *
 * @param tasks  Filtered EffectiveTask[] (output of applyQueryFilters)
 * @param view   QueryPresetViewConfig from the active QueryPreset
 * @param weekStartsOn  0=Sunday, 1=Monday
 * @param anchorISO  ISO date for the current view cursor (defaults to today)
 * @returns ViewModel for rendering
 */
export function applyViewProjection(
  tasks: EffectiveTask[],
  view: QueryPresetViewConfig,
  weekStartsOn: 0 | 1,
  anchorISO: string = todayISO(),
): ViewModel {
  switch (view.type) {
    case "list":
      return projectList(tasks, view);
    case "week":
      return projectWeek(tasks, view, weekStartsOn, anchorISO);
    case "month":
      return projectMonth(tasks, view, anchorISO);
    case "matrix":
      return projectMatrix(tasks, view, weekStartsOn);
    default:
      return projectList(tasks, view);
  }
}
