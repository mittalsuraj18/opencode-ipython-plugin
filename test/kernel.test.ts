/**
 * Tests for kernel.ts - Jupyter WebSocket client and protocol.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { PythonKernel, checkPythonKernelAvailability, renderKernelDisplay, deserializeWebSocketMessage, serializeWebSocketMessage } from "../src/ipy/kernel";
import { acquireSharedGateway, shutdownSharedGateway } from "../src/ipy/gateway";
import { isPythonAvailable, testIfPython } from "./util";

describe("Kernel Protocol", () => {
	it("checkPythonKernelAvailability returns proper structure", async () => {
		const result = await checkPythonKernelAvailability(process.cwd());
		expect(result).toBeObject();
		expect(result.ok).toBeBoolean();
	});

	it("renderKernelDisplay handles text/plain", () => {
		const result = renderKernelDisplay({
			data: { "text/plain": "Hello World" },
		});
		expect(result.text).toBe("Hello World\n");
		expect(result.outputs).toBeArray();
	});

	it("renderKernelDisplay handles markdown", () => {
		const result = renderKernelDisplay({
			data: { "text/markdown": "# Title\nBody" },
		});
		expect(result.text).toBe("# Title\nBody\n");
		expect(result.outputs).toHaveLength(1);
		expect(result.outputs[0]).toEqual({ type: "markdown" });
	});

	it("renderKernelDisplay handles image/png", () => {
		const result = renderKernelDisplay({
			data: { "image/png": "base64data123" },
		});
		expect(result.outputs).toHaveLength(1);
		expect(result.outputs[0]).toEqual({ type: "image", data: "base64data123", mimeType: "image/png" });
	});

	it("renderKernelDisplay handles application/json", () => {
		const result = renderKernelDisplay({
			data: { "application/json": { key: "value" } },
		});
		expect(result.outputs).toHaveLength(1);
		expect(result.outputs[0]).toEqual({ type: "json", data: { key: "value" } });
	});

	it("serialize/deserialize WebSocket message roundtrip", () => {
		const msg = {
			channel: "shell",
			header: {
				msg_id: "test-id",
				session: "session-id",
				username: "test",
				date: new Date().toISOString(),
				msg_type: "execute_request",
				version: "5.5",
			},
			parent_header: {},
			metadata: {},
			content: { code: "print(1)" },
		};
		const serialized = serializeWebSocketMessage(msg);
		expect(serialized).toBeInstanceOf(ArrayBuffer);

		const deserialized = deserializeWebSocketMessage(serialized);
		expect(deserialized).not.toBeNull();
		expect(deserialized?.header.msg_id).toBe("test-id");
		expect(deserialized?.header.msg_type).toBe("execute_request");
	});
});

describe("PythonKernel Live", () => {
	let kernel: PythonKernel;
	let pythonReady = false;

	beforeAll(async () => {
		pythonReady = await isPythonAvailable();
		if (pythonReady) {
			await acquireSharedGateway(process.cwd());
			kernel = await PythonKernel.start({ cwd: process.cwd() });
		}
	});

	afterAll(async () => {
		if (kernel) {
			await kernel.shutdown();
		}
		await shutdownSharedGateway();
	});

	testIfPython("starts and connects", () => {
		expect(kernel.isAlive()).toBeTrue();
	});

	testIfPython("executes simple code", async () => {
		let output = "";
		const result = await kernel.execute("print('hello')", {
			onChunk: (text) => {
				output += text;
			},
		});
		expect(result.status).toBe("ok");
		expect(result.cancelled).toBeFalse();
		expect(output).toContain("hello");
	});

	testIfPython("handles errors", async () => {
		let output = "";
		const result = await kernel.execute("1/0", {
			onChunk: (text) => {
				output += text;
			},
		});
		expect(result.status).toBe("error");
		expect(result.error).toBeDefined();
	});

	testIfPython("persists variables across calls", async () => {
		await kernel.execute("x = 42", { silent: true, storeHistory: false });
		let output = "";
		const result = await kernel.execute("print(x)", {
			onChunk: (text) => {
				output += text;
			},
		});
		expect(result.status).toBe("ok");
		expect(output).toContain("42");
	});

	testIfPython("interrupts execution", async () => {
		const controller = new AbortController();
		const promise = kernel.execute("import time; time.sleep(10)", {
			signal: controller.signal,
			timeoutMs: 5000,
		});
		
		await Bun.sleep(500);
		controller.abort();
		
		const result = await promise;
		expect(result.cancelled || result.status === "error").toBeTrue();
	});
});
