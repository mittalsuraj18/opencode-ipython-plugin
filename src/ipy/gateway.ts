/**
 * Shared Jupyter Kernel Gateway coordinator.
 *
 * Manages a single shared `jupyter_kernel_gateway` process with file-locking,
 * health checks, PID tracking, and stale cleanup.
 */
import * as fs from "node:fs";
import { createServer } from "node:net";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { resolveManagedPythonEnv } from "./runtime.js";
import { logger } from "../util/logger.js";

const GATEWAY_DIR_NAME = "gateway";
const GATEWAY_INFO_FILE = "gateway.json";
const GATEWAY_LOCK_FILE = "gateway.lock";
const GATEWAY_STARTUP_TIMEOUT_MS = 30000;
const GATEWAY_LOCK_TIMEOUT_MS = GATEWAY_STARTUP_TIMEOUT_MS + 5000;
const GATEWAY_LOCK_RETRY_MS = 50;
const GATEWAY_LOCK_STALE_MS = GATEWAY_STARTUP_TIMEOUT_MS * 2;
const GATEWAY_LOCK_HEARTBEAT_MS = 5000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;

const PLUGIN_DIR = path.join(process.env.HOME ?? "/tmp", ".opencode-ipython-plugin");

export interface GatewayInfo {
	url: string;
	pid: number;
	startedAt: number;
	pythonPath?: string;
	venvPath?: string | null;
}

interface GatewayLockInfo {
	pid: number;
	startedAt: number;
}

interface AcquireResult {
	url: string;
	isShared: boolean;
}

let localGatewayProcess: ChildProcess | null = null;
let localGatewayUrl: string | null = null;
let isCoordinatorInitialized = false;

async function allocatePort(): Promise<number> {
	const { promise, resolve, reject } = Promise.withResolvers<number>();
	const server = createServer();
	server.unref();
	server.on("error", reject);
	server.listen(0, "127.0.0.1", () => {
		const address = server.address();
		if (address && typeof address === "object") {
			const port = address.port;
			server.close((err: Error | null | undefined) => {
				if (err) {
					reject(err);
				} else {
					resolve(port);
				}
			});
		} else {
			server.close();
			reject(new Error("Failed to allocate port"));
		}
	});

	return promise;
}

function getGatewayDir(): string {
	return path.join(PLUGIN_DIR, GATEWAY_DIR_NAME);
}

function getGatewayInfoPath(): string {
	return path.join(getGatewayDir(), GATEWAY_INFO_FILE);
}

function getGatewayLockPath(): string {
	return path.join(getGatewayDir(), GATEWAY_LOCK_FILE);
}

async function writeLockInfo(lockPath: string): Promise<void> {
	const payload: GatewayLockInfo = { pid: process.pid, startedAt: Date.now() };
	try {
		await fs.promises.writeFile(lockPath, JSON.stringify(payload));
	} catch {
		// Ignore lock write failures
	}
}

