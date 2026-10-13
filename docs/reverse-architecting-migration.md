# RAA File-by-File Migration Plan

**Baseline:** morluto/rea at `fd9588089d089e7cb02d12178e34407d6f889f22`.

The working fork retains upstream history and the MIT license. Original
publication names and compatibility commands are **not** renamed until
operating alternatives are verified. The scope of the fork is substantially
larger than one text substitution.

## Decision protocol for every file

1. Read the file and its current callers, contracts, output and tests.
2. Decide: **retain**, **adapt**, **replace**, or **retire**. Never rename a
   working RE capability simply because it uses the word "engineering".
3. Classify observations, deterministic derivations, inferences, assumptions,
   unknowns and architecture hypotheses.
4. Implement the smallest coherent slice at the producing boundary.
5. Validate types, focused tests, boundary cases, and CLI/MCP compatibility.
6. Mark the row in `reverse-architecting-file-ledger.jsonl` with a status
   and _concrete evidence_. Do not count scans as completed reviews.
7. Commit the change with its test evidence; keep unrelated files pending.

## Migration priority and acceptance gates

| Phase                       | Owner                                                  | Gate                                                |
| --------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| 01-domain                   | Identity, evidence, architecture graph, reconciliation | Explicit epistemic states; stable scoped identities |
| 02-contracts                | Public input/output and schema correctness             | Typed, validated, versioned contract                |
| 03-workflows                | Evidence acquisition -> architecture projection        | No execution/mutation authority escalation          |
| 04-composition-mcp          | MCP exposure, authorization, tool catalogs             | Parity, reference validation, schema clients        |
| 05-cli                      | Names, commands, diagnostics, JSON outputs             | Reproducible CLI integration                        |
| 06-providers                | Native, browser, mobile, captures, file adapters       | Retained existing provider behavior                 |
| 07-tests                    | Regression, conformance, fixtures                      | Stronger checks than replaced tests                 |
| 08-documentation            | README, guides, website, multilingual docs             | Updated truthful identity and usage                 |
| 09-project-and-dependencies | Build, packaging, CI, releases, submodules             | License retention and clean release gate            |

## Ledger commands

```sh
node scripts/raa-file-ledger.mjs sync
node scripts/raa-file-ledger.mjs summary
node scripts/raa-file-ledger.mjs next
node scripts/raa-file-ledger.mjs check
node scripts/raa-file-ledger.mjs mark src/domain/evidence.ts reviewed-retained "Existing authenticated Evidence semantics preserved."
```

`init` is a **one-time**, refusal-on-overwrite operation. `sync` safely
registers newly added fork files without changing any source identities or
existing review decisions; run it before marking newly authored files.
The ledger records
the upstream blob SHA for every original file and separate rows for fork-added
files. `pending` never implies architectural deficiency: it means nobody has
completed a file-specific review yet. Submodule gitlinks remain external
dependencies; do not overwrite or rewrite third-party code without separate
provenance and licensing review.

Status definitions: `pending` (unreviewed), `reviewed-retained`,
`modified-verified`, `new-verified`, `deferred`, and
`removed-verified`. A completion note must identify the review rationale
or test, not simply say "done."

## Scope of initial iteration

Implemented: pure architecture projection, authenticated application Evidence
validation, cryptographically identified derived projection Evidence, the local
CLI command and the native MCP operation (including same-session retained
Evidence), five domain tests, three application service tests, three MCP
boundary tests, and architectural documentation. The acquisition providers and existing REA identity are
intentionally preserved. Cross-provider architectural reconciliation,
production MCP deployment, and package rebranding remain **pending**.

**Validation performed:** upstream JavaScript graph 19/19 regression tests,
new projection 5/5 domain tests, 3/3 application service tests, three MCP
boundary tests including schema and session isolation, the upstream MCP parity
tests (9/9 combined), 34/34 existing application CLI acceptance tests,
full local CI static gates, documentation checks and
local CLI analysis -> projection Evidence smoke test.

## Phase 3: bounded multi-source federation (2026-10-12)

Implemented `federate-reverse-architecture` (CLI) and
`federate_reverse_architecture` (MCP) for two to six complete
RAA-projection Evidence records. The projection now carries its validated
source family, root artifact digest, and original scoped node identities.
Federation does not coalesce nodes by name, path, or structural similarity;
it returns source-local edges, hypotheses, unknowns and original coverage.

It reports equal **supplied** SHA-256 digests only for content-exact nodes
or the source-root artifact. This is a digest comparison, **not independent
rehashing** or proof of shared logical architecture. No cross-source
runtime/trust relationships are fabricated. Resource limits are explicit.

**Validation:** 5/5 federation domain tests, 3/3 federation Evidence service
tests, 3/3 federation MCP boundary tests, 1/1 public CLI acceptance test
(order independence and duplicate rejection), retained Evidence session
isolation, 34/34 legacy application CLI acceptance tests, and full local CI
static gates. A real CLI analysis of two overlapping
JavaScript source directories yielded 42 components, 60 relationships,
3 shared reported content digests and no identical root digest; it created
no unjustified cross-source edges.

