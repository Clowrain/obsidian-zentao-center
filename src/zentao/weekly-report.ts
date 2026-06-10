import { TFile, type App } from "obsidian";
import { addDays, endOfWeek, fromISO, isoWeekNumber, pad, startOfWeek, todayISO } from "../dates";
import type { ParsedTask } from "../types";
import type { MapperOptions, ZentaoTask } from "./mapper";
import type { ZentaoClient } from "./client";
import type { ZentaoSettings } from "./types";

export interface WeeklyRange {
	start: string;
	end: string;
}

export interface WeeklyDateRanges {
	thisWeek: WeeklyRange;
	nextWeek: WeeklyRange;
}

export interface WeeklyReportResult {
	path: string;
	weekNum: number;
	weekStart: string;
	completedCount: number;
	plannedCount: number;
}

// ── Helper functions ──

/** Calculate ISO week number. */
export function getWeekNumber(date: string): number {
	return isoWeekNumber(date);
}

/** Get this week and next week date ranges. */
export function getWeeklyDateRange(weekStartsOn: 0 | 1 = 1): WeeklyDateRanges {
	const today = todayISO();
	const thisWeekStart = startOfWeek(today, weekStartsOn);
	const nextWeekStart = addDays(thisWeekStart, 7);
	return {
		thisWeek: {
			start: thisWeekStart,
			end: endOfWeek(today, weekStartsOn),
		},
		nextWeek: {
			start: nextWeekStart,
			end: endOfWeek(nextWeekStart, weekStartsOn),
		},
	};
}

/** Filter tasks completed this week (status=done/closed, finishedDate in range). */
export function filterCompletedThisWeek(tasks: ZentaoTask[], thisWeek: WeeklyRange): ZentaoTask[] {
	return tasks.filter((task) => {
		if (task.status !== "done" && task.status !== "closed") return false;
		const finishedDate = task.finishedDate?.slice(0, 10) ?? "";
		if (!/^\d{4}-\d{2}-\d{2}$/.test(finishedDate)) return false;
		return finishedDate >= thisWeek.start && finishedDate <= thisWeek.end;
	});
}

export function filterCompletedFromCache(tasks: ParsedTask[], thisWeek: WeeklyRange): ZentaoTask[] {
	return tasks.filter((task) => {
		const zentaoMatch = task.rawLine?.match(/\[zentao::\s*(\d+)\]/);
		if (!zentaoMatch) return false;
		if (task.status !== "done") return false;
		const completedMatch = task.rawLine?.match(/✅\s*(\d{4}-\d{2}-\d{2})/);
		if (!completedMatch) return false;
		const completedDate = completedMatch[1];
		return completedDate >= thisWeek.start && completedDate <= thisWeek.end;
	}).map((task) => ({
		id: parseInt(task.rawLine?.match(/\[zentao::\s*(\d+)\]/)?.[1] || "0"),
		name: task.title,
		status: "done",
		finishedDate: task.rawLine?.match(/✅\s*(\d{4}-\d{2}-\d{2})/)?.[1] || "",
		project: 0,
		projectName: "",
		execution: 0,
		parent: 0,
		type: "",
		pri: 3,
		deadline: "",
		estStarted: "",
		estimate: "0",
		consumed: "0",
		assignedTo: "",
		openedBy: "",
		openedDate: "",
		finishedBy: null,
		closedDate: "",
		desc: "",
	}));
}

/** Filter tasks planned for next week (status=wait/doing, deadline in range). */
export function filterPlannedNextWeek(tasks: ZentaoTask[], nextWeek: WeeklyRange): ZentaoTask[] {
	return tasks.filter((task) => {
		if (task.status !== "wait" && task.status !== "doing") return false;
		const deadline = task.deadline?.slice(0, 10) ?? "";
		if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return false;
		return deadline >= nextWeek.start && deadline <= nextWeek.end;
	});
}

/** Group tasks by project name. */
function groupTasksByProject(tasks: ZentaoTask[]): Map<string, ZentaoTask[]> {
	const groups = new Map<string, ZentaoTask[]>();
	for (const task of tasks) {
		const projectName = task.projectName || `项目${task.project}`;
		const existing = groups.get(projectName) || [];
		existing.push(task);
		groups.set(projectName, existing);
	}
	return groups;
}

/** Format weekday label: 周一/周二/周三/周四/周五/周六/周日. */
function formatWeekday(date: string): string {
	const d = fromISO(date);
	const dow = d.getDay(); // 0 Sun .. 6 Sat
	const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
	return weekdays[dow];
}

/** Format hours: 8h/2h/0.5h. */
function formatHours(hoursStr: string): string {
	const h = parseFloat(hoursStr);
	if (!h || h <= 0) return "";
	const hours = Math.floor(h);
	const minutes = Math.round((h - hours) * 60);
	if (hours === 0) return `${minutes}m`;
	if (minutes === 0) return `${hours}h`;
	return `${hours}h${minutes}m`;
}

