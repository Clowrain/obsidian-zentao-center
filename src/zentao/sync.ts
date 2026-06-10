// US-816~818: Zentao sync orchestration.
// Coordinates: fetch tasks → map to Obsidian format → dedup → write to target file.
// Uses vault.process for atomic writes (consistent with writer.ts).

import { TFile, type App } from "obsidian";
import { ZentaoClient } from "./client";
import { mapZentaoTask, extractZentaoId, hasTaskChanged, type MapperOptions, type ZentaoTask } from "./mapper";
import type { ZentaoSettings } from "./types";
import { todayISO, startOfWeek, endOfWeek, addDays, shiftMonth } from "../dates";

// ── Types ──

export interface SyncResult {
	added: number;
	updated: number;
	skipped: number;
	errors: string[];
}

export interface DateRange {
	start: string; // YYYY-MM-DD
	end: string;   // YYYY-MM-DD
}

// ── Date range computation (US-810) ──

export function getDateRangeForTab(
	tabPreset?: string,
	weekStartsOn: 0 | 1 = 1,
): DateRange | null {
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
			return null; // No date range filter
	}
}

/** Filter Zentao tasks by deadline within a date range (client-side).
 *  Tasks without a valid deadline are KEPT (they still need syncing). */
export function filterTasksByDeadline(
	tasks: ZentaoTask[],
	range: DateRange,
): ZentaoTask[] {
	return tasks.filter((t) => {
		if (!t.deadline || t.deadline === "0000-00-00") return true;
		const d = t.deadline.slice(0, 10);
		return d >= range.start && d <= range.end;
	});
}

// ── Dedup index ──

interface ExistingLine {
	lineIndex: number; // 0-based line number
	rawLine: string;
}

function buildZentaoIndex(content: string): Map<number, ExistingLine> {
	const index = new Map<number, ExistingLine>();
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const id = extractZentaoId(lines[i]);
		if (id !== null) {
			index.set(id, { lineIndex: i, rawLine: lines[i] });
		}
	}
	return index;
}

// ── Daily Note path resolution ──

interface DailyNotesOptions {
	folder?: string;
	format?: string;
	extension?: string;
}

interface DailyNotesPluginInstance {
	options?: DailyNotesOptions;
}

interface DailyNotesPluginEntry {
	enabled?: boolean;
	instance?: DailyNotesPluginInstance;
}

interface AppWithInternalPlugins extends App {
	internalPlugins?: {
		getPluginById(id: string): DailyNotesPluginEntry | undefined;
	};
}

function getDailyNotePath(app: App): string | null {
	const internalPlugins = (app as AppWithInternalPlugins).internalPlugins;
	const dailyNotesPlugin = internalPlugins?.getPluginById("daily-notes");
	if (!dailyNotesPlugin?.enabled) return null;
	const config = dailyNotesPlugin.instance?.options;
	if (!config?.folder) return null;
	const today = todayISO();
	const fmt = config.format || "YYYY-MM-DD";
	const fileName = fmt
		.replace("YYYY", today.slice(0, 4))
		.replace("MM", today.slice(5, 7))
		.replace("DD", today.slice(8, 10));
	const ext = config.extension || "md";
	return `${config.folder}/${fileName}.${ext}`;
}

