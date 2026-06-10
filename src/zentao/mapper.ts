// US-813~815: Maps Zentao task API response to Obsidian Markdown task line.
// Pure functions — no DOM, no Obsidian API dependency.
// Respects taskFormatFlavor: Tasks emoji or Dataview bracket inline fields.

// ── Zentao API response types (subset used for mapping) ──

export interface ZentaoUserRef {
	id: number;
	account: string;
	avatar: string;
	realname: string;
}

export interface ZentaoTask {
	id: number;
	project: number;
	projectName?: string;  // Project name for file grouping
	execution: number;
	executionName?: string;
	parent: number;
	name: string;
	type: string;       // devel | design | test | study | discuss | ui | affair | misc
	pri: number;        // 1~4
	status: string;     // wait | doing | done | closed | cancel
	deadline: string;   // YYYY-MM-DD or "" or "0000-00-00"
	estStarted: string; // YYYY-MM-DD or "" or "0000-00-00"
	estimate: string;   // float hours as string
	consumed: string;   // float hours as string
	assignedTo: string | ZentaoUserRef;
	openedBy: string | ZentaoUserRef;
	openedDate: string;
	finishedBy: string | ZentaoUserRef | null;
	finishedDate: string; // datetime or "" or "0000-00-00 00:00:00"
	closedDate: string;
	desc: string;
}

// ── Mapper options ──

export type TaskFormatFlavor = "tasks" | "dataview";

export interface MapperOptions {
	taskFormatFlavor: TaskFormatFlavor;
	/** Zentao server URL for generating task detail link */
	serverUrl?: string;
}

// ── Internal helpers ──

const ZENTAO_INVALID_DATES = new Set(["", "0000-00-00", "0000-00-00 00:00:00"]);

function isValidZentaoDate(value: string | null | undefined): value is string {
	if (!value) return false;
	return !ZENTAO_INVALID_DATES.has(value.trim()) && /^\d{4}-\d{2}-\d{2}/.test(value);
}

function extractDate(value: string): string | null {
	if (!isValidZentaoDate(value)) return null;
	return value.slice(0, 10); // YYYY-MM-DD
}

function formatHours(hoursStr: string): string | null {
	const h = parseFloat(hoursStr);
	if (!h || h <= 0) return null;
	// e.g. 1.5 → "1h30m", 2 → "2h", 0.5 → "30m"
	const hours = Math.floor(h);
	const minutes = Math.round((h - hours) * 60);
	if (hours === 0) return `${minutes}m`;
	if (minutes === 0) return `${hours}h`;
	return `${hours}h${minutes}m`;
}

function priorityEmoji(pri: number): string {
	switch (pri) {
		case 1: return "⏫";
		case 2: return "🔼";
		case 3: return "🔽";
		case 4: return "⏬";
		default: return "";
	}
}

function priorityDataview(pri: number): string {
	switch (pri) {
		case 1: return "high";
		case 2: return "medium";
		case 3: return "low";
		case 4: return "lowest";
		default: return "";
	}
}

// ── Public API ──

/** Map a Zentao task to an Obsidian Markdown task line. */
export function mapZentaoTask(task: ZentaoTask, options: MapperOptions): string {
	const { taskFormatFlavor } = options;
	const isTasks = taskFormatFlavor === "tasks";

	// Checkbox status
	let checkbox = " ";
	let completionDate = "";
	if (task.status === "done" || task.status === "closed") {
		checkbox = "x";
		const fd = extractDate(task.finishedDate);
		completionDate = fd ?? extractDate(task.closedDate) ?? "";
	} else if (task.status === "cancel") {
		checkbox = "-";
		completionDate = extractDate(task.closedDate) ?? "";
	}

	// Build title with metadata tokens
	const tokens: string[] = [];

	// Priority
	if (task.pri >= 1 && task.pri <= 4) {
		tokens.push(isTasks ? priorityEmoji(task.pri) : `[priority:: ${priorityDataview(task.pri)}]`);
	}

	// Deadline (⏳)
	const deadline = extractDate(task.deadline);
	if (deadline) {
		tokens.push(isTasks ? `⏳ ${deadline}` : `[due:: ${deadline}]`);
	}

	// Estimate
	const estimateStr = formatHours(task.estimate);
	if (estimateStr) {
		tokens.push(`[estimate:: ${estimateStr}]`);
	}

	// Consumed / actual
	const actualStr = formatHours(task.consumed);
	if (actualStr) {
		tokens.push(`[actual:: ${actualStr}]`);
	}

	// Zentao ID (always inline field)
	tokens.push(`[zentao:: ${task.id}]`);

	// Completion / cancellation date
	if (completionDate) {
		if (task.status === "cancel") {
			tokens.push(isTasks ? `❌ ${completionDate}` : `[cancelled:: ${completionDate}]`);
		} else if (task.status === "done" || task.status === "closed") {
			tokens.push(isTasks ? `✅ ${completionDate}` : `[completion:: ${completionDate}]`);
		}
	}

	// Assemble line
	const meta = tokens.join(" ");
	return `- [${checkbox}] ${task.name} ${meta}`.replace(/\s+/g, " ").trimEnd();
}

/** Extract the Zentao task ID from an existing Obsidian task line (for dedup). */
export function extractZentaoId(line: string): number | null {
	const match = line.match(/\[zentao::\s*(\d+)\]/);
	return match ? parseInt(match[1], 10) : null;
}

/** Check if a Zentao task differs from an existing Obsidian line. */
export function hasTaskChanged(
	zentaoTask: ZentaoTask,
	obsidianLine: string,
	options: MapperOptions,
): boolean {
	const currentMapped = mapZentaoTask(zentaoTask, options);
	// Normalize whitespace for comparison
	const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
	return normalize(currentMapped) !== normalize(obsidianLine);
}
