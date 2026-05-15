/**
 * Session-scoped kernel manager.
 *
 * Manages persistent Python kernels with LRU eviction, idle timeout,
 * heartbeat checks, and auto-restart on crash.
 */
import { PythonKernel, type KernelExecuteOptions, type KernelExecuteResult, type PreludeHelper } from "./kernel.js";
import { logger } from "../util/logger.js";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_KERNEL_SESSIONS = 4;
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds

export interface PythonExecutorOptions {
	/** Working directory for command execution */
	cwd?: string;
	/** Timeout in milliseconds */
	timeoutMs?: number;
	/** Absolute wall-clock deadline in milliseconds since epoch */
	deadlineMs?: number;
	/** Callback for streaming output chunks (already sanitized) */
	onChunk?: (chunk: string) => Promise<void> | void;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
	/** Session identifier for kernel reuse */
	sessionId?: string;
	/** Restart the kernel before executing */
	reset?: boolean;
	/** Session file path for accessing task outputs */
	sessionFile?: string;
}

export interface PythonKernelExecutor {
	execute: (code: string, options?: KernelExecuteOptions) => Promise<KernelExecuteResult>;
}

export interface PythonResult {
	/** Combined stdout + stderr output (sanitized, possibly truncated) */
	output: string;
	/** Execution exit code (0 ok, 1 error, undefined if cancelled) */
	exitCode: number | undefined;
	/** Whether the execution was cancelled via signal */
	cancelled: boolean;
	/** Whether the output was truncated */
	truncated: boolean;
	/** Total number of lines in the output stream */
	totalLines: number;
	/** Total number of bytes in the output stream */
	totalBytes: number;
	/** Number of lines included in the output text */
	outputLines: number;
	/** Number of bytes included in the output text */
	outputBytes: number;
	/** Rich display outputs captured from display_data/execute_result */
	displayOutputs: import("./kernel.js").KernelDisplayOutput[];
	/** Whether stdin was requested */
	stdinRequested: boolean;
}

interface KernelSession {
	id: string;
	kernel: PythonKernel;
	queue: Promise<void>;
	restartCount: number;
	dead: boolean;
	lastUsedAt: number;
	heartbeatTimer?: NodeJS.Timeout;
}

const kernelSessions = new Map<string, KernelSession>();
let cachedPreludeDocs: PreludeHelper[] | null = null;

class PythonExecutionCancelledError extends Error {
	readonly timedOut: boolean;

	constructor(timedOut: boolean) {
		super(timedOut ? "Command timed out" : "Command aborted");
		this.name = timedOut ? "TimeoutError" : "AbortError";
		this.timedOut = timedOut;
	}
}

function getExecutionDeadlineMs(options?: Pick<PythonExecutorOptions, "deadlineMs" | "timeoutMs">): number | undefined {
	if (options?.deadlineMs !== undefined) return options.deadlineMs;
	if (options?.timeoutMs === undefined) return undefined;
	return Date.now() + options.timeoutMs;
}

function getRemainingTimeoutMs(deadlineMs?: number): number | undefined {
	if (deadlineMs === undefined) return undefined;
	return deadlineMs - Date.now();
}

function requireRemainingTimeoutMs(deadlineMs?: number): number | undefined {
	const remainingMs = getRemainingTimeoutMs(deadlineMs);
	if (remainingMs === undefined) return undefined;
	if (remainingMs <= 0) {
		throw new PythonExecutionCancelledError(true);
	}
	return remainingMs;
}

function isCancellationError(error: unknown): boolean {
	return (
		error instanceof PythonExecutionCancelledError ||
		(error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) ||
		(error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
	);
}

function isTimedOutCancellation(error: unknown, signal?: AbortSignal): boolean {
	if (error instanceof PythonExecutionCancelledError) return error.timedOut;
	if (error instanceof DOMException) return error.name === "TimeoutError";
	if (error instanceof Error && error.name === "TimeoutError") return true;
	const reason = signal?.reason;
	if (reason instanceof DOMException) return reason.name === "TimeoutError";
	return reason instanceof Error ? reason.name === "TimeoutError" : false;
}

async function waitForQueueTurn(
	queue: Promise<void>,
	options: Pick<PythonExecutorOptions, "signal" | "deadlineMs">,
): Promise<void> {
	if (options.signal?.aborted) {
		throw new PythonExecutionCancelledError(isTimedOutCancellation(options.signal.reason, options.signal));
	}

	const remainingMs = getRemainingTimeoutMs(options.deadlineMs);
	if (remainingMs !== undefined && remainingMs <= 0) {
		throw new PythonExecutionCancelledError(true);
	}

	if (!options.signal && remainingMs === undefined) {
		await queue;
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const cleanups: Array<() => void> = [];
		const finish = (callback: () => void) => {
			while (cleanups.length > 0) {
				cleanups.pop()?.();
			}
			callback();
		};

		const onAbort = () => {
			finish(() =>
				reject(new PythonExecutionCancelledError(isTimedOutCancellation(options.signal?.reason, options.signal))),
			);
		};

		if (options.signal) {
			options.signal.addEventListener("abort", onAbort, { once: true });
			cleanups.push(() => options.signal?.removeEventListener("abort", onAbort));
		}

		if (remainingMs !== undefined) {
			const timeout = setTimeout(() => {
				finish(() => reject(new PythonExecutionCancelledError(true)));
			}, remainingMs);
			timeout.unref?.();
			cleanups.push(() => clearTimeout(timeout));
		}

		queue.then(
			() => finish(resolve),
			error => finish(() => reject(error)),
		);
	});
}

