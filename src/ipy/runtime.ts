/**
 * Python runtime resolution utilities.
 *
 * Centralizes environment filtering, venv detection, and Python executable resolution
 * for both the shared gateway and local kernel spawning.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../util/logger.js";

const DEFAULT_ENV_ALLOWLIST = new Set([
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"LC_MESSAGES",
	"TERM",
	"TERM_PROGRAM",
	"TERM_PROGRAM_VERSION",
	"TMPDIR",
	"TEMP",
	"TMP",
	"XDG_CACHE_HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_RUNTIME_DIR",
	"SSH_AUTH_SOCK",
	"SSH_AGENT_PID",
	"CONDA_PREFIX",
	"CONDA_DEFAULT_ENV",
	"VIRTUAL_ENV",
	"PYTHONPATH",
]);

const WINDOWS_ENV_ALLOWLIST = new Set([
	"APPDATA",
	"COMPUTERNAME",
	"COMSPEC",
	"HOMEDRIVE",
	"HOMEPATH",
	"LOCALAPPDATA",
	"NUMBER_OF_PROCESSORS",
	"OS",
	"PATH",
	"PATHEXT",
	"PROCESSOR_ARCHITECTURE",
	"PROCESSOR_IDENTIFIER",
	"PROGRAMDATA",
	"PROGRAMFILES",
	"PROGRAMFILES(X86)",
	"PROGRAMW6432",
	"SESSIONNAME",
	"SYSTEMDRIVE",
	"SYSTEMROOT",
	"TEMP",
	"TMP",
	"USERDOMAIN",
	"USERDOMAIN_ROAMINGPROFILE",
	"USERPROFILE",
	"USERNAME",
	"WINDIR",
]);

const DEFAULT_ENV_DENYLIST = new Set([
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
	"GOOGLE_API_KEY",
	"GEMINI_API_KEY",
	"OPENROUTER_API_KEY",
	"PERPLEXITY_API_KEY",
	"PERPLEXITY_COOKIES",
	"EXA_API_KEY",
	"AZURE_OPENAI_API_KEY",
	"MISTRAL_API_KEY",
]);

const DEFAULT_ENV_ALLOW_PREFIXES = ["LC_", "XDG_", "OC_"];

const CASE_INSENSITIVE_ENV = process.platform === "win32";
const BASE_ENV_ALLOWLIST = new Set([...DEFAULT_ENV_ALLOWLIST, ...WINDOWS_ENV_ALLOWLIST]);

const NORMALIZED_ALLOWLIST = new Set(
	Array.from(BASE_ENV_ALLOWLIST, key => (CASE_INSENSITIVE_ENV ? key.toUpperCase() : key)),
);
const NORMALIZED_DENYLIST = new Set(
	Array.from(DEFAULT_ENV_DENYLIST, key => (CASE_INSENSITIVE_ENV ? key.toUpperCase() : key)),
);
const NORMALIZED_ALLOW_PREFIXES = CASE_INSENSITIVE_ENV
	? DEFAULT_ENV_ALLOW_PREFIXES.map(prefix => prefix.toUpperCase())
	: DEFAULT_ENV_ALLOW_PREFIXES;

function normalizeEnvKey(key: string): string {
	return CASE_INSENSITIVE_ENV ? key.toUpperCase() : key;
}

export interface PythonRuntime {
	/** Path to python executable */
	pythonPath: string;
	/** Filtered environment variables */
	env: Record<string, string | undefined>;
	/** Path to virtual environment, if detected */
	venvPath?: string;
}

/**
 * Filter environment variables to a safe allowlist for Python subprocesses.
 * Removes sensitive API keys and limits to known-safe variables.
 */
export function filterEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
	const filtered: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) continue;
		const normalizedKey = normalizeEnvKey(key);
		if (NORMALIZED_DENYLIST.has(normalizedKey)) continue;
		if (NORMALIZED_ALLOWLIST.has(normalizedKey)) {
			const destKey = normalizedKey === "PATH" ? "PATH" : key;
			filtered[destKey] = value;
			continue;
		}
		if (NORMALIZED_ALLOW_PREFIXES.some(prefix => normalizedKey.startsWith(prefix))) {
			filtered[key] = value;
		}
	}
	return filtered;
}

/**
 * Detect virtual environment path from VIRTUAL_ENV or common locations.
 */
