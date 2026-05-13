/**
 * Python environment checker for setup CLI.
 * Ensures an isolated managed Python environment exists with required packages.
 */
import { resolveManagedPythonEnv, findUv } from "../ipy/runtime.js";

export async function ensurePythonEnvironment(): Promise<{ ok: boolean; pythonPath: string; reason?: string }> {
	console.log("Ensuring isolated Python environment...");
	
	try {
		const uv = await findUv();
		if (uv) {
			console.log("  ✓ uv detected — will use for fast environment creation");
		}
		
		const runtime = await resolveManagedPythonEnv();
		console.log(`  ✓ Using Python: ${runtime.pythonPath}`);
		return { ok: true, pythonPath: runtime.pythonPath };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error("  ✗ Failed to create Python environment:", message);
		console.log("");
		console.log("  Please ensure one of the following is available:");
		console.log("    • uv (https://docs.astral.sh/uv/) — fastest option");
		console.log("    • python3 with venv module");
		console.log("");
		return { ok: false, pythonPath: "", reason: message };
	}
}
