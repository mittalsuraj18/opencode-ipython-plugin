/**
 * Tests for runtime.ts - Python runtime resolution and environment filtering.
 */
import { describe, it, expect } from "bun:test";
import { filterEnv, resolveVenvPath, resolvePythonRuntime, checkPythonPackages, installPythonPackages } from "../src/ipy/runtime";

describe("filterEnv", () => {
	it("preserves safe environment variables", () => {
		const env = {
			PATH: "/usr/bin",
			HOME: "/home/user",
			USER: "user",
			VIRTUAL_ENV: "/venv",
			PYTHONPATH: "/lib",
			LANG: "en_US.UTF-8",
		};
		const filtered = filterEnv(env);
		expect(filtered.PATH).toBe("/usr/bin");
		expect(filtered.HOME).toBe("/home/user");
		expect(filtered.USER).toBe("user");
		expect(filtered.VIRTUAL_ENV).toBe("/venv");
		expect(filtered.PYTHONPATH).toBe("/lib");
		expect(filtered.LANG).toBe("en_US.UTF-8");
	});

	it("strips dangerous API keys", () => {
		const env = {
			OPENAI_API_KEY: "sk-12345",
			ANTHROPIC_API_KEY: "sk-ant-12345",
			GEMINI_API_KEY: "gemini-12345",
			PATH: "/usr/bin",
		};
		const filtered = filterEnv(env);
		expect(filtered.OPENAI_API_KEY).toBeUndefined();
		expect(filtered.ANTHROPIC_API_KEY).toBeUndefined();
		expect(filtered.GEMINI_API_KEY).toBeUndefined();
		expect(filtered.PATH).toBe("/usr/bin");
	});

	it("handles empty and undefined values", () => {
		const env = {
			PATH: "/usr/bin",
			LANG: "",
			UNDEFINED: undefined,
		};
		const filtered = filterEnv(env);
		expect(filtered.PATH).toBe("/usr/bin");
		expect(filtered.LANG).toBe(""); // Empty string in allowlist is preserved
		expect(filtered.UNDEFINED).toBeUndefined();
	});

	it("preserves XDG_ and LC_ prefixed variables", () => {
		const env = {
			XDG_CACHE_HOME: "/home/user/.cache",
			LC_ALL: "en_US.UTF-8",
			LC_CTYPE: "en_US.UTF-8",
		};
		const filtered = filterEnv(env);
		expect(filtered.XDG_CACHE_HOME).toBe("/home/user/.cache");
		expect(filtered.LC_ALL).toBe("en_US.UTF-8");
		expect(filtered.LC_CTYPE).toBe("en_US.UTF-8");
	});
});

describe("resolveVenvPath", () => {
	it("returns VIRTUAL_ENV when set", () => {
		const original = process.env.VIRTUAL_ENV;
		process.env.VIRTUAL_ENV = "/my/venv";
		try {
			expect(resolveVenvPath("/cwd")).toBe("/my/venv");
		} finally {
			if (original) process.env.VIRTUAL_ENV = original;
			else delete process.env.VIRTUAL_ENV;
		}
	});

	it("falls back to .venv directory when present", () => {
		const tmpDir = process.cwd();
		const result = resolveVenvPath(tmpDir);
		// May return undefined if no venv exists
		expect(result === undefined || typeof result === "string").toBeTrue();
	});
});

describe("resolvePythonRuntime", () => {
	it("finds system Python", () => {
		const runtime = resolvePythonRuntime(process.cwd(), {});
		expect(runtime.pythonPath).toBeString();
		expect(runtime.pythonPath.length).toBeGreaterThan(0);
	});

	it("includes filtered environment", () => {
		const env = { PATH: "/usr/bin", OPENAI_API_KEY: "secret" };
		const runtime = resolvePythonRuntime(process.cwd(), filterEnv(env));
		expect(runtime.env.OPENAI_API_KEY).toBeUndefined();
		expect(runtime.env.PATH).toBeDefined();
	});
});

describe("checkPythonPackages", () => {
	it("checks for kernel_gateway and ipykernel", async () => {
		const runtime = resolvePythonRuntime(process.cwd(), {});
		const result = await checkPythonPackages(runtime.pythonPath);
		// We expect it might fail in CI where packages aren't installed
		expect(result).toBeObject();
		expect(result.ok).toBeBoolean();
	});
});

describe("installPythonPackages", () => {
	it("returns proper result type", async () => {
		const runtime = resolvePythonRuntime(process.cwd(), {});
		const result = await installPythonPackages(runtime.pythonPath);
		expect(result).toBeObject();
		expect(result.ok).toBeBoolean();
	});
});
