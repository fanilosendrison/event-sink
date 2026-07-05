/**
 * Cycle 1 — RED phase tests for atomic-writer.ts
 *
 * See: specs/implementation-plan.md — Cycle 1
 * See: specs/event-sink.md — §10.10
 *
 * These tests will fail until atomicAppend() is properly implemented.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicAppend } from "../atomic-writer";

let tempDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "atomic-writer-test-"));
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
// 1.1 — Creates file on first call
// ──────────────────────────────────────────────
describe("1.1 — File creation on first call", () => {
	it("creates the file when it does not exist", () => {
		const filePath = p("events.jsonl");

		atomicAppend(filePath, "first line");

		expect(existsSync(filePath)).toBe(true);
	});
});

// ──────────────────────────────────────────────
// 1.2 — Appends in order
// ──────────────────────────────────────────────
describe("1.2 — Append order preservation", () => {
	it("preserves two appended lines in order", () => {
		const filePath = p("events.jsonl");

		atomicAppend(filePath, "line one");
		atomicAppend(filePath, "line two");

		const content = readFileSync(filePath, "utf-8");
		const lines = content.split("\n");

		// Two lines + optional trailing empty string from trailing \n
		expect(lines.filter((l) => l.length > 0)).toEqual(["line one", "line two"]);
	});
});

// ──────────────────────────────────────────────
// 1.3 — Never throws on bad path
// ──────────────────────────────────────────────
describe("1.3 — Error resilience on bad path", () => {
	it("does not throw when the target directory does not exist", () => {
		const badPath = join(tempDir, "nonexistent", "events.jsonl");
		const stderrSpy = spyOn(process.stderr, "write").mockImplementation(
			() => {},
		);

		expect(() => atomicAppend(badPath, "should not throw")).not.toThrow();

		stderrSpy.mockRestore();
	});

	it("logs an error message to stderr on bad path", () => {
		const badPath = join(tempDir, "nonexistent", "events.jsonl");
		const stderrMessages: string[] = [];
		const stderrSpy = spyOn(process.stderr, "write").mockImplementation(
			(chunk: string | Uint8Array) => {
				stderrMessages.push(chunk.toString());
				return true;
			},
		);

		atomicAppend(badPath, "should log error");

		expect(stderrMessages.length).toBeGreaterThan(0);
		expect(stderrMessages[0]).toContain("[event-sink]");

		stderrSpy.mockRestore();
	});
});

// ──────────────────────────────────────────────
// 1.4 — Recovers after error
// ──────────────────────────────────────────────
describe("1.4 — Recovery after error", () => {
	it("succeeds on a valid path after a failed call on an invalid path", () => {
		const badPath = join(tempDir, "nonexistent", "events.jsonl");
		const goodPath = p("events.jsonl");

		// Suppress stderr noise during error
		const stderrSpy = spyOn(process.stderr, "write").mockImplementation(
			() => {},
		);

		// Bad call — should not throw
		expect(() => atomicAppend(badPath, "lost event")).not.toThrow();

		// Valid call — should succeed
		expect(() => atomicAppend(goodPath, "recovered event")).not.toThrow();

		stderrSpy.mockRestore();

		expect(existsSync(goodPath)).toBe(true);
		const content = readFileSync(goodPath, "utf-8");
		expect(content).toContain("recovered event");
	});
});

// ──────────────────────────────────────────────
// 1.5 — 100 rapid appends
// ──────────────────────────────────────────────
describe("1.5 — 100 rapid sequential appends", () => {
	it("persists all 100 lines without data loss", () => {
		const filePath = p("events.jsonl");
		const count = 100;

		for (let i = 1; i <= count; i++) {
			atomicAppend(filePath, `line ${i}`);
		}

		const content = readFileSync(filePath, "utf-8");
		const lines = content.split("\n").filter((l) => l.length > 0);

		expect(lines).toHaveLength(count);

		// Verify every line is present (no duplicates, no gaps)
		for (let i = 1; i <= count; i++) {
			expect(lines).toContain(`line ${i}`);
		}

		// Verify ordering is preserved
		for (let i = 0; i < count; i++) {
			expect(lines[i]).toBe(`line ${i + 1}`);
		}
	});
});
