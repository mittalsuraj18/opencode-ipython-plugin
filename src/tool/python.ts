/**
 * Python tool for OpenCode.
 *
 * Provides the tool surface for executing Python code in an IPython kernel
 * with rich output support and prelude helpers.
 */
import { z } from "zod";
import { tool } from "@opencode-ai/plugin";
import { executeCells } from "../ipy/executor";

export function createPythonTool() {
	return tool({
		description: "Execute Python code in a persistent IPython kernel with rich output support",
		args: {
			cells: z.array(
				z.object({
					code: z.string().describe("Python code to execute"),
					title: z.string().optional().describe("Cell label, e.g. 'imports', 'helper'"),
				}),
			),
			timeout: z.number().optional().describe("Timeout in seconds (default: 30)"),
			cwd: z.string().optional().describe("Working directory (default: cwd)"),
			reset: z.boolean().optional().describe("Restart kernel before execution"),
		},
		async execute(args, ctx) {
			const result = await executeCells({
				cells: args.cells,
				timeout: args.timeout,
				cwd: args.cwd ?? ctx.directory,
				reset: args.reset,
				sessionId: ctx.sessionID,
				sessionFile: undefined,
				signal: ctx.abort,
			});

			// Format output with inline images for LLM visibility
			let output = result.output;
			for (const image of result.images) {
				output += `\n\n![image](data:image/png;base64,${image})\n`;
			}

			// Build metadata
			const metadata: Record<string, unknown> = {
				cells: result.cells.map(c => ({
					index: c.index,
					title: c.title,
					status: c.status,
					durationMs: c.durationMs,
					exitCode: c.exitCode,
				})),
				cancelled: result.cancelled,
				timedOut: result.timedOut,
				stdinRequested: result.stdinRequested,
				isError: result.isError,
			};

			if (result.jsonOutputs.length > 0) {
				metadata.jsonOutputs = result.jsonOutputs;
			}

			if (result.statusEvents.length > 0) {
				metadata.statusEvents = result.statusEvents;
			}

			// Build attachments for TUI rendering
			const attachments = result.images.map((image, index) => ({
				type: "file" as const,
				mime: "image/png",
				url: `data:image/png;base64,${image}`,
				filename: `figure_${index + 1}.png`,
			}));

			return {
				title: result.cells.length > 1
					? `Executed ${result.cells.length} Python cells`
					: "Executed Python code",
				output,
				metadata,
				attachments: attachments.length > 0 ? attachments : undefined,
			};
		},
	});
}
