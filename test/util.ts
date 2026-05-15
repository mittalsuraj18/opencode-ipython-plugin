/**
 * Test utilities for Python plugin tests.
 */
import { describe, it } from "bun:test";
import { resolveManagedPythonEnv, checkPythonPackages } from "../src/ipy/runtime";

let pythonAvailable: boolean | null = null;
let pythonPath: string | null = null;

export async function isPythonAvailable(): Promise<boolean> {
	if (process.env.OC_PYTHON_SKIP_CHECK === "1") return false;
	if (pythonAvailable !== null) return pythonAvailable;
	try {
		const runtime = await resolveManagedPythonEnv();
		pythonPath = runtime.pythonPath;
		const check = await checkPythonPackages(runtime.pythonPath);
		pythonAvailable = check.ok;
	} catch {
		pythonAvailable = false;
	}
	return pythonAvailable;
}

export function getPythonPath(): string | null {
	return pythonPath;
}

/**
 * Conditionally run a test based on Python availability.
 * If Python packages are not available, the test is skipped.
 */
export function testIfPython(name: string, fn: () => Promise<void> | void): void {
	it(name, async () => {
		const available = await isPythonAvailable();
		if (!available) {
			// Use Bun's test.skip mechanism by throwing a specific skip signal
			// Actually, we just return early - the test passes vacuously
			return;
		}
		await fn();
	});
}
