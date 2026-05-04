// Summary computation — computes count, sum, ratio, top-N, and group-by
// over a filtered EffectiveTask[] using user-configured field names.
//
// ARCHITECTURE.md §4.4 defines the summary semantics.
// Pure functions, no DOM, no Obsidian dependency.

import type { EffectiveTask } from "../task-tree";
import type { QueryPresetSummaryMetric } from "../types";
import { formatMinutes } from "../parser";

// ── Result types ──

export interface CountResult {
  type: "count";
  value: number;
}

export interface SumResult {
  type: "sum";
  field: string;
  value: number;
  formatted?: string;
}

export interface RatioResult {
  type: "ratio";
  numerator: string;
  denominator: string;
  numeratorSum: number;
  denominatorSum: number;
  value: number; // 0-100 percentage by convention
  formatted?: string;
}

export interface TopNItem {
  key: string;
  count: number;
}

export interface TopNResult {
  type: "top_n";
  by: string;
  limit: number;
  items: TopNItem[];
}

export interface GroupByGroup {
  key: string;
  count: number;
}

export interface GroupByResult {
  type: "group_by";
  by: string;
  groups: GroupByGroup[];
}

export type SummaryResultItem =
  | CountResult
  | SumResult
  | RatioResult
  | TopNResult
  | GroupByResult;

// ── Field value extraction ──

/**
 * Get the numeric value of a user-configured field from a task.
 * Checks durationFields first (pre-parsed), then inlineFields (raw strings).
 */
function getFieldValue(task: EffectiveTask, field: string): number {
  // Pre-parsed duration fields (minutes)
  if (task.durationFields && typeof task.durationFields[field] === "number") {
    return task.durationFields[field];
  }
  // Raw inline fields — attempt to parse as minutes
  if (task.inlineFields && Array.isArray(task.inlineFields[field])) {
    const raw = task.inlineFields[field][0];
    if (typeof raw === "string") {
      const parsed = parseMinutes(raw);
      if (parsed !== null) return parsed;
    }
  }
  return 0;
}

function parseMinutes(raw: string): number | null {
  const trimmed = raw.trim();
  // "1h30m", "90m", "1.5h"
  let total = 0;
  const hourMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*h$/i);
  if (hourMatch) return Math.round(parseFloat(hourMatch[1]) * 60);

  const combinedMatch = trimmed.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/i);
  if (combinedMatch) {
    if (combinedMatch[1]) total += parseInt(combinedMatch[1], 10) * 60;
    if (combinedMatch[2]) total += parseInt(combinedMatch[2], 10);
    if (combinedMatch[1] || combinedMatch[2]) return total;
  }

  // Simple number (assume minutes)
  const numMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) return Math.round(parseFloat(numMatch[1]));

  return null;
}

function formatDuration(minutes: number): string {
  return formatMinutes(minutes);
}

// ── Metric extractors ──

function collectFieldValues(tasks: EffectiveTask[], field: string): string[] {
  const values: string[] = [];
  if (field === "tag") {
    for (const task of tasks) {
      for (const tag of task.tags) {
        values.push(tag.toLowerCase());
      }
    }
  } else {
    // User-configured inline field
    for (const task of tasks) {
      if (task.inlineFields && Array.isArray(task.inlineFields[field])) {
        for (const val of task.inlineFields[field]) {
          if (typeof val === "string" && val.trim()) {
            values.push(val.trim());
          }
        }
      }
    }
  }
  return values;
}

// ── Metric computers ──

function computeCount(tasks: EffectiveTask[]): CountResult {
  return { type: "count", value: tasks.length };
}

function computeSum(
  tasks: EffectiveTask[],
  metric: QueryPresetSummaryMetric,
): SumResult {
  const field = metric.field ?? "actual";
  let total = 0;
  for (const task of tasks) {
    total += getFieldValue(task, field);
  }

  const result: SumResult = { type: "sum", field, value: total };
  if (metric.format === "duration") {
    result.formatted = formatDuration(total);
  }
  return result;
}

function computeRatio(
  tasks: EffectiveTask[],
  metric: QueryPresetSummaryMetric,
): RatioResult {
  const numerator = metric.numerator ?? "actual";
  const denominator = metric.denominator ?? "estimate";
  let numSum = 0;
  let denSum = 0;

  for (const task of tasks) {
    const numVal = getFieldValue(task, numerator);
    const denVal = getFieldValue(task, denominator);
    if (numVal > 0 || denVal > 0) {
      numSum += numVal;
      denSum += denVal;
    }
  }

  let value: number;
  if (denSum > 0) {
    // By convention, ratio returns percentage (0-100)
    value = Math.round((numSum / denSum) * 100);
  } else {
    value = 0;
  }

  const result: RatioResult = {
    type: "ratio",
    numerator,
    denominator,
    numeratorSum: numSum,
    denominatorSum: denSum,
    value,
  };

  if (metric.format === "percent") {
    result.formatted = `${value}%`;
  }

  return result;
}

function computeTopN(
  tasks: EffectiveTask[],
  metric: QueryPresetSummaryMetric,
): TopNResult {
  const by = metric.by ?? "tag";
  const limit = metric.limit ?? 5;
  const values = collectFieldValues(tasks, by);

  // Count occurrences
  const counter = new Map<string, number>();
  for (const val of values) {
    counter.set(val, (counter.get(val) ?? 0) + 1);
  }

  // Sort by count desc, then by key asc
  const items: TopNItem[] = Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));

  return { type: "top_n", by, limit, items };
}

function computeGroupBy(
  tasks: EffectiveTask[],
  metric: QueryPresetSummaryMetric,
): GroupByResult {
  const by = metric.by ?? "tag";
  const values = collectFieldValues(tasks, by);

  const counter = new Map<string, number>();
  for (const val of values) {
    counter.set(val, (counter.get(val) ?? 0) + 1);
  }

  const groups: GroupByGroup[] = Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));

  return { type: "group_by", by, groups };
}

// ── Main entry point ──

/**
 * Compute summary metrics over a filtered EffectiveTask[].
 *
 * Each metric is computed independently using user-configured field names.
 * No hardcoded field names like "estimate"/"actual" — those are only used
 * as default field values in the builtin presets, not in the computation.
 *
 * @param tasks    Filtered EffectiveTask[] (output of applyQueryFilters)
 * @param metrics  QueryPresetSummaryMetric[] from the active QueryPreset
 * @returns SummaryResultItem[] for rendering
 */
export function computeSummary(
  tasks: EffectiveTask[],
  metrics: QueryPresetSummaryMetric[],
): SummaryResultItem[] {
  const results: SummaryResultItem[] = [];

  for (const metric of metrics) {
    switch (metric.type) {
      case "count":
        results.push(computeCount(tasks));
        break;
      case "sum":
        results.push(computeSum(tasks, metric));
        break;
      case "ratio":
        results.push(computeRatio(tasks, metric));
        break;
      case "top_n":
        results.push(computeTopN(tasks, metric));
        break;
      case "group_by":
        results.push(computeGroupBy(tasks, metric));
        break;
      default:
        // Unknown metric type — skip silently
        break;
    }
  }

  return results;
}
