# Implementation Plan

## Approach

Inside-out TDD, one module at a time. Each module is implemented only after its
dependencies are green.

## Dependencies

```
atomic-writer.ts   ← zero dependencies
event-factory.ts   ← zero dependencies
index.ts           ← depends on atomic-writer.ts, event-factory.ts
```

---

## Cycle 1 — `atomic-writer.ts`

**Target**: `src/atomic-writer.ts`

**Tests**: `src/__tests__/atomic-writer.test.ts` (§10.10)

Pure I/O module. Write the test, run (red), implement, run (green), next test.

| Step | Test | What it validates |
|------|------|-------------------|
| 1.1 | Creates file on first call | File exists after `atomicAppend()` to a non-existent path |
| 1.2 | Appends in order | Two calls → two lines, preserved order |
| 1.3 | Never throws on bad path | Call with non-existent directory → logs stderr, no throw |
| 1.4 | Recovers after error | Bad call then valid call → valid call succeeds, file written |
| 1.5 | 100 rapid appends | All 100 lines persist, no data loss |

**Outcome**: `atomicAppend(filePath, line)` is ready and reusable.

---

## Cycle 2 — `event-factory.ts`

**Target**: `src/event-factory.ts`

**Tests**: `src/__tests__/event-factory.test.ts` (§10.11)

Pure function. No filesystem, no mocks needed (except optionally freezing time for
timestamp tests).

| Step | Test | What it validates |
|------|------|-------------------|
| 2.1 | Returns all 8 fields | Envelope has `timestamp`, `eventId`, `agent`, `namespace`, `eventType`, `workspace`, `sessionId`, `details` |
| 2.2 | `eventId` is valid UUID v4 | Matches UUID v4 regex |
| 2.3 | `eventId` is unique | Two consecutive calls → different IDs |
| 2.4 | `agent` matches input | Value passed through |
| 2.5 | `namespace` matches input | Value passed through |
| 2.6 | `eventType` matches input | Value passed through |
| 2.7 | `details` is same reference | Object identity preserved (not cloned) |
| 2.8 | `overrides.workspace` takes precedence | Override wins over default |
| 2.9 | `undefined` workspace falls back | `undefined` → default value used |
| 2.10 | `overrides.sessionId` takes precedence | Override wins over default |
| 2.11 | `undefined` sessionId falls back | `undefined` → default value used |
| 2.12 | Timestamp auto-generated when omitted | ISO 8601 present when `overrides.timestamp` is `undefined` |

**Outcome**: `buildEvent(inputs)` is ready. All envelope logic verified without
touching disk.

---

## Cycle 3 — `index.ts`

**Target**: `src/index.ts`

**Tests**: `src/__tests__/index.test.ts` (§10.1 → §10.9)

Integration — composes `buildEvent` + `JSON.stringify` + `atomicAppend`. Tests use
temp directories, no mocks.

| Category | § | Tests |
|----------|---|-------|
| File creation | 10.1 | `append()` creates `events.jsonl`; `createEventSink()` creates directory tree but not file |
| Event envelope | 10.2 | Written JSON has all 8 fields, `eventId` unique, `agent`/`namespace` match creation-time, `eventType` matches `append()`, `details` round-trip |
| Overrides | 10.3 | Workspace/sessionId/timestamp precedence and fallback (validated via written JSON) |
| Atomicity & ordering | 10.4 | Sequential calls → ordered lines; 50 concurrent calls → all persist, valid JSON |
| Error resilience | 10.5 | `append()` never throws on bad dir; subsequent call to valid path succeeds; existing readable file works |
| Idempotency | 10.6 | Two sinks with same `statsDir` do not corrupt each other |
| Timestamp auto-gen | 10.7 | Omitted timestamp → generated, within 1s of actual time |
| Absolute path | 10.8 | `filePath` is absolute regardless of relative `statsDir` |
| Same-process concurrency | 10.9 | Two sink instances → both writes succeed, no collision |

**Outcome**: `createEventSink(opts)` is ready. All public API behavior verified.

---

## Completion criteria

- [ ] All 3 test files pass: `bun test` from `event-sink/`
- [ ] `atomic-writer.ts` has no import of `event-factory` or event-sink domain types
- [ ] `event-factory.ts` has no `fs`, no `path`, no `process` usage
- [ ] `index.ts` imports only `./atomic-writer` and `./event-factory` (+ `node:path`)
- [ ] All exports match §9 module contracts
- [ ] No `package.json`, no `node_modules`, no npm dependencies
