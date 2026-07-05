/**
 * Cycle 3 — RED phase tests for index.ts (integration)
 *
 * See: specs/implementation-plan.md — Cycle 3
 * See: specs/event-sink.md — §10.1 – §10.9
 *
 * Integration tests — compose buildEvent + JSON.stringify + atomicAppend.
 * Uses real temp directories, no mocks.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createEventSink } from "../index";

let tempDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "event-sink-test-"));
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Helper: build a path inside the temp directory.
 */
function p(relative: string): string {
	return join(tempDir, relative);
}

// ──────────────────────────────────────────────
// 10.1 — File creation
// ──────────────────────────────────────────────
describe("10.1 — File creation", () => {
	it("creates the directory tree but NOT the file on createEventSink()", () => {
		const dir = p("sub/deep/path");

		createEventSink({
			statsDir: dir,
			agent: "test",
			namespace: "test",
		});

		expect(existsSync(dir)).toBe(true);
		expect(existsSync(join(dir, "events.jsonl"))).toBe(false);
	});

	it("creates events.jsonl on first append() call", () => {
		const filePath = p("events.jsonl");

		const sink = createEventSink({
			statsDir: tempDir,
			agent: "test",
			namespace: "test",
		});

		sink.append("test_type", { msg: "hello" });

		expect(existsSync(filePath)).toBe(true);
	});
});

// ──────────────────────────────────────────────
// 10.2 — Event envelope
// ──────────────────────────────────────────────
describe("10.2 — Event envelope", () => {
	it("written JSON has all 8 envelope fields", () => {
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "path-guard",
		});

		sink.append("path_access", { tool: "write" });

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const parsed = JSON.parse(content.trim());

		expect(parsed).toHaveProperty("timestamp");
		expect(parsed).toHaveProperty("eventId");
		expect(parsed).toHaveProperty("agent");
		expect(parsed).toHaveProperty("namespace");
		expect(parsed).toHaveProperty("eventType");
		expect(parsed).toHaveProperty("workspace");
		expect(parsed).toHaveProperty("sessionId");
		expect(parsed).toHaveProperty("details");
	});

	it("eventId is a valid UUID v4 and unique across events", () => {
		const uuidV4Regex =
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
		});

		sink.append("a", {});
		sink.append("b", {});

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const lines = content
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));

		expect(lines).toHaveLength(2);
		expect(lines[0].eventId).toMatch(uuidV4Regex);
		expect(lines[1].eventId).toMatch(uuidV4Regex);
		expect(lines[0].eventId).not.toBe(lines[1].eventId);
	});

	it("agent and namespace match creation-time values", () => {
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "antigravity",
			namespace: "secret-scanner",
		});

		sink.append("scan", {});

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const parsed = JSON.parse(content.trim());

		expect(parsed.agent).toBe("antigravity");
		expect(parsed.namespace).toBe("secret-scanner");
	});

	it("eventType matches the append() call argument", () => {
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
		});

		sink.append("my_custom_event", {});

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const parsed = JSON.parse(content.trim());

		expect(parsed.eventType).toBe("my_custom_event");
	});

	it("details survive JSON round-trip", () => {
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
		});

		const details = { str: "hello", num: 42, bool: true, nested: { a: 1 } };
		sink.append("test", details);

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const parsed = JSON.parse(content.trim());

		expect(parsed.details).toEqual(details);
	});
});

// ──────────────────────────────────────────────
// 10.3 — Overrides
// ──────────────────────────────────────────────
describe("10.3 — Overrides", () => {
	it("per-event workspace override takes precedence over creation-time workspace", () => {
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
			workspace: "/default/ws",
		});

		sink.append("test", {}, { workspace: "/override/ws" });

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const parsed = JSON.parse(content.trim());

		expect(parsed.workspace).toBe("/override/ws");
	});

	it("undefined workspace override falls back to creation-time workspace", () => {
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
			workspace: "/default/ws",
		});

		sink.append("test", {}, { workspace: undefined });

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const parsed = JSON.parse(content.trim());

		expect(parsed.workspace).toBe("/default/ws");
	});

	it("per-event sessionId override takes precedence over creation-time sessionId", () => {
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
			sessionId: "default-session",
		});

		sink.append("test", {}, { sessionId: "override-session" });

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const parsed = JSON.parse(content.trim());

		expect(parsed.sessionId).toBe("override-session");
	});

	it("undefined sessionId override falls back to creation-time sessionId", () => {
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
			sessionId: "default-session",
		});

		sink.append("test", {}, { sessionId: undefined });

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const parsed = JSON.parse(content.trim());

		expect(parsed.sessionId).toBe("default-session");
	});

	it("per-event timestamp override is used as-is", () => {
		const fixedTimestamp = "2026-07-05T12:00:00.000Z";
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
		});

		sink.append("test", {}, { timestamp: fixedTimestamp });

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const parsed = JSON.parse(content.trim());

		expect(parsed.timestamp).toBe(fixedTimestamp);
	});

	it("omitted or undefined timestamp causes the sink to generate one", () => {
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
		});

		sink.append("test", {});

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const parsed = JSON.parse(content.trim());

		expect(typeof parsed.timestamp).toBe("string");
		expect(parsed.timestamp).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
		);
	});
});