async function readLockInfo(lockPath: string): Promise<GatewayLockInfo | null> {
	try {
		const raw = await fs.promises.readFile(lockPath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<GatewayLockInfo>;
		if (typeof parsed.pid === "number" && Number.isFinite(parsed.pid)) {
			return { pid: parsed.pid, startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0 };
		}
	} catch {
		// Ignore parse errors
	}
	return null;
}

async function ensureGatewayDir(): Promise<void> {
	const dir = getGatewayDir();
	await fs.promises.mkdir(dir, { recursive: true });
}

function isPidRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function withGatewayLock<T>(handler: () => Promise<T>): Promise<T> {
	await ensureGatewayDir();
	const lockPath = getGatewayLockPath();
	const start = Date.now();
	while (true) {
		let fd: fs.promises.FileHandle | undefined;
		try {
			fd = await fs.promises.open(lockPath, "wx");
			let heartbeatRunning = true;
			const heartbeat = (async () => {
				while (heartbeatRunning) {
					await new Promise<void>((resolve) => setTimeout(resolve, GATEWAY_LOCK_HEARTBEAT_MS));
					if (!heartbeatRunning) break;
					try {
						const now = new Date();
						await fs.promises.utimes(lockPath, now, now);
					} catch {
						// Ignore heartbeat errors
					}
				}
			})();
			try {
				await writeLockInfo(lockPath);
				return await handler();
			} finally {
				heartbeatRunning = false;
				void heartbeat.catch(() => {}); // Don't await - let it die naturally
				try {
					await fd.close();
					await fs.promises.unlink(lockPath);
				} catch {
					// Ignore lock cleanup errors
				}
			}
		} catch (err) {
			const error = err as NodeJS.ErrnoException;
			if (error.code === "EEXIST") {
				let removedStale = false;
				try {
					const lockStat = await fs.promises.stat(lockPath);
					const lockInfo = await readLockInfo(lockPath);
					const lockPid = lockInfo?.pid;
					const lockAgeMs = lockInfo?.startedAt ? Date.now() - lockInfo.startedAt : Date.now() - lockStat.mtimeMs;
					const staleByTime = lockAgeMs > GATEWAY_LOCK_STALE_MS;
					const staleByPid = lockPid !== undefined && !isPidRunning(lockPid);
					const staleByMissingPid = lockPid === undefined && staleByTime;
					if (staleByPid || staleByMissingPid) {
						await fs.promises.unlink(lockPath);
						removedStale = true;
						logger.warn("Removed stale shared gateway lock", { path: lockPath, pid: lockPid });
					}
				} catch {
					// Ignore stat errors; keep waiting
				}
				if (!removedStale) {
					if (Date.now() - start > GATEWAY_LOCK_TIMEOUT_MS) {
						throw new Error("Timed out waiting for shared gateway lock");
					}
					await new Promise<void>((resolve) => setTimeout(resolve, GATEWAY_LOCK_RETRY_MS));
				}
				continue;
			}
			throw err;
		}
	}
}

async function readGatewayInfo(): Promise<GatewayInfo | null> {
	const infoPath = getGatewayInfoPath();
	try {
		const content = await fs.promises.readFile(infoPath, "utf-8");
		const parsed = JSON.parse(content) as Partial<GatewayInfo>;

		if (typeof parsed.url !== "string" || typeof parsed.pid !== "number" || typeof parsed.startedAt !== "number") {
			return null;
		}
		return {
			url: parsed.url,
			pid: parsed.pid,
			startedAt: parsed.startedAt,
			pythonPath: typeof parsed.pythonPath === "string" ? parsed.pythonPath : undefined,
			venvPath: typeof parsed.venvPath === "string" || parsed.venvPath === null ? parsed.venvPath : undefined,
		};
	} catch {
		return null;
	}
}

async function writeGatewayInfo(info: GatewayInfo): Promise<void> {
	const infoPath = getGatewayInfoPath();
	const tempPath = `${infoPath}.tmp`;
	await fs.promises.writeFile(tempPath, JSON.stringify(info, null, 2));
	await fs.promises.rename(tempPath, infoPath);
}

async function clearGatewayInfo(): Promise<void> {
	const infoPath = getGatewayInfoPath();
	try {
		await fs.promises.unlink(infoPath);
	} catch {
		// Ignore errors on cleanup (file may not exist)
	}
}

async function isGatewayHealthy(url: string): Promise<boolean> {
	try {
		const response = await fetch(`${url}/api/kernelspecs`, {
			signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
		});
		return response.ok;
	} catch {
		return false;
	}
}

async function isGatewayAlive(info: GatewayInfo): Promise<boolean> {
	if (!isPidRunning(info.pid)) return false;
	return await isGatewayHealthy(info.url);
}

async function startGatewayProcess(
	cwd: string,
): Promise<{ url: string; pid: number; pythonPath: string; venvPath: string | null }> {
	const runtime = await resolveManagedPythonEnv();

	const kernelEnv: Record<string, string | undefined> = {
		...runtime.env,
		PYTHONUNBUFFERED: "1",
	};

	const gatewayPort = await allocatePort();
	const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

	const gatewayProcess = spawn(
		runtime.pythonPath,
		[
			"-m",
			"kernel_gateway",
			"--KernelGatewayApp.ip=127.0.0.1",
			`--KernelGatewayApp.port=${gatewayPort}`,
			"--KernelGatewayApp.port_retries=0",
			"--KernelGatewayApp.allow_origin=*",
			"--JupyterApp.answer_yes=true",
		],
		{
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
			detached: true,
			env: kernelEnv as Record<string, string>,
		},
	);

	let exited = false;
	gatewayProcess.on("exit", () => {
		exited = true;
	});

	const startTime = Date.now();
	while (Date.now() - startTime < GATEWAY_STARTUP_TIMEOUT_MS) {
		if (exited) {
			throw new Error("Gateway process exited during startup");
		}
		if (await isGatewayHealthy(gatewayUrl)) {
			localGatewayProcess = gatewayProcess;
			localGatewayUrl = gatewayUrl;
			return {
				url: gatewayUrl,
				pid: gatewayProcess.pid!,
				pythonPath: runtime.pythonPath,
				venvPath: runtime.venvPath ?? null,
			};
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 100));
	}

	gatewayProcess.kill();
	throw new Error("Gateway startup timeout");
}

