/**
 * Config I/O for opencode setup CLI.
 * Handles reading/writing ~/.opencode/config.json and project-level configs.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { parse, type ParseError } from "jsonc-parser";

export interface OpenCodeConfig {
	$schema?: string;
	plugin?: string[];
	agent?: {
		build?: {
			prompt?: string;
		};
	};
	instructions?: string[];
	[key: string]: unknown;
}

const PYTHON_PREFERENCE_PROMPT =
	"When executing code, calculations, data processing, or scripting tasks, ALWAYS prefer the `python` tool over `bash`/`shell`. Only use `bash` for system-level operations (git, npm, docker) that genuinely require shell commands. The `python` tool provides a persistent IPython kernel with rich output support (plots, JSON, markdown) and a comprehensive prelude library of helper functions.";

const PYTHON_PREFERENCE_INSTRUCTION =
	"When executing code, calculations, data processing, or scripting tasks, ALWAYS prefer the `python` tool over `bash`/`shell`. Only use `bash` for system-level operations (git, npm, docker). The `python` tool provides a persistent IPython kernel with rich output support.";

export function getGlobalConfigDir(): string {
	return path.join(process.env.HOME ?? process.env.USERPROFILE ?? "/tmp", ".opencode");
}

export function getGlobalConfigPath(): string {
	return path.join(getGlobalConfigDir(), "config.json");
}

export function getProjectConfigDir(cwd: string = process.cwd()): string {
	return path.join(cwd, ".opencode");
}

export function getProjectConfigPath(cwd: string = process.cwd()): string {
	return path.join(getProjectConfigDir(cwd), "config.json");
}

export async function readConfig(configPath: string): Promise<OpenCodeConfig> {
	if (!existsSync(configPath)) {
		return { $schema: "https://opencode.ai/config.json" };
	}

	const content = await fs.readFile(configPath, "utf-8");
	const errors: ParseError[] = [];
	const parsed = parse(content, errors) as OpenCodeConfig | undefined;

	if (errors.length > 0) {
		console.warn("  Warning: Config file has JSON syntax errors, using best-effort parse");
	}

	return parsed ?? { $schema: "https://opencode.ai/config.json" };
}

export async function writeConfig(configPath: string, config: OpenCodeConfig): Promise<void> {
	const dir = path.dirname(configPath);
	await fs.mkdir(dir, { recursive: true });

	const content = JSON.stringify(config, null, 2) + "\n";
	await fs.writeFile(configPath, content, "utf-8");
}

export function mergePluginSpec(config: OpenCodeConfig, pluginSpec: string, force: boolean): boolean {
	const plugins = config.plugin ?? [];
	if (plugins.includes(pluginSpec) && !force) {
		return false;
	}
	if (!plugins.includes(pluginSpec)) {
		config.plugin = [...plugins, pluginSpec];
		return true;
	}
	return false;
}

export function mergeAgentPrompt(config: OpenCodeConfig, force: boolean): boolean {
	config.agent ??= {};
	config.agent.build ??= {};

	const existingPrompt = config.agent.build.prompt;
	if (existingPrompt && existingPrompt.includes("python") && !force) {
		return false;
	}

	if (existingPrompt) {
		// Append to existing prompt
		config.agent.build.prompt = `${existingPrompt}\n\n${PYTHON_PREFERENCE_PROMPT}`;
	} else {
		config.agent.build.prompt = PYTHON_PREFERENCE_PROMPT;
	}
	return true;
}

export function mergeInstructions(config: OpenCodeConfig, force: boolean): boolean {
	const instructions = config.instructions ?? [];
	const hasPythonInstruction = instructions.some(
		(inst) => typeof inst === "string" && inst.toLowerCase().includes("python"),
	);

	if (hasPythonInstruction && !force) {
		return false;
	}

	config.instructions = [...instructions, PYTHON_PREFERENCE_INSTRUCTION];
	return true;
}
