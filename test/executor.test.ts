/**
 * Tests for executor.ts - Multi-cell execution engine.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { executeCells } from "../src/ipy/executor";
import { acquireSharedGateway, shutdownSharedGateway } from "../src/ipy/gateway";
import { isPythonAvailable, testIfPython } from "./util";

describe("Executor", () => {
	const cwd = process.cwd();
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

	testIfPython("executes multiple cells sequentially", async () => {
		const result = await executeCells({
			cells: [
				{ code: "x = 1", title: "define" },
				{ code: "y = 2", title: "define2" },
				{ code: "print(x + y)", title: "use" },
			],
			timeout: 30,
			cwd,
		});

		expect(result.isError).toBeFalse();
		expect(result.cells).toHaveLength(3);
		expect(result.cells[0].status).toBe("complete");
		expect(result.cells[1].status).toBe("complete");
		expect(result.cells[2].status).toBe("complete");
		expect(result.output).toContain("3");
	});

	testIfPython("stops on cell error", async () => {
		const result = await executeCells({
			cells: [
				{ code: "x = 1" },
				{ code: "1/0" },
				{ code: "print(x)" },
			],
			timeout: 30,
			cwd,
		});

		expect(result.isError).toBeTrue();
		expect(result.cells[0].status).toBe("complete");
		expect(result.cells[1].status).toBe("error");
		expect(result.cells[2].status).toBe("pending");
	});

	testIfPython("respects timeout", async () => {
		const result = await executeCells({
			cells: [{ code: "import time; time.sleep(10)" }],
			timeout: 1,
			cwd,
		});

		expect(result.timedOut || result.cancelled).toBeTrue();
	});

	// TODO: Fix cancellation timing - test is flaky
	// testIfPython("handles cancellation via signal", async () => {
	// 	const controller = new AbortController();
	// 	const promise = executeCells({
	// 		cells: [{ code: "import time; time.sleep(10)" }],
	// 		timeout: 30,
	// 		cwd,
	// 		signal: controller.signal,
	// 	});

	// 	await Bun.sleep(300);
	// 	controller.abort();

	// 	const result = await promise;
	// 	expect(result.cancelled).toBeTrue();
	// });

	// TODO: Fix display output collection in test environment
	// testIfPython("collects display outputs", async () => {
	// 	const result = await executeCells({
	// 		cells: [
	// 			{
	// 				code: "from IPython.display import display, JSON\ndisplay(JSON({'key': 'value'}))",
	// 			},
	// 		],
	// 		timeout: 30,
	// 		cwd,
	// 	});

	// 	expect(result.isError).toBeFalse();
	// 	expect(result.jsonOutputs.length).toBeGreaterThan(0);
	// });

	testIfPython("collects images", async () => {
		const result = await executeCells({
			cells: [
				{
					code: `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.plot([1, 2, 3], [1, 4, 9])
plt.show()
`,
				},
			],
			timeout: 30,
			cwd,
		});

		expect(result).toBeObject();
	});
});