function formatTimeoutAnnotation(timeoutMs?: number): string | undefined {
	if (timeoutMs === undefined) return "Command timed out";
	const secs = Math.max(1, Math.round(timeoutMs / 1000));
	return `Command timed out after ${secs} second${secs === 1 ? "" : "s"}`;
}

async function startKernelSession(
	sessionId: string,
	cwd: string,
	env?: Record<string, string | undefined>,
	signal?: AbortSignal,
	deadlineMs?: number,
): Promise<KernelSession> {
	const kernel = await PythonKernel.start({
		cwd,
		env,
		signal,
		deadlineMs,
	});

	const session: KernelSession = {
		id: sessionId,
		kernel,
		queue: Promise.resolve(),
		restartCount: 0,
		dead: false,
		lastUsedAt: Date.now(),
	};

	// Start heartbeat
	startHeartbeat(session);

	return session;
}

function startHeartbeat(session: KernelSession): void {
	if (session.heartbeatTimer) {
		clearInterval(session.heartbeatTimer);
	}

	const check = async () => {
		if (session.dead) return;
		if (!session.kernel.isAlive()) {
			if (session.restartCount >= 1) {
				logger.error("Kernel session crashed twice, marking as dead", { sessionId: session.id });
				session.dead = true;
				return;
			}
			session.restartCount++;
			logger.warn("Kernel session crashed, attempting restart", { sessionId: session.id, attempt: session.restartCount });
			try {
				// Extract cwd from the kernel's initialization state if available
				// For now, we'll restart without env - the caller should handle this
				const newKernel = await PythonKernel.start({
					cwd: ".", // Will be overridden by the next execute call
					signal: undefined,
				});
				session.kernel = newKernel;
				session.dead = false;
				console.info("Kernel session restarted successfully", { sessionId: session.id });
			} catch (err) {
				logger.error("Failed to restart kernel session", {
					sessionId: session.id,
					error: err instanceof Error ? err.message : String(err),
				});
				session.dead = true;
			}
		}
	};

	session.heartbeatTimer = setInterval(check, HEARTBEAT_INTERVAL_MS);
	// Keep the process alive while the timer is running
	if (session.heartbeatTimer.unref) {
		session.heartbeatTimer.unref();
	}
}

function stopHeartbeat(session: KernelSession): void {
	if (session.heartbeatTimer) {
		clearInterval(session.heartbeatTimer);
		session.heartbeatTimer = undefined;
	}
}

function getSessionKey(sessionId: string, cwd: string): string {
	return `${sessionId}:${cwd}`;
}

async function getOrCreateSession(
	options: PythonExecutorOptions,
	reset?: boolean,
): Promise<KernelSession> {
	const sessionId = options.sessionId ?? "default";
	const cwd = options.cwd ?? process.cwd();
	const key = getSessionKey(sessionId, cwd);

	let session = kernelSessions.get(key);

	if (reset && session) {
		// Shutdown existing kernel and create new one
		await shutdownSession(session);
		session = undefined;
	}

	if (!session || session.dead || !session.kernel.isAlive()) {
		// Check if we need to evict
		if (kernelSessions.size >= MAX_KERNEL_SESSIONS) {
			// Evict least recently used
			const entries = Array.from(kernelSessions.entries());
			entries.sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
			const [evictKey, evictSession] = entries[0]!;
			if (evictSession) {
				await shutdownSession(evictSession);
				kernelSessions.delete(evictKey);
			}
		}

		const deadlineMs = getExecutionDeadlineMs(options);
		session = await startKernelSession(sessionId, cwd, undefined, options.signal, deadlineMs);
		kernelSessions.set(key, session);
	}

	session.lastUsedAt = Date.now();
	return session;
}

