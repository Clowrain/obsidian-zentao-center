// US-801~806: Zentao API client.
// Uses classic page API (cookie-based) for task fetching,
// REST API (token-based) for test connection and settings UI.

import { requestUrl, type RequestUrlParam } from "obsidian";
import type { ZentaoTask, ZentaoUserRef } from "./mapper";

// ── Helpers ──

function getAccount(val: string | ZentaoUserRef): string {
	if (typeof val === "string") return val;
	return val?.account ?? "";
}

// ── REST API response types ──

export interface ZentaoTokenResponse { token: string }
export interface ZentaoProject { id: number; name: string; code: string; status: string }
export interface ZentaoExecution { id: number; project: number; name: string; status: string; begin: string; end: string }
export interface ZentaoExecutionListResponse { page: number; total: number; limit: number; executions: ZentaoExecution[] }
export interface ZentaoTaskListResponse { page: number; total: number; limit: number; tasks: ZentaoTask[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClassicTaskRaw = Record<string, any>;

// ── Error types ──

export type ZentaoErrorCode = "network_error" | "auth_failed" | "token_expired" | "api_error" | "not_configured";

export class ZentaoError extends Error {
	constructor(message: string, public code: ZentaoErrorCode, public statusCode?: number) {
		super(message);
		this.name = "ZentaoError";
	}
}

// ── Client ──

const REQUEST_TIMEOUT_MS = 15_000;

function timeoutPromise(): Promise<never> {
	return new Promise((_, reject) => {
		window.setTimeout(() => reject(new ZentaoError("请求超时", "network_error")), REQUEST_TIMEOUT_MS);
	});
}

export class ZentaoClient {
	private token: string | null = null;
	private allCookies: string | null = null;  // Full cookie string (all cookies combined)

	constructor(
		private serverUrl: string,
		private account: string,
		private getPassword: () => Promise<string>,
	) {
		this.serverUrl = serverUrl.replace(/\/+$/, "");
	}

	// ── Generic HTTP helpers ──

	private buildUrl(path: string): string {
		return `${this.serverUrl}/api.php/v1${path}`;
	}

	private async request<T>(params: RequestUrlParam): Promise<T> {
		try {
			const response = await Promise.race([
				requestUrl({ ...params, headers: { "Content-Type": "application/json", ...(params.headers ?? {}) } }),
				timeoutPromise(),
			]);
			return response.json as T;
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.includes("401") || msg.includes("Unauthorized")) throw new ZentaoError("认证失败", "auth_failed", 401);
			throw new ZentaoError(`网络错误: ${msg}`, "network_error");
		}
	}

	private async authenticatedRequest<T>(path: string): Promise<T> {
		const token = await this.ensureToken();
		return this.request<T>({ url: this.buildUrl(path), method: "GET", headers: { Token: token } });
	}

	// ── REST API: login, test connection ──

	async login(): Promise<string> {
		const password = await this.getPassword();
		const result = await this.request<ZentaoTokenResponse>({
			url: this.buildUrl("/tokens"), method: "POST",
			body: JSON.stringify({ account: this.account, password }),
		});
		if (!result.token) throw new ZentaoError("认证失败：未返回 token", "auth_failed");
		this.token = result.token;
		return this.token;
	}

	async ensureToken(): Promise<string> {
		if (this.token) return this.token;
		return this.login();
	}

	async testConnection(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
		try {
			const token = await this.login();
			return { ok: true, token };
		} catch (e) {
			const msg = e instanceof ZentaoError ? e.message : String(e);
			return { ok: false, error: msg };
		}
	}

	// ── REST API: projects & executions (for settings UI) ──

	async getProjects(): Promise<ZentaoProject[]> {
		const result = await this.authenticatedRequest<{ projects: ZentaoProject[] } | ZentaoProject[]>("/projects?limit=100");
		if (Array.isArray(result)) return result;
		return result.projects ?? [];
	}

	async getExecutions(projectId?: number): Promise<ZentaoExecution[]> {
		if (projectId !== undefined) {
			const result = await this.authenticatedRequest<ZentaoExecutionListResponse>(`/projects/${projectId}/executions?limit=100`);
			return result.executions ?? [];
		}
		const projects = await this.getProjects();
		const all: ZentaoExecution[] = [];
		for (const p of projects) { try { all.push(...await this.getExecutions(p.id)); } catch { /* skip */ } }
		return all;
	}

	async getExecutionTasks(executionId: number, status?: string): Promise<ZentaoTask[]> {
		const params = new URLSearchParams({ recPerPage: "1000", pageID: "1" });
		if (status) params.set("status", status);
		const result = await this.authenticatedRequest<ZentaoTaskListResponse>(`/executions/${executionId}/tasks?${params.toString()}`);
		return result.tasks ?? [];
	}

	// ── Classic page API: cookie-based login & task fetch ──

	/** Parse cookies from set-cookie array, deduplicating zentaosid (keep last one). */
	private parseAllCookies(headers: Record<string, unknown>): string | null {
		const raw = headers["set-cookie"] ?? headers["Set-Cookie"];
		if (!raw) return null;
		// raw may be string or array
		const cookieArr = Array.isArray(raw) ? raw : [String(raw)];
		// Extract name=value from each cookie, dedupe zentaosid
		const pairs: Map<string, string> = new Map();
		for (const c of cookieArr) {
			const match = String(c).match(/^([^=]+)=([^;]+)/);
			if (match) {
				const [, name, value] = match;
				// For zentaosid, keep only the last (most recent login session)
				if (name === "zentaosid" || !pairs.has(name)) {
					pairs.set(name, `${name}=${value}`);
				}
			}
		}
		const result = Array.from(pairs.values()).join("; ");
		console.log("[zentao-classic] parsed cookies:", result);
		return result.length > 0 ? result : null;
	}

		/**
		 * Session-based classic login (US-801):
		 * 1. GET getSessionID to pre-establish session
		 * 2. POST login with zentaosid parameter to bind auth to session
		 * This flow is more stable than direct POST login.
		 */
		private async classicLogin(): Promise<void> {
			const password = await this.getPassword();

			// Step 1: Pre-establish session via getSessionID API
			const sessionResp = await Promise.race([
				requestUrl({
					url: `${this.serverUrl}/index.php?m=api&f=getSessionID&t=json`,
					method: "GET",
				}),
				timeoutPromise(),
			]);

			const sessionData = sessionResp.json;
			console.log("[zentao-classic] getSessionID response:", sessionData?.status);

			if (sessionData?.status !== "success") {
				throw new ZentaoError("获取 sessionID 失败", "auth_failed");
			}

			// Parse inner JSON data
			let sessionId: string;
			try {
				const inner = typeof sessionData.data === "string" ? JSON.parse(sessionData.data) : sessionData.data;
				sessionId = inner?.sessionID;
				console.log("[zentao-classic] sessionID:", sessionId);
			} catch {
				throw new ZentaoError("解析 sessionID 失败", "auth_failed");
			}

			if (!sessionId) {
				throw new ZentaoError("sessionID 为空", "auth_failed");
			}

			// Step 2: Login with zentaosid parameter
			const loginResp = await Promise.race([
				requestUrl({
					url: `${this.serverUrl}/index.php?m=user&f=login&t=json&zentaosid=${sessionId}`,
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: `account=${encodeURIComponent(this.account)}&password=${encodeURIComponent(password)}&keepLogin=on`,
				}),
				timeoutPromise(),
			]);

			const result = loginResp.json;
			console.log("[zentao-classic] login status:", result?.status);

			if (result?.status !== "success") {
				throw new ZentaoError("经典接口登录失败: " + (result?.message ?? "unknown"), "auth_failed");
			}

			// Parse ALL cookies from response
			const fullCookie = this.parseAllCookies(loginResp.headers ?? {});
			if (!fullCookie) {
				throw new ZentaoError("登录成功但未获取到 cookies", "auth_failed");
			}
			this.allCookies = fullCookie;
			console.log("[zentao-classic] stored full cookies:", this.allCookies);
		}

	/** Authenticated request to classic page API with full cookies. */
	private async classicRequest<T>(url: string, retry = true): Promise<T> {
		if (!this.allCookies) await this.classicLogin();
		try {
			const response = await Promise.race([
				requestUrl({
					url,
					method: "GET",
					headers: { Cookie: this.allCookies },
				}),
				timeoutPromise(),
			]);
			const json = response.json;
			// Detect session expiry (redirect to login)
			if (json?.status === "success" && typeof json.data === "string") {
				const inner = JSON.parse(json.data);
				if (inner?.loginExpired && retry) {
					this.allCookies = null;
					return this.classicRequest<T>(url, false);
				}
			}
			if (json?.status === "failed" && retry) {
				this.allCookies = null;
				return this.classicRequest<T>(url, false);
			}
			return json as T;
		} catch (e) {
			if (retry) { this.allCookies = null; return this.classicRequest<T>(url, false); }
			throw e;
		}
	}

	/**
	 * Fetch tasks assigned to me via classic page API:
	 * Dashboard → assigntome block → blockLink → tasks
	 */
	async fetchAssignedToMeClassic(): Promise<ZentaoTask[]> {
		console.log("[zentao-fetch] === starting fetch ===");

		const blocks = await this.classicRequest<{ code: string; blockLink: string }[]>(
			`${this.serverUrl}/index.php?m=my&f=index&t=json`,
		);
		console.log("[zentao-fetch] dashboard blocks:", Array.isArray(blocks) ? blocks.length : "NOT ARRAY, type=" + typeof blocks);

		if (!Array.isArray(blocks)) {
			console.log("[zentao-fetch] blocks raw:", JSON.stringify(blocks).slice(0, 300));
			return [];
		}

		console.log("[zentao-fetch] block codes:", blocks.map(b => b.code).join(", "));

		const assignBlock = blocks.find((b) => b.code === "assigntome");
		console.log("[zentao-fetch] assigntome found:", assignBlock ? "YES" : "NO");

		if (!assignBlock?.blockLink) {
			console.log("[zentao-fetch] no blockLink, returning empty");
			return [];
		}

		const fullUrl = assignBlock.blockLink.startsWith("http")
			? assignBlock.blockLink
			: `${this.serverUrl}${assignBlock.blockLink}`;
		console.log("[zentao-fetch] fetching tasks from:", fullUrl);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const taskData = await this.classicRequest<any>(fullUrl);
		console.log("[zentao-fetch] taskData keys:", taskData ? Object.keys(taskData).join(", ") : "null");

		// Parse nested JSON string if needed
		let data: any;
		if (taskData?.data && typeof taskData.data === "string") {
			try {
				data = JSON.parse(taskData.data);
				console.log("[zentao-fetch] parsed nested data, keys:", Object.keys(data).join(", "));
			} catch {
				data = taskData.data;
			}
		} else {
			data = taskData?.data ?? taskData;
		}

		const rawTasks: ClassicTaskRaw[] = data?.tasks ?? [];
		console.log("[zentao-fetch] raw tasks count:", rawTasks.length);

		if (rawTasks.length > 0) {
			console.log("[zentao-fetch] first task:", JSON.stringify(rawTasks[0]).slice(0, 200));
		}

		const converted = rawTasks.map((t) => convertClassicTask(t));
		console.log("[zentao-fetch] === returning", converted.length, "tasks ===");

		return converted;
	}

	// ── Public task fetchers ──

	async fetchAssignedToMeTasks(_executionIds: number[]): Promise<ZentaoTask[]> {
		return this.fetchAssignedToMeClassic();
	}

	async fetchAllAssignedToMe(): Promise<ZentaoTask[]> {
		return this.fetchAssignedToMeClassic();
	}

	invalidateToken(): void {
		this.token = null;
		this.allCookies = null;
	}

	// ── US-826~829: Finish task sync ──

	/**
	 * Finish a task in Zentao via REST API.
	 * Uses JSON POST with Token authentication.
	 * @param taskId Zentao task ID
	 * @param options Finish options (finishedDate, currentConsumed, etc.)
	 */
	async finishTask(
		taskId: number,
		options: {
			finishedDate?: string; // YYYY-MM-DD HH:mm, defaults to now
			currentConsumed?: string; // hours (int), defaults to "1"
			assignedTo?: string; // account, defaults to this.account
			realStarted?: string; // YYYY-MM-DD HH:mm, optional
			comment?: string; // optional
		} = {},
	): Promise<{ success: boolean; message?: string; consumed?: number }> {
		// Get REST API token
		const token = await this.ensureToken();
		if (!token) {
			return { success: false, message: "禅道认证失败，无法获取 Token" };
		}

		const now = new Date();
		const finishedDate = options.finishedDate ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
		// currentConsumed must be an integer (hours), minimum 1
		const currentConsumed = parseInt(options.currentConsumed ?? "1") || 1;
		const assignedTo = options.assignedTo ?? this.account;

		// Build JSON request body (REST API format)
		// assignedTo is optional - if not provided, uses task's current assignee
		const bodyObj: Record<string, unknown> = {
			currentConsumed,
			realStarted: options.realStarted ?? undefined,
			finishedDate,
			comment: options.comment ?? undefined,
		};
		// Only include assignedTo if explicitly provided
		if (options.assignedTo) {
			bodyObj.assignedTo = options.assignedTo;
		}
		const body = JSON.stringify(bodyObj);
		console.log("[zentao-finish] REST API body:", body);

		try {
			const response = await Promise.race([
				requestUrl({
					url: `${this.serverUrl}/api.php/v1/tasks/${taskId}/finish`,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Token: token,
					},
					body,
				}),
				timeoutPromise(),
			]);

			const result = response.json;
			console.log("[zentao-finish] REST response:", result);

			// REST API returns {status: 'success'} or task object with status='done'
			// The task object includes consumed field (hours)
			if (result?.status === "success" || result?.status === "done") {
				console.log("[zentao-finish] Task completed successfully!");
				// Return consumed hours from response if available
				const consumed = typeof result?.consumed === "number" ? result.consumed : undefined;
				return { success: true, consumed };
			}

			// Check for error response
			if (result?.error ?? result?.message) {
				return { success: false, message: result?.error ?? result?.message ?? "禅道操作失败" };
			}

			// If we got a valid task object back, check its status
			if (result?.id && typeof result.id === "number") {
				console.log("[zentao-finish] Got task object back, checking status:", result.status);
				if (result.status === "done" || result.status === "closed") {
					// Return consumed hours from task object
					const consumed = typeof result?.consumed === "number" ? result.consumed : undefined;
					return { success: true, consumed };
				}
				return { success: false, message: `任务状态未更新：${result.status}` };
			}

			// Default: if HTTP 200, assume success (no consumed info available)
			if (response.status === 200) {
				console.log("[zentao-finish] HTTP 200, assuming success");
				return { success: true };
			}

			return { success: false, message: "未知响应格式" };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[zentao-finish] REST error:", msg);
			return { success: false, message: msg };
		}
	}

