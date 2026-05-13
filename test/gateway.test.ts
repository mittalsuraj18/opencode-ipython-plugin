/**
 * Tests for gateway.ts - Shared gateway coordinator.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { acquireSharedGateway, getGatewayStatus, shutdownSharedGateway, getSharedGatewayUrl } from "../src/ipy/gateway";
import { isPythonAvailable, testIfPython } from "./util";

describe("Gateway Lifecycle", () => {
	const cwd = process.cwd();
	let pythonReady = false;

	beforeAll(async () => {
		pythonReady = await isPythonAvailable();
	});

	afterAll(async () => {
		await shutdownSharedGateway();
	});

	testIfPython("spawns gateway and returns url", async () => {
		const result = await acquireSharedGateway(cwd);
		expect(result).not.toBeNull();
		expect(result?.url).toBeString();
		expect(result?.url).toStartWith("http://127.0.0.1:");
	});

	testIfPython("reuses existing healthy gateway", async () => {
		const first = await acquireSharedGateway(cwd);
		expect(first).not.toBeNull();

		const second = await acquireSharedGateway(cwd);
		expect(second).not.toBeNull();
		expect(second?.url).toBe(first?.url);
	});

	testIfPython("getGatewayStatus returns active status", async () => {
		await acquireSharedGateway(cwd);
		const status = await getGatewayStatus();
		expect(status.active).toBeTrue();
		expect(status.url).toBeString();
		expect(status.pid).toBeNumber();
	});

	testIfPython("getSharedGatewayUrl returns URL", async () => {
		await acquireSharedGateway(cwd);
		const url = await getSharedGatewayUrl();
		expect(url).toBeString();
		expect(url).toStartWith("http://127.0.0.1:");
	});

	testIfPython("shutdown clears gateway", async () => {
		await acquireSharedGateway(cwd);
		await shutdownSharedGateway();
		const status = await getGatewayStatus();
		expect(status.active).toBeFalse();
	});
});