async function shutdownSession(session: KernelSession): Promise<void> {
	stopHeartbeat(session);
	session.dead = true;
	try {
		await session.kernel.shutdown({ timeoutMs: 2000 });
	} catch (err) {
		logger.warn("Error shutting down kernel session", {
			sessionId: session.id,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/** Shutdown all sessions. Called on process exit. */
export async function shutdownAllSessions(): Promise<void> {
	const sessions = Array.from(kernelSessions.values());
	kernelSessions.clear();
	await Promise.all(sessions.map(session => shutdownSession(session)));
}

// Idle eviction timer
let idleEvictionTimer: NodeJS.Timeout | null = null;

function startIdleEviction(): void {
	if (idleEvictionTimer) return;
	idleEvictionTimer = setInterval(async () => {
		const now = Date.now();
		for (const [key, session] of kernelSessions.entries()) {
			if (now - session.lastUsedAt > IDLE_TIMEOUT_MS) {
				logger.debug("Evicting idle kernel session", { sessionId: session.id, idleMs: now - session.lastUsedAt });
				await shutdownSession(session);
				kernelSessions.delete(key);
			}
		}
	}, 30_000);
	if (idleEvictionTimer.unref) {
		idleEvictionTimer.unref();
	}
}

startIdleEviction();

// Cleanup on process exit
process.on("exit", () => {
	shutdownAllSessions().catch(() => {});
});

process.on("SIGINT", () => {
	shutdownAllSessions().catch(() => {});
});

process.on("SIGTERM", () => {
	shutdownAllSessions().catch(() => {});
});

/**
 * Execute Python code in a session-scoped kernel.
 */
export async function executePython(
	code: string,
	options: PythonExecutorOptions = {},
): Promise<PythonResult> {
	const deadlineMs = getExecutionDeadlineMs(options);
	const timeoutMs = requireRemainingTimeoutMs(deadlineMs);

	const session = await getOrCreateSession(options, options.reset);

	// Wait for queue turn
	const { resolve: resolveQueue, promise: queuePromise } = Promise.withResolvers<void>();
	const previousQueue = session.queue;
	session.queue = queuePromise;

	try {
		await waitForQueueTurn(previousQueue, { signal: options.signal, deadlineMs });
	} catch (err) {
		resolveQueue();
		throw err;
	}

	let output = "";
	const displayOutputs: import("./kernel.js").KernelDisplayOutput[] = [];
	let stdinRequested = false;
	let cancelled = false;
	let timedOut = false;

	try {
		const result = await session.kernel.execute(code, {
			signal: options.signal,
			timeoutMs,
			onChunk: (text) => {
				output += text;
				if (options.onChunk) {
					void options.onChunk(text);
				}
			},
			onDisplay: (disp) => {
				displayOutputs.push(disp);
			},
		});

		stdinRequested = result.stdinRequested;
		cancelled = result.cancelled;
		timedOut = result.timedOut;

		const totalLines = output.split("\n").length;
		const totalBytes = Buffer.byteLength(output);

		return {
			output,
			exitCode: result.status === "ok" ? 0 : 1,
			cancelled,
			truncated: false, // Truncation handled at tool layer
			totalLines,
			totalBytes,
			outputLines: totalLines,
			outputBytes: totalBytes,
			displayOutputs,
			stdinRequested,
		};
	} catch (err) {
		if (isCancellationError(err)) {
			cancelled = true;
			timedOut = isTimedOutCancellation(err, options.signal);
			const annotation = timedOut ? formatTimeoutAnnotation(timeoutMs) : "Execution aborted";
			if (annotation) {
				output += `\n\n${annotation}\n`;
			}
			return {
				output,
				exitCode: undefined,
				cancelled: true,
				truncated: false,
				totalLines: output.split("\n").length,
				totalBytes: Buffer.byteLength(output),
				outputLines: output.split("\n").length,
				outputBytes: Buffer.byteLength(output),
				displayOutputs,
				stdinRequested,
			};
		}
		throw err;
	} finally {
		resolveQueue();
		session.lastUsedAt = Date.now();
	}
}

/**
 * Get prelude helper documentation.
 */
export async function getPreludeDocs(): Promise<PreludeHelper[]> {
	if (cachedPreludeDocs) return cachedPreludeDocs;

	const session = await getOrCreateSession({ sessionId: "__prelude_introspection__", cwd: process.cwd() });
	const docs = await session.kernel.introspectPrelude();
	cachedPreludeDocs = docs;
	return docs;
}

/**
 * Clear cached prelude docs (useful for testing).
 */
export function clearPreludeDocsCache(): void {
	cachedPreludeDocs = null;
}
