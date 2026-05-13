/**
 * Silent logger for opencode-ipython-plugin.
 *
 * Writes logs to ~/.opencode-ipython-plugin/plugin.log instead of stdout/stderr
 * to avoid polluting OpenCode's TUI display.
 *
 * Set OPENCODE_PYTHON_DEBUG=1 to see logs in stdout (for development).
 */
import fs from "fs";
import path from "path";
const PLUGIN_DIR = path.join(process.env.HOME ?? "/tmp", ".opencode-ipython-plugin");
const LOG_FILE = path.join(PLUGIN_DIR, "plugin.log");
const DEBUG = process.env.OPENCODE_PYTHON_DEBUG === "1";

function appendLog(level: string, msg: string, meta?: Record<string, unknown>): void {
	try {
		const entry = `[${new Date().toISOString()}] ${level}: ${msg}${meta ? " " + JSON.stringify(meta) : ""}\n`;
		fs.appendFileSync(LOG_FILE, entry);
	} catch {
		// If file logging fails, silently drop the log
	}
}

function consoleLog(level: string, msg: string, meta?: Record<string, unknown>): void {
	if (DEBUG) {
		const fn = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
		fn(`[ipython-plugin] ${msg}`, meta ?? "");
	}
}

export const logger = {
	debug: (msg: string, meta?: Record<string, unknown>) => {
		appendLog("DEBUG", msg, meta);
		consoleLog("DEBUG", msg, meta);
	},
	log: (msg: string, meta?: Record<string, unknown>) => {
		appendLog("LOG", msg, meta);
		consoleLog("LOG", msg, meta);
	},
	warn: (msg: string, meta?: Record<string, unknown>) => {
		appendLog("WARN", msg, meta);
		consoleLog("WARN", msg, meta);
	},
	error: (msg: string, meta?: Record<string, unknown>) => {
		appendLog("ERROR", msg, meta);
		consoleLog("ERROR", msg, meta);
	},
};
