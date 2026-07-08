/**
 * index.ts — Public API for Event Sink.
 *
 * Composes `buildEvent` + `JSON.stringify` + `atomicAppend`.
 *
 * Imports only:
 *   - ./atomic-writer  (I/O)
 *   - ./event-factory  (pure logic)
 *   - node:path, node:fs
 */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { atomicAppend } from "./atomic-writer";
import { buildEvent } from "./event-factory";

export interface EventSinkOptions {
	statsDir: string;
	agent: string;
	namespace: string;
	sessionId?: string;
	workspace?: string;
}

export interface AppendOverrides {
	timestamp?: string;
	sessionId?: string;
	workspace?: string;
}

export interface EventSink {
	readonly filePath: string;
	append(
		eventType: string,
		details: Record<string, unknown>,
		overrides?: AppendOverrides,
	): void;
}

/**
 * Create an EventSink that writes JSONL events atomically to
 * `<statsDir>/events.jsonl`.
 *
 * - `statsDir` is resolved to an absolute path.
 * - The directory tree is created recursively (mkdir -p semantics).
 * - No file is created until the first `append()` call.
 * - `append()` never throws — errors are logged to stderr.
 */
export function createEventSink(options: EventSinkOptions): EventSink {
	const absDir = resolve(options.statsDir);
	const filePath = join(absDir, "events.jsonl");
	const defaults = {
		...(options.sessionId ? { sessionId: options.sessionId } : {}),
		...(options.workspace ? { workspace: options.workspace } : {}),
	};

	// Create directory tree — failures are caught by append() at write time
	try {
		mkdirSync(absDir, { recursive: true });
	} catch {
		// mkdir failure is handled silently per spec (§6.2):
		// first append() will fail, log to stderr, event is lost
	}

	return {
		get filePath() {
			return filePath;
		},

		append(
			eventType: string,
			details: Record<string, unknown>,
			overrides?: AppendOverrides,
		): void {
			try {
				const event = buildEvent({
					agent: options.agent,
					namespace: options.namespace,
					eventType,
					details,
					defaults,
					...(overrides ? { overrides } : {}),
				});

				const line = JSON.stringify(event);
				atomicAppend(filePath, line);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				process.stderr.write(`[event-sink] Error writing event: ${message}\n`);
			}
		},
	};
}
