# Event Sink

> Append-only, atomic JSONL event logging — zero runtime dependencies.

Writes structured events to `<statsDir>/events.jsonl`, one JSON line per event. Designed for agent harnesses (Pi, Antigravity, Claude Code), CI pipelines, and audit trails.

```ts
const sink = createEventSink({
  statsDir:  "/var/stats",
  agent:     "pi",
  namespace: "path-guard",
  sessionId: "abc123",
  workspace: "/home/user/project",
});

sink.append("path_access", {
  toolType: "write",
  action: "redirected",
  givenPath: "/app/foo.ts",
});
// → appends one JSON line to /var/stats/events.jsonl
```

---

## Features

- **Atomic writes** — temp-file + rename per append. No partial lines, no corruption
- **Zero runtime deps** — `node:fs`, `node:path`, `node:crypto`. Nothing to install
- **Never throws** — all filesystem errors are caught and logged to stderr
- **Pure factory** — `buildEvent()` is testable without touching disk
- **JSONL output** — one line per event, consumable by any log pipeline
- **Runs on Bun and Node 22+** (`--experimental-strip-types`)

---

## Installation

No `npm install` needed. Import directly:

```ts
// If your project is co-located:
import { createEventSink } from "../event-sink/src/index.ts";

// Or via git submodule / monorepo path
```

If you're using VSCode, install `@types/node` as a devDependency for editor IntelliSense:

```bash
bun install         # installs @types/node (devDependency only)
```

---

## Quick start

### 1. Create a sink

```ts
import { createEventSink } from "./src/index.ts";

const sink = createEventSink({
  statsDir:  "./logs",
  agent:     "my-agent",
  namespace: "my-module",
  sessionId: "session-001",
  workspace: "/path/to/project",
});

console.log(sink.filePath);
// → /absolute/path/to/logs/events.jsonl
```

### 2. Append events

```ts
sink.append("user_action", { user: "alice", action: "login" });
sink.append("user_action", { user: "bob",   action: "logout" });
```

### 3. Read the file

```bash
cat ./logs/events.jsonl
```

```jsonl
{"timestamp":"2026-07-05T12:00:00.000Z","eventId":"a1b2c3d4-...","agent":"my-agent","namespace":"my-module","eventType":"user_action","workspace":"/path/to/project","sessionId":"session-001","details":{"user":"alice","action":"login"}}
{"timestamp":"2026-07-05T12:00:01.000Z","eventId":"e5f6g7h8-...","agent":"my-agent","namespace":"my-module","eventType":"user_action","workspace":"/path/to/project","sessionId":"session-001","details":{"user":"bob","action":"logout"}}
```

---

## API

### `createEventSink(options) → EventSink`

| Option     | Required | Type     | Description |
|------------|----------|----------|-------------|
| `statsDir` | yes      | `string` | Directory for `events.jsonl`. Resolved to absolute, created recursively |
| `agent`    | yes      | `string` | Agent identifier (`"pi"`, `"antigravity"`, ...) |
| `namespace`| yes      | `string` | Source module (`"path-guard"`, `"secret-scanner"`, ...) |
| `sessionId`| no       | `string` | Default sessionId. Overridable per `append()`. Defaults to `""` |
| `workspace`| no       | `string` | Default workspace. Overridable per `append()`. Defaults to `""` |

### `sink.filePath`

Absolute path to `events.jsonl` (read-only).

### `sink.append(eventType, details, overrides?)`

| Param       | Type                          | Description |
|-------------|-------------------------------|-------------|
| `eventType` | `string`                      | Event kind |
| `details`   | `Record<string, unknown>`     | Domain payload (JSON-serializable) |
| `overrides` | `{ timestamp?, sessionId?, workspace? }` | Per-event overrides |

**Never throws.** Errors are logged to stderr with `[event-sink]` prefix.

### Event envelope

Every line is a single JSON object with these 8 fields:

| Field       | Type     | Source |
|-------------|----------|--------|
| `timestamp` | `string` | `overrides.timestamp` or generated ISO 8601 |
| `eventId`   | `string` | Generated UUID v4 |
| `agent`     | `string` | From `createEventSink` options |
| `namespace` | `string` | From `createEventSink` options |
| `eventType` | `string` | From `append()` argument |
| `workspace` | `string` | Precedence: overrides → creation-time → `""` |
| `sessionId` | `string` | Precedence: overrides → creation-time → `""` |
| `details`   | `object` | From `append()` argument |

