/**
 * OpenCode IPython Plugin
 *
 * Provides Python code execution via a persistent IPython kernel with:
 * - Jupyter Kernel Gateway backend
 * - Session-scoped kernel reuse (LRU eviction, idle timeout, heartbeat)
 * - Rich output support (images, JSON, markdown, HTML)
 * - Full prelude helper library (file ops, search, shell, text processing)
 * - Auto-installation of required Python packages
 */
import { Plugin } from "@opencode-ai/plugin";
import { createPythonTool } from "./tool/python.js";

const plugin: Plugin = async (input) => {
	const pythonTool = createPythonTool();

	return {
		tool: {
			python: pythonTool,
		},
	};
};

export default plugin;
