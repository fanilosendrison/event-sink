# Phase 2 — Refactor stats-log modules to use event-sink

## Goal

Replace all ad-hoc stats-log implementations with the `event-sink` library.
One envelope format, one atomic-append strategy, zero duplication.

---

## Current state (before refactoring)

| # | Module | Append strategy | Event format | Agent | Path |
|---|--------|----------------|--------------|-------|------|
| 1 | `~/.gravity/telemetry/logger.ts` | `fs.appendFileSync` (NOT atomic) | `{wrapper, status, ...}` custom | antigravity | `~/.neelopedia/stats/antigravity/events.jsonl` |
| 2 | `~/.gravity/telemetry/resolve-event.ts` | `fs.appendFileSync` | `{resolve, model}` (non-event record) | antigravity | même fichier que logger |
| 3 | `skill-stats-log.ts` | Duplicated local `atomicAppend` | `{extension, cycleId, ...}` custom | pi | `~/.neelopedia/stats/pi/git-commits-push/events.jsonl` |
| 4 | `pre-commit-validators.ts` — `logSecretBlock()` | `atomicAppend` from event-sink (partial) | manual event construction | pi | `~/.neelopedia/stats/pi/secret-scanner/events.jsonl` |

---

## Target state (after refactoring)

| # | Module | Sink | Envelope | Agent | Path |
|---|--------|------|----------|-------|------|
| 1 | `secret-scanner/hook.ts` | `createEventSink(...)` | standard 8 fields | antigravity | `~/.neelopedia/stats/antigravity/secret-scanner/events.jsonl` |
| 2 | `commit-msg-validator/hook.ts` | `createEventSink(...)` | standard 8 fields | antigravity | `~/.neelopedia/stats/antigravity/commit-msg-validator/events.jsonl` |
| 3 | `git-commits-push-enforcer/hook.ts` | `createEventSink(...)` | standard 8 fields | antigravity | `~/.neelopedia/stats/antigravity/git-commits-push-enforcer/events.jsonl` |
| 4 | `skill-stats-log.ts` | `createEventSink(...)` | standard 8 fields | pi | `~/.neelopedia/stats/pi/git-commits-push/events.jsonl` |
| 5 | `pre-commit-validators.ts` — `logSecretBlock()` | `createEventSink(...)` | standard 8 fields | pi | `~/.neelopedia/stats/pi/secret-scanner/events.jsonl` |

**Removed**:
- `~/.gravity/telemetry/logger.ts` — replaced by per-wrapper sinks
- `~/.gravity/telemetry/resolve-event.ts` — `{resolve, model}` records moved to separate file `~/.neelopedia/stats/antigravity/model-resolutions.jsonl`
- Local `atomicAppend` in `skill-stats-log.ts` — replaced by event-sink

**Event envelope normalized**: all modules use the same 8 fields (`timestamp`, `eventId`, `agent`, `namespace`, `eventType`, `workspace`, `sessionId`, `details`).

**Atomicity**: all writes go through `atomic-writer.ts` (temp-file + rename).

---

## Steps

### Step 1 — Remove duplicated `atomicAppend` in `skill-stats-log.ts`

**Target**: `~/.agents/skills/git-commits-push/src/modules/skill-stats-log.ts`

Replace the local `atomicAppend` function with an import from event-sink:

```
- local atomicAppend(filePath, newContent) { ... }   ← delete
+ import { atomicAppend } from "event-sink/src/atomic-writer"
```

No behavior change. The public API (`createSkillStatsLog`) stays identical.

---

### Step 2 — Normalize `skill-stats-log.ts` to event-sink envelope

**Target**: same file

Replace `appendEvent()` — which manually constructs `{extension, eventType, cycleId, ...}` — with a sink created via `createEventSink`.

**Mapping**:

| Current `appendEvent` fields | event-sink envelope |
|---|---|
| `extension: "git-commits-push"` | `namespace: "git-commits-push"` |
| `eventType` | `eventType` (unchanged) |
| `agent: "pi"` | `agent: "pi"` |
| `workspace: process.cwd()` | `workspace: process.cwd()` |
| `sessionId: process.env.PI_SESSION_ID \|\| "unknown"` | `sessionId: process.env.PI_SESSION_ID \|\| ""` |
| `cycleId: crypto.randomUUID()` | moved to `details.cycleId` |
| `details` | `details` (unchanged) |

**Before**:
```ts
const event = {
  timestamp: ...,
  eventId: crypto.randomUUID(),
  extension: "git-commits-push",
  eventType,
  agent: "pi",
  workspace: process.cwd(),
  sessionId: process.env.PI_SESSION_ID || "unknown",
  cycleId: crypto.randomUUID(),
  details,
};
atomicAppend(FILE_PATH, `${JSON.stringify(event)}\n`);
```

