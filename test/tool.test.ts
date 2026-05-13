/**
 * Tests for tool/python.ts - Tool surface.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createPythonTool } from "../src/tool/python";
import { acquireSharedGateway, shutdownSharedGateway } from "../src/ipy/gateway";
import { isPythonAvailable, testIfPython } from "./util";

describe("Python Tool", () => {
	const cwd = process.cwd();
	const tool = createPythonTool();
	let pythonReady = false;

	beforeAll(async () => {
		pythonReady = await isPythonAvailable();
		if (pythonReady) {
			await acquireSharedGateway(cwd);
		}
	});

	afterAll(async () => {
		await shutdownSharedGateway();
	});

	it("has correct structure", () => {
		expect(tool).toBeObject();
		expect(tool.description).toBeString();
		expect(tool.args).toBeObject();
		expect(tool.execute).toBeFunction();
	});

		testIfPython("executes simple code", async () => {
		const result = await tool.execute(
			{
				cells: [{ code: "print('hello world')" }],
				cwd,
			},
			{
				sessionID: "test-session",
				messageID: "test-message",
				agent: "test-agent",
				directory: cwd,
				worktree: cwd,
				abort: new AbortController().signal,
				metadata: () => {},
				ask: async () => {},
			},
		);

		expect(typeof result).toBe("string");
		expect(result).toContain("hello world");
	});

	testIfPython("executes multiple cells", async () => {
		const result = await tool.execute(
			{
				cells: [
					{ code: "x = 42", title: "define" },
					{ code: "print(x)", title: "use" },
				],
				cwd,
			},
			{
				sessionID: "test-session-2",
				messageID: "test-message-2",
				agent: "test-agent",
				directory: cwd,
				worktree: cwd,
				abort: new AbortController().signal,
				metadata: () => {},
				ask: async () => {},
			},
		);

		expect(typeof result).toBe("string");
		expect(result).toContain("42");
		expect(result).toContain("## define");
		expect(result).toContain("## use");
	});

	testIfPython("handles errors", async () => {
		const result = await tool.execute(
			{
				cells: [{ code: "1/0" }],
				cwd,
			},
			{
				sessionID: "test-session-3",
				messageID: "test-message-3",
				agent: "test-agent",
				directory: cwd,
				worktree: cwd,
				abort: new AbortController().signal,
				metadata: () => {},
				ask: async () => {},
			},
		);

		expect(typeof result).toBe("string");
		expect(result).toContain("ZeroDivisionError");
	});
});
