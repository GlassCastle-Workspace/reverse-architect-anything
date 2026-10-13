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

## Implemented foundation: domain, CLI, and MCP

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
- **Provenance:** the CLI and MCP return a derived Evidence envelope containing
  the projection as `normalized_result`. Its `evidence_links` points to the
  exact authenticated source Evidence ID; the envelope is marked
  `analyst-inference`, never `observed`.
- **MCP:** `project_reverse_architecture` accepts inline Evidence or a typed
  `retained-evidence` reference scoped to the current session. It reuses
  REA's admission, ledger and error handling; it does not start providers.

### Local CLI usage (this fork, not the published REA package)

```sh
# Requires Node.js 24 and project dependencies (npm ci).
node scripts/rea.mjs analyze-javascript-application /path/to/unpacked-app --format json > evidence.json
node -e 'const fs=require("node:fs");const evidence=JSON.parse(fs.readFileSync("evidence.json"));fs.writeFileSync("request.json",JSON.stringify({application:evidence}));'
node scripts/rea.mjs project-reverse-architecture request.json --format json > architecture-evidence.json
node -e 'const e=require("./architecture-evidence.json"); console.log(e.normalized_result.summary, e.evidence_links)'
```

The MCP operation `project_reverse_architecture` accepts the same complete
`application` Evidence JSON or an exact retained reference
`{"application":{"kind":"retained-evidence","evidence_id":"ev_<64-hex>"}}`.
The caller must already have retained that Evidence in its current MCP session.
The command returns an **Evidence envelope**, not an unwrapped graph.
The source Evidence and derived architectural result are recorded in the same
session with deterministic IDs, making exact replays idempotent.

The executable remains `rea` during compatibility migration. It has **not**
been renamed or published under an RAA package identity.

### Measured local smoke test (2026-10-12)

On the upstream `scripts/fixtures/javascript-recovery/code-split` fixture:

- CLI JavaScript analysis completed with a valid Evidence record.
- The new CLI projection exited successfully with 11 components,
  17 relationships, zero eligible boundary candidates, and complete source
  graph coverage. The zero result is intentional, not a missing fallback.
- Five dedicated domain tests, three service-level tests and three MCP
  boundary tests passed, alongside TypeScript typecheck, lint, full local
  CI static gates, documentation validation and the local CLI build.
- The MCP boundary tests check JSON Schema, Evidence linkage, inline and
  retained equivalence, invalid/tampered inputs and session isolation.
- This is **not** a native-provider, externally deployed MCP, or full-repository
  regression verification claim.

## Evidence federation: implemented bounded slice

`federate_reverse_architecture` (MCP) and
`federate-reverse-architecture` (CLI) accept **two to six distinct RAA
architectural Evidence records**. The upstream producer must first be
`project_reverse_architecture`; arbitrary reports cannot be silently
promoted to architecture.

- **Sources:** retains each projection Evidence ID, original graph Evidence
  ID, graph ID, root artifact digest, source kind, limitations, and coverage.
- **Entities:** namespaces every component by its projection Evidence and
  original node ID. Identically named entities are **never merged**.
- **Relationships and hypotheses:** preserves only validated source-local edges
  and boundary candidates with their source-scoped identifiers.
- **Cross-source correspondences:** reports equal _provided_ SHA-256 digests for
  root artifacts and exact content-digest nodes. These are **reported digest
  matches**, not independent byte rereads, proof of the same logical entity, or
  authorization for cross-source architectural links.
- **Unknowns and coverage:** retain source-specific incomplete/unknown findings;
  `complete-within-sources` means only that each contributing graph reported
  complete coverage within its own scope.
- **Limits:** at most six source projections, 20,000 components and 50,000
  relationships per federation; larger requests fail before federation work.
- **Integrity:** validate each complete RAA Evidence envelope, provider/operation
  contract, content-addressed ID, normalized projection schema, and its
  source Evidence link. A semantic digest detects inconsistent record contents;
  **it is not a digital signature of independent producer authenticity**.

Example with already produced RAA Evidence files:

```sh
node -e 'const fs=require("node:fs"); const a=JSON.parse(fs.readFileSync("architecture-a.json"));const b=JSON.parse(fs.readFileSync("architecture-b.json"));fs.writeFileSync("federation-request.json",JSON.stringify({projections:[a,b]}));'
node scripts/rea.mjs federate-reverse-architecture federation-request.json --format json > federation-evidence.json
```