function resolveSyncTargetPath(task: ZentaoTask, baseFolder: string): string {
	const safeProjectName = (task.projectName || `项目${task.project}`).replace(/[\/\\:*?"<>|]/g, "_");
	const safeExecutionName = task.executionName ? task.executionName.replace(/[\/\\:*?"<>|]/g, "_") : "";
	if (!safeExecutionName || safeExecutionName === safeProjectName) {
		return `${baseFolder}/${safeProjectName}/${safeProjectName}.md`;
	}
	return `${baseFolder}/${safeProjectName}/${safeExecutionName}.md`;
}

// ── Helper: Sync tasks to a single file ──

async function syncTasksToFile(
	vault: App["vault"],
	targetPath: string,
	tasks: ZentaoTask[],
	mapperOpts: MapperOptions,
): Promise<{ added: number; updated: number; skipped: number; error?: string }> {
	const result = { added: 0, updated: 0, skipped: 0 };

	// Read existing file and build dedup index
	let existingContent = "";
	try {
		if (await vault.adapter.exists(targetPath)) {
			existingContent = await vault.adapter.read(targetPath);
		}
	} catch {
		// File may not exist yet
	}

	const zentaoIndex = buildZentaoIndex(existingContent);
	const lines = existingContent ? existingContent.split("\n") : [];

	// Process each task
	for (const task of tasks) {
		const mapped = mapZentaoTask(task, mapperOpts);
		const existing = zentaoIndex.get(task.id);

		if (existing) {
			if (hasTaskChanged(task, existing.rawLine, mapperOpts)) {
				// Update existing line
				lines[existing.lineIndex] = mapped;
				result.updated++;
			} else {
				result.skipped++;
			}
		} else {
			// Append new task
			if (lines.length > 0 && lines[lines.length - 1] !== "") {
				lines.push(""); // Blank line separator
			}
			lines.push(mapped);
			result.added++;
		}
	}

	// Write back atomically
	try {
		const newContent = lines.join("\n");
		const fileExists = await vault.adapter.exists(targetPath);
		if (fileExists) {
			const file = vault.getAbstractFileByPath(targetPath);
			if (file instanceof TFile) {
				await vault.process(file, () => newContent);
			} else {
				await vault.adapter.write(targetPath, newContent);
			}
		} else {
			const dir = targetPath.substring(0, targetPath.lastIndexOf("/"));
			if (dir) {
				await vault.adapter.mkdir(dir).catch(() => {});
			}
			await vault.create(targetPath, newContent);
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		result.error = msg;
	}

	return result;
}

// ── Main sync function ──

export async function syncZentaoTasks(
	client: ZentaoClient,
	settings: ZentaoSettings,
	app: App,
	mapperOpts: MapperOptions,
	dateRange?: DateRange | null,
): Promise<SyncResult> {
	const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: [] };

	// 1. Fetch tasks from Zentao
	let tasks: ZentaoTask[];
	try {
		if (settings.syncMode === "manual") {
			tasks = await client.fetchAssignedToMeTasks(settings.selectedExecutionIds);
		} else {
			tasks = await client.fetchAllAssignedToMe();
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		result.errors.push(`拉取任务失败: ${msg}`);
		return result;
	}

	// 2. Filter by date range if provided
	if (dateRange) {
		tasks = filterTasksByDeadline(tasks, dateRange);
	}

	if (tasks.length === 0) {
		return result;
	}

	const vault = app.vault;

	// 3. Branch by sync target mode
	if (settings.syncTarget === "project-folder") {
		const folder = settings.projectFolder || "ZentaoTasks";
		const pathGroups = new Map<string, ZentaoTask[]>();
		for (const task of tasks) {
			const targetPath = resolveSyncTargetPath(task, folder);
			const group = pathGroups.get(targetPath) || [];
			group.push(task);
			pathGroups.set(targetPath, group);
		}

		for (const [targetPath, targetTasks] of pathGroups) {
			const dir = targetPath.substring(0, targetPath.lastIndexOf("/"));
			if (dir) {
				await vault.adapter.mkdir(dir).catch(() => {});
			}

			const fileResult = await syncTasksToFile(vault, targetPath, targetTasks, mapperOpts);
			result.added += fileResult.added;
			result.updated += fileResult.updated;
			result.skipped += fileResult.skipped;
			if (fileResult.error) {
				result.errors.push(`${targetPath}: ${fileResult.error}`);
			}
		}
	} else {
		// Single file mode (daily-note or specified-file)
		let targetPath: string;
		if (settings.syncTarget === "daily-note") {
			const dailyPath = getDailyNotePath(app);
			if (!dailyPath) {
				result.errors.push("Daily Notes 不可用，请先启用 Daily Notes 并设置文件夹");
				return result;
			}
			targetPath = dailyPath;
		} else {
			targetPath = settings.specifiedFilePath;
			if (!targetPath) {
				result.errors.push("未指定同步目标文件");
				return result;
			}
		}

		const fileResult = await syncTasksToFile(vault, targetPath, tasks, mapperOpts);
		result.added = fileResult.added;
		result.updated = fileResult.updated;
		result.skipped = fileResult.skipped;
		if (fileResult.error) {
			result.errors.push(fileResult.error);
		}
	}

	return result;
}