**After**:
```ts
const sink = createEventSink({
  statsDir: STATS_DIR,
  agent: "pi",
  namespace: "git-commits-push",
  sessionId: process.env.PI_SESSION_ID,
  workspace: process.cwd(),
});
sink.append(eventType, { ...details, cycleId: crypto.randomUUID() });
```

---

### Step 3 — Replace `logEvent()` in the 3 gravity wrappers

**Targets**:
- `~/.gravity/wrappers/secret-scanner/hook.ts`
- `~/.gravity/wrappers/commit-msg-validator/hook.ts`
- `~/.gravity/wrappers/git-commits-push-enforcer/hook.ts`

Each wrapper imports `logEvent` from `../../telemetry/logger.ts` and calls:
```
logEvent(wrapper, status, details)
```

Replace with a per-wrapper sink:

```ts
import { createEventSink } from "event-sink";
import * as os from "node:os";

const sink = createEventSink({
  statsDir: `${os.homedir()}/neelopedia/stats/antigravity/<wrapper-name>`,
  agent: "antigravity",
  namespace: "<wrapper-name>",
});
```

Then replace each `logEvent(...)` call:
```
- logEvent("secret-scanner", "passed", { ... })
+ sink.append("passed", { ... })
```

**Mapping**:

| `logEvent` param | event-sink |
|---|---|
| `wrapper` ("secret-scanner", etc.) | `namespace` |
| `status` ("passed", "blocked", "skipped", "error") | `eventType` |
| `details` | `details` |
| `agent` (deduced from argv) | `agent: "antigravity"` (hardcoded, all gravity wrappers) |
| `workspace` (from env or cwd) | `workspace` |
| `trajectoryId` | moved to `details.trajectoryId` |
| `model` | moved to `details.model` |

---

### Step 4 — Extract resolver to separate file

**Target**: `~/.gravity/telemetry/resolve-event.ts`

The resolver currently writes `{resolve: eventId, model}` records into the same `events.jsonl` — violating the JSONL schema contract.

**Action**: move resolution records to a dedicated file:

```
~/neelopedia/stats/antigravity/model-resolutions.jsonl
```

Schema of resolution records:
```jsonl
{"resolve":"<eventId>","model":"deepseek-v4-flash","timestamp":"...","trajectoryId":"..."}
```

The resolver is spawned only when `trajectoryId` is present (which means the event came from an agent). Update the resolver to write to the new path.

---

### Step 5 — Refactor `logSecretBlock` to use `createEventSink`

**Target**: `~/.agents/skills/git-commits-push/src/modules/pre-commit-validators.ts`

Already partially migrated (imports `atomicAppend` from event-sink). Finish the migration by replacing the manual event construction with a sink.

**Before**:
```ts
import { atomicAppend } from "event-sink/src/atomic-writer";

function logSecretBlock(opts) {
  // ... manual event construction
  atomicAppend(filePath, JSON.stringify(event) + "\n");
}
```

**After**:
```ts
import { createEventSink } from "event-sink";

const secretSink = createEventSink({
  statsDir: `${os.homedir()}/neelopedia/stats/pi/secret-scanner`,
  agent: "pi",
  namespace: "secret-scanner",
  sessionId: `skill-${opts.repoId}`,
  workspace: opts.repoPath,
});

function logSecretBlock(opts) {
  secretSink.append("block", {
    findingsCount: opts.matchCount,
    findings,
    _source: "git-commits-push-skill",
  });
}
```

Note: the `cycleId` field from the original disappears — it was an implementation detail, and `eventId` (UUID v4, auto-generated by the sink) provides uniqueness.

---

### Step 6 — Delete `logger.ts`

**Target**: `~/.gravity/telemetry/logger.ts`

Once all 3 wrappers use their own sinks, `logger.ts` has zero consumers. Delete it.

---

## Completion criteria

- [ ] All 4 stats-log sources use `createEventSink` (no manual event construction, no ad-hoc append)
- [ ] All events follow the 8-field envelope (`timestamp`, `eventId`, `agent`, `namespace`, `eventType`, `workspace`, `sessionId`, `details`)
- [ ] All writes are atomic (temp-file + rename via `atomic-writer.ts`)
- [ ] `logger.ts` deleted
- [ ] Resolver writes to a separate file (`model-resolutions.jsonl`), not `events.jsonl`
- [ ] `~/.agents/skills/git-commits-push/src/modules/pre-commit-validators.ts` no longer imports `atomicAppend` directly (uses `createEventSink` instead)
- [ ] All existing tests pass
- [ ] No regression: wrappers still invoked by git hooks, secret scanner still fail-closed