MCP also accepts current-session references of the form
`{"projections":[{"kind":"retained-evidence","evidence_id":"ev_<sha256-A>"},{"kind":"retained-evidence","evidence_id":"ev_<sha256-B>"}]}`.
Only Evidence already held by that MCP session can be resolved.

### Measured two-artifact CLI smoke test (2026-10-12)

Two actual REA JavaScript analyses of
`scripts/fixtures/javascript-recovery/code-split` and its enclosing
`scripts/fixtures/javascript-recovery` directory produced separate Evidence
records. Their RAA projections federated successfully:

| Measurement                            | Observed |
| -------------------------------------- | -------: |
| Separate source projections            |        2 |
| Components retained without coalescing |       42 |
| Source relationships retained          |       60 |
| Boundary hypotheses created            |        0 |
| Shared **reported content digests**    |        3 |
| Matching root-artifact digests         |        0 |
| Source-scoped unresolved components    |        0 |

The three digest matches correspond to content seen in both analysis scopes.
They **do not** establish identical application identity, runtime execution,
trust relationships, or architectural intent. The federation output was
content-addressed and linked to both RAA projection Evidence IDs.
A compiled CLI acceptance test also verifies the same derived Evidence ID
when source order is reversed, plus duplicate-source rejection.

## Next architectural capabilities (planned)

1. **Cross-family federation:** connect the new native-trace and packet-frame
   observation surfaces with existing application projections using separately
   verified cross-domain bindings. Raw native graphs and broader network/mobile
   formats require further adapters; no name, address or path match by itself
   proves a shared entity.
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

## Phase 4: native and packet observation surfaces (2026-10-13)

The additive `project-observation-architecture` CLI command and
`project_observation_architecture` MCP tool accept precisely one
authenticated source Evidence record and a discriminating `source_kind`.
The returned hash-identified `raa.observation-architecture-surface` Evidence
links the original producer's `evidence_id` without executing a target.

Two source types have separate, explicitly typed outputs:

**`native-trace`** — accepts existing REA `trace_native_ui_action`
Evidence with its native investigation trace schema, composed workflow
provider identity, and exact target artifact SHA-256. The projection
retains original native entity IDs, distinct entities with identical names,
native source coordinates, named edges and original resolution states
(`observed`, `inferred`, `resolved`, `ambiguous`, `unresolved`).
Unresolved indirect dispatch is not turned into a call target. When a
bounded trace omits a relationship endpoint, its original ID is retained
with a null projected endpoint and an explicit coverage limitation.
This is not full static or dynamic control-flow recovery.

**`packet-capture`** — accepts existing REA `inspect_packet_capture`
Evidence, validates source path/digest and exactly reconciles the
producer's selected fields, display filter, decode-as, limits and paging
with the stored output. It retains the original frame numbers and
ordered, potentially repeated field values. Its typed frame observations
produce **zero asserted inter-frame relationships**: a TShark field
window does not establish network flows, bidirectional conversations,
application-layer transactions, users, hosts or executable provenance.
The output reports matches, returned window, `has_more`, read scope,
filters and pagination, so incomplete observations cannot imply absence.

### CLI usage

```sh
# native-trace Evidence comes from an authorized REA trace_native_ui_action
# packet-capture Evidence comes from an existing inspect_packet_capture result
node -e 'const fs=require("node:fs"); fs.writeFileSync("observation-input.json", JSON.stringify({ source_kind:"packet-capture", evidence:JSON.parse(fs.readFileSync("source-evidence.json")) }));'
node scripts/rea.mjs project-observation-architecture observation-input.json --format json > observation-evidence.json
```

MCP accepts the same inline request or
`{"source_kind":"native-trace","evidence":{"kind":"retained-evidence","evidence_id":"ev_<64-hex>"}}`
for source Evidence already retained **in that exact MCP session**.

### Verification and boundaries

- Six pure-domain tests passed for distinct native identities, missing
  endpoint coverage, ambiguous dispatch, repeated network fields, pagination,
  duplicate frame identity and empty filtered windows.
