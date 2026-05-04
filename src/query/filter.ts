// Query filter execution — applies QueryPresetFilters to EffectiveTask[].
//
// Pure function, no DOM, no Obsidian dependency.  Shared by GUI, CLI,
// and summary computation.
//
// ARCHITECTURE.md §4.2 defines the filter semantics:
//   - search: title/tag keyword match (case-insensitive)
//   - tags: AND match (all specified tags must be present)
//   - status: multi-select over effectiveStatus
//   - time: per-field date token matching using effective dates
//   - unscheduled: means effectiveScheduled is null

import type { EffectiveTask } from "../task-tree";
import type {
  QueryPresetFilters,
  SavedViewTimeField,
  SavedViewTimeFilters,
} from "../types";
import { normalizeSavedViewStatus } from "../saved-views";
import { taskMatchesTimeToken, timeTokenAppliesToField } from "../time-filter";
import { todayISO } from "../dates";

// ── Field helpers ──

/**
 * Get the effective time value for a time filter field.
 * Uses effective dates (post-inheritance), not raw parsed values.
 */
function effectiveTimeValue(
  task: EffectiveTask,
  field: SavedViewTimeField,
): string | null {
  switch (field) {
    case "scheduled":
      return task.effectiveScheduled;
    case "deadline":
      return task.effectiveDeadline;
    case "completed":
      return task.completed;
    case "created":
      return task.effectiveCreated ?? task.created;
    case "dropped":
      return task.cancelled;
    default:
      return null;
  }
}

// ── Normalization ──

function normalizeTags(tags: QueryPresetFilters["tags"]): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  // Comma-separated string
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalizeStatusFilter(
  status: QueryPresetFilters["status"],
): "all" | string[] {
  return normalizeSavedViewStatus(status);
}

// ── Individual filter predicates ──

function matchesSearch(task: EffectiveTask, q: string): boolean {
  const lower = q.toLowerCase();
  if (task.title.toLowerCase().includes(lower)) return true;
  for (const tag of task.tags) {
    if (tag.toLowerCase().includes(lower)) return true;
  }
  return false;
}

function matchesTags(task: EffectiveTask, wanted: string[]): boolean {
  for (const wantedTag of wanted) {
    const normalized = wantedTag.startsWith("#")
      ? wantedTag.toLowerCase()
      : `#${wantedTag.toLowerCase()}`;
    const found = task.tags.some(
      (t) => t.toLowerCase() === normalized,
    );
    if (!found) return false;
  }
  return true;
}

function matchesStatus(
  task: EffectiveTask,
  status: "all" | string[],
): boolean {
  if (status === "all") return true;
  // Use effectiveStatus (post terminal-inheritance), not raw checkbox status
  return status.includes(task.effectiveStatus);
}

function matchesTime(
  task: EffectiveTask,
  time: SavedViewTimeFilters,
  weekStartsOn: 0 | 1,
  today: string,
): boolean {
  for (const field of [
    "scheduled",
    "deadline",
    "completed",
    "created",
    "dropped",
  ] as SavedViewTimeField[]) {
    const token = time[field]?.trim();
    if (!token) continue;

    // ARCHITECTURE.md §4.2: "unscheduled" means effective scheduled is empty
    if (field === "scheduled" && token === "unscheduled") {
      if (task.effectiveScheduled !== null) return false;
      continue;
    }
    // "unscheduled" on non-scheduled fields: treated as "value is null"
    if (token === "unscheduled") {
      if (effectiveTimeValue(task, field) !== null) return false;
      continue;
    }

    // "overdue" and "next-7-days" only apply to deadline
    if (!timeTokenAppliesToField(field, token)) return false;

    const value = effectiveTimeValue(task, field);
    if (!taskMatchesTimeToken(value, token, weekStartsOn, today)) return false;
  }
  return true;
}

// ── Main entry point ──

/**
 * Apply QueryPreset filters to an array of EffectiveTask.
 *
 * All filters are AND-ed: a task must pass every active filter to be included.
 * Filters that are undefined/empty/absent are treated as "match all".
 *
 * @param tasks  EffectiveTask[] from deriveEffectiveTasks
 * @param filters  QueryPresetFilters from a QueryPreset
 * @param weekStartsOn  0=Sunday, 1=Monday
 * @param today  ISO date for "today" token (defaults to actual today)
 * @returns filtered EffectiveTask[]
 */
export function applyQueryFilters(
  tasks: EffectiveTask[],
  filters: QueryPresetFilters,
  weekStartsOn: 0 | 1,
  today: string = todayISO(),
): EffectiveTask[] {
  // Quick-pass: no active filters
  const searchQ = (filters.search ?? "").trim().toLowerCase();
  const tagList = normalizeTags(filters.tags);
  const statusFilter = normalizeStatusFilter(filters.status);
  const hasTime = Object.values(filters.time ?? {}).some(
    (v) => typeof v === "string" && v.trim(),
  );

  if (!searchQ && tagList.length === 0 && statusFilter === "all" && !hasTime) {
    return tasks;
  }

  return tasks.filter((task) => {
    if (searchQ && !matchesSearch(task, searchQ)) return false;
    if (tagList.length > 0 && !matchesTags(task, tagList)) return false;
    if (!matchesStatus(task, statusFilter)) return false;
    if (hasTime && !matchesTime(task, filters.time ?? {}, weekStartsOn, today))
      return false;
    return true;
  });
}
