# Event Sink — Agent Guide

> **Audience**: AI coding agents and developers integrating event-sink.
> **Version**: 0.1.0
> **Dependencies**: zero npm runtime deps. Bun or Node 22+ with `--experimental-strip-types`.

---

## 1. What it does

Append-only, atomic JSONL event logging. You create a *sink*, you call `sink.append(...)`, and each call writes exactly one JSON line to `<statsDir>/events.jsonl`. No reading. No querying. No rotating.

```jsonl
{"timestamp":"2026-07-05T12:00:00.000Z","eventId":"a1b2...","agent":"pi","namespace":"path-guard","eventType":"path_access","workspace":"/home/user/project","sessionId":"abc123","details":{"tool":"write","action":"redirected"}}
```

Every event has the same 8 top-level fields (`details` varies). One line = one event. No headers, no footers.

---

## 2. Quick start

```ts
import { createEventSink } from "event-sink";

const sink = createEventSink({
  statsDir:  "/var/stats/session-abc",
  agent:     "pi",
  namespace: "path-guard",
  sessionId: "abc123",
  workspace: "/home/user/project",
});

sink.append("path_access", {
  toolType: "write",
  givenPath: "/dotpi/foo.ts",
}, {
  timestamp: "2026-07-05T12:00:00.000Z",
});
```

That writes one JSON line to `/var/stats/session-abc/events.jsonl`.

---

## 3. API Reference

### 3.1 `createEventSink(options) → EventSink`

Creates a sink bound to a specific directory. The directory is created recursively if it doesn't exist. The file itself is NOT created until the first `append()`.

| Option     | Required | Type     | Description |
|------------|----------|----------|-------------|
| `statsDir` | yes      | `string` | Directory for `events.jsonl`. Resolved to absolute. |
| `agent`    | yes      | `string` | Agent identifier (`"pi"`, `"antigravity"`, ...) |
| `namespace`| yes      | `string` | Source module (`"path-guard"`, `"secret-scanner"`, ...) |
| `sessionId`| no       | `string` | Default sessionId. Overridable per `append()`. Defaults to `""` if omitted. |
| `workspace`| no       | `string` | Default workspace. Overridable per `append()`. Defaults to `""` if omitted. |

**Returns**:

```ts
interface EventSink {
  readonly filePath: string;          // absolute path to events.jsonl
  append(
    eventType: string,
    details: Record<string, unknown>,
    overrides?: AppendOverrides,
  ): void;
}
```

---

### 3.2 `sink.append(eventType, details, overrides?)`

Appends one event. **Never throws.** On filesystem failure, the error is logged to stderr and the event is silently lost.

| Param       | Required | Type                        | Description |
|-------------|----------|-----------------------------|-------------|
| `eventType` | yes      | `string`                    | Event kind (`"path_access"`, `"scan_result"`, ...) |
| `details`   | yes      | `Record<string, unknown>`   | Domain payload. Must be JSON-serializable (no circular refs). |
| `overrides` | no       | `AppendOverrides`           | See below. |

**AppendOverrides**:

| Field       | Type     | Description |
|-------------|----------|-------------|
| `timestamp` | `string` | ISO 8601. If omitted, generated at append time. |
| `sessionId` | `string` | Per-event override. `undefined` falls back to creation-time. |
| `workspace` | `string` | Per-event override. `undefined` falls back to creation-time. |

---

### 3.3 Precedence rules

| Field       | Priority |
|-------------|----------|
| `workspace` | `overrides.workspace` → `options.workspace` → `""` |
| `sessionId` | `overrides.sessionId` → `options.sessionId` → `""` |
| `timestamp` | `overrides.timestamp` → `new Date().toISOString()` |
| `eventId`   | Always generated (UUID v4) |
| `agent`     | Always from `options.agent` |
| `namespace` | Always from `options.namespace` |

---

## 4. Usage patterns

### Pattern A — All defaults at creation (most extensions)

```ts
const sink = createEventSink({
  statsDir:  "/var/stats/my-extension",
  agent:     "pi",
  namespace: "my-extension",
  sessionId: process.env.SESSION_ID,
  workspace: process.env.WORKSPACE,
});

// Every event uses the defaults — no overrides needed
sink.append("tool_call", { tool: "read", path: "/app/src" });
sink.append("tool_call", { tool: "write", path: "/app/out" });
```

### Pattern B — Per-event overrides (no defaults)