	/**
	 * Update task deadline via REST API.
	 * PUT /api.php/v1/tasks/{id} with { deadline: "YYYY-MM-DD", estStarted: "YYYY-MM-DD" }
	 * Zentao requires deadline >= estStarted, so we also send estStarted if needed.
	 */
	async updateTaskDeadline(
		taskId: number,
		deadline: string | null, // YYYY-MM-DD or null to clear
		estStarted?: string | null, // YYYY-MM-DD or null to use deadline as estStarted
	): Promise<{ success: boolean; message?: string }> {
		// Get REST API token
		const token = await this.ensureToken();
		if (!token) {
			return { success: false, message: "禅道认证失败，无法获取 Token" };
		}

		// Zentao requires deadline >= estStarted
		// If deadline is set and estStarted is not provided or deadline < estStarted,
		// set estStarted = deadline to satisfy the constraint
		let finalEstStarted = estStarted ?? "";
		if (deadline && (!estStarted || (estStarted && deadline < estStarted))) {
			finalEstStarted = deadline;
		}

		const bodyObj: Record<string, unknown> = {
			deadline: deadline ?? "", // Empty string clears deadline
			estStarted: finalEstStarted,
		};
		const body = JSON.stringify(bodyObj);
		console.log("[zentao-update] REST API body:", body);

		try {
			const response = await Promise.race([
				requestUrl({
					url: `${this.serverUrl}/api.php/v1/tasks/${taskId}`,
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Token: token,
					},
					body,
				}),
				timeoutPromise(),
			]);

			const result = response.json;
			console.log("[zentao-update] REST response:", result);

			// REST API returns updated task object or {status: 'success'}
			if (result?.id && typeof result.id === "number") {
				console.log("[zentao-update] Task updated successfully, new deadline:", result.deadline);
				return { success: true };
			}

			if (result?.status === "success") {
				return { success: true };
			}

			// Check for error response
			if (result?.error ?? result?.message) {
				return { success: false, message: result?.error ?? result?.message ?? "禅道操作失败" };
			}

			// Default: if HTTP 200, assume success
			if (response.status === 200) {
				console.log("[zentao-update] HTTP 200, assuming success");
				return { success: true };
			}

			return { success: false, message: "未知响应格式" };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[zentao-update] REST error:", msg);
			return { success: false, message: msg };
		}
	}

	/**
	 * Close a task via REST API.
	 * POST /api.php/v1/tasks/{id}/close with optional comment.
	 */
	async closeTask(
		taskId: number,
		comment?: string,
	): Promise<{ success: boolean; message?: string }> {
		// Get REST API token
		const token = await this.ensureToken();
		if (!token) {
			return { success: false, message: "禅道认证失败，无法获取 Token" };
		}

		const bodyObj: Record<string, unknown> = {};
		if (comment) {
			bodyObj.comment = comment;
		}
		const body = JSON.stringify(bodyObj);
		console.log("[zentao-close] REST API body:", body);

		try {
			const response = await Promise.race([
				requestUrl({
					url: `${this.serverUrl}/api.php/v1/tasks/${taskId}/close`,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Token: token,
					},
					body,
				}),
				timeoutPromise(),
			]);

			const result = response.json;
			console.log("[zentao-close] REST response:", result);

			// REST API returns updated task object with status='closed'
			if (result?.id && typeof result.id === "number" && result.status === "closed") {
				console.log("[zentao-close] Task closed successfully");
				return { success: true };
			}

			if (result?.status === "success") {
				return { success: true };
			}

			// Check for error response
			if (result?.error ?? result?.message) {
				return { success: false, message: result?.error ?? result?.message ?? "禅道操作失败" };
			}

			// Default: if HTTP 200, assume success
			if (response.status === 200) {
				console.log("[zentao-close] HTTP 200, assuming success");
				return { success: true };
			}

			return { success: false, message: "未知响应格式" };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[zentao-close] REST error:", msg);
			return { success: false, message: msg };
		}
	}
}