- Six application service tests passed for deterministic content-linked
  Evidence, producer-family authentication, forged/mismatched artifacts,
  inconsistent packet selections and duplicate frame rejection.
- Three MCP boundary tests passed for full JSON Schemas, inline/retained
  identity parity, cross-session isolation, close-based reference expiry
  and forged input rejection.
- Two compiled CLI acceptance tests passed using **synthetic native and
  packet Evidence fixtures**. Tests do not claim that Hopper, Ghidra,
  TShark, Linux or a live device was run during this phase.
- Static local CI (including module boundaries, typechecks and formatting)
  passed after fixing an initial fixture-layer dependency violation.

**Evidence trust boundary:** Semantic Evidence ID validation detects altered records; it is not a digital signature, hardware attestation, or independent proof that a claimed tool actually ran. Producer-specific operation checks cannot establish trustworthy provenance without separate authority evidence.

**Current federation limit:** `federate_reverse_architecture` still
accepts its own validated application architecture projections, not these
two new observation-surface types. This prevents accidentally asserting
cross-domain equivalence or undocumented trust boundaries. A future
binding workflow must attach independently verifiable correspondence
Evidence before native, application and network facts can be correlated.

## Phase 5: heterogeneous evidence atlas (2026-10-13)

RAA now has an **evidence-backed, source-scoped architecture atlas** that can
display application architecture, native investigation and network packet
observations in one typed model without conflating their identities.

The new `build-reverse-architecture-atlas` CLI command and
`build_reverse_architecture_atlas` MCP operation consume **2–8** complete RAA
derived Evidence records from at least **two distinct source domains**:
`project_reverse_architecture` (application), or
`project_observation_architecture` (native trace / packet capture).

The output is a hash-identified, replayable Evidence record with:

- **Sources:** exact projection Evidence IDs, their original source Evidence
  IDs, reported target SHA-256, original graph or coverage structure,
  source-specific limitations and completeness within declared scope
- **Components:** exact original application, native or packet facts, each
  assigned a deterministic atlas identifier scoped to its input Evidence
- **Relationships:** only source-local application and native edges; native
  missing targets remain `null`
- **Boundary hypotheses:** existing application candidates remain explicitly
  labeled _hypotheses_ and refer back to their supporting source edges
- **Unresolved:** existing unknown component and native edge findings remain
  source-qualified; a packet capture cannot produce fabricated call edges
- **Reported artifact digest matches:** matching source artifact SHA-256 values
  may be grouped for inspection, but are **not** proof of shared deployment,
  function identity, network attribution, or system architecture
- **Cross-source relationships:** explicitly **empty** until a separate
  validated correspondence/authority contract is developed

Inputs are bounded to at most eight source Evidence records, 20,000 components
and 50,000 relationships. The tool requires at least two different domains to
avoid duplicating the earlier application-only federation. No schema
coercion to a JavaScript graph, name matching, implicit IP correlations,
live instrumentation or packet capture takes place.

### CLI invocation

```sh
# sources[] contains complete RAA Evidence records previously generated by
# project-reverse-architecture / project-observation-architecture.
node scripts/rea.mjs build-reverse-architecture-atlas atlas-request.json --format json > atlas-evidence.json
```

`atlas-request.json` is of the shape
`{"sources":[{"...":"full RAA projection Evidence"},{"...":"full RAA observation Evidence"}]}`.
In MCP, each item may instead be an exact same-session
`{"kind":"retained-evidence","evidence_id":"ev_<64-hex>"}` reference.
The atlas output's `evidence_links` enumerates each included Evidence ID in
canonical order; reversing valid input order must not change the result ID.

The initial source fixtures include a JavaScript application graph, a
**synthetic** native UI trace with an unresolved indirect call, and
**synthetic** paged TShark-style output with repeated network fields. Test
coverage is evidence that the atlas transport and interpretation rules work
on those inputs, **not** evidence that native instrumentation or packet
decoding ran during this phase. A separate compiled CLI acceptance case runs
REA's actual JavaScript analyzer against the repository's code-split fixture,
then combines that authenticated application output with the synthetic native
and packet sources. The mixed pipeline succeeds without introducing any
cross-domain edges.