**Known limitations:** the new native UI trace and saved TShark packet
inspection adapters are separate source-scoped observation surfaces. Full raw
native-investigation graphs, flow/session reconstruction, other capture formats
and mobile graph inventories still require additional typed adapters.
Even when input source kinds include static JavaScript, runtime-reconciled
JavaScript and managed application projections, no cross-source identity
merge is authorized by this slice. Process/trust boundaries remain hypotheses.
C4 exports, state machines and architecture decision records are unimplemented.
Publication, provider-level integration tests and the full repository-wide
test suite remain separate release gates.

## Phase 4: native/packet evidence adapters (2026-10-13)

Implemented: `project-observation-architecture` (CLI) and
`project_observation_architecture` (MCP) for two bounded and typed inputs:
original `trace_native_ui_action` native trace Evidence and original
`inspect_packet_capture` saved-capture Evidence.

The domain owns source-scoped component and relationship transformations.
The application layer authenticates Evidence digests, producer operation
and identity, native target SHA-256, capture path/digest, and selected
capture options. Both interfaces return identical derived Evidence
envelopes. The MCP path only resolves exact same-session records.

The network projection deliberately makes no flow/session claims.
Native unresolved and partially covered call paths remain unknown.

**Validated:** 6 pure domain tests, 6 service tests, 3 new MCP boundary tests,
2 new compiled CLI acceptance tests, a combined 14/14 MCP regression suite,
36/36 compiled application CLI acceptance tests, and local static CI. The fixture source
records are synthetic, not external provider execution.

**Not implemented:** direct full native graph ingestion, arbitrary pcap
analysis in the projection, live capture, cross-family federation,
evidence-based native-to-network binding, field-level temporality, or
automated architecture reconstruction from unverified display names.

## Phase 5: heterogeneous Architecture Atlas (2026-10-13)

Implemented `build-reverse-architecture-atlas` (CLI) and
`build_reverse_architecture_atlas` (MCP) for two to eight complete RAA
architectural Evidence sources spanning at least two source domains
(application, native trace, packet capture). The service requires a recognized
RAA projection producer, authenticated record hash, exact source Evidence
lineage, declared source type and version, consistent component/edge counts,
and original-to-projected relationship identity consistency.

The atlas assigns deterministic source-scoped IDs to application, native, and
packet components without collapsing identifiers across source families.
It exposes each source's coverage and limitations, preserves native incomplete
dispatch and unknown endpoints, never invents packet relationships, and keeps
application boundary proposals as hypotheses. Matching **reported** artifact
SHA-256 values become informational digest groups only; the
`cross_source_relationships` collection remains explicitly empty.

**Resource bounds:** 2–8 source records, at most 20,000 nodes and 50,000
relationships. Inputs are order-independent, and source records are recorded
within the current MCP session using existing Evidence admission controls.

**Verified:** 9/9 atlas domain tests; 4/4 Atlas Evidence service tests;
3/3 atlas MCP tests including AJV schema, retained-session isolation and
tampering; 3/3 compiled atlas CLI acceptance tests. One CLI acceptance
case runs REA's real JavaScript analyzer on a local source fixture before
combining its Evidence with synthetic native and packet projections. The combined legacy/new
MCP and application CLI regression selection passed 56/56. Typechecking,
linting, module boundaries, architecture guards, dead-export checking,
formatting and duplicate-code checks passed in the local static CI gate.

**Not claimed:** independently signed producer provenance, full provider
integration, independently confirmed binary/packet equivalence, network
session reconstruction, architecture design-intent recovery, or verified
cross-domain relations. The Atlas's native and packet test data are synthetic.
A typed independently sourced correspondence verifier is the next milestone.

## Phase 6: cross-domain report review and admissibility (2026-10-13)

Implemented `review-architecture-correspondences` CLI and
`review_architecture_correspondences` MCP. The operation reviews separately
submitted, content-addressed analyst reports about explicit pairs of
atlas nodes. It enforces exact atlas/node/source identities, report operation
and source lineage, allowable directed relation kinds, scope/date validation,
and independent report identifiers. The result groups matching scopes,
preserves supporting and challenging Evidence IDs, records disconfirmation
questions and missing verification requirements, and distinguishes
`reported-unverified`, `contested`, and `challenge-only`.

The output never populates verified cross-source relationships. The input
`report_architecture_correspondence` is an externally authored Evidence
record, not a built-in instrumented producer. Semantic hash validation is
not attestation; no real process/socket observer, signed verifier, or native
instrumentation has been implemented by this phase.

Validation includes pure-domain, application-service, in-memory MCP and
compiled CLI tests with synthetic reports; retained Evidence expiry,
tampering/lineage rejections, report-order independence and lack of false
identity/causation claims are required release gates.

**Next:** independently authenticated or constrained producer adapters and
observable process/socket/network provenance, with sensor-time and namespace
coordination. Mere provider names, digest equality or an apparent IP/time
overlap must never be sufficient to mark a relationship verified.