```ts
const sink = createEventSink({
  statsDir:  "/var/stats",
  agent:     "pi",
  namespace: "my-extension",
  // No sessionId, no workspace at creation
});

sink.append("event", { data: "x" }, {
  timestamp: "2026-07-05T12:00:00.000Z",
  sessionId: "abc123",
  workspace: "/home/user/project",
});
```

### Pattern C — Mixed (defaults with occasional overrides)

```ts
const sink = createEventSink({
  statsDir:  "/var/stats/session-abc",
  agent:     "pi",
  namespace: "my-extension",
  sessionId: "abc123",
  workspace: "/default/ws",
});

// Uses defaults
sink.append("normal_event", { ... });

// Overrides workspace for one event
sink.append("cross_ws_event", { ... }, {
  workspace: "/home/user/other-project",
});
```

---

## 5. Error behavior

`append()` **never throws**. All errors are caught internally and logged to `process.stderr` with the prefix `[event-sink]`:

```
[event-sink] Error writing event: ENOENT: no such file or directory...
```

| Scenario | Outcome |
|----------|---------|
| `statsDir` doesn't exist yet | Created at sink creation time |
| `statsDir` is a file (can't create dir) | Dir creation fails silently. First `append()` logs to stderr, event lost |
| Disk full | Logged to stderr. File unchanged |
| Permission denied | Logged to stderr. File unchanged |
| Two different processes write simultaneously | One rename wins, other gets ENOENT. Non-deterministic order |
| Same process, two sink instances, same file | Both succeed. Each `append()` uses a unique temp file (`<pid>.<random>`). Order non-deterministic |
| Circular ref in `details` | `JSON.stringify` throws. Logged to stderr. Event lost. Callers are responsible for valid data |

---

## 6. File format (JSONL)

- **Filename**: `events.jsonl`
- **Encoding**: UTF-8
- **Separator**: `\n` (LF)
- **One line per event**. No line breaks inside the JSON.

```jsonl
{"timestamp":"...","eventId":"...","agent":"pi","namespace":"ns","eventType":"a","workspace":"/ws","sessionId":"s1","details":{"k":"v"}}
{"timestamp":"...","eventId":"...","agent":"pi","namespace":"ns","eventType":"b","workspace":"/ws","sessionId":"s1","details":{"k":"v2"}}
```

To read the file: `split("\n")` on the raw text, then `JSON.parse` each non-empty line.

---

## 7. Atomicity guarantee

Every `append()` uses a **temp-file + rename** cycle:

1. Read current content of `events.jsonl` (empty string if missing)
2. Append `<new JSON line>\n`
3. Write to `<events.jsonl>.tmp.<pid>.<random>`
4. `rename()` the temp file to `events.jsonl`

This guarantees:
- Each `append()` fully succeeds or leaves the file unchanged
- No reader ever sees a partial line
- No temp file collisions within the same process (pid + random suffix)

---

## 8. Internal modules (for testing / reuse)

The public API (`createEventSink`) is composed of two reusable internal modules:

| Module | Export | Purpose | Dependencies |
|--------|--------|---------|--------------|
| `atomic-writer.ts` | `atomicAppend(filePath, line)` | Temp-file + rename atomic append | `node:fs` |
| `event-factory.ts` | `buildEvent(inputs)` | Build event envelope, UUID, precedence | `node:crypto` |

```ts
// Direct imports (not part of public API, but usable for testing)
import { atomicAppend } from "event-sink/src/atomic-writer";
import { buildEvent }   from "event-sink/src/event-factory";
```

---

## 9. Edge cases

| Edge case | Behavior |
|-----------|----------|
| Empty `details` (`{}`) | Written as `"details":{}` |
| `details` with `null` values | Preserved (JSON round-trip) |
| `eventType` empty string | Written as `"eventType":""` |
| `overrides` object empty (`{}`) | No effect — all defaults used |
| `overrides` completely omitted | Same as `{}` |
| `statsDir` relative (`"../logs"`) | Resolved to absolute at creation time |
| No `append()` ever called | File never created, dir exists |
| 10 000 rapid `append()` calls | All persist. Performance degrades (read-append-write per call). Not designed for high-throughput streaming |

---

## 10. Non-goals (what it doesn't do)

- ❌ **Rotate files** — one file, grows forever
- ❌ **Read events** — write-only API
- ❌ **Query, filter, aggregate**
- ❌ **Batch writes** — each `append()` is a full atomic cycle
- ❌ **Validate details schema** — callers own their payload
- ❌ **Buffer in RAM** — every append flushes to disk immediately