// ── Classic task format converter ──

function convertClassicTask(raw: ClassicTaskRaw): ZentaoTask {
	const currentYear = new Date().getFullYear().toString();

	function fixDate(val: string | null | undefined): string {
		if (!val || val === "0000-00-00" || val === "0000-00-00 00:00:00") return "";
		if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
		if (/^\d{2}-\d{2}$/.test(val)) return `${currentYear}-${val}`;
		return val;
	}

	function fixEstimate(val: string | number | null | undefined): string {
		if (val == null) return "0";
		if (typeof val === "number") return String(val);
		const hoursMatch = String(val).match(/^([\d.]+)\s*h$/i);
		if (hoursMatch) return hoursMatch[1];
		const minsMatch = String(val).match(/^([\d.]+)\s*m$/i);
		if (minsMatch) return String(parseFloat(minsMatch[1]) / 60);
		return String(val);
	}

	return {
		id: raw.id,
		project: raw.project,
		projectName: raw.projectName ?? "",
		execution: raw.execution ?? raw.executionID ?? 0,
		executionName: raw.executionName ?? "",
		parent: raw.parent ?? 0,
		name: raw.name ?? "",
		type: raw.type ?? "",
		pri: raw.pri ?? 3,
		status: raw.status ?? "wait",
		deadline: fixDate(raw.deadline),
		estStarted: fixDate(raw.estStarted),
		estimate: fixEstimate(raw.estimate),
		consumed: String(raw.consumed ?? "0"),
		assignedTo: raw.assignedTo ?? "",
		openedBy: raw.openedBy ?? "",
		openedDate: raw.openedDate ?? "",
		finishedBy: raw.finishedBy || null,
		finishedDate: fixDate(raw.finishedDate),
		closedDate: fixDate(raw.closedDate),
		desc: raw.desc ?? "",
	};
}
