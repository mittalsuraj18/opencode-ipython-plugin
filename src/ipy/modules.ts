/**
 * Python extension module auto-loader.
 *
 * Discovers and loads user/project .py modules into active kernels.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type KernelExecuteResult } from "./kernel";

const PLUGIN_DIR = path.join(process.env.HOME ?? "/tmp", ".opencode-ipython-plugin");

export type PythonModuleSource = "user" | "project";

export interface PythonModuleEntry {
	path: string;
	content: string;
	source: PythonModuleSource;
}

export interface PythonModuleExecutor {
	execute: (
		code: string,
		options?: { signal?: AbortSignal; timeoutMs?: number; silent?: boolean; storeHistory?: boolean },
	) => Promise<KernelExecuteResult>;
}

interface ModuleCandidate {
	name: string;
	path: string;
	source: PythonModuleSource;
}

async function listModuleCandidates(dir: string, source: PythonModuleSource): Promise<ModuleCandidate[]> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		return entries
			.filter(entry => entry.isFile() && entry.name.endsWith(".py"))
			.map(entry => ({
				name: entry.name,
				path: path.resolve(dir, entry.name),
				source,
			}));
	} catch {
		return [];
	}
}

async function readModuleContent(candidate: ModuleCandidate): Promise<PythonModuleEntry> {
	try {
		const content = await Bun.file(candidate.path).text();
		return { path: candidate.path, content, source: candidate.source };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to read Python module ${candidate.path}: ${message}`);
	}
}

/**
 * Discover Python prelude extension modules from user and project directories.
 */
export async function discoverPythonModules(cwd: string): Promise<PythonModuleEntry[]> {
	const userDir = path.join(PLUGIN_DIR, "modules");
	const projectDir = path.join(cwd, ".opencode-ipython-plugin", "modules");

	const userCandidates = await listModuleCandidates(userDir, "user");
	const projectCandidates = await listModuleCandidates(projectDir, "project");

	const byName = new Map<string, ModuleCandidate>();
	for (const candidate of userCandidates) {
		if (!byName.has(candidate.name)) {
			byName.set(candidate.name, candidate);
		}
	}
	for (const candidate of projectCandidates) {
		const existing = byName.get(candidate.name);
		if (!existing || existing.source === "user") {
			byName.set(candidate.name, candidate);
		}
	}

	const sorted = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
	return Promise.all(sorted.map(candidate => readModuleContent(candidate)));
}

/**
 * Load Python prelude extension modules into an active kernel.
 */
export async function loadPythonModules(
	executor: PythonModuleExecutor,
	cwd: string,
	options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<PythonModuleEntry[]> {
	const modules = await discoverPythonModules(cwd);
	for (const module of modules) {
		const result = await executor.execute(module.content, {
			signal: options?.signal,
			timeoutMs: options?.timeoutMs,
			silent: true,
			storeHistory: false,
		});
		if (result.cancelled) {
			throw new Error(`Failed to load Python module ${module.path}: execution cancelled`);
		}
		if (result.status === "error") {
			const details = result.error ? `${result.error.name}: ${result.error.value}` : "unknown error";
			throw new Error(`Failed to load Python module ${module.path}: ${details}`);
		}
	}
	return modules;
}