---

## Usage patterns

### Pattern A — all defaults at creation

```ts
const sink = createEventSink({
  statsDir:  "/var/stats/my-ext",
  agent:     "pi",
  namespace: "my-extension",
  sessionId: process.env.SESSION_ID!,
  workspace: process.env.WORKSPACE!,
});

// No overrides needed — every event gets the same workspace + sessionId
sink.append("tool_used", { tool: "read", path: "/app/src" });
```

### Pattern B — per-event overrides

```ts
const sink = createEventSink({
  statsDir:  "/var/stats",
  agent:     "pi",
  namespace: "zero-timeout-filter",
  // No defaults — provided per event
});

sink.append("timeout_stripped", { originalTimeout: 60 }, {
  sessionId: "abc123",
  workspace: "/home/user/project",
});
```

### Pattern C — mixed (defaults + occasional overrides)

```ts
const sink = createEventSink({
  statsDir:  "/var/stats",
  agent:     "pi",
  namespace: "read-deduplicator",
  sessionId: "abc123",
  workspace: "/default/ws",
});

sink.append("file_access", { action: "read",  path: "/a.ts" }); // uses defaults
sink.append("file_access", { action: "blocked", path: "/b.ts" }, {
  workspace: "/home/user/other-project", // override workspace for this event
});
```

---

## Architecture

```
event-sink/
├── src/
│   ├── index.ts              ← public API (createEventSink)
│   ├── atomic-writer.ts      ← I/O: temp-file + rename
│   ├── event-factory.ts      ← pure logic: envelope, UUID, precedence
│   └── __tests__/
│       ├── index.test.ts           ← integration (22 tests)
│       ├── atomic-writer.test.ts   ← unit (6 tests)
│       └── event-factory.test.ts   ← unit (13 tests)
├── specs/
│   ├── event-sink.md              ← full specification
│   └── implementation-plan.md     ← TDD plan (3 cycles)
├── docs/
│   └── agent-guide.md             ← detailed AI-agent reference
└── README.md                      ← this file
```

**Dependency graph:**

```
index.ts
  ├── atomic-writer.ts   (node:fs)
  └── event-factory.ts   (node:crypto)
```

No circular dependencies. `event-factory` and `atomic-writer` are independent and reusable outside event-sink.

---

## Atomicity

Each `append()` uses a **temp-file + rename** strategy:

1. Read current `events.jsonl` content (or empty string)
2. Append `<new JSON line>\n`
3. Write to `<events.jsonl>.tmp.<pid>.<random>`
4. Atomically `rename()` the temp file to `events.jsonl`

This guarantees every `append()` either fully succeeds or leaves the file unchanged. No reader ever sees a partial line.

---

## Error handling

`append()` **never throws**. Every filesystem error is caught internally and logged to stderr:

```
[event-sink] Error writing event: ENOENT: no such file or directory...
```

| Scenario | Behavior |
|----------|----------|
| Directory doesn't exist | Created at sink creation |
| Disk full | Logged to stderr, file unchanged |
| Permission denied | Logged to stderr, file unchanged |
| Concurrent process race | One rename wins, other gets ENOENT. Event lost, logged |
| Two sink instances, same file | Both succeed (unique temp file names). Non-deterministic order |

---

## Non-goals

- ❌ **Rotate files** — one file per sink, grows indefinitely
- ❌ **Read events** — write-only API
- ❌ **Query, filter, aggregate**
- ❌ **Validate `details` schema** — callers own their payload
- ❌ **Batch writes** — each `append()` is a full atomic cycle
- ❌ **Buffer in RAM** — every append flushes to disk

---

## Testing

```bash
bun test
```

```
✓ 41 tests passing across 3 test files
  - atomic-writer.test.ts   (6 tests)  — unit, temp dirs, no mocks
  - event-factory.test.ts   (13 tests) — pure functions, no I/O
  - index.test.ts           (22 tests) — integration, temp dirs, no mocks
```

---

## Documentation

- **[Agent Guide](docs/agent-guide.md)** — detailed reference for AI coding agents
- **[Specification](specs/event-sink.md)** — complete behavioral contract
- **[Implementation Plan](specs/implementation-plan.md)** — TDD plan and test-by-test breakdown
