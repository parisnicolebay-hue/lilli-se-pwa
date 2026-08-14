/**
 * KUSP knowledge pack — deterministic build.
 *
 *   TLV official source → fetch (cached raw) → normalize → validate → data/kusp/
 *
 * Run:  npm run kusp:update          (fetches, then rebuilds)
 *       npm run kusp:build           (rebuilds from the cached raw source)
 *
 * ── WHAT THIS DOES AND DOES NOT INGEST ───────────────────────────────────────
 * TLV publishes ONE machine-readable KUSP artefact: the reference-price
 * spreadsheet, which carries åtgärd codes, titles, and separate general and
 * specialist reference prices. That is ingested here.
 *
 * Tillstånd, tillstånd↔åtgärd relationships, rule texts, handbook sections and
 * answered questions are published as HTML pages and PDFs only. They are NOT
 * ingested, and this build writes them as explicitly empty datasets with an
 * `availability` note rather than inventing them. A relationship guessed from
 * two pages mentioning the same word is exactly the kind of fabricated clinical
 * link this product must never contain.
 *
 * ── WHY THE RAW FILE IS CACHED ───────────────────────────────────────────────
 * A build that reaches the network is a build that changes when TLV publishes.
 * The raw artefact is stored with its SHA-256 so a rebuild is reproducible, and
 * so a changed upstream file is visible as a changed hash rather than as
 * silently different prices.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { unzip, readSheet } from './xlsx.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const RAW_DIR = path.join(ROOT, 'scripts', 'kusp', 'raw');
const OUT_DIR = path.join(ROOT, 'data', 'kusp');

const SCHEMA_VERSION = '1.0.0';

/** Only these hosts may be fetched, and only over HTTPS. */
const ALLOWED_HOSTS = Object.freeze(['www.tlv.se', 'tlv.se', 'kusp.tlv.se']);

/**
 * The official sources this pack is derived from.
 *
 * `machineReadable: false` entries are recorded for provenance and are NOT
 * parsed — they are the categories a human must still read.
 */
const SOURCES = Object.freeze({
  referencePrices: {
    id: 'reference-prices-2026-01-01',
    url: 'https://www.tlv.se/download/18.529dc9ea19afcca05a41160c/1765803851920/'
      + 'Referenspriser%20med%20dentalt%20material%20fr%C3%A5n%201%20jan%202026.xlsx',
    file: 'referenspriser-2026-01-01.xlsx',
    machineReadable: true,
    kind: 'xlsx',
    describes: ['atgarder', 'reference-prices'],
  },
  regulation: {
    id: 'hslf-fs-2025-68',
    url: 'https://www.tlv.se/download/18.529dc9ea19afcca05a410f65/1765444861528/HSLF-FS_2025_68.pdf',
    file: 'HSLF-FS_2025_68.pdf',
    machineReadable: false,
    kind: 'pdf',
    describes: ['rules'],
  },
  kuspPortal: {
    id: 'kusp-portal',
    url: 'https://kusp.tlv.se/',
    machineReadable: false,
    kind: 'html',
    describes: ['tillstand', 'relationships', 'handbook', 'questions'],
  },
});

/** The regulation this pack encodes. Verified against TLV, not assumed here. */
const REGULATION = Object.freeze({
  id: 'HSLF-FS 2025:68',
  title: 'Tandvårds- och läkemedelsförmånsverkets föreskrifter och allmänna råd om statligt tandvårdsstöd',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  // Published and dated, but not yet in force. Recorded so a future build knows
  // a successor exists; never mixed into the same dataset.
  supersededBy: { id: 'HSLF-FS 2026:22', effectiveFrom: '2027-01-15' },
});

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function assertAllowed(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('refusing_non_https:' + url);
  if (!ALLOWED_HOSTS.includes(u.hostname)) throw new Error('refusing_non_tlv_host:' + u.hostname);
  return u;
}

/* ── Fetch ────────────────────────────────────────────────────────────────── */

