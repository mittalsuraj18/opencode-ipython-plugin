#!/usr/bin/env node
/**
 * CLI entry point for @mittalsuraj18/opencode-ipython-plugin setup.
 *
 * Usage:
 *   npx @mittalsuraj18/opencode-ipython-plugin setup [options]
 *
 * Options:
 *   --force              Overwrite existing config entries
 *   --skip-python-check  Skip Python dependency validation
 *   --local              Setup project-level config only
 *   --global             Setup global config only (default)
 *   --both               Setup both global and project-level
 *   --help               Show this help message
 */
import { runSetup } from "./setup-logic.js";

function showHelp(): void {
	console.log(`
Usage: @mittalsuraj18/opencode-ipython-plugin setup [options]

One-time setup to activate the IPython plugin for OpenCode.

Options:
  --force              Overwrite existing config entries
  --skip-python-check  Skip Python dependency validation
  --local              Setup project-level config only
  --global             Setup global config only (default)
  --both               Setup both global and project-level
  --help               Show this help message

Examples:
  @mittalsuraj18/opencode-ipython-plugin setup                    # Global setup
  @mittalsuraj18/opencode-ipython-plugin setup --both             # Global + project
  @mittalsuraj18/opencode-ipython-plugin setup --local          # Project only
  @mittalsuraj18/opencode-ipython-plugin setup --force            # Overwrite existing
  @mittalsuraj18/opencode-ipython-plugin setup --skip-python-check # Skip Python check
`);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		showHelp();
		process.exit(0);
	}

	const options = {
		force: args.includes("--force"),
		skipPythonCheck: args.includes("--skip-python-check"),
		local: args.includes("--local"),
		global: args.includes("--global"),
		both: args.includes("--both"),
	};

	try {
		await runSetup(options);
	} catch (err) {
		console.error("Setup failed:", err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}

main();