**Next architectural milestone:** a separate typed, falsifiable cross-domain
binding contract with independent evidence IDs, scope (target/sensor/time),
reported authority, competing explanations, and validation results. Until
then, every atlas source remains a disjoint subgraph.

## Phase 6: Scoped correspondence reports and falsifiable review (2026-10-13)

A new `review-architecture-correspondences` CLI command and
`review_architecture_correspondences` MCP operation review **1–32**
separately authored report Evidence records against one complete
`build_reverse_architecture_atlas` Evidence record. This phase does **not**
promote the reports into verified cross-source relationships.

### Source requirements

- The atlas must have the exact RAA Atlas producer identity, operation,
  version, authority, semantic Evidence digest, and consistent source Evidence
  lineage. There is no re-creation of a graph from anonymous JSON.
- Each report must have `report_architecture_correspondence`,
  `raa.cross-domain-correspondence-report`, inferred/analyst authority,
  a typed `RAACorrespondenceReport` normalized result, a content-addressed
  Evidence identity, and exact links to the atlas and both referenced source
  projection Evidence IDs. Invalid references or mismatched parameters fail.
- Atlas node IDs, original projection ownership, permitted direction, and
  differing domains are checked. The only admitted report relation kinds are
  `application-loads-native`, `native-emits-packet`, and
  `application-emits-packet`.
- Each report carries a precisely scoped subject SHA-256 (or explicit null),
  process instance, namespace, connection/socket instance, sensor, start/end
  timestamp pair, rationale and report polarity. A supplied subject SHA-256
  must match the reported digest of at least one of the two original atlas
  sources; this remains a reported digest, not an independent byte rehash.
- Only reports with **identical** directional endpoints, relationship kind,
  and observation scope are grouped together. Supporting and challenging
  reports produce a `contested` review status; a challenge alone is
  `challenge-only`; otherwise a claim is `reported-unverified`.
  Different sensor scopes or time windows are _not silently merged_.
- Each claim includes missing source-validation requirements and a
  disconfirmation question. A process-to-packet report without a
  namespace, reuse-safe process instance identity, socket/connection identity,
  sensor/vantage or observation window remains visibly incomplete.
- Exact input reordering does not change the derived Evidence ID.
  Same-session MCP Evidence references expire on session close.
  The tool does not load binaries, launch processes, inspect packet files,
  access external networks or mutate an atlas.

### Input and output

```sh
# atlas.json: full derived RAA Atlas Evidence
# reports.json: array of full reported correspondence Evidence envelopes
node -e 'const fs=require("node:fs"); const atlas=JSON.parse(fs.readFileSync("atlas.json")); const reports=JSON.parse(fs.readFileSync("reports.json")); fs.writeFileSync("correspondence-request.json",JSON.stringify({atlas,reports}));'
node scripts/rea.mjs review-architecture-correspondences correspondence-request.json --format json > review-evidence.json
```

In MCP, `atlas` and each `reports[]` element may instead be an exact
`{"kind":"retained-evidence","evidence_id":"ev_<64-hex>"}` reference in
the same investigation session. The result is an RAA-derived Evidence
envelope containing a typed `RAACorrespondenceReview` in its
`normalized_result`, source IDs in `evidence_links` and explicit
`no-independent-verification` for every reviewed claim.
`verified_cross_source_relationships` is always empty in this release.

### Provenance and epistemic boundary

**A report is not proof that an underlying observation occurred.** Current
REA Evidence digests establish record-content integrity but not the
reporter's identity, instrument authorization or actual runtime behavior.
Two reporters agreeing does not authenticate either one. The review
therefore never marks reports `verified`, even when they agree or include
apparently complete scope fields.

Actual verification requires a separately developed and tested trusted
producer and admissibility contract. For example, process→network attribution
would need process-instance identity protected against PID reuse, socket or
connection ownership telemetry, network namespace and NAT context, capture
vantage, timestamp alignment and bounded observation coverage, followed by
tests designed to disconfirm attribution. This phase creates the typed
review/inquiry boundary without pretending that instrumentation already exists.

### Validation

The initial suite uses synthetic, explicitly analyst-authored report Evidence
records. It exercises invalid directions, absent nodes, unrelated artifact
digests, malformed time windows, duplicated report identities, inconsistent
source lineage, contradictory reports, different sensor scopes, and rejection
of forged or unauthorized source envelopes. Local CLI/MCP tests validate
the advertised schemas, deterministic replay, exact session reference
resolution and that reviews never create confirmed atlas edges.