async function killGateway(pid: number, context: string): Promise<void> {
	try {
		process.kill(pid, "SIGTERM");
		await new Promise<void>((resolve) => setTimeout(resolve, 1000));
		if (isPidRunning(pid)) {
			process.kill(pid, "SIGKILL");
		}
	} catch (err) {
		logger.warn("Failed to kill shared gateway process", {
			error: err instanceof Error ? err.message : String(err),
			pid,
			context,
		});
	}
}

export async function acquireSharedGateway(cwd: string): Promise<AcquireResult | null> {
	try {
		return await withGatewayLock(async () => {
			const existingInfo = await readGatewayInfo();
			if (existingInfo) {
				if (await isGatewayAlive(existingInfo)) {
					localGatewayUrl = existingInfo.url;
					isCoordinatorInitialized = true;
					logger.debug("Reusing global Python gateway", { url: existingInfo.url });
					return { url: existingInfo.url, isShared: true };
				}

				logger.debug("Cleaning up stale gateway info", { pid: existingInfo.pid });
				if (isPidRunning(existingInfo.pid)) {
					await killGateway(existingInfo.pid, "stale");
				}
				await clearGatewayInfo();
			}

			const { url, pid, pythonPath, venvPath } = await startGatewayProcess(cwd);
			const info: GatewayInfo = {
				url,
				pid,
				startedAt: Date.now(),
				pythonPath,
				venvPath,
			};
			await writeGatewayInfo(info);
			isCoordinatorInitialized = true;
			logger.debug("Started global Python gateway", { url, pid });
			return { url, isShared: true };
		});
	} catch (err) {
		logger.warn("Failed to acquire shared gateway", {
			error: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
}

export async function releaseSharedGateway(): Promise<void> {
	if (!isCoordinatorInitialized) return;
}

export async function getSharedGatewayUrl(): Promise<string | null> {
	if (localGatewayUrl) return localGatewayUrl;
	return (await readGatewayInfo())?.url ?? null;
}

export async function isSharedGatewayActive(): Promise<boolean> {
	return (await getGatewayStatus()).active;
}

export interface GatewayStatus {
	active: boolean;
	url: string | null;
	pid: number | null;
	uptime: number | null;
	pythonPath: string | null;
	venvPath: string | null;
}

export async function getGatewayStatus(): Promise<GatewayStatus> {
	const info = await readGatewayInfo();
	if (!info) {
		return {
			active: false,
			url: null,
			pid: null,
			uptime: null,
			pythonPath: null,
			venvPath: null,
		};
	}
	const active = isPidRunning(info.pid);
	return {
		active,
		url: info.url,
		pid: info.pid,
		uptime: active ? Date.now() - info.startedAt : null,
		pythonPath: info.pythonPath ?? null,
		venvPath: info.venvPath ?? null,
	};
}

export async function shutdownSharedGateway(): Promise<void> {
	try {
		await withGatewayLock(async () => {
			const info = await readGatewayInfo();
			if (!info) return;
			if (isPidRunning(info.pid)) {
				await killGateway(info.pid, "shutdown");
			}
			await clearGatewayInfo();
		});
	} catch (err) {
		logger.warn("Failed to shutdown shared gateway", {
			error: err instanceof Error ? err.message : String(err),
		});
	} finally {
		if (localGatewayProcess) {
			await killGateway(localGatewayProcess.pid!, "shutdown-local");
		}
		localGatewayProcess = null;
		localGatewayUrl = null;
		isCoordinatorInitialized = false;
	}
}
