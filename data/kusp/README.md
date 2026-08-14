# KUSP knowledge pack — provenance and update policy

**SYNTHETIC DEMONSTRATION — no real patient data.**
The Lilli conversation is synthetic. The KUSP dataset below is **real, official
TLV material** — that is the point of it — but it is used only as reference
information and never to establish anything about a patient.

## Source authority

**Tandvårds- och läkemedelsförmånsverket (TLV)** — the Swedish Dental and
Pharmaceutical Benefits Agency. KUSP is *Kunskapsstödet i praktiken*, TLV's
support for applying the rules on state dental support.

| | |
|---|---|
| Binding regulation | **HSLF-FS 2025:68** |
| In force from | **2026-01-01** |
| Successor (published, not in force) | HSLF-FS 2026:22, from 2027-01-15 |
| Ingested artefact | `Referenspriser med dentalt material från 1 jan 2026.xlsx` |
| Retrieved | see `manifest.json` → `retrieved_at` |
| SHA-256 of the raw file | see `manifest.json` → `source_hashes` |

Source URLs are recorded in `manifest.json`. Only `tlv.se`, `www.tlv.se` and
`kusp.tlv.se` may ever be fetched; the build refuses any other host and refuses
plain HTTP.

## What is ingested, and what is not

| Category | Status | Why |
|---|---|---|
| Åtgärder (codes, titles, series) | **Ingested** | published in the reference-price XLSX |
| Reference prices, general dentistry | **Ingested** | same file |
| Reference prices, specialist dentistry | **Ingested** | same file, separate column |
| Tillstånd (conditions) | **Not ingested** | published as HTML pages only |
| Tillstånd ↔ åtgärd relationships | **Not ingested** | HTML only; inferring them would fabricate clinical links |
| Rule texts / paragraphs | **Not ingested** | binding regulation is a PDF |
| Handbook sections | **Not ingested** | PDF |
| Answered questions | **Not ingested** | HTML only |

The not-ingested datasets exist as **declared, empty files** carrying an
`availability` object with the reason. A consumer can therefore see both the
intended shape and the honest absence, and `kusp.js` answers
`{ available: false, reason }` rather than an empty result that would read as
"there is nothing here".

**Nothing in this pack is inferred.** No relationship was derived from two TLV
pages mentioning the same word.

## Binding vs explanatory

HSLF-FS 2025:68 is **binding**. The handbook and KUSP guidance are
**explanatory**. Every record returned by the query layer carries
`provenance.binding` — currently `false` throughout, because only the
reference-price file has been ingested and it is not the binding text.

## Rebuilding

```bash
npm run kusp:fetch      # downloads from TLV into scripts/kusp/raw/ (with hashes)
npm run kusp:build      # rebuilds data/kusp/ from the cached raw file
npm run kusp:update     # both
npm run kusp:validate   # validates without writing
npm test                # 41 assertions over the pack and the guarantees
```

The build is deterministic: JSON keys are sorted, åtgärder are sorted by code,
and rebuilding from the same raw file reproduces the same bytes. The raw
artefact is cached so a rebuild does not depend on the network, and a changed
upstream file shows up as a changed SHA-256 rather than as silently different
prices.

## Validation

The build fails loudly — it never writes a partial dataset — on: a missing or
moved column, a duplicate code, a non-integer or negative price, an unresolvable
cross-reference, a non-TLV source URL, or an implausibly small dataset. The
header row is *located* rather than assumed by index, because TLV has moved it
before and a fixed index would silently read a title as a price.

## When TLV changes its source format

1. `npm run kusp:fetch` records a new SHA-256; the diff shows the raw file moved.
2. `npm run kusp:build` fails with the specific missing column or header.
3. Fix the column matcher in `scripts/kusp/build.mjs`, re-run, review the diff.
4. If the **regulation** changed, update `REGULATION` — never mix two regulatory
   versions in one dataset. The manifest carries exactly one `regulation`.

Download URLs at TLV contain generated path segments and do change. They live in
`SOURCES` in the build script, in one place, for exactly that reason.

## Privacy

The patient browser **never contacts TLV**. Ingestion happens at build time; the
runtime reads static same-origin JSON. The CSP (`default-src 'none'`,
`connect-src 'self'`) makes an outbound request impossible, and a test asserts
no executable line in `app.js`, `kusp.js` or `service-worker.js` references a
TLV host. No patient information exists to send, and none is sent.

## The clinical boundary

KUSP supports **applying the rules**. It does not diagnose.

- No KUSP `tillstånd` is ever selected automatically as clinical fact.
- Every query response carries `notADiagnosis: true` and `advisory: true`.
- The routing projection is marked `decisionSupportOnly: true`.
- The patient-facing panel states, in Swedish and English, that a licensed
  dentist decides the condition and the treatment.
- **Reference price ≠ clinic price ≠ what the patient pays.** All three are
  named separately, and no reimbursement is calculated from a single åtgärd.