/** Get the latest date from a group of tasks (for 本周工作 project title). */
function getLatestCompletedDate(tasks: ZentaoTask[]): string | null {
	let latest = "";
	for (const task of tasks) {
		const fd = task.finishedDate?.slice(0, 10) ?? "";
		if (fd && /^\d{4}-\d{2}-\d{2}$/.test(fd) && fd > latest) {
			latest = fd;
		}
	}
	return latest || null;
}

/** Get the earliest deadline from a group of tasks (for 下周工作 project title). */
function getEarliestDeadline(tasks: ZentaoTask[]): string | null {
	let earliest = "";
	for (const task of tasks) {
		const dl = task.deadline?.slice(0, 10) ?? "";
		if (dl && /^\d{4}-\d{2}-\d{2}$/.test(dl)) {
			if (!earliest || dl < earliest) {
				earliest = dl;
			}
		}
	}
	return earliest || null;
}

/** Render timestamp for report footer. */
function timestamp(): string {
	const now = new Date();
	return `${todayISO()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// ── Report rendering ──

/** Render new weekly report format with project grouping. */
export function renderWeeklyReport(
	completed: ZentaoTask[],
	planned: ZentaoTask[],
	weekNum: number,
	weekStart: string,
	weekStartsOn: 0 | 1 = 1,
): string {
	const lines: string[] = [];

	// 本周工作
	lines.push("---");
	lines.push("# 本周工作");
	lines.push("---");
	lines.push("");
	const completedGroups = groupTasksByProject(completed);
	if (completedGroups.size === 0) {
		lines.push("无");
	} else {
		for (const [projectName, tasks] of completedGroups) {
			lines.push(`## ${projectName}`);
			// 按 finishedDate 排序（周一→周日）
			const sorted = [...tasks].sort((a, b) => {
				const aDate = a.finishedDate?.slice(0, 10) ?? "";
				const bDate = b.finishedDate?.slice(0, 10) ?? "";
				return aDate.localeCompare(bDate);
			});
			for (const task of sorted) {
				const fd = task.finishedDate?.slice(0, 10) ?? "";
				const weekday = fd ? formatWeekday(fd) : "";
				lines.push(`- ${task.name}（${weekday} 完成）`);
			}
		}
	}

	lines.push("");
	lines.push("---");
	lines.push("# 下周工作");
	lines.push("---");
	lines.push("");
	const plannedGroups = groupTasksByProject(planned);
	if (plannedGroups.size === 0) {
		lines.push("无");
	} else {
		for (const [projectName, tasks] of plannedGroups) {
			lines.push(`## ${projectName}`);
			// 按 deadline 排序（周一→周日）
			const sorted = [...tasks].sort((a, b) => {
				const aDate = a.deadline?.slice(0, 10) ?? "";
				const bDate = b.deadline?.slice(0, 10) ?? "";
				return aDate.localeCompare(bDate);
			});
			for (const task of sorted) {
				const dl = task.deadline?.slice(0, 10) ?? "";
				const hours = formatHours(task.estimate);
				const weekday = dl ? formatWeekday(dl) : "";
				const taskLine = hours ? `${task.name} （${hours} ${weekday}）` : `${task.name} （${weekday}）`;
				lines.push(`- ${taskLine}`);
			}
		}
	}

	return lines.join("\n");
}

// ── File writing ──

async function writeWeeklyReport(app: App, path: string, content: string): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.process(existing, () => content);
		return;
	}

	const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
	if (dir) {
		await app.vault.adapter.mkdir(dir).catch(() => {});
	}
	await app.vault.create(path, content);
}

// ── Main entry ──

export async function generateWeeklyReport(
	client: ZentaoClient,
	settings: ZentaoSettings,
	app: App,
	tasks: ParsedTask[] | MapperOptions | 0 | 1 = [],
	weekStartsOn: 0 | 1 = 1,
): Promise<WeeklyReportResult> {
	const cachedTasks = Array.isArray(tasks) ? tasks : [];
	const resolvedWeekStartsOn = typeof tasks === "number" ? tasks : weekStartsOn;
	const zentaoTasks = settings.syncMode === "manual"
		? await client.fetchAssignedToMeTasks(settings.selectedExecutionIds)
		: await client.fetchAllAssignedToMe();

	const { thisWeek, nextWeek } = getWeeklyDateRange(resolvedWeekStartsOn);
	const weekNum = getWeekNumber(thisWeek.start);
	const completed = cachedTasks.length > 0
		? filterCompletedFromCache(cachedTasks, thisWeek)
		: filterCompletedThisWeek(zentaoTasks, thisWeek);
	const planned = filterPlannedNextWeek(zentaoTasks, nextWeek);
	const content = renderWeeklyReport(completed, planned, weekNum, thisWeek.start, resolvedWeekStartsOn);
	const folder = settings.weeklyReportFolder || "WeeklyReports";
	const path = `${folder}/${thisWeek.start}（第${weekNum}周）.md`;

	await writeWeeklyReport(app, path, content);

	return {
		path,
		weekNum,
		weekStart: thisWeek.start,
		completedCount: completed.length,
		plannedCount: planned.length,
	};
}