export async function fetchSources() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const retrieved = {};
  for (const source of Object.values(SOURCES)) {
    if (!source.file) continue;                 // portal pages are not downloaded
    assertAllowed(source.url);
    const res = await fetch(source.url, {
      headers: { 'user-agent': 'VanilliOS-Sweden KUSP ingest (build-time, no patient data)' },
    });
    if (!res.ok) throw new Error('tlv_fetch_failed:' + source.id + ':' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(RAW_DIR, source.file), buf);
    retrieved[source.id] = { bytes: buf.length, sha256: sha256(buf) };
    process.stdout.write('fetched ' + source.file + ' (' + buf.length + ' bytes)\n');
  }
  fs.writeFileSync(path.join(RAW_DIR, 'retrieved.json'),
    JSON.stringify({ retrievedAt: new Date().toISOString(), files: retrieved }, null, 2) + '\n');
  return retrieved;
}

/* ── Normalise ────────────────────────────────────────────────────────────── */

/** "1 100" / "1100,50" / "-" → 110000 öre | null. Integers only: money is not a float. */
function toOre(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s || s === '-' || s === '–') return null;
  const cleaned = s.replace(/\s| /g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

const SERIES = Object.freeze({
  100: 'Undersökningar, riskbedömning och hälsofrämjande åtgärder',
  200: 'Sjukdomsförebyggande åtgärder',
  300: 'Sjukdomsbehandlande åtgärder',
  400: 'Kirurgiska åtgärder',
  500: 'Rotbehandlingsåtgärder',
  600: 'Bettfysiologiska åtgärder',
  700: 'Reparativa åtgärder',
  800: 'Protetiska åtgärder',
  900: 'Tandreglerande åtgärder och utbytesåtgärder',
});

export function normalise(rawBuffer, { retrievedAt }) {
  const sheet = readSheet(unzip(rawBuffer));
  if (!sheet.length) throw new Error('xlsx_empty');

  // The header row is located rather than assumed: TLV has moved it before,
  // and a hard-coded row index would silently read a title as a price.
  const headerIndex = sheet.findIndex((r) => /åtgärdsnummer/i.test(r[0] || ''));
  if (headerIndex < 0) throw new Error('xlsx_header_not_found:åtgärdsnummer');
  const header = sheet[headerIndex].map((h) => h.toLowerCase());

  const columnFor = (test, label) => {
    const idx = header.findIndex(test);
    if (idx < 0) throw new Error('xlsx_column_not_found:' + label);
    return idx;
  };
  const cCode = columnFor((h) => /åtgärdsnummer/.test(h), 'åtgärdsnummer');
  const cName = columnFor((h) => /åtgärdsnamn/.test(h), 'åtgärdsnamn');
  const cGeneral = columnFor((h) => /referenspris\s*allmän/.test(h), 'referenspris allmäntandvård');
  const cSpecialist = columnFor((h) => /referenspris\s*specialist/.test(h), 'referenspris specialisttandvård');
  const cTechnical = header.findIndex((h) => /tandteknisk/.test(h));
  const cMaterial = header.findIndex((h) => /dentalt material/.test(h));

  const atgarder = [];
  for (const row of sheet.slice(headerIndex + 1)) {
    const code = String(row[cCode] || '').trim();
    if (!/^\d{3}[a-zA-Z]?$/.test(code)) continue;        // notes and blanks
    const series = String(Math.floor(Number(code.slice(0, 3)) / 100) * 100);
    atgarder.push({
      code,
      title: String(row[cName] || '').trim(),
      series,
      seriesTitle: SERIES[Number(series)] || null,
      referencePriceOre: toOre(row[cGeneral]),
      specialistReferencePriceOre: toOre(row[cSpecialist]),
      technicalCostIncludedOre: cTechnical >= 0 ? toOre(row[cTechnical]) : null,
      dentalMaterialIncludedOre: cMaterial >= 0 ? toOre(row[cMaterial]) : null,
      // Everything below is published only as HTML/PDF at TLV and is therefore
      // left empty rather than guessed. See data/kusp/manifest.json.
      eligibilityConditions: [],
      incompatibleActions: [],
      relatedConditions: [],
      relatedRules: [],
      handbookRefs: [],
      questionRefs: [],
      sourceUrl: SOURCES.referencePrices.url,
      sourceType: 'reference_price_file',
      bindingRegulation: REGULATION.id,
      effectiveFrom: REGULATION.effectiveFrom,
    });
  }

  // Stable ordering, so a rebuild produces a byte-identical file.
  atgarder.sort((a, b) => a.code.localeCompare(b.code, 'sv'));
  return { atgarder, retrievedAt };
}

/* ── Validate ─────────────────────────────────────────────────────────────── */

export function validate({ atgarder }) {
  const problems = [];
  const seen = new Set();

  for (const a of atgarder) {
    if (!a.code) problems.push('missing code');
    if (seen.has(a.code)) problems.push('duplicate code: ' + a.code);
    seen.add(a.code);
    if (!a.title) problems.push('missing title: ' + a.code);
    if (a.referencePriceOre !== null && !Number.isInteger(a.referencePriceOre)) {
      problems.push('non-integer price: ' + a.code);
    }
    if (a.referencePriceOre !== null && a.referencePriceOre < 0) {
      problems.push('negative price: ' + a.code);
    }
    // Every cross-reference must resolve. They are all empty today; this check
    // is what stops the first populated relationship from being a dangling one.
    for (const ref of a.eligibilityConditions.concat(a.relatedConditions)) {
      problems.push('unresolvable condition reference: ' + a.code + ' -> ' + ref);
    }
    for (const ref of a.incompatibleActions) {
      if (!atgarder.some((x) => x.code === ref)) {
        problems.push('unresolvable action reference: ' + a.code + ' -> ' + ref);
      }
    }
    const u = new URL(a.sourceUrl);
    if (!ALLOWED_HOSTS.includes(u.hostname)) problems.push('non-TLV source url: ' + a.code);
  }

  if (atgarder.length < 50) problems.push('suspiciously few åtgärder: ' + atgarder.length);
  return problems;
}

/* ── Build ────────────────────────────────────────────────────────────────── */

/** Sorted-key JSON, so a rebuild diffs as data changes and never as key order. */
function stableStringify(value) {
  return JSON.stringify(value, (k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce((acc, key) => { acc[key] = v[key]; return acc; }, {});
    }
    return v;
  }, 2) + '\n';
}

