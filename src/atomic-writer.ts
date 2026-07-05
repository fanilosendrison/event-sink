/**
 * atomic-writer.ts — I/O only module for atomic append to a file.
 *
 * Exports a single function `atomicAppend` that appends a line to a file
 * using a temp-file + rename strategy.
 *
 * Temp file name: `<filePath>.tmp.<pid>.<random>`
 *
 * - Creates the file if it does not exist.
 * - Never throws: errors are logged to stderr with `[event-sink]` prefix.
 * - Does NOT create directories (caller is responsible).
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/**
 * Atomically append a line to a file.
 *
 * @param filePath – path to the target file (absolute or relative)
 * @param line – line to append (without trailing newline)
 */
export function atomicAppend(filePath: string, line: string): void {
	try {
		// 1. Read current content (empty string if file does not exist)
		let content = "";
		if (existsSync(filePath)) {
			content = readFileSync(filePath, "utf-8");
		}

		// 2. Append the new line (with trailing \n)
		content += line + "\n";

		// 3. Write to a temp file in the same directory
		const pid = process.pid;
		const random = randomBytes(4).toString("hex");
		const tmpPath = `${filePath}.tmp.${pid}.${random}`;

		writeFileSync(tmpPath, content, "utf-8");

		// 4. Atomically rename the temp file to the target path
		renameSync(tmpPath, filePath);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`[event-sink] Error writing event: ${message}\n`);
	}
}
