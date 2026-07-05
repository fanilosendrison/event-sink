# Phase 2 (Pi) — Migrate extensions stats-log → event-sink

## Goal

Replace all 6 duplicated `stats-log.ts` modules in Pi extensions with
`createEventSink` from `telemetry-tools/event-sink`. One envelope format,
one atomic writer, zero duplication.

## Test strategy

Chaque `stats-log.test.ts` teste actuellement deux choses distinctes :

| Couche | Ce qui est testé | Après migration |
|---|---|---|
| **Infrastructure** | Création de fichier, mkdir récursif, ordre des events, atomicité, schema compliance (champs requis) | ❌ **À supprimer** — couvert par les tests d'`event-sink` (`src/__tests__/`) |
| **Contrat de données** | Le bon `namespace`, le bon `eventType`, la forme exacte de `details` | ✅ **À conserver** — c'est le contrat spécifique à l'extension |

Les tests post-migration doivent être **fins** : ils vérifient uniquement que
l'extension appelle `sink.append()` avec les bons arguments (namespace implicite
via la config, eventType explicite, details conformes). Pas de test d'IO.

---

## Current state — 6 extensions, 6 copies dupliquées

| # | Extension | Stats-log path | `atomicAppend` | EventType(s) | Method |
|---|-----------|---------------|----------------|-------------|--------|
| 1 | git-commits-push-enforcer | `git-commits-push-enforcer-internals/stats-log.ts` | copié local | `enforcer_triggered` | `logTriggered(entry)` |
| 2 | path-guard | `path-guard-internals/stats-log.ts` | copié local | `path_access` | `logAccess(entry)` |
| 3 | post-write-linter | `post-write-linter-internals/stats-log.ts` | copié local | `lint_result` | `logResult(entry)` |
| 4 | read-deduplicator | `read-deduplicator-internals/stats-log.ts` | extrait dans `./lib/atomic-writer.ts` | `file_access` | `logFileAccess(entry)` |
| 5 | secret-scanner | `secret-scanner-internals/stats-log.ts` | copié local | `scan_result` | `logResult(entry)` |
| 6 | zero-timeout-filter | `zero-timeout-filter-internals/stats-log.ts` | copié local | `timeout_stripped` | `logTimeoutStripped(entry)` |

### Ce qui est dupliqué 5 à 6 fois

```ts
// 1. atomicAppend — même code, préfixe d'erreur différent
function atomicAppend(filePath: string, newContent: string): void {
  try {
    let existingContent = "";
    if (fs.existsSync(filePath)) { existingContent = fs.readFileSync(filePath, "utf-8"); }
    const combinedContent = existingContent + newContent;
    const tmpPath = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, combinedContent);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    process.stderr.write(`[<extension>] Error writing stats: ${err}\n`);
  }
}

// 2. mkdirSync — partout
fs.mkdirSync(opts.statsDir, { recursive: true });

// 3. Construction d'enveloppe — partout
{
  timestamp: entry.ts,
  eventId: crypto.randomUUID(),
  extension: "<extension-name>",    // ← BREAKING: devient namespace
  eventType: "<event-type>",
  agent: "pi",
  workspace: opts.cwd,
  sessionId: opts.sessionId,
  details: { ... }
}
```

---

## Breaking change : `extension` → `namespace`

L'enveloppe actuelle des stats-log Pi utilise `extension`, celle d'event-sink utilise `namespace`. Même sémantique, nom différent.

| Champ actuel | Champ event-sink | Impact |
|---|---|---|
| `extension: "git-commits-push-enforcer"` | `namespace: "git-commits-push-enforcer"` | Les requêtes jq, dashboards et CONTEXT.md qui lisent `.extension` doivent lire `.namespace` |
| `extension: "path-guard"` | `namespace: "path-guard"` | idem |
| etc. | etc. | idem |

**Tous les tests existants** vérifient `ev.extension === "..."`. Ils devront être mis à jour vers `ev.namespace === "..."`.