export function resolveVenvPath(cwd: string): string | undefined {
	if (process.env.VIRTUAL_ENV) return process.env.VIRTUAL_ENV;
	const candidates = [path.join(cwd, ".venv"), path.join(cwd, "venv")];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

/**
 * @deprecated System Python fallback is no longer supported. Use resolveManagedPythonEnv() instead.
 * This function now throws to prevent accidental system Python usage.
 */
export function resolvePythonRuntime(_cwd: string, _baseEnv: Record<string, string | undefined>): never {
	throw new Error(
		"System Python fallback removed. Use resolveManagedPythonEnv() which creates an isolated environment automatically.",
	);
}

/**
 * Check if required Python packages are available.
 */
export async function checkPythonPackages(pythonPath: string): Promise<{ ok: boolean; reason?: string }> {
	const checkScript =
		"import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('kernel_gateway') and importlib.util.find_spec('ipykernel') else 1)";
	try {
		const proc = Bun.spawn([pythonPath, "-c", checkScript], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		if (exitCode === 0) {
			return { ok: true };
		}
		return {
			ok: false,
			reason:
				"kernel_gateway (jupyter-kernel-gateway) or ipykernel not installed. Plugin will attempt automatic installation.",
		};
	} catch (err) {
		return { ok: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Attempt to install required Python packages.
 */
export async function installPythonPackages(pythonPath: string): Promise<{ ok: boolean; reason?: string }> {
	try {
		const proc = Bun.spawn([pythonPath, "-m", "pip", "install", "jupyter_kernel_gateway", "ipykernel"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		if (exitCode === 0) {
			return { ok: true };
		}
		const stderr = await new Response(proc.stderr).text();
		return { ok: false, reason: `pip install failed: ${stderr}` };
	} catch (err) {
		return { ok: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

// ── Managed isolated environment ──────────────────────────────────────────

const PLUGIN_DIR = path.join(process.env.HOME ?? "/tmp", ".opencode-ipython-plugin");
const MANAGED_ENV_DIR = path.join(PLUGIN_DIR, "python-env");
const MANAGED_PYTHON = path.join(
	MANAGED_ENV_DIR,
	process.platform === "win32" ? "Scripts" : "bin",
	process.platform === "win32" ? "python.exe" : "python",
);

export function getConfigDir(): string {
	return PLUGIN_DIR;
}

async function runCommand(cmd: string, args: string[]): Promise<void> {
	const proc = Bun.spawn([cmd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`Command failed: ${cmd} ${args.join(" ")} — ${stderr}`);
	}
}

export async function findUv(): Promise<string | undefined> {
	return Bun.which("uv") ?? undefined;
}

export async function isValidEnv(): Promise<boolean> {
	if (!fs.existsSync(MANAGED_PYTHON)) return false;
	const check = await checkPythonPackages(MANAGED_PYTHON);
	return check.ok;
}

export async function createUvEnv(dir: string): Promise<void> {
	await runCommand("uv", ["venv", dir, "--seed"]);
}

export async function createVenvEnv(dir: string): Promise<void> {
	const python = Bun.which("python3") ?? Bun.which("python");
	if (!python) throw new Error("python3 or python not found on PATH");
	await runCommand(python, ["-m", "venv", dir]);
}

export async function installManagedPackages(): Promise<void> {
	const uv = await findUv();
	if (uv) {
		await runCommand("uv", ["pip", "install", "jupyter_kernel_gateway", "ipykernel", "--python", MANAGED_PYTHON]);
	} else {
		await runCommand(MANAGED_PYTHON, ["-m", "pip", "install", "jupyter_kernel_gateway", "ipykernel"]);
	}
}

export async function createManagedEnv(): Promise<void> {
	logger.log("Creating isolated Python environment...");
	await fs.promises.mkdir(PLUGIN_DIR, { recursive: true });

	const uv = await findUv();
	if (uv) {
		logger.log("  Using uv for fast environment creation");
		await createUvEnv(MANAGED_ENV_DIR);
	} else {
		logger.log("  Using python3 -m venv (install uv for faster setup: https://docs.astral.sh/uv/)");
		await createVenvEnv(MANAGED_ENV_DIR);
	}

	logger.log("  Installing jupyter_kernel_gateway and ipykernel...");
	await installManagedPackages();
	logger.log("  ✓ Isolated Python environment ready");
}

export async function resolveManagedPythonEnv(): Promise<PythonRuntime> {
	if (await isValidEnv()) {
		return {
			pythonPath: MANAGED_PYTHON,
			env: filterEnv(process.env as Record<string, string | undefined>),
			venvPath: MANAGED_ENV_DIR,
		};
	}

	await createManagedEnv();

	return {
		pythonPath: MANAGED_PYTHON,
		env: filterEnv(process.env as Record<string, string | undefined>),
		venvPath: MANAGED_ENV_DIR,
	};
}