## Phase 7: caller-scoped live macOS socket observations (2026-10-13)

The `observe-macos-process-sockets` CLI command and
`observe_macos_process_sockets` MCP tool collect a **passive, bounded OS
report** of TCP/UDP descriptors belonging to **one explicit numeric PID**.
This is the first RAA slice to read live process/socket state on the Mac mini
rather than deriving claims solely from previously recorded application
or packet Evidence.

### Acquisition contract

The producer executes only fixed system binaries, with fixed arguments plus
the validated numeric PID, without a shell or arbitrary executable paths:

- `/usr/sbin/sysctl -n kern.boottime` for a boot-time scope marker
- `/bin/ps -p PID -o lstart=` before and after socket inspection
- `/usr/sbin/lsof -nP -a -p PID -i -FpcfnPT` twice for the selected PID

Each process is bounded to four seconds with a 256 KiB captured-output limit.
Each readout admits at most 2,000 socket entries. The implementation
refuses unsupported platforms, malformed/duplicate descriptors,
unexpected PIDs, command diagnostics, changed boot identities, or changed
process-start labels. Only `lsof` exit code 1 with **completely empty**
stdout/stderr counts as a no-match readout; visibility is still partial.

The process instance marker hashes the reported boot timestamp, PID and
`ps lstart` label. The last field has **second-level precision** and is
not globally collision-proof under rapid PID reuse, so the output explicitly
records that limitation. Every socket observation is separately identified
within the capture window: even a reused FD and identical endpoint in a
subsequent capture receives a different observation identity.

The two lsof readouts are compared by file descriptor, protocol, opaque
OS-reported endpoint and TCP state. Entries are retained as:

- `reported-in-both-readouts`
- `first-readout-only`
- `second-readout-only`

A socket reported twice is **not** proven continuously open between reads.
All counts and resulting time bounds are carried in the typed
`RAAMacOSProcessSocketSnapshot`, with
`completeness: "partial-point-in-time"` regardless of how many sockets
were returned. No matching addresses, port numbers or file descriptors are
interpreted as a process-to-packet, flow, user or architectural relationship.

### Usage

```sh
# Select the PID deliberately; this inspects no other process.
node scripts/rea.mjs observe-macos-process-sockets '{"pid":12345}' --format json > socket-evidence.json
```

The MCP operation `observe_macos_process_sockets` takes
`{"pid":12345}` directly. Unlike existing RAA derived projections, it
launches the OS's **fixed diagnostic utilities**, so its MCP effect contract
advertises `launchesProcess: true`. It never launches/attaches to the
selected target, escalates privileges, captures packet payloads, opens
network connections or modifies process state.

The result is a normalized Evidence record with
`operation: "observe_macos_process_sockets"`,
`predicate_type: "raa.macos-process-socket-readout"`, `observed`
confidence and `external-service` authority. Here **observed** means
"reported by the local operating-system utility at collection time", _not_
independent cryptographic attestation or proof of actual packet transmission.
The selected live PID is not an immutable artifact subject.

### Verified on the Mac mini

A controlled local Node.js TCP server bound to the IPv4 loopback interface
was observed from its own PID. The fixed `lsof` selector returned the
listener, and RAA preserved its protocol, endpoint, file descriptor, state
and process identity. Compiled CLI and live MCP tests each exercised this
source without broad process scans or root escalation.

The initial `lsof -iTCP -iUDP` invocation returned exit code 1 even
though it emitted a valid TCP descriptor, due to combined selector
semantics. The corrected single `-i` selector exited successfully and
retained the typed TCP observation. The regression tests cover this path,
malformed/duplicate descriptors, PID or boot identity changes, empty
readouts, OS diagnostics, unsafe PID strings, and cancellation.

**Not claimed:** independent lsof binary attestation, an authenticated
process or executable signing chain, continuous socket telemetry, payload
recording, any packet timestamp correlation, namespace/NAT correlation or
verified process-to-frame attribution. No data from this live producer is
automatically promoted to a cross-domain architectural edge. That requires
separate process/sensor/connection event provenance and disconfirmation
experiments.
