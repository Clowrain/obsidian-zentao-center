// US-801~806: Zentao REST API client.
// Handles authentication (token-based), project/execution listing, and task fetching.
// Uses Obsidian's requestUrl for HTTP (bypasses CORS in plugin context).

import { requestUrl, type RequestUrlParam } from "obsidian";
import type { ZentaoTask } from "./mapper";

// ── API response types ──

export interface ZentaoTokenResponse {
	token: string;
}

export interface ZentaoProject {
	id: number;
	name: string;
	code: string;
	status: string;
}

export interface ZentaoExecution {
	id: number;
	project: number;
	name: string;
	status: string;
	begin: string;
	end: string;
}

export interface ZentaoExecutionListResponse {
	page: number;
	total: number;
	limit: number;
	executions: ZentaoExecution[];
}

export interface ZentaoTaskListResponse {
	page: number;
	total: number;
	limit: number;
	tasks: ZentaoTask[];
}

// ── Error types ──

export type ZentaoErrorCode =
	| "network_error"
	| "auth_failed"
	| "token_expired"
	| "api_error"
	| "not_configured";

export class ZentaoError extends Error {
	constructor(
		message: string,
		public code: ZentaoErrorCode,
		public statusCode?: number,
	) {
		super(message);
		this.name = "ZentaoError";
	}
}

// ── Client ──


export class ZentaoClient {
	private token: string | null = null;

	constructor(
		private serverUrl: string,
		private account: string,
		private getPassword: () => Promise<string>,
	) {
		// Normalize: strip trailing slash
		this.serverUrl = serverUrl.replace(/\/+$/, "");
	}

	private buildUrl(path: string): string {
		return `${this.serverUrl}/api.php/v1${path}`;
	}

	private async request<T>(params: RequestUrlParam): Promise<T> {
		try {
			const response = await requestUrl({
				...params,
				headers: {
					"Content-Type": "application/json",
					...(params.headers ?? {}),
				},
			});
			return response.json as T;
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.includes("401") || msg.includes("Unauthorized")) {
				throw new ZentaoError("认证失败", "auth_failed", 401);
			}
			throw new ZentaoError(`网络错误: ${msg}`, "network_error");
		}
	}

	private async authenticatedRequest<T>(path: string): Promise<T> {
		const token = await this.ensureToken();
		return this.request<T>({
			url: this.buildUrl(path),
			method: "GET",
			headers: { Token: token },
		});
	}

	/** Login to Zentao and cache the token. */
	async login(): Promise<string> {
		const password = await this.getPassword();
		const result = await this.request<ZentaoTokenResponse>({
			url: this.buildUrl("/tokens"),
			method: "POST",
			body: JSON.stringify({ account: this.account, password }),
		});
		if (!result.token) {
			throw new ZentaoError("认证失败：未返回 token", "auth_failed");
		}
		this.token = result.token;
		return this.token;
	}

	/** Ensure we have a valid token; re-login if needed. */
	async ensureToken(): Promise<string> {
		if (this.token) return this.token;
		return this.login();
	}

	/** Test the connection by attempting to login. */
	async testConnection(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
		try {
			const token = await this.login();
			return { ok: true, token };
		} catch (e) {
			const msg = e instanceof ZentaoError ? e.message : String(e);
			return { ok: false, error: msg };
		}
	}

	/** Get all projects visible to the current user. */
	async getProjects(): Promise<ZentaoProject[]> {
		const result = await this.authenticatedRequest<{ projects: ZentaoProject[] } | ZentaoProject[]>(
			"/projects?limit=100",
		);
		// API may return { projects: [...] } or just [...]
		if (Array.isArray(result)) return result;
		return result.projects ?? [];
	}

	/** Get executions for a specific project, or all if projectId is undefined. */
	async getExecutions(projectId?: number): Promise<ZentaoExecution[]> {
		if (projectId !== undefined) {
			const result = await this.authenticatedRequest<ZentaoExecutionListResponse>(
				`/projects/${projectId}/executions?limit=100`,
			);
			return result.executions ?? [];
		}
		// Fetch executions across all projects
		const projects = await this.getProjects();
		const all: ZentaoExecution[] = [];
		for (const p of projects) {
			try {
				const execs = await this.getExecutions(p.id);
				all.push(...execs);
			} catch {
				// Skip projects we can't read
			}
		}
		return all;
	}

	/** Get tasks for a specific execution with optional status filter. */
	async getExecutionTasks(
		executionId: number,
		status?: string,
	): Promise<ZentaoTask[]> {
		const params = new URLSearchParams({ recPerPage: "1000", pageID: "1" });
		if (status) params.set("status", status);
		const result = await this.authenticatedRequest<ZentaoTaskListResponse>(
			`/executions/${executionId}/tasks?${params.toString()}`,
		);
		return result.tasks ?? [];
	}

	/** Fetch tasks assigned to me from specified executions. */
	async fetchAssignedToMeTasks(executionIds: number[]): Promise<ZentaoTask[]> {
		const all: ZentaoTask[] = [];
		const seen = new Set<number>();
		for (const eid of executionIds) {
			try {
				const tasks = await this.getExecutionTasks(eid, "assignedtome");
				for (const t of tasks) {
					if (!seen.has(t.id)) {
						seen.add(t.id);
						all.push(t);
					}
				}
			} catch {
				// Continue with other executions on failure
			}
		}
		return all;
	}

	/** Fetch all tasks assigned to me across all active executions. */
	async fetchAllAssignedToMe(): Promise<ZentaoTask[]> {
		const executions = await this.getExecutions();
		// Filter to active executions
		const activeIds = executions
			.filter((e) => e.status === "doing" || e.status === "wait")
			.map((e) => e.id);
		return this.fetchAssignedToMeTasks(activeIds);
	}

	/** Invalidate cached token (e.g. after settings change). */
	invalidateToken(): void {
		this.token = null;
	}
}