**Les CONTEXT.md** de chaque dossier de stats (ex: `~/neelopedia/stats/pi/git-commits-push-enforcer/CONTEXT.md`) référencent aussi `.extension` dans leurs exemples de requêtes.

---

## Migration par extension

### 1. git-commits-push-enforcer

**Stats-log actuel :**
```ts
createStatsLog({ statsDir, sessionId, cwd }) → { filePath, logTriggered(entry) }
logTriggered({ ts, rawCommand, detectedBy, toolCallId, parentModel, thinkingLevel })
// produit : { extension: "git-commits-push-enforcer", eventType: "enforcer_triggered", ... }
```

**Extension consommatrice** (`git-commits-push-enforcer.ts`) :
```ts
const statsLog = createStatsLog({ statsDir, sessionId, cwd: process.cwd() });
statsLog.logTriggered({ ts, rawCommand, detectedBy, toolCallId, parentModel: ..., thinkingLevel: ... });
```

**Migration :**
```ts
// REMPLACER
import { createStatsLog } from "./git-commits-push-enforcer-internals/stats-log";
const statsLog = createStatsLog({ statsDir, sessionId, cwd: process.cwd() });

// PAR
import { createEventSink } from "/Users/.../telemetry-tools/event-sink/src/index.ts";
const sink = createEventSink({ statsDir, agent: "pi", namespace: "git-commits-push-enforcer", sessionId, workspace: process.cwd() });

// Puis chaque appel
statsLog.logTriggered({ ts, rawCommand, detectedBy, toolCallId, parentModel, thinkingLevel });
// →
sink.append("enforcer_triggered", { rawCommand, detectedBy, toolCallId, parentModel, thinkingLevel }, { timestamp: ts });
```

**Contrat de sortie (events.jsonl) :**
```json
{
  "timestamp": "<ISO 8601>",
  "eventId": "<UUID v4>",
  "agent": "pi",
  "namespace": "git-commits-push-enforcer",
  "eventType": "enforcer_triggered",
  "workspace": "<cwd>",
  "sessionId": "<sessionId>",
  "details": {
    "rawCommand": "<string>",
    "detectedBy": "git-commit | git-commits-push",
    "toolCallId": "<string>",
    "parentModel": "<string>",
    "thinkingLevel": "<string>"
  }
}
```

**Tests à migrer (git-commits-push-enforcer) :**
- `stats-log.test.ts` : 7 tests, 5 describe blocks
- **À supprimer** (infrastructure, déjà couvert par event-sink) :
  - "file creation" (2 tests) — mkdir, création events.jsonl
  - "event accumulation" (1 test) — ordre
  - "schema compliance" (1 test) — champs requis (event-sink le garantit)
- **À conserver + adapter** (contrat de données) :
  - "logTriggered" (2 tests) → renommer en "enforcer_triggered", vérifier namespace + détails
  - "single event per trigger" (1 test) → garder
- Changements : `extension` → `namespace`, `createStatsLog` → `createEventSink`, `logTriggered` → `append`

---

### 2. path-guard

**Stats-log actuel :**
```ts
createStatsLog({ statsDir, sessionId, cwd }) → { filePath, logAccess(entry) }
logAccess({ ts, toolType, repo, action, givenPath, rewrittenTo?, originalCmd?, parentModel, thinkingLevel })
// produit : { extension: "path-guard", eventType: "path_access", ... }
// truncate originalCmd à 200, rewrittenTo/originalCmd conditionnels
```

**Extension consommatrice** (`path-guard.ts`) — 4 call sites :
- write/edit redirect (avec `rewrittenTo`, sans `originalCmd`)
- write/edit correct (ni `rewrittenTo` ni `originalCmd`)
- bash redirect (avec `rewrittenTo` + `originalCmd`)
- bash correct (ni `rewrittenTo` ni `originalCmd`)

