/**
 * Multi-cell Python execution engine.
 *
 * Executes multiple code cells sequentially in a persistent kernel session,
 * with proper error handling, timeout management, and output collection.
 */
import { executePython, getPreludeDocs } from "./session";
import type { PreludeHelper } from "./kernel";

export interface CellParams {
	code: string;
	title?: string;
}

export interface ExecutorOptions {
	cells: CellParams[];
	timeout?: number; // seconds, default 30
	cwd?: string;
	reset?: boolean;
	sessionId?: string;
	sessionFile?: string;
	signal?: AbortSignal;
}

export interface CellResult {
	index: number;
	title?: string;
	code: string;
	output: string;
	status: "pending" | "running" | "complete" | "error";
	durationMs?: number;
	exitCode?: number;
	statusEvents?: import("./kernel").PythonStatusEvent[];
	hasMarkdown?: boolean;
}

export interface ExecutionResult {
	cells: CellResult[];
	output: string;
	cancelled: boolean;
	timedOut: boolean;
	stdinRequested: boolean;
	images: string[]; // base64 png images
	jsonOutputs: unknown[];
	statusEvents: import("./kernel").PythonStatusEvent[];
	isError: boolean;
	meta?: {
		truncated?: boolean;
		outputPath?: string;
	};
}

const DEFAULT_TIMEOUT_SEC = 30;
const MAX_TIMEOUT_SEC = 600;

function clampTimeout(timeout?: number): number {
	if (timeout === undefined) return DEFAULT_TIMEOUT_SEC;
	if (timeout < 1) return 1;
	if (timeout > MAX_TIMEOUT_SEC) return MAX_TIMEOUT_SEC;
	return timeout;
}

/**
 * Execute multiple Python cells sequentially in a persistent kernel.
 */
export async function executeCells(options: ExecutorOptions): Promise<ExecutionResult> {
	const timeoutSec = clampTimeout(options.timeout);
	const timeoutMs = timeoutSec * 1000;
	const deadlineMs = Date.now() + timeoutMs;
	const combinedSignal = options.signal
		? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
		: AbortSignal.timeout(timeoutMs);

	const cellResults: CellResult[] = [];
	let output = "";
	let cancelled = false;
	let timedOut = false;
	let stdinRequested = false;
	const images: string[] = [];
	const jsonOutputs: unknown[] = [];
	const allStatusEvents: import("./kernel").PythonStatusEvent[] = [];
	let isError = false;

	for (let i = 0; i < options.cells.length; i++) {
		if (cancelled || timedOut || isError) {
			cellResults.push({
				index: i,
				title: options.cells[i]?.title,
				code: options.cells[i]?.code ?? "",
				output: "",
				status: "pending",
			});
			continue;
		}

		const cell = options.cells[i]!;
		const cellResult: CellResult = {
			index: i,
			title: cell.title,
			code: cell.code,
			output: "",
			status: "running",
		};
		cellResults.push(cellResult);

		const cellStart = Date.now();
		try {
			const cellStatusEvents: import("./kernel").PythonStatusEvent[] = [];
			const result = await executePython(cell.code, {
				sessionId: options.sessionId,
				cwd: options.cwd,
				reset: i === 0 ? options.reset : false, // reset only applies to first cell
				deadlineMs,
				signal: combinedSignal,
				onChunk: (chunk) => {
					cellResult.output += chunk;
					output += chunk;
				},
			});

			// Collect display outputs
			for (const display of result.displayOutputs) {
				switch (display.type) {
					case "image":
						images.push(display.data);
						break;
					case "json":
						jsonOutputs.push(display.data);
						break;
					case "status":
						cellStatusEvents.push(display.event);
						allStatusEvents.push(display.event);
						break;
					case "markdown":
						cellResult.hasMarkdown = true;
						break;
				}
			}

			cellResult.status = result.exitCode === 0 ? "complete" : "error";
			cellResult.exitCode = result.exitCode;
			cellResult.durationMs = Date.now() - cellStart;
			cellResult.statusEvents = cellStatusEvents;

			if (result.cancelled) {
				cancelled = true;
			}
			if (result.stdinRequested) {
				stdinRequested = true;
			}

			if (result.exitCode !== 0) {
				isError = true;
				output += `\nCell ${i + 1} failed${cell.title ? ` (${cell.title})` : ""}\n`;
			}
		} catch (err) {
			isError = true;
			cellResult.status = "error";
			cellResult.durationMs = Date.now() - cellStart;

			const errorMsg = err instanceof Error ? err.message : String(err);
			cellResult.output += `\nError: ${errorMsg}\n`;
			output += `\nCell ${i + 1} failed${cell.title ? ` (${cell.title})` : ""}: ${errorMsg}\n`;

			if (err instanceof Error && err.name === "TimeoutError") {
				timedOut = true;
			}
		}
	}

	return {
		cells: cellResults,
		output,
		cancelled,
		timedOut,
		stdinRequested,
		images,
		jsonOutputs,
		statusEvents: allStatusEvents,
		isError,
	};
}

/**
 * Get prelude helper docs grouped by category.
 */
export async function getPreludeCategories(): Promise<{ name: string; functions: PreludeHelper[] }[]> {
	const helpers = await getPreludeDocs();
	const categories: { name: string; functions: PreludeHelper[] }[] = [];
	const byName = new Map<string, PreludeHelper[]>();

	for (const helper of helpers) {
		let bucket = byName.get(helper.category);
		if (!bucket) {
			bucket = [];
			byName.set(helper.category, bucket);
			categories.push({ name: helper.category, functions: bucket });
		}
		bucket.push(helper);
	}

	return categories;
}
