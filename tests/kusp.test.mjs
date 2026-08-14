/**
 * KUSP knowledge pack — the guarantees that matter.
 *
 * SYNTHETIC DEMONSTRATION — no real patient data.
 *
 * Two kinds of assertion here. The first checks the pack is real: it came from
 * TLV, it carries its regulation, and its prices are the published ones. The
 * second checks what the pack must NEVER do — infer a diagnosis, invent a
 * relationship, present a reference price as a patient's bill, or let the
 * patient browser reach tlv.se.
 *
 * Fixtures are read from the built dataset rather than transcribed from this
 * file, so a test cannot pass by agreeing with a value someone typed from
 * memory. The few literal prices below were verified against the current TLV
 * publication (HSLF-FS 2025:68, in force from 2026-01-01) at build time.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as kusp from '../kusp.js';
import { toOre, ALLOWED_HOSTS, validate, normalise } from '../scripts/kusp/build.mjs';
import { unzip, readSheet } from '../scripts/kusp/xlsx.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kusp', p), 'utf8'));

const manifest = read('manifest.json');
const atgarder = read('atgarder.json');
const tillstand = read('tillstand.json');
const relationships = read('relationships.json');
const rules = read('rules.json');

kusp.hydrate({ manifest, atgarder, tillstand, relationships, rules });

test('the pack declares where it came from', async (t) => {
  await t.test('manifest loads with regulation and effective date', () => {
    assert.equal(manifest.source, 'TLV');
    assert.equal(manifest.dataset, 'KUSP');
    assert.equal(manifest.jurisdiction, 'SE');
    // Verified against TLV: HSLF-FS 2025:68 applies from 1 January 2026.
    assert.equal(manifest.regulation, 'HSLF-FS 2025:68');
    assert.match(manifest.effective_from, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(manifest.effective_from, '2026-01-01');
    assert.ok(manifest.retrieved_at, 'a retrieval timestamp exists');
    assert.ok(manifest.generated_at);
    assert.ok(manifest.schema_version);
  });

  await t.test('the raw source is hashed, so a changed upstream file is visible', () => {
    const hashes = Object.values(manifest.source_hashes);
    assert.ok(hashes.length >= 1);
    hashes.forEach((h) => assert.match(h, /^[0-9a-f]{64}$/));
  });

  await t.test('a successor regulation is recorded but never mixed in', () => {
    // HSLF-FS 2026:22 is published and dated but not yet in force.
    assert.ok(manifest.supersededBy);
    assert.ok(manifest.supersededBy.effectiveFrom > manifest.effective_from);
    assert.equal(atgarder.regulation, manifest.regulation, 'one regulation per dataset');
  });

  await t.test('the version is reachable through the query layer', () => {
    const v = kusp.getKuspVersion();
    assert.equal(v.regulation, 'HSLF-FS 2025:68');
    assert.equal(v.effectiveFrom, '2026-01-01');
    assert.ok(v.counts.atgarder > 0);
  });
});

test('åtgärder come from the official file', async (t) => {
  await t.test('a known action resolves with its published price', () => {
    // 101 Basundersökning, utförd av tandläkare — 1 100 kr from 2026-01-01.
    const a = kusp.getAction('101');
    assert.equal(a.code, '101');
    assert.match(a.title, /^Basundersökning/);
    assert.equal(a.referencePrice.ore, 110000);
    assert.equal(a.referencePrice.sek, 1100);
    assert.equal(a.series, '100');
  });

  await t.test('general and specialist prices stay distinct', () => {
    // 103 differs between allmän- and specialisttandvård; conflating them would
    // misstate the basis for state support.
    const a = kusp.getAction('103');
    assert.notEqual(a.referencePrice.ore, a.specialistReferencePrice.ore);
    assert.equal(a.referencePrice.ore, 44500);
    assert.equal(a.specialistReferencePrice.ore, 58500);

    const differing = atgarder.items.filter((x) =>
      x.specialistReferencePriceOre !== null
      && x.specialistReferencePriceOre !== x.referencePriceOre);
    assert.ok(differing.length > 100, 'most actions genuinely differ');
  });

  await t.test('"—" becomes null, never zero', () => {
    // A hygienist action has no specialist price. Zero would read as "free".
    const none = atgarder.items.filter((x) => x.specialistReferencePriceOre === null);
    assert.ok(none.length > 0);
    none.forEach((x) => assert.notEqual(x.specialistReferencePriceOre, 0));
    assert.equal(toOre('-'), null);
    assert.equal(toOre('–'), null);
    assert.equal(toOre(''), null);
  });

  await t.test('prices are integer öre, never floats', () => {
    atgarder.items.forEach((x) => {
      if (x.referencePriceOre !== null) assert.ok(Number.isInteger(x.referencePriceOre), x.code);
      if (x.specialistReferencePriceOre !== null) {
        assert.ok(Number.isInteger(x.specialistReferencePriceOre), x.code);
      }
    });
    assert.equal(toOre('1 100'), 110000);
    assert.equal(toOre('1100,50'), 110050);
  });

  await t.test('all nine åtgärd series are present', () => {
    const series = [...new Set(atgarder.items.map((x) => x.series))].sort();
    assert.deepEqual(series, ['100', '200', '300', '400', '500', '600', '700', '800', '900']);
  });

  await t.test('an unknown code fails safely — null, not a near match', () => {
    assert.equal(kusp.getAction('999999'), null);
    assert.equal(kusp.getAction(''), null);
    assert.equal(kusp.getAction(null), null);
    assert.equal(kusp.getReferencePrice('999999'), null);
    // 10 must not silently resolve to 101.
    assert.equal(kusp.getAction('10'), null);
  });
});

test('validation refuses what would corrupt the pack', async (t) => {
  const base = () => JSON.parse(JSON.stringify(atgarder.items.slice(0, 60)));

  await t.test('duplicate codes fail', () => {
    const items = base();
    items.push(Object.assign({}, items[0]));
    assert.ok(validate({ atgarder: items }).some((p) => /duplicate code/.test(p)));
  });

  await t.test('a broken cross-reference fails', () => {
    const items = base();
    items[0].incompatibleActions = ['404404'];
    assert.ok(validate({ atgarder: items }).some((p) => /unresolvable action reference/.test(p)));
    const withCondition = base();
    withCondition[0].relatedConditions = ['5000'];
    assert.ok(validate({ atgarder: withCondition })
      .some((p) => /unresolvable condition reference/.test(p)));
  });

  await t.test('a non-TLV source url fails', () => {
    const items = base();
    items[0].sourceUrl = 'https://example.com/prices.xlsx';
    assert.ok(validate({ atgarder: items }).some((p) => /non-TLV source url/.test(p)));
  });

  await t.test('a suspiciously small dataset fails rather than shipping', () => {
    assert.ok(validate({ atgarder: base().slice(0, 3) })
      .some((p) => /suspiciously few/.test(p)));
  });

  await t.test('the shipped pack itself validates', () => {
    assert.deepEqual(validate({ atgarder: atgarder.items }), []);
  });
});

test('the build is deterministic', async (t) => {
  await t.test('re-normalising the cached source reproduces the dataset', () => {
    const raw = fs.readFileSync(
      path.join(ROOT, 'scripts', 'kusp', 'raw', 'referenspriser-2026-01-01.xlsx'));
    const again = normalise(raw, { retrievedAt: manifest.retrieved_at });
    assert.equal(again.atgarder.length, atgarder.items.length);
    assert.deepEqual(again.atgarder.map((a) => a.code), atgarder.items.map((a) => a.code));
    assert.deepEqual(again.atgarder[0], atgarder.items[0]);
  });

  await t.test('the spreadsheet reader honours column letters', () => {
    // A blank cell must leave a hole, not shift every later value one column
    // left — that is how a price ends up on the wrong åtgärd.
    const raw = fs.readFileSync(
      path.join(ROOT, 'scripts', 'kusp', 'raw', 'referenspriser-2026-01-01.xlsx'));
    const rows = readSheet(unzip(raw));
    const header = rows.find((r) => /åtgärdsnummer/i.test(r[0] || ''));
    assert.ok(header, 'the header row is found, not assumed by index');
    assert.match(header[2], /allmän/i);
    assert.match(header[3], /specialist/i);
  });
});

test('what the pack must never claim', async (t) => {
  await t.test('every answer is advisory and not a diagnosis', () => {
    const a = kusp.getAction('701');
    assert.equal(a.provenance.notADiagnosis, true);
    assert.equal(a.provenance.advisory, true);
    assert.equal(a.provenance.binding, false, 'the price file is not the binding text');
    assert.equal(a.provenance.regulation, 'HSLF-FS 2025:68');
  });

  await t.test('a reference price is not a patient price or a clinic price', () => {
    const p = kusp.getReferencePrice('101');
    assert.equal(p.kind, 'reference_price');
    assert.equal(p.isPatientPrice, false);
    assert.equal(p.isClinicPrice, false);
    assert.match(p.formatted, /kr/);
  });

  await t.test('no condition is inferred — the absence is stated', () => {
    // TLV publishes no machine-readable tillstånd. Saying so is the correct
    // answer; returning an empty object as if none existed is not.
    const c = kusp.getCondition('4001');
    assert.equal(c.available, false);
    assert.ok(c.reason, 'the reason is given');
    assert.equal(manifest.availability.tillstand.status, 'not_ingested');
  });

  await t.test('no relationship is invented between condition and action', () => {
    const e = kusp.getEligibleActions('4001');
    assert.deepEqual(e.actions, []);
    assert.equal(e.available, false);
    assert.match(e.reason, /fabricat|HTML/i);
    assert.equal(relationships.items.length, 0);
  });

  await t.test('binding regulation is distinguished from explanatory material', () => {
    const r = kusp.getRelatedRules('101');
    assert.equal(r.binding, false, 'nothing binding has been ingested');
    assert.ok(r.reason);
    assert.match(manifest.notices.binding_vs_explanatory, /binding/i);
  });

  await t.test('the routing object is decision support, never a diagnosis', () => {
    const routing = kusp.toRoutingObject({
      urgency: 'soon', careCategory: 'restorative_assessment',
      providerType: 'general_dentist', actionCodes: ['701', '999999'],
    });
    assert.equal(routing.jurisdiction, 'SE');
    assert.equal(routing.notADiagnosis, true);
    assert.equal(routing.decisionSupportOnly, true);
    assert.equal(routing.kusp_candidates.length, 1, 'an unknown code is dropped, not passed through');
    assert.equal(routing.kusp_candidates[0].code, '701');
    assert.equal(routing.kusp_version.regulation, 'HSLF-FS 2025:68');
  });
});

test('search is predictable', async (t) => {
  await t.test('an exact code ranks first', () => {
    const out = kusp.searchKusp('101');
    assert.equal(out.results[0].code, '101');
  });

  await t.test('a Swedish term finds its actions', () => {
    const out = kusp.searchKusp('fyllning');
    assert.ok(out.results.length > 0);
    out.results.forEach((r) => assert.match(r.title.toLowerCase(), /fyllning/));
  });

  await t.test('an empty query returns nothing rather than everything', () => {
    assert.deepEqual(kusp.searchKusp('').results, []);
  });
});

test('the patient runtime never contacts TLV', async (t) => {
  const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const kuspJs = fs.readFileSync(path.join(ROOT, 'kusp.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');

  await t.test('no runtime file references a TLV host', () => {
    for (const [name, src] of [['app.js', appJs], ['kusp.js', kuspJs], ['service-worker.js', sw]]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
      assert.equal(/tlv\.se/.test(code), false, name + ' must not reach TLV at runtime');
    }
  });

  await t.test('the CSP still forbids it', () => {
    const csp = /content="(default-src[^"]*)"/.exec(indexHtml)[1];
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /default-src 'none'/);
    assert.equal(/tlv\.se/.test(csp), false, 'no TLV host is allowlisted');
  });

  await t.test('the source urls in the data point only at TLV', () => {
    const hosts = new Set(manifest.source_urls.map((u) => new URL(u).hostname));
    hosts.forEach((h) => assert.ok(ALLOWED_HOSTS.includes(h), h));
    atgarder.items.forEach((a) => {
      assert.ok(ALLOWED_HOSTS.includes(new URL(a.sourceUrl).hostname), a.code);
    });
  });
});

test('the existing demonstration is untouched', async (t) => {
  const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');

  await t.test('the emergency short-circuit still exists', () => {
    assert.match(appJs, /RED_FLAGS/);
    assert.match(appJs, /emergencyPanel/);
    assert.match(appJs, /role="alert"/);
    assert.match(i18n, /ring 112|Ring 112/);
  });

  await t.test('both languages still load', () => {
    assert.match(i18n, /"sv-SE"/);
    assert.match(i18n, /"en-SE"/);
    assert.match(appJs, /LOCALES = \['sv-SE', 'en-SE'\]/);
  });

  await t.test('the synthetic banner is still there', () => {
    assert.match(i18n, /SYNTETISK DEMONSTRATION/);
  });

  await t.test('the service worker caches the KUSP data explicitly', () => {
    // Enumerated, never wildcarded: the worker may hold exactly these files.
    assert.match(sw, /data\/kusp\/manifest\.json/);
    assert.match(sw, /data\/kusp\/atgarder\.json/);
    assert.match(sw, /kusp\.js/);
    // Comments state the policy; only code can violate it. The worker's comment
    // names kusp.tlv.se precisely to record that it must never be fetched.
    const swCode = sw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    assert.equal(/tlv\.se/.test(swCode), false, 'no executable line may reference TLV');
  });
});