export function build({ write = true } = {}) {
  const rawPath = path.join(RAW_DIR, SOURCES.referencePrices.file);
  if (!fs.existsSync(rawPath)) {
    throw new Error('raw source missing — run `npm run kusp:fetch` first: ' + rawPath);
  }
  const rawBuffer = fs.readFileSync(rawPath);
  const retrievedMeta = fs.existsSync(path.join(RAW_DIR, 'retrieved.json'))
    ? JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'retrieved.json'), 'utf8'))
    : { retrievedAt: null };

  const normalised = normalise(rawBuffer, { retrievedAt: retrievedMeta.retrievedAt });
  const problems = validate(normalised);
  if (problems.length) {
    throw new Error('KUSP validation failed:\n  - ' + problems.join('\n  - '));
  }

  const manifestGeneratedAt = new Date().toISOString();
  const manifest = {
    source: 'TLV',
    dataset: 'KUSP',
    jurisdiction: 'SE',
    regulation: REGULATION.id,
    regulationTitle: REGULATION.title,
    effective_from: REGULATION.effectiveFrom,
    effective_to: REGULATION.effectiveTo,
    supersededBy: REGULATION.supersededBy,
    retrieved_at: retrievedMeta.retrievedAt,
    generated_at: manifestGeneratedAt,
    schema_version: SCHEMA_VERSION,
    source_urls: Object.values(SOURCES).map((s) => s.url),
    source_hashes: { [SOURCES.referencePrices.id]: sha256(rawBuffer) },
    counts: { atgarder: normalised.atgarder.length, tillstand: 0, relationships: 0, rules: 0 },
    // The honest half of the manifest: what TLV does not publish in a form a
    // build can read, and therefore what this pack does not contain.
    availability: {
      atgarder: { status: 'ingested', source: 'reference_price_file', machineReadable: true },
      reference_prices: { status: 'ingested', source: 'reference_price_file', machineReadable: true },
      specialist_reference_prices: { status: 'ingested', source: 'reference_price_file', machineReadable: true },
      tillstand: { status: 'not_ingested', reason: 'published as HTML pages only at kusp.tlv.se', machineReadable: false },
      relationships: { status: 'not_ingested', reason: 'tillstånd↔åtgärd links are published as HTML only; inferring them would fabricate clinical relationships', machineReadable: false },
      rules: { status: 'not_ingested', reason: 'binding regulation published as PDF (HSLF-FS 2025:68)', machineReadable: false },
      handbook: { status: 'not_ingested', reason: 'TLV handbook published as PDF', machineReadable: false },
      questions: { status: 'not_ingested', reason: 'answered questions published as HTML only', machineReadable: false },
    },
    notices: {
      not_a_diagnosis: 'KUSP material supports application of the state dental-support rules. It never establishes a patient\'s clinical condition; only a licensed dentist does that.',
      reference_price_is_not_patient_price: 'A reference price is the basis for calculating state support. It is not the clinic\'s price and not what a patient pays.',
      binding_vs_explanatory: 'HSLF-FS 2025:68 is binding. Handbook and KUSP guidance are explanatory and are marked separately.',
    },
  };

  const datasets = {
    'manifest.json': manifest,
    'atgarder.json': { schema_version: SCHEMA_VERSION, regulation: REGULATION.id, items: normalised.atgarder },
    // Declared and empty, on purpose: a consumer can see the shape and see that
    // TLV publishes no machine-readable source for it.
    'tillstand.json': { schema_version: SCHEMA_VERSION, regulation: REGULATION.id, items: [],
      availability: manifest.availability.tillstand },
    'relationships.json': { schema_version: SCHEMA_VERSION, regulation: REGULATION.id, items: [],
      availability: manifest.availability.relationships },
    'rules.json': { schema_version: SCHEMA_VERSION, regulation: REGULATION.id, items: [],
      availability: manifest.availability.rules },
    'handbook-index.json': { schema_version: SCHEMA_VERSION, items: [], availability: manifest.availability.handbook },
    'questions-index.json': { schema_version: SCHEMA_VERSION, items: [], availability: manifest.availability.questions },
  };

  // A portable artefact for consumers outside this repo — notably the private
  // Vanilli OS Sweden backend, which must import a versioned dataset and must
  // NEVER scrape this PWA. Only verified fields travel: codes, titles, series,
  // both prices, and provenance. No inferred relationship can leave here
  // because none exists.
  const exportArtefact = {
    artefact: 'tlv-atgarder',
    schema_version: SCHEMA_VERSION,
    regulation: REGULATION.id,
    regulation_title: REGULATION.title,
    effective_from: REGULATION.effectiveFrom,
    effective_to: REGULATION.effectiveTo,
    superseded_by: REGULATION.supersededBy,
    source: 'TLV',
    source_url: SOURCES.referencePrices.url,
    source_sha256: sha256(rawBuffer),
    retrieved_at: retrievedMeta.retrievedAt,
    generated_at: manifestGeneratedAt,
    verified_fields: ['code', 'title', 'series', 'general_reference_price_ore',
      'specialist_reference_price_ore', 'source', 'regulation', 'effective_from'],
    unverified_absent: ['tillstand', 'tillstand_atgard_relationships', 'rule_paragraphs',
      'handbook_logic', 'answered_questions'],
    procedures: normalised.atgarder.map((a) => ({
      procedure_code: a.code,
      title: a.title,
      series: a.series,
      series_title: a.seriesTitle,
      general_reference_price_ore: a.referencePriceOre,
      specialist_reference_price_ore: a.specialistReferencePriceOre,
    })),
  };

  if (write) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const exportDir = path.join(ROOT, 'data', 'export');
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(
      path.join(exportDir, 'tlv-atgarder-' + REGULATION.id.replace(/[^A-Za-z0-9]+/g, '-') + '.json'),
      stableStringify(exportArtefact));
    for (const [name, value] of Object.entries(datasets)) {
      fs.writeFileSync(path.join(OUT_DIR, name), stableStringify(value));
    }
  }
  return { manifest, datasets, exportArtefact, problems };
}

/* ── CLI ──────────────────────────────────────────────────────────────────── */

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invoked) {
  const mode = process.argv[2] || 'build';
  try {
    if (mode === 'fetch' || mode === 'update') await fetchSources();
    if (mode === 'build' || mode === 'update') {
      const { manifest } = build();
      process.stdout.write('KUSP pack built: ' + manifest.counts.atgarder + ' åtgärder, '
        + manifest.regulation + ' from ' + manifest.effective_from + '\n');
    }
    if (mode === 'validate') {
      const { problems } = build({ write: false });
      process.stdout.write(problems.length ? problems.join('\n') + '\n' : 'valid\n');
      if (problems.length) process.exit(1);
    }
  } catch (err) {
    process.stderr.write('kusp: ' + err.message + '\n');
    process.exit(1);
  }
}

export { SOURCES, REGULATION, ALLOWED_HOSTS, SCHEMA_VERSION, toOre, stableStringify };
