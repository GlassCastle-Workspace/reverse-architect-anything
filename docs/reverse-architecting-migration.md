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

**Known limitations:** process/trust boundaries are only _candidates_; the
first projection requires authenticated application Evidence and does not
yet emit C4, state machines, ADRs or cross-provider reconciliations.
