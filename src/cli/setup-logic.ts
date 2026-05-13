/**
 * Setup logic for opencode-ipython-plugin.
 * Orchestrates config updates, auto-discovery symlink, and project directory creation.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	getGlobalConfigPath,
	getProjectConfigPath,
	readConfig,
	writeConfig,
	mergePluginSpec,
	mergeAgentPrompt,
	mergeInstructions,
} from "./config-io.js";
import { ensurePythonEnvironment } from "./python-check.js";

export interface SetupOptions {
	force?: boolean;
	skipPythonCheck?: boolean;
	local?: boolean;
	global?: boolean;
	both?: boolean;
}

function shouldSetupGlobal(options: SetupOptions): boolean {
	if (options.local && !options.global && !options.both) return false;
	return true; // default is global
}

function shouldSetupProject(options: SetupOptions): boolean {
	if (options.local || options.both) return true;
	return false;
}

async function setupConfig(configPath: string, force: boolean): Promise<{ changes: string[] }> {
	console.log(`  Reading config: ${configPath}`);
	const config = await readConfig(configPath);
	const changes: string[] = [];

	// 1. Merge plugin spec
	if (mergePluginSpec(config, "opencode-ipython-plugin@latest", force)) {
		changes.push("Added plugin: opencode-ipython-plugin@latest");
		console.log("  ✓ Registered plugin");
	} else {
		console.log("  - Plugin already registered (skipped)");
	}

	// 2. Merge agent prompt
	if (mergeAgentPrompt(config, force)) {
		changes.push("Added python preference to agent.build.prompt");
		console.log("  ✓ Added agent prompt preference");
	} else {
		console.log("  - Agent prompt already set (skipped)");
	}

	// 3. Merge instructions
	if (mergeInstructions(config, force)) {
		changes.push("Added python preference to instructions array");
		console.log("  ✓ Added instruction preference");
	} else {
		console.log("  - Instructions already set (skipped)");
	}

	// Write back
	await writeConfig(configPath, config);
	console.log(`  ✓ Wrote config: ${configPath}`);

	return { changes };
}

async function createAutoDiscoverySymlink(configDir: string): Promise<void> {
	const pluginsDir = path.join(configDir, "plugins");
	const symlinkPath = path.join(pluginsDir, "opencode-ipython-plugin.js");

	// Resolve the actual plugin entry point
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const packageDir = path.resolve(__dirname, ".."); // src/cli/ -> src/
	const pluginEntry = path.join(packageDir, "index.js");

	// If running from dist/, adjust
	const actualEntry = existsSync(pluginEntry)
		? pluginEntry
		: path.join(packageDir, "..", "dist", "index.js");

	if (!existsSync(actualEntry)) {
		console.warn("  ⚠ Could not find plugin entry point for symlink");
		console.warn(`    Expected: ${actualEntry}`);
		return;
	}

	// Remove existing symlink if it points somewhere else
	if (existsSync(symlinkPath)) {
		const existingTarget = await fs.readlink(symlinkPath).catch(() => null);
		if (existingTarget === actualEntry) {
			console.log("  - Auto-discovery symlink already exists (skipped)");
			return;
		}
		await fs.unlink(symlinkPath);
	}

	await fs.mkdir(pluginsDir, { recursive: true });
	await fs.symlink(actualEntry, symlinkPath);
	console.log("  ✓ Created auto-discovery symlink");
}

async function createProjectModulesDir(cwd: string): Promise<void> {
	const modulesDir = path.join(cwd, ".opencode-ipython-plugin", "modules");
	await fs.mkdir(modulesDir, { recursive: true });

	// Create a README inside the modules dir
	const readmePath = path.join(modulesDir, "README.md");
	if (!existsSync(readmePath)) {
		const readme = `# Python Extension Modules

Place ".py" files in this directory to auto-load them into every IPython kernel for this project.

These modules are executed silently on kernel startup, after the prelude.

## Example

\`\`\`python
# custom_helpers.py
def my_helper():
    return "Hello from custom helper!"
\`\`\`

Then in any cell:
\`\`\`python
my_helper()  # => "Hello from custom helper!"
\`\`\`
`;
		await fs.writeFile(readmePath, readme, "utf-8");
	}

	console.log(`  ✓ Created project modules directory: ${modulesDir}`);
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
	const doGlobal = shouldSetupGlobal(options);
	const doProject = shouldSetupProject(options);

	console.log("=".repeat(60));
	console.log("OpenCode IPython Plugin Setup");
	console.log("=".repeat(60));
	console.log("");

	// 1. Ensure Python environment
	if (!options.skipPythonCheck) {
		const pythonCheck = await ensurePythonEnvironment();
		if (!pythonCheck.ok) {
			console.log("");
			console.log("Setup incomplete. Please resolve Python environment and run again.");
			console.log("  Or run with --skip-python-check to bypass this step.");
			process.exit(1);
		}
		console.log("");
	} else {
		console.log("⏭  Skipping Python environment setup (--skip-python-check)");
		console.log("");
	}

	const allChanges: string[] = [];

	// 2. Global setup
	if (doGlobal) {
		console.log("🌐 Global Setup");
		console.log("-".repeat(40));
		const globalConfigPath = getGlobalConfigPath();
		const globalResult = await setupConfig(globalConfigPath, options.force ?? false);
		allChanges.push(...globalResult.changes);

		// Create auto-discovery symlink
		const globalConfigDir = path.dirname(globalConfigPath);
		await createAutoDiscoverySymlink(globalConfigDir);
		console.log("");
	}

	// 3. Project-level setup
	if (doProject) {
		console.log("📁 Project Setup");
		console.log("-".repeat(40));
		const projectConfigPath = getProjectConfigPath();
		const projectResult = await setupConfig(projectConfigPath, options.force ?? false);
		allChanges.push(...projectResult.changes);

		// Create project modules directory
		await createProjectModulesDir(process.cwd());
		console.log("");
	}

	// 4. Summary
	console.log("=".repeat(60));
	console.log("Setup Complete!");
	console.log("=".repeat(60));
	if (allChanges.length > 0) {
		console.log("Changes made:");
		for (const change of allChanges) {
			console.log(`  • ${change}`);
		}
	} else {
		console.log("No changes needed — everything was already configured.");
	}
	console.log("");
	console.log("The opencode-ipython-plugin is now active.");
	console.log("OpenCode will prefer the `python` tool over `bash` for code execution.");
	console.log("");

	if (doProject) {
		console.log("Project-level config written to: ./.opencode/config.json");
		console.log("You can commit this file to share the plugin with your team.");
		console.log("");
	}
}
