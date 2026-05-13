/**
 * Python dependency checker for setup CLI.
 */
import { resolvePythonRuntime, filterEnv, checkPythonPackages, installPythonPackages } from "../ipy/runtime.js";

export async function checkAndInstallPythonDeps(): Promise<{ ok: boolean; reason?: string }> {
	console.log("Checking Python dependencies...");
	
	try {
		const runtime = resolvePythonRuntime(process.cwd(), filterEnv(process.env as Record<string, string | undefined>));
		
		const check = await checkPythonPackages(runtime.pythonPath);
		if (check.ok) {
			console.log("  ✓ jupyter_kernel_gateway and ipykernel already installed");
			return { ok: true };
		}
		
		console.log("  ⚠ Missing Python dependencies:", check.reason);
		console.log("  Attempting auto-install...");
		
		const install = await installPythonPackages(runtime.pythonPath);
		if (install.ok) {
			console.log("  ✓ Python dependencies installed successfully");
			return { ok: true };
		}
		
		console.error("  ✗ Auto-install failed:", install.reason);
		
		// Check if it's a PEP 668 issue
		if (install.reason?.includes("externally-managed-environment")) {
			console.log("\n  Your Python is externally managed (PEP 668).");
			console.log("  Please create a virtual environment and install manually:");
			console.log("");
			console.log("    python3 -m venv ~/.opencode-ipython-plugin/python-env");
			console.log("    source ~/.opencode-ipython-plugin/python-env/bin/activate");
			console.log("    pip install jupyter_kernel_gateway ipykernel");
			console.log("");
			console.log("  Then run this setup again with --skip-python-check");
		} else {
			console.log("\n  Please install manually:");
			console.log("");
			console.log("    pip install jupyter_kernel_gateway ipykernel");
			console.log("");
		}
		
		return { ok: false, reason: install.reason };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error("  ✗ Python check failed:", message);
		return { ok: false, reason: message };
	}
}