**Logique métier à déplacer :**
| Logique | Stats-log → Extension |
|---|---|
| Truncation `originalCmd` à 200 + `…` | ✅ à déplacer dans `path-guard.ts` |
| Champs conditionnels (`rewrittenTo`, `originalCmd`) | ✅ à déplacer (déjà conditionnel dans l'extension, le stats-log ne faisait que propager) |

**⚠️ Duplication potentielle** : avec 4 call sites, répéter la construction du
`details` + la truncation à chaque appel serait verbeux. Ajouter un petit helper
privé dans l'extension :
```ts
function buildDetails(entry: {...}): Record<string, unknown> {
  const d: Record<string, unknown> = { toolType: entry.toolType, repo: entry.repo,
    action: entry.action, givenPath: entry.givenPath,
    parentModel: entry.parentModel, thinkingLevel: entry.thinkingLevel };
  if (entry.rewrittenTo) d.rewrittenTo = entry.rewrittenTo;
  if (entry.originalCmd) d.originalCmd = entry.originalCmd.length <= 200
    ? entry.originalCmd : entry.originalCmd.slice(0, 200) + "…";
  return d;
}
```

**Migration :**
```ts
import { createEventSink } from ".../event-sink/src/index.ts";
const sink = createEventSink({ statsDir, agent: "pi", namespace: "path-guard", sessionId, workspace: process.cwd() });

// Avant
statsLog.logAccess({ ts, toolType, repo, action, givenPath, rewrittenTo, originalCmd, parentModel, thinkingLevel });
// Après
sink.append("path_access", buildDetails({...}), { timestamp: ts });
```

**⚠️ Attention** : la logique de truncation et de champs conditionnels (`rewrittenTo`, `originalCmd`) devra être **déplacée dans l'extension** (`path-guard.ts`), pas dans le sink. Le sink ne fait pas de logique métier.

**Contrat de sortie (events.jsonl) :**
```json
{
  "timestamp": "<ISO 8601>",
  "eventId": "<UUID v4>",
  "agent": "pi",
  "namespace": "path-guard",
  "eventType": "path_access",
  "workspace": "<cwd>",
  "sessionId": "<sessionId>",
  "details": {
    "toolType": "write | edit | bash",
    "repo": "<string>",
    "action": "redirected | correct",
    "givenPath": "<string>",
    "rewrittenTo": "<string>",       // absent si action=correct
    "originalCmd": "<string, ≤200>",  // absent si action=correct ou toolType≠bash
    "parentModel": "<string>",
    "thinkingLevel": "<string>"
  }
}
```

**Tests à migrer (path-guard) :**
- 9 tests, 5 describe blocks
- **À supprimer** (infrastructure, couvert par event-sink) :
  - "file creation" (2 tests) — mkdir, création events.jsonl
  - "event accumulation" (1 test) — ordre
  - "concurrent safety" (1 test) — append sans écraser
- **À conserver + adapter** (contrat de données) :
  - "logAccess — redirected" (1 test) → vérifier tous les champs d'un event redirect (write, avec rewrittenTo, sans originalCmd)
  - "logAccess — correct" (1 test) → vérifier action="correct", rewrittenTo et originalCmd absents
  - "truncates originalCmd" (1 test) → tester la troncation à 200 (logique maintenant dans l'extension)
  - "schema compliance" (2 tests) → garder uniquement le test `no cycleId`, virer le test "required fields" (event-sink le garantit)
- Changements : `extension` → `namespace`, `createStatsLog` → `createEventSink`, `logAccess` → `append`
- **⚠️ Gap à combler** : pas de test pour `originalCmd` court (<200) qui reste intact. Ajouter un test "ne tronque pas les commandes courtes".

---

### 3. post-write-linter

**Stats-log actuel :**
```ts
createStatsLog({ statsDir, sessionId, cwd }) → { filePath, logResult(entry) }
logResult({ ts, filePath, language, status, output?, parentModel, thinkingLevel })
// produit : { extension: "post-write-linter", eventType: "lint_result", ... }
// truncate output à 500 si présent, output absent si status=success
```

**Extension consommatrice** (`post-write-linter.ts`) — 2 call sites :
- error (avec `output` → tronqué à 500)
- success (sans `output`)

**Logique métier à déplacer :**
| Logique | Stats-log → Extension |
|---|---|
| Truncation `output` à 500 + `…` | ✅ à déplacer dans le call site error |
| Champ conditionnel `output` | ✅ déjà naturel (error=envoie, success=non) |

**Migration :**
```ts
import { createEventSink } from ".../event-sink/src/index.ts";
const sink = createEventSink({ statsDir, agent: "pi", namespace: "post-write-linter", sessionId, workspace: process.cwd() });

// Error path
const details: Record<string, unknown> = { filePath, language, status: "error",
  output: result.output.length <= 500 ? result.output : result.output.slice(0, 500) + "…",
  parentModel: lastModel ?? "unknown", thinkingLevel: lastThinking };
sink.append("lint_result", details, { timestamp: ts });

// Success path
sink.append("lint_result", { filePath, language, status: "success",
  parentModel: lastModel ?? "unknown", thinkingLevel: lastThinking }, { timestamp: ts });
```

**Contrat de sortie (events.jsonl) :**
```json
{
  "timestamp": "<ISO 8601>",
  "eventId": "<UUID v4>",
  "agent": "pi",
  "namespace": "post-write-linter",
  "eventType": "lint_result",
  "workspace": "<cwd>",
  "sessionId": "<sessionId>",
  "details": {
    "filePath": "<string>",
    "language": "<string>",
    "status": "success | error",
    "output": "<string, ≤500>",    // absent si status=success
    "parentModel": "<string>",
    "thinkingLevel": "<string>"
  }
}
```

**Tests à migrer (post-write-linter) :**
- 7 tests, 5 describe blocks
- **À supprimer** (infrastructure, couvert par event-sink) :
  - "file creation" (2 tests) — mkdir, création events.jsonl
  - "event accumulation" (1 test) — ordre
  - "all events have required fields" (1 test) — event-sink le garantit
- **À conserver + adapter** (contrat de données) :
  - "logResult (error)" (3 tests) → vérifier status="error", tous les champs, truncation 500, short output intact
  - "logResult (success)" (1 test) → vérifier status="success", output absent
  - "no cycleId field present" (1 test) → garder
- Changements : `extension` → `namespace`, `createStatsLog` → `createEventSink`, `logResult` → `append`
- ✅ **Aucun gap** : les 2 statuts et les 2 branches de troncation sont couverts

---

### 4. read-deduplicator

**Stats-log actuel :**
```ts
createStatsLog({ statsDir, sessionId?, cwd }) → { filePath, logFileAccess(entry) }
logFileAccess({ ts, action, path, sizeBytes, turnIndex, parentModel, thinkingLevel, sessionId, workspace, blockedReason? })
// produit : { extension: "read-deduplicator", eventType: "file_access", ... }
// sessionId/workspace viennent de l'ENTRY (pas des opts), blockedReason conditionnel
```

**Extension consommatrice** (`read-deduplicator.ts`) — 2 call sites réels :
- blocked (dans `tool_call`) — avec `blockedReason`
- read (dans `tool_result`) — sans `blockedReason`

**⚠️ Particularité critique** : `workspace` et `sessionId` viennent de l'`entry`, pas des `opts`. Les opts ne servent qu'à générer un `sessionId` par défaut si absent. Pour la migration → overrides à chaque `append()`.

**Logique métier à déplacer :**
| Logique | Stats-log → Extension |
|---|---|
| Champ conditionnel `blockedReason` | ✅ à déplacer (déjà conditionnel dans l'extension, le stats-log ne faisait que propager) |

**Migration :**
```ts
import { createEventSink } from ".../event-sink/src/index.ts";
const sink = createEventSink({ statsDir, agent: "pi", namespace: "read-deduplicator" });

// Blocked path
const details: Record<string, unknown> = { action: "blocked", path, sizeBytes, turnIndex, parentModel, thinkingLevel, blockedReason };
sink.append("file_access", details, { timestamp: ts, sessionId, workspace });

// Read path
sink.append("file_access", { action: "read", path, sizeBytes, turnIndex, parentModel, thinkingLevel },
  { timestamp: ts, sessionId, workspace });
```

**Contrat de sortie (events.jsonl) :**
```json
{
  "timestamp": "<ISO 8601>",
  "eventId": "<UUID v4>",
  "agent": "pi",
  "namespace": "read-deduplicator",
  "eventType": "file_access",
  "workspace": "<entry.workspace>",
  "sessionId": "<entry.sessionId>",
  "details": {
    "action": "blocked | read",
    "path": "<string>",
    "sizeBytes": "<number>",
    "turnIndex": "<number>",
    "parentModel": "<string>",
    "thinkingLevel": "<string>",
    "blockedReason": "<string>"     // absent si action=read
  }
}
```

**Tests à migrer (read-deduplicator) :**
- 8 tests, 5 describe blocks, 103 assertions
- **À supprimer** (infrastructure, couvert par event-sink) :
  - "file creation" (2 tests) — mkdir, création events.jsonl
  - "event accumulation" (1 test) — ordre
  - "all events have required fields" (1 test) — event-sink le garantit
  - "edge cases — multiple sessions" (1 test) — doublon du test d'ordre
- **À conserver + adapter** (contrat de données) :
  - "logFileAccess (blocked)" (1 test) → 15 assertions, tous les champs d'un event blocked
  - "logFileAccess (read)" (1 test) → 15 assertions, tous les champs d'un event read
  - "no cycleId field present" (1 test) → garder
- Changements : `extension` → `namespace`, `createStatsLog` → `createEventSink`, `logFileAccess` → `append`
- ✅ **Aucun gap** : 14/14 champs couverts (corrigé le 5 juil)
- **Fichiers à supprimer** : `stats-log.ts` + `lib/atomic-writer.ts` (2 fichiers)

---

### 5. secret-scanner

**Stats-log actuel :**
```ts
createStatsLog({ statsDir, sessionId, cwd }) → { filePath, logResult(entry) }
logResult({ ts, status, findings?, commitMsg?, parentModel, thinkingLevel })
// produit : { extension: "secret-scanner", eventType: "scan_result", ... }
// truncate finding.line à 80, commitMsg à 100, ajoute findingsCount
// champs conditionnels : findings (avec findingsCount), commitMsg
```

**Extension consommatrice** (`secret-scanner.ts`) — 2 shapes :
- blocked (avec `findings`, optionnellement `commitMsg`)
- clean (sans `findings`, sans `commitMsg`, ×3 chemins)

**Logique métier à déplacer :**
| Logique | Stats-log → Extension |
|---|---|
| Truncation `finding.line` à 80 + `…` | ✅ à déplacer dans le call site blocked |
| Truncation `commitMsg` à 100 + `…` | ✅ à déplacer |
| Ajout `findingsCount` | ✅ à déplacer |
| Champs conditionnels (`findings`, `commitMsg`) | ✅ déjà naturel (blocked=envoie, clean=non) |

**Migration :**
```ts
import { createEventSink } from ".../event-sink/src/index.ts";
const sink = createEventSink({ statsDir, agent: "pi", namespace: "secret-scanner", sessionId, workspace: process.cwd() });

// Blocked path
const details: Record<string, unknown> = { status: "blocked", parentModel, thinkingLevel };
if (findings?.length) {
  details.findingsCount = findings.length;
  details.findings = findings.map(f => ({
    ...f,
    line: f.line.length <= 80 ? f.line : f.line.slice(0, 79) + "…",
  }));
}
if (commitMsg !== undefined) {
  details.commitMsg = commitMsg.length <= 100 ? commitMsg : commitMsg.slice(0, 99) + "…";
}
sink.append("scan_result", details, { timestamp: ts });

// Clean path
sink.append("scan_result", { status: "clean", parentModel, thinkingLevel }, { timestamp: ts });
```

**Contrat de sortie (events.jsonl) :**
```json
{
  "timestamp": "<ISO 8601>",
  "eventId": "<UUID v4>",
  "agent": "pi",
  "namespace": "secret-scanner",
  "eventType": "scan_result",
  "workspace": "<cwd>",
  "sessionId": "<sessionId>",
  "details": {
    "status": "blocked | clean",
    "parentModel": "<string>",
    "thinkingLevel": "<string>",
    "findingsCount": "<number>",              // absent si status=clean
    "findings": [                              // absent si status=clean
      {
        "name": "<string>",
        "line": "<string, ≤80>",
        "lineNumber": "<number>"
      }
    ],
    "commitMsg": "<string, ≤100>"             // optionnel, absent si non fourni
  }
}
```

**Tests à migrer (secret-scanner) :**
- 11 tests, 5 describe blocks, 41 assertions
- **À supprimer** (infrastructure, couvert par event-sink) :
  - "file creation" (2 tests) — mkdir, création events.jsonl
  - "event accumulation" (1 test) — ordre
  - "all events have required fields" (1 test) — event-sink le garantit
- **À conserver + adapter** (contrat de données) :
  - "logResult (blocked)" (5 tests) → blocked avec findings + 2× troncation line + 2× troncation commitMsg
  - "logResult (clean)" (1 test) → clean, findings absents
  - "no cycleId field present" (1 test) → garder
- Changements : `extension` → `namespace`, `createStatsLog` → `createEventSink`, `logResult` → `append`
- ✅ **Aucun gap** : 15/15 champs couverts, les 2 branches de troncation pour `line` et `commitMsg`

---

### 6. zero-timeout-filter

**Stats-log actuel :**
```ts
createStatsLog({ statsDir }) → { logTimeoutStripped(entry) }
logTimeoutStripped({ ts, originalTimeout, parentModel, thinkingLevel, sessionId, workspace, toolCallId })
// pas de filePath exposé, pas de cwd dans les opts
// sessionId/workspace viennent de l'entry, pas des opts
// construction d'enveloppe inline (pas de appendEvent helper)
```

**Extension consommatrice** (`zero-timeout-filter.ts`) — 1 seul call site :
- Lazy init : `createStatsLog` appelé au premier `logTimeoutStripped`, pas au load de l'extension

**Logique métier à déplacer :**
| Logique | Stats-log → Extension |
|---|---|
| Aucune | ✅ déjà zéro logique métier dans le stats-log (pas de truncation, pas de champs conditionnels, pas de findingsCount) |

**⚠️ Particularité** : le seul des 6 à ne pas passer `sessionId`/`workspace` à la création mais par événement. Le sink supporte ce pattern via les `overrides`.

**Migration :**
```ts
import { createEventSink } from ".../event-sink/src/index.ts";
// Lazy init conservée car le statsDir peut changer via env var
let sink: ReturnType<typeof createEventSink> | undefined;
function ensureSink() {
  if (!sink) {
    const dir = process.env.ZERO_TIMEOUT_FILTER_STATS_DIR ?? join(homedir(), "neelopedia/stats/pi/zero-timeout-filter");
    sink = createEventSink({ statsDir: dir, agent: "pi", namespace: "zero-timeout-filter" });
  }
  return sink;
}

// Avant
statsLog.logTimeoutStripped({ ts, originalTimeout, parentModel, thinkingLevel, sessionId, workspace, toolCallId });
// Après
ensureSink().append("timeout_stripped", { originalTimeout, parentModel, thinkingLevel, toolCallId },
  { timestamp: ts, sessionId, workspace });
```

**Contrat de sortie (events.jsonl) :**
```json
{
  "timestamp": "<ISO 8601>",
  "eventId": "<UUID v4>",
  "agent": "pi",
  "namespace": "zero-timeout-filter",
  "eventType": "timeout_stripped",
  "workspace": "<entry.workspace>",
  "sessionId": "<entry.sessionId>",
  "details": {
    "originalTimeout": "<number>",
    "parentModel": "<string>",
    "thinkingLevel": "<string>",
    "toolCallId": "<string>"
  }
}
```

**Tests à migrer (zero-timeout-filter) :**
- 5 tests, 4 describe blocks, 27 assertions
- **À supprimer** (infrastructure, couvert par event-sink) :
  - "file creation" (2 tests) — mkdir, création events.jsonl
  - "event accumulation" (1 test) — ordre
  - "all events have required fields" (1 test) — event-sink le garantit
- **À conserver + adapter** (contrat de données) :
  - "writes valid JSON with all fields" (1 test) → 11 assertions, tous les champs (enveloppe + details)
- Changements : `extension` → `namespace`, `createStatsLog` → `createEventSink`, `logTimeoutStripped` → `append`
- ✅ **Aucun gap** : 11/11 champs couverts
- ✅ **Le plus simple** des 6 : zéro logique métier, 1 seul call site, 1 seul test contrat

---

## Étapes d'exécution

### Step 1 — git-commits-push-enforcer (le plus simple)
- Remplacer `createStatsLog` par `createEventSink` dans l'extension
- Migrer les tests
- Supprimer `git-commits-push-enforcer-internals/stats-log.ts`
- Mettre à jour `CONTEXT.md` correspondant (`extension` → `namespace`)

### Step 2 — zero-timeout-filter (cas particulier, pas de sessionId/workspace aux opts)
- Remplacer, migrer tests, supprimer stats-log.ts

### Step 3 — post-write-linter (truncation simple)
- Déplacer la logique de truncation dans l'extension
- Remplacer, migrer tests, supprimer stats-log.ts

### Step 4 — secret-scanner (truncation + findingsCount)
- Déplacer la logique métier dans l'extension
- Remplacer, migrer tests, supprimer stats-log.ts

### Step 5 — path-guard (truncation + champs conditionnels)
- Déplacer la logique métier dans l'extension
- Remplacer, migrer tests, supprimer stats-log.ts

### Step 6 — read-deduplicator (le plus complexe : atomic-writer local, sessionId optionnel)
- Remplacer, migrer tests, supprimer `stats-log.ts` ET `lib/atomic-writer.ts`

---

## Récapitulatif des suppressions

| Fichier supprimé | Extension |
|---|---|
| `git-commits-push-enforcer-internals/stats-log.ts` | Step 1 |
| `zero-timeout-filter-internals/stats-log.ts` | Step 2 |
| `post-write-linter-internals/stats-log.ts` | Step 3 |
| `secret-scanner-internals/stats-log.ts` | Step 4 |
| `path-guard-internals/stats-log.ts` | Step 5 |
| `read-deduplicator-internals/stats-log.ts` | Step 6 |
| `read-deduplicator-internals/lib/atomic-writer.ts` | Step 6 |

**Total** : 7 fichiers supprimés, ~250 lignes de code dupliqué éliminées.

---

## Logique métier déplacée dans les extensions

Actuellement, chaque `stats-log.ts` contient de la **logique métier de formatting** qui n'a rien à faire dans un logger :

| Extension | Logique déplacée |
|---|---|
| path-guard | Truncation `originalCmd` à 200, champs conditionnels `rewrittenTo` |
| post-write-linter | Truncation `output` à 500 |
| secret-scanner | Truncation `finding.line` à 80, `commitMsg` à 100, ajout `findingsCount` |
| read-deduplicator | Champs conditionnels `blockedReason` |
| git-commits-push-enforcer | Aucune (déjà propre) |
| zero-timeout-filter | Aucune (déjà propre) |

---

## Completion criteria

- [ ] Les 6 extensions importent `createEventSink` (plus aucun `createStatsLog` local)
- [ ] Les 6 `stats-log.ts` sont supprimés
- [ ] `read-deduplicator-internals/lib/atomic-writer.ts` est supprimé
- [ ] Tous les events respectent l'enveloppe event-sink : `timestamp`, `eventId`, `agent`, `namespace`, `eventType`, `workspace`, `sessionId`, `details`
- [ ] Tous les tests passent avec `namespace` à la place de `extension`
- [ ] Les CONTEXT.md des dossiers de stats référencent `namespace` (pas `extension`)
- [ ] Aucune régression fonctionnelle : chaque extension logue les mêmes events qu'avant