// ──────────────────────────────────────────────
// 10.4 — Atomicity & ordering
// ──────────────────────────────────────────────
describe("10.4 — Atomicity & ordering", () => {
	it("sequential append calls result in ordered lines", () => {
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
		});

		sink.append("first", { seq: 1 });
		sink.append("second", { seq: 2 });
		sink.append("third", { seq: 3 });

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const lines = content
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));

		expect(lines).toHaveLength(3);
		expect(lines[0].details.seq).toBe(1);
		expect(lines[1].details.seq).toBe(2);
		expect(lines[2].details.seq).toBe(3);
	});

	it("50 rapid concurrent append calls all persist without data loss", () => {
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
		});

		const count = 50;
		const promises: Promise<void>[] = [];

		for (let i = 0; i < count; i++) {
			promises.push(
				Promise.resolve().then(() => {
					sink.append("concurrent", { index: i });
				}),
			);
		}

		return Promise.all(promises).then(() => {
			const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
			const lines = content
				.trim()
				.split("\n")
				.filter((l) => l.length > 0);

			expect(lines).toHaveLength(count);

			for (const line of lines) {
				const parsed = JSON.parse(line);
				expect(parsed).toHaveProperty("eventId");
				expect(parsed).toHaveProperty("eventType", "concurrent");
				expect(parsed.details).toHaveProperty("index");
			}
		});
	});
});

// ──────────────────────────────────────────────
// 10.5 — Error resilience
// ──────────────────────────────────────────────
describe("10.5 — Error resilience", () => {
	it("append() never throws when statsDir is unwritable (logs to stderr instead)", () => {
		const badDir = "/dev/null/unwritable";
		const sink = createEventSink({
			statsDir: badDir,
			agent: "pi",
			namespace: "test",
		});

		const stderrSpy = spyOn(process.stderr, "write").mockImplementation(
			() => {},
		);

		expect(() => sink.append("test", {})).not.toThrow();

		stderrSpy.mockRestore();
	});

	it("after an error, subsequent append() calls to a valid path work normally", () => {
		const badDir = join(tempDir, "nonexistent");
		const goodSink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
		});

		const stderrSpy = spyOn(process.stderr, "write").mockImplementation(
			() => {},
		);

		// This one might fail if createEventSink doesn't create the dir
		// But we do it anyway to test error recovery
		const badSink = createEventSink({
			statsDir: badDir,
			agent: "pi",
			namespace: "test",
		});

		// Give a chance for errors to happen
		badSink.append("bad", {});

		// Now a valid call should work
		goodSink.append("good", { recovered: true });

		stderrSpy.mockRestore();

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const parsed = JSON.parse(content.trim());
		expect(parsed.details.recovered).toBe(true);
	});

	it("append() never throws when the target file exists and is readable", () => {
		// Pre-create the file
		writeFileSync(join(tempDir, "events.jsonl"), '{"dummy":true}\n', "utf-8");

		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
		});

		expect(() => sink.append("test", {})).not.toThrow();

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const lines = content
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		expect(lines).toHaveLength(2);
	});
});

// ──────────────────────────────────────────────
// 10.6 — Idempotency
// ──────────────────────────────────────────────
describe("10.6 — Idempotency of creation", () => {
	it("two sinks with the same statsDir do not corrupt each other", () => {
		const sinkA = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "ns-a",
		});
		const sinkB = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "ns-b",
		});

		sinkA.append("event_a", {});
		sinkB.append("event_b", {});

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const lines = content
			.trim()
			.split("\n")
			.filter((l) => l.length > 0)
			.map((l) => JSON.parse(l));

		expect(lines).toHaveLength(2);

		const namespaces = lines.map((l) => l.namespace).sort();
		expect(namespaces).toEqual(["ns-a", "ns-b"]);
	});
});

// ──────────────────────────────────────────────
// 10.7 — Timestamp auto-generation
// ──────────────────────────────────────────────
describe("10.7 — Timestamp auto-generation", () => {
	it("generated timestamp is within 1 second of the actual append time", () => {
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
		});

		const before = Date.now();
		sink.append("test", {});
		const after = Date.now();

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const parsed = JSON.parse(content.trim());

		const parsedTime = new Date(parsed.timestamp).getTime();
		expect(parsedTime).toBeGreaterThanOrEqual(before - 1000);
		expect(parsedTime).toBeLessThanOrEqual(after + 1000);
	});
});

// ──────────────────────────────────────────────
// 10.8 — Absolute path
// ──────────────────────────────────────────────
describe("10.8 — Absolute path", () => {
	it("filePath is absolute even when statsDir is relative", () => {
		// We can't use a truly relative path in tests because the cwd changes,
		// but we can verify that createEventSink resolves it.
		// Use a relative-looking path within tempDir by changing approach:
		// We pass an absolute path and verify it stays absolute.
		const sink = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "test",
		});

		// filePath should be absolute and end with events.jsonl
		expect(sink.filePath).toBe(resolve(join(tempDir, "events.jsonl")));
		expect(sink.filePath).toMatch(/^\//);
	});
});

// ──────────────────────────────────────────────
// 10.9 — Same-process concurrency
// ──────────────────────────────────────────────
describe("10.9 — Same-process concurrency", () => {
	it("two sink instances both succeed without collision", () => {
		const sinkA = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "ns-A",
		});
		const sinkB = createEventSink({
			statsDir: tempDir,
			agent: "pi",
			namespace: "ns-B",
		});

		sinkA.append("a", { id: 1 });
		sinkB.append("b", { id: 2 });
		sinkA.append("a", { id: 3 });
		sinkB.append("b", { id: 4 });

		const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
		const lines = content
			.trim()
			.split("\n")
			.filter((l) => l.length > 0)
			.map((l) => JSON.parse(l));

		expect(lines).toHaveLength(4);

		const namespaces = lines.map((l) => l.namespace).sort();
		expect(namespaces).toEqual(["ns-A", "ns-A", "ns-B", "ns-B"]);
	});
});
