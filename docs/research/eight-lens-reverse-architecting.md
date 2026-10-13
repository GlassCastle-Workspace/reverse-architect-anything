# Eight-Lens Reverse Architecting — Research Contract (2026-10-13)

> Research-only specification for RAA. **Not integrated into REA, not a verified new decompiler, and not an authorization to run targets.**

## Objective

Reconstruct evidence-linked structure, behavior, format rules, meaning, situated usage, content, observation context and candidate purpose. Require an auditable path from observation to claim, and a falsifiable experiment before elevating an explanation.

The eight lenses are **complementary projections**, not independent statistical dimensions:

| Lens | Question | Non-claim boundary |
|---|---|---|
| Anatomy | What parts, boundaries, interfaces and connections exist? | Existence does not establish execution |
| Physiology | How does the system operate, evolve and respond? | Co-occurrence does not prove cause |
| Syntax | What encodings and sequences are well formed? | Grammar alone does not establish meaning |
| Semantics | What meanings/effects are defined by a specification or operation? | Standard semantics do not prove situated usage |
| Pragmatics | How is something used in an actual workflow? | Typical use does not prove observed use |
| Content | Which bytes, values, payloads and representations are present? | Content hash does not establish provenance |
| Context | Where/when/from which vantage and under what constraints? | Reported metadata needs separate corroboration |
| Intent | Which purposes plausibly explain the behavior? | Identical behavior can have benign or malicious explanations |

## Existing RAA foundation

The current draft PR #1 on feat/reverse-architecting-foundation at commit e0eb4b075cfeabdc8996d214fd51a3e7a0faf013 implements architecture projection, bounded federation, native and packet observation surfaces, heterogeneous atlas and falsifiable correspondence review. Its cross-source relationships remain unverified by design. This research branch begins from that commit; it makes no runtime or provider changes.

## Evidence model

An individual LensClaim must preserve:

- original source Evidence ID and exact source-scoped target identity
- lens identifier and precise, nonoverlapping proposition
- epistemic state: observed, derived, inferred, hypothesized, reported-unverified, unknown, unavailable, or disconfirmed
- byte/frame/time coordinates **when supplied by the source**
- coverage, trust and time scope, assumptions, limitations, alternatives, independent-test requirements
- original producer reported identity vs separately verified producer authority

An Evidence SHA-256 may detect record-content differences. It does not independently authenticate the original observer, prove execution or authorize merging identifiers across domains. A source-scoped packet field does not imply a flow or process attribution. A single IP, port or file path is not a universal entity identity.

## Model discipline

The core separation is Target × Lens × Method × Evidence × Claim. The method can be offline inspection, instrumented read-only observation, or a separately approved experimental action. A lens is an interpretation view, not a new evidence producer. Never convert absence under partial coverage into evidence of nonexistence.

Only accept cross-domain links after suitable observations of process-instance identity, load/socket ownership, namespace, NAT/sensor vantage and bounded timestamp window. Preserve contradictory reports and source-specific missing checks until the verifier can actually discriminate them.

## Candidate inventions (ranked by feasible demonstrability)

1. **LensGraph**: typed evidence-linked multiview projections for the architecture atlas. Test invariance of content/anatomy under context-only changes.
2. **Hypothesis Discriminator**: propose the least invasive experiment whose outcomes distinguish competing explanations. Record prediction before observation and negative controls.
3. **Contradiction Auditor**: detect genuinely conflicting source/scoped assertions while distinguishing unknown coverage from disagreement.
4. **Protocol Tomographer**: align bounded byte grammars, packet traces and state-machine models with typed native/application observations without inventing attribution.
5. **Contract Forge**: turn independently verified semantics and invariants into executable compatibility tests; distinguish recovered specification from assumptions.
6. **Semantic Drift**: compare architecture/behavior across versions without collapsing renamed identifiers or equating changed hashes with changed semantics.
7. **Cyber-Physical Reverse Architect**: eventually extend to recorded actuator/control signals; deny real actuation without new authority.

## Build boundary

Recommended dependency direction:

1. Existing REA providers → immutable source Evidence
2. Existing RAA normalized graphs/atlas → strict source-validated lens projection
3. Pure domain LensClaim engine → derived RAA Evidence with source links
4. Hypothesis/review service → discriminating proposed test
5. Approval-gated experiment executor → independently observed result
6. Reconciliation, comparison and export → diagrams / state machines / contracts

Do not add eight independent acquisition engines or replace mature protocol parsers. Implement the domain contract first, then service, then shared CLI/MCP workflow, then real-provider validation and false-attribution tests. Update the file-migration ledger only for fully reviewed files with concrete evidence.

## Narrow laboratory performed on 2026-10-13

An independent read-only Python lab was created and tested in a local sandbox. It is deliberately not part of this GitHub branch or upstream REA. It supports only bounded PNG/PCAP file inspection and explicit unknown handling; negative controls mutate disposable **in-memory copies**.

- 34/34 unit tests passed.
- 3,000 seeded mutation samples over synthetic PNG/PCAP/unknown bytes produced zero unhandled exceptions, not a security proof.
- A 69-byte 1×1 synthetic PNG was recognized and checked using structural parsing/CRC; Pillow 12.3.0 separately decoded the predicted pixel.
- A 149-byte synthetic classic PCAP with two invented Ethernet/IPv4/UDP frames was recognized by /usr/bin/file; no real packet capture or telemetry was run.
- Two parser negative controls (one PNG IHDR bit flip and one PCAP record-length increase) were independently reparsed and rejected.
- Observed sample-run latency for these tiny synthetic inputs: approximately 461 microseconds PNG and 393 microseconds PCAP; not comparable to production REA.

These tests establish **only** the limited parser, epistemic labeling and control behavior in the isolated lab. They do not verify native code correlation, human intent, actual runtime dynamics, or superiority to existing tools.

## Research foundation and references

- Upstream REA: https://github.com/morluto/rea
- Fork draft PR: https://github.com/GlassCastle-Workspace/reverse-architect-anything/pull/1
- REA tool contracts: https://github.com/morluto/rea/blob/main/docs/tool-design.md
- Ghidra p-code semantics: https://github.com/NationalSecurityAgency/ghidra/blob/master/GhidraDocs/languages/html/sleigh.html
- Netzob protocol vocabulary/grammar/state inference: https://netzob.github.io/netzob/index.html
- LearnLib active automata learning: https://github.com/LearnLib/learnlib
- Daikon likely dynamic invariants: https://plse.cs.washington.edu/daikon/download/doc/daikon.html
- W3C provenance: https://www.w3.org/TR/prov-dm/
- RFC 9110 HTTP semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- W3C PNG syntax: https://www.w3.org/TR/png-3/
- IETF classic PCAP draft (September 2026): https://datatracker.ietf.org/doc/draft-ietf-opsawg-pcap/09/
- MITRE ambiguity of techniques and intent: https://ctid.mitre.org/blog/2026/02/19/ambiguous-techniques-extension/

## Next falsifiable milestone

Create a **strictly typed domain-only LensGraph projection** over one preauthenticated RAA architectural source. Acceptance: no provider calls, no invented cross-source edges, deterministic Evidence projection, exact source coordinates, explicit unknowns for uncovered lenses, and negative tests proving a change to analyst-supplied context cannot turn an unobserved intention into a verified intent. Only after this passes should a CLI/MCP operation be added.

*This file is an exploratory research contract; do not promote it to release documentation or a claim of new underlying reverse-engineering capability without independent provider and comparative verification.*
