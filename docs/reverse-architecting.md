# Reverse Architect Anything (RAA): Architecture and Evidence Contract

> Working specification for the independent [REA fork](https://github.com/GlassCastle-Workspace/reverse-architect-anything). This fork remains a work in progress; upstream REA is maintained separately by morluto.

## Mission

Transform an investigation toolkit into an **evidence-led architecture reconstruction platform**.

Reverse engineering uncovers how a system behaves or was implemented. Reverse
architecting reconstructs _architectural structure, boundaries, responsibilities,
interfaces, constraints, and evolution_ from partial observations. A defensible
architecture model is not automatically the original designer's intent.

The upstream tool remains the evidence acquisition foundation: binaries,
native calls, source artifacts, browser/network captures, applications, and
runtime traces. RAA adds architectural interpretation, competing hypotheses,
verification questions, and eventually cross-source reconciliation and diagrams.

## Epistemic model (normative)

| Status                | Meaning                                                                   | Example                                                         |
| --------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Observed              | Reported by an identified extractor, with source coordinates and coverage | A captured request reaches a specific endpoint                  |
| Derived               | A deterministic transformation of validated facts                         | Group a module as an implementation component based on its kind |
| Inferred              | A plausible conclusion supported but not entailed by the evidence         | A service may be responsible for authentication                 |
| Hypothesis            | An interpretation explicitly requiring a falsifiable verification step    | This IPC relationship crosses a trust boundary                  |
| Unknown / unavailable | Insufficient evidence, unobservable scope, or unsupported provider        | Whether a background worker can access credentials              |

**Invariant:** A derived class, inferred responsibility, or hypothesized
boundary MUST NOT be represented as a directly observed architectural fact.
Evidence confidence and architectural interpretation are different fields.

### Identity, time, scope, and evidence

- Preserve source node IDs and identity stability. A code path, process ID,
  hostname, URL, or symbol name alone is not a system-wide identity.
- Keep graph-level Evidence ID, edge IDs, per-fact evidence references,
  extraction limitations and source coverage. An empty graph-local evidence
  reference list does not mean the outer authenticated Evidence is absent.
- Incomplete coverage is not evidence of absence.
- Graph versions are separate assessments. Structural fingerprints do not
  authorize merging nodes across versions without supporting evidence.
- Valid-at/known-as-of and runtime locations will be introduced only where the
  source format has defensible time or locality coordinates.
- A candidate architectural decision requires alternatives, evidence, known
  constraints, tradeoffs and disconfirmation criteria. No reconstructed
  historical intent should be asserted as fact without independent evidence.

## Logical processing architecture

```text
Authorized targets / supplied artifacts
  -> REA provider observations and immutable Evidence records
  -> validated per-format graphs and bounded coverage
  -> RAA architectural projection
        components: stable source identities + derived categories
        relationships: exactly those present in the source graph
        boundary candidates: explicit hypotheses + test questions
        unresolved: retained missing / contradictory knowledge
  -> architecture verification and reconciliation [planned]
  -> typed model + diagrams + ADR candidates [planned]
  -> regression, drift, and coverage tests [planned]
```

Dependency direction is: pure domain interpretation <- application validation
and orchestration <- CLI/MCP adapters. The acquisition adapters MUST NOT be
rewritten to infer decisions directly. New architecture logic should prefer
shared domain contracts, never parallel ad-hoc parsers.

## First implemented vertical slice

The initial domain projection is
`src/domain/architecture/architectureProjection.ts`.
It consumes a **validated** `JavaScriptApplicationGraph` and retains its
graph identity, source node IDs, edge IDs, evidence states and limitations.

- **Components:** classifies a source node into distribution, artifact,
  execution-context, interface, implementation, storage, or unresolved. The
  classification is explicitly `source-node-kind` derived, not observed.
- **Relationships:** preserves original direction and typed relation verb
  without fabricating absent links.
- **Boundary candidates:** cross-category `sends`, `handles`,
  `exposes`, `invokes`, and `persists_to` edges become _hypotheses_.
  Every candidate carries its supporting edge and a verification question.
  The result does not prove a process, deployment, privilege or trust boundary.
- **Unresolved:** unknown/unavailable observations remain unresolved;
  coverage and limitations are passed through without promotion.
- **Validation:** `ArchitectureProjectionService` authenticates the caller's
  REA Evidence using the existing application graph validation boundary.

### Local CLI usage (this fork, not the published REA package)

```sh
# Requires Node.js 24 and project dependencies (npm ci).
node scripts/rea.mjs analyze-javascript-application /path/to/unpacked-app --format json > evidence.json
node -e 'const fs=require("node:fs");const evidence=JSON.parse(fs.readFileSync("evidence.json"));fs.writeFileSync("request.json",JSON.stringify({application:evidence}));'
node scripts/rea.mjs project-reverse-architecture request.json --format json > architecture.json
```

The executable remains `rea` during compatibility migration. It has **not**
been renamed or published under an RAA package identity.

### Measured local smoke test (2026-10-12)

On the upstream `scripts/fixtures/javascript-recovery/code-split` fixture:

- CLI JavaScript analysis completed with a valid Evidence record.
- The new CLI projection exited successfully with 11 components,
  17 relationships, zero eligible boundary candidates, and complete source
  graph coverage. The zero result is intentional, not a missing fallback.
- Five dedicated domain tests passed, alongside TypeScript typecheck and
  an instrumented local CLI build.
- This is **not** a native-provider, remote MCP, security, or full-regression
  verification claim.

## Next architectural capabilities (planned)

1. **Evidence federation:** align native, managed, JavaScript, browser,
   network, mobile, and runtime graphs with non-destructive entity resolution.
2. **Architectural contracts:** endpoints, data schemas, call shapes,
   invariants, side effects and dependency direction with coverage.
3. **State and temporal systems:** state transitions, event flows, concurrency,
   persistence and lifecycle ownership.
4. **Constraints and quality attributes:** security/trust, deployment, failure
   modes, performance, reliability, observability and portability.
5. **Hypothesis testing:** rank possible responsibilities and boundary
   interpretations; design minimal falsifiable observations and record outcomes.
6. **Exports:** C4-style layered diagrams, sequence/state/dependency views,
   an as-built architecture dossier and draft architecture decision records.
7. **Evolution:** compare architecture snapshots without merging scoped
   identities or leaking future knowledge into earlier interpretations.

## Security and scope

Work only on owner-authorized targets and data. Passive evidence reads do not
authorize execution, attachment, injection, bypass, secret extraction or
modification of analyzed targets. Preserve provider-specific authority and
explicit human approval gates from the upstream codebase. Architectural
models are not authority to manipulate the reconstructed system.

## File-by-file modernization acceptance

For each migrated file: identify ownership and dependencies; decide whether it
should be retained, rewritten, split, or retired; write down the reason and
risk; preserve evidence/authority semantics; add or update verification; then
mark the file in the pinned migration ledger. A passing test alone is not
proof of architectural correctness.

See [file migration plan](reverse-architecting-migration.md) and
[upstream architectural rules](../AGENTS.md).
