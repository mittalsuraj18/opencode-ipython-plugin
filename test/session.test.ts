/**
 * Tests for session.ts - Session manager with LRU, heartbeat, and eviction.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { executePython, shutdownAllSessions } from "../src/ipy/session";
import { acquireSharedGateway, shutdownSharedGateway } from "../src/ipy/gateway";
import { isPythonAvailable, testIfPython } from "./util";

describe("Session Manager", () => {
	const cwd = process.cwd();
	let pythonReady = false;

	beforeAll(async () => {
		pythonReady = await isPythonAvailable();
		if (pythonReady) {
			await acquireSharedGateway(cwd);
		}
	});

	afterAll(async () => {
		await shutdownAllSessions();
		await shutdownSharedGateway();
	});

	afterEach(async () => {
		await shutdownAllSessions();
	});

	testIfPython("reuses kernel for same session+cwd", async () => {
		const result1 = await executePython("x = 1", { sessionId: "test-session", cwd });
		expect(result1.exitCode).toBe(0);

		const result2 = await executePython("print(x)", { sessionId: "test-session", cwd });
		expect(result2.exitCode).toBe(0);
		expect(result2.output).toContain("1");
	});

	testIfPython("creates new kernel for different session", async () => {
		const result1 = await executePython("x = 1", { sessionId: "session-a", cwd });
		expect(result1.exitCode).toBe(0);

		const result2 = await executePython("print(x)", { sessionId: "session-b", cwd });
		expect(result2.exitCode).toBe(1);
	});

	testIfPython("serializes execution per session", async () => {
		const promises = [
			executePython("x = 1", { sessionId: "serial-session", cwd }),
			executePython("x = 2", { sessionId: "serial-session", cwd }),
		];

		const results = await Promise.all(promises);
		expect(results[0].exitCode).toBe(0);
		expect(results[1].exitCode).toBe(0);
	});

	// TODO: Fix cancellation timing - test is flaky
	// testIfPython("handles cancellation gracefully", async () => {
	// 	const controller = new AbortController();
	// 	const promise = executePython("import time; time.sleep(10)", {
	// 		cwd,
	// 		signal: controller.signal,
	// 		deadlineMs: Date.now() + 5000,
	// 	});

	// 	await Bun.sleep(300);
	// 	controller.abort();

	// 	const result = await promise;
	// 	expect(result.cancelled).toBeTrue();
	// });

	testIfPython("handles timeout", async () => {
		const result = await executePython("import time; time.sleep(10)", {
			cwd,
			deadlineMs: Date.now() + 500,
		});

		expect(result.cancelled).toBeTrue();
	});

	testIfPython("handles multi-cell with error stopping", async () => {
		const result1 = await executePython("x = 1", { sessionId: "error-test", cwd });
		expect(result1.exitCode).toBe(0);

		const result2 = await executePython("1/0", { sessionId: "error-test", cwd });
		expect(result2.exitCode).toBe(1);

		const result3 = await executePython("print(x)", { sessionId: "error-test", cwd });
		expect(result3.exitCode).toBe(0);
		expect(result3.output).toContain("1");
	});
});
