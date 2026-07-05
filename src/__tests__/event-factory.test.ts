/**
 * Cycle 2 — RED phase tests for event-factory.ts
 *
 * See: specs/implementation-plan.md — Cycle 2
 * See: specs/event-sink.md — §10.11
 *
 * Pure function tests — no filesystem, no mocks needed.
 * These tests will fail until buildEvent() is properly implemented.
 */

import { describe, expect, it } from "bun:test";
import {
	type AppendEvent,
	type BuildEventInputs,
	buildEvent,
} from "../event-factory";

// ─── Helpers ────────────────────────────────────────────────────────────

function makeInputs(overrides?: Partial<BuildEventInputs>): BuildEventInputs {
	return {
		agent: "test-agent",
		namespace: "test-ns",
		eventType: "test-event",
		details: { key: "value", num: 42 },
		defaults: { sessionId: "default-session", workspace: "/default/ws" },
		...overrides,
	};
}

// ──────────────────────────────────────────────
// 2.1 — Returns all 8 fields
// ──────────────────────────────────────────────
describe("2.1 — Envelope has all 8 fields", () => {
	it("returns an object with timestamp, eventId, agent, namespace, eventType, workspace, sessionId, details", () => {
		const event = buildEvent(makeInputs());

		expect(event).toHaveProperty("timestamp");
		expect(event).toHaveProperty("eventId");
		expect(event).toHaveProperty("agent");
		expect(event).toHaveProperty("namespace");
		expect(event).toHaveProperty("eventType");
		expect(event).toHaveProperty("workspace");
		expect(event).toHaveProperty("sessionId");
		expect(event).toHaveProperty("details");
	});
});

// ──────────────────────────────────────────────
// 2.2 — eventId is valid UUID v4
// ──────────────────────────────────────────────
describe("2.2 — eventId is valid UUID v4", () => {
	it("matches the UUID v4 regex pattern", () => {
		const event = buildEvent(makeInputs());

		const uuidV4Regex =
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

		expect(event.eventId).toMatch(uuidV4Regex);
	});
});

// ──────────────────────────────────────────────
// 2.3 — eventId is unique
// ──────────────────────────────────────────────
describe("2.3 — eventId uniqueness", () => {
	it("produces different IDs on two consecutive calls", () => {
		const event1 = buildEvent(makeInputs());
		const event2 = buildEvent(makeInputs());

		expect(event1.eventId).not.toBe(event2.eventId);
	});
});

// ──────────────────────────────────────────────
// 2.4 — agent matches input
// ──────────────────────────────────────────────
describe("2.4 — agent passthrough", () => {
	it("sets agent to the input value", () => {
		const event = buildEvent(makeInputs({ agent: "pi" }));
		expect(event.agent).toBe("pi");
	});
});

// ──────────────────────────────────────────────
// 2.5 — namespace matches input
// ──────────────────────────────────────────────
describe("2.5 — namespace passthrough", () => {
	it("sets namespace to the input value", () => {
		const event = buildEvent(makeInputs({ namespace: "path-guard" }));
		expect(event.namespace).toBe("path-guard");
	});
});

// ──────────────────────────────────────────────
// 2.6 — eventType matches input
// ──────────────────────────────────────────────
describe("2.6 — eventType passthrough", () => {
	it("sets eventType to the input value", () => {
		const event = buildEvent(makeInputs({ eventType: "path_access" }));
		expect(event.eventType).toBe("path_access");
	});
});

// ──────────────────────────────────────────────
// 2.7 — details is same reference
// ──────────────────────────────────────────────
describe("2.7 — details object identity", () => {
	it("preserves the exact object reference (not cloned)", () => {
		const details = { foo: "bar" };
		const event = buildEvent(makeInputs({ details }));
		expect(event.details).toBe(details);
	});
});

// ──────────────────────────────────────────────
// 2.8 — overrides.workspace takes precedence
// ──────────────────────────────────────────────
describe("2.8 — workspace override precedence", () => {
	it("uses overrides.workspace instead of defaults.workspace", () => {
		const event = buildEvent(
			makeInputs({
				defaults: { workspace: "/default/ws", sessionId: "s" },
				overrides: { workspace: "/override/ws" },
			}),
		);
		expect(event.workspace).toBe("/override/ws");
	});
});

// ──────────────────────────────────────────────
// 2.9 — undefined workspace falls back
// ──────────────────────────────────────────────
describe("2.9 — undefined workspace fallback", () => {
	it("falls back to defaults.workspace when overrides.workspace is undefined", () => {
		const event = buildEvent(
			makeInputs({
				defaults: { workspace: "/default/ws", sessionId: "s" },
				overrides: { workspace: undefined },
			}),
		);
		expect(event.workspace).toBe("/default/ws");
	});
});

// ──────────────────────────────────────────────
// 2.10 — overrides.sessionId takes precedence
// ──────────────────────────────────────────────
describe("2.10 — sessionId override precedence", () => {
	it("uses overrides.sessionId instead of defaults.sessionId", () => {
		const event = buildEvent(
			makeInputs({
				defaults: { sessionId: "default-session", workspace: "/ws" },
				overrides: { sessionId: "override-session" },
			}),
		);
		expect(event.sessionId).toBe("override-session");
	});
});

// ──────────────────────────────────────────────
// 2.11 — undefined sessionId falls back
// ──────────────────────────────────────────────
describe("2.11 — undefined sessionId fallback", () => {
	it("falls back to defaults.sessionId when overrides.sessionId is undefined", () => {
		const event = buildEvent(
			makeInputs({
				defaults: { sessionId: "default-session", workspace: "/ws" },
				overrides: { sessionId: undefined },
			}),
		);
		expect(event.sessionId).toBe("default-session");
	});
});

// ──────────────────────────────────────────────
// 2.12 — Timestamp auto-generated when omitted
// ──────────────────────────────────────────────
describe("2.12 — Timestamp auto-generation", () => {
	it("generates an ISO 8601 timestamp when overrides.timestamp is undefined", () => {
		const event = buildEvent(
			makeInputs({
				overrides: { timestamp: undefined },
			}),
		);

		expect(typeof event.timestamp).toBe("string");
		// ISO 8601 format: 2026-07-05T12:00:00.000Z
		expect(event.timestamp).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
		);
	});

	it("uses the provided timestamp when overrides.timestamp is set", () => {
		const fixedTimestamp = "2026-01-01T00:00:00.000Z";
		const event = buildEvent(
			makeInputs({
				overrides: { timestamp: fixedTimestamp },
			}),
		);
		expect(event.timestamp).toBe(fixedTimestamp);
	});
});
