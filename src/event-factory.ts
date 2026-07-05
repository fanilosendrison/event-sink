/**
 * event-factory.ts — Pure logic module for building event envelopes.
 *
 * Exports a single function `buildEvent` that constructs an `AppendEvent`
 * object from creation-time config and per-call parameters.
 *
 * Zero dependencies — no fs, no path, no process.
 */

import { randomUUID } from "node:crypto";

export interface BuildEventInputs {
	agent: string;
	namespace: string;
	eventType: string;
	details: Record<string, unknown>;
	defaults: { sessionId?: string; workspace?: string };
	overrides?: { timestamp?: string; sessionId?: string; workspace?: string };
}

export interface AppendEvent {
	timestamp: string;
	eventId: string;
	agent: string;
	namespace: string;
	eventType: string;
	workspace: string;
	sessionId: string;
	details: Record<string, unknown>;
}

/**
 * Build a fully-formed event envelope from creation-time config and
 * per-call parameters.
 *
 * Precedence rules:
 *   overrides.workspace ?? defaults.workspace
 *   overrides.sessionId ?? defaults.sessionId
 *   overrides.timestamp ?? new Date().toISOString()
 *
 * @param inputs – combined creation-time and per-call configuration
 * @returns a plain AppendEvent object (not serialized)
 */
export function buildEvent(inputs: BuildEventInputs): AppendEvent {
	const { agent, namespace, eventType, details, defaults, overrides } = inputs;

	return {
		timestamp: overrides?.timestamp ?? new Date().toISOString(),
		eventId: randomUUID(),
		agent,
		namespace,
		eventType,
		workspace: overrides?.workspace ?? defaults.workspace ?? "",
		sessionId: overrides?.sessionId ?? defaults.sessionId ?? "",
		details,
	};
}
