/**
 * Vanilli OS Sverige — KUSP-frågelagret.
 *
 * SYNTETISK DEMONSTRATION — inga verkliga patientuppgifter.
 *
 * Deterministiska uppslag mot det lokalt byggda KUSP-paketet. Ingen modell,
 * ingen gissning, inget nätverk: patientens webbläsare kontaktar aldrig
 * kusp.tlv.se, och CSP:n (`connect-src 'self'`) gör det omöjligt även om någon
 * försökte.
 *
 * ── DET HÄR ÄR INTE EN DIAGNOS ───────────────────────────────────────────────
 * KUSP är stöd för att TILLÄMPA reglerna om statligt tandvårdsstöd. Det avgör
 * aldrig vilket tillstånd en patient har — det gör en legitimerad tandläkare.
 * Varje svar härifrån bär därför `advisory: true` och en uttrycklig
 * `notADiagnosis`-flagga, och lagret exponerar medvetet ingen funktion som
 * "väljer tillstånd åt patienten".
 *
 * ── REFERENSPRIS ÄR INTE PATIENTENS PRIS ─────────────────────────────────────
 * Referenspriset är grunden för att räkna ut det statliga stödet. Det är inte
 * klinikens pris och inte vad patienten betalar. De tre begreppen hålls isär i
 * både API:et och texten.
 */

/* eslint-disable no-restricted-globals */

const DATA_PATHS = Object.freeze({
  manifest: './data/kusp/manifest.json',
  atgarder: './data/kusp/atgarder.json',
  tillstand: './data/kusp/tillstand.json',
  relationships: './data/kusp/relationships.json',
  rules: './data/kusp/rules.json',
});

const state = {
  loaded: false,
  manifest: null,
  atgarder: [],
  byCode: new Map(),
  tillstand: [],
  relationships: [],
  rules: [],
};

/**
 * Ladda paketet en gång. Samma ursprung, statiska filer, inget annat.
 * Anropas av appen vid start; frågefunktionerna kräver att den körts.
 */
export async function loadKusp(fetchImpl = fetch) {
  if (state.loaded) return getKuspVersion();
  const read = async (p) => {
    const res = await fetchImpl(p);
    if (!res.ok) throw new Error('kusp_dataset_unavailable:' + p);
    return res.json();
  };
  const [manifest, atgarder, tillstand, relationships, rules] = await Promise.all([
    read(DATA_PATHS.manifest), read(DATA_PATHS.atgarder), read(DATA_PATHS.tillstand),
    read(DATA_PATHS.relationships), read(DATA_PATHS.rules),
  ]);
  hydrate({ manifest, atgarder, tillstand, relationships, rules });
  return getKuspVersion();
}

/** Samma laddning, men från redan lästa objekt — används av testerna. */
export function hydrate({ manifest, atgarder, tillstand, relationships, rules }) {
  state.manifest = manifest;
  state.atgarder = (atgarder && atgarder.items) || [];
  state.tillstand = (tillstand && tillstand.items) || [];
  state.relationships = (relationships && relationships.items) || [];
  state.rules = (rules && rules.items) || [];
  state.byCode = new Map(state.atgarder.map((a) => [a.code, a]));
  state.loaded = true;
  return getKuspVersion();
}

function requireLoaded() {
  if (!state.loaded) throw new Error('kusp_not_loaded');
}

/** Gemensam proveniens på varje svar. Utan källa är ett svar inte användbart. */
function provenance(extra = {}) {
  const m = state.manifest || {};
  return Object.assign({
    source: m.source || 'TLV',
    dataset: m.dataset || 'KUSP',
    regulation: m.regulation || null,
    effectiveFrom: m.effective_from || null,
    effectiveTo: m.effective_to || null,
    retrievedAt: m.retrieved_at || null,
    schemaVersion: m.schema_version || null,
    // Bindande föreskrift kontra förklarande stödmaterial hålls isär.
    binding: false,
    advisory: true,
    notADiagnosis: true,
  }, extra);
}

export function getKuspVersion() {
  requireLoaded();
  const m = state.manifest;
  return {
    regulation: m.regulation,
    regulationTitle: m.regulationTitle,
    effectiveFrom: m.effective_from,
    effectiveTo: m.effective_to,
    supersededBy: m.supersededBy || null,
    retrievedAt: m.retrieved_at,
    generatedAt: m.generated_at,
    schemaVersion: m.schema_version,
    counts: m.counts,
    availability: m.availability,
    sourceUrls: m.source_urls,
  };
}

/**
 * Slå upp en åtgärd.
 *
 * Okänd kod ger `null` — aldrig en gissning, aldrig närmaste träff. En felaktig
 * åtgärdskod som ser rätt ut är värre än inget svar alls.
 */
export function getAction(code) {
  requireLoaded();
  const key = String(code || '').trim();
  const item = state.byCode.get(key);
  if (!item) return null;
  return {
    type: 'action',
    code: item.code,
    title: item.title,
    series: item.series,
    seriesTitle: item.seriesTitle,
    referencePrice: priceView(item.referencePriceOre),
    specialistReferencePrice: priceView(item.specialistReferencePriceOre),
    relatedConditions: item.relatedConditions,
    relatedRules: item.relatedRules,
    handbookRefs: item.handbookRefs,
    questionRefs: item.questionRefs,
    sourceUrl: item.sourceUrl,
    provenance: provenance({ sourceUrl: item.sourceUrl }),
  };
}

/** Öre in, tre representationer ut — så ingen råkar visa öre som kronor. */
function priceView(ore) {
  if (ore === null || ore === undefined) return null;
  return {
    ore,
    sek: ore / 100,
    formatted: new Intl.NumberFormat('sv-SE',
      { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }).format(ore / 100),
    kind: 'reference_price',
    isPatientPrice: false,
    isClinicPrice: false,
  };
}

export function getReferencePrice(code, { specialist = false } = {}) {
  const action = getAction(code);
  if (!action) return null;
  return specialist ? action.specialistReferencePrice : action.referencePrice;
}

/**
 * Slå upp ett tillstånd.
 *
 * TLV publicerar inga maskinläsbara tillstånd, så den här funktionen svarar
 * ärligt: `{ available: false }` med skälet, i stället för tomt eller påhittat.
 */
export function getCondition(code) {
  requireLoaded();
  const item = state.tillstand.find((t) => t.code === String(code || '').trim());
  if (item) return Object.assign({ type: 'condition' }, item, { provenance: provenance() });
  const availability = (state.manifest.availability || {}).tillstand || {};
  return {
    type: 'condition',
    code: String(code || '').trim(),
    available: false,
    reason: availability.reason || 'not_ingested',
    provenance: provenance(),
  };
}

/**
 * Åtgärder som kan vara aktuella för ett tillstånd.
 *
 * Relationen tillstånd↔åtgärd finns bara som HTML hos TLV och är därför inte
 * ingestad. Att härleda den ur sidor som nämner samma ord vore att uppfinna ett
 * kliniskt samband — så funktionen returnerar en tom lista OCH säger varför.
 */
export function getEligibleActions(conditionCode) {
  requireLoaded();
  const links = state.relationships.filter((r) => r.conditionCode === String(conditionCode || '').trim());
  const availability = (state.manifest.availability || {}).relationships || {};
  return {
    conditionCode: String(conditionCode || '').trim(),
    actions: links.map((r) => getAction(r.actionCode)).filter(Boolean),
    complete: links.length > 0,
    available: availability.status === 'ingested',
    reason: availability.status === 'ingested' ? null : availability.reason,
    provenance: provenance(),
  };
}

export function getRelatedRules(code) {
  requireLoaded();
  const action = state.byCode.get(String(code || '').trim());
  const refs = action ? action.relatedRules : [];
  const availability = (state.manifest.availability || {}).rules || {};
  return {
    code: String(code || '').trim(),
    rules: refs.map((id) => state.rules.find((r) => r.id === id)).filter(Boolean),
    available: availability.status === 'ingested',
    reason: availability.status === 'ingested' ? null : availability.reason,
    // Föreskriften är bindande; handbok och KUSP-text är förklarande.
    binding: availability.status === 'ingested',
    provenance: provenance({ binding: availability.status === 'ingested' }),
  };
}

/**
 * Fritextsökning över åtgärdskoder och -namn.
 *
 * Enkel och förutsägbar: exakt kod först, sedan prefix, sedan delsträng. Ingen
 * rangordning som ändrar sig, ingen "menade du" — en sökning som gissar är en
 * sökning man inte kan lita på i ett regelverk.
 */
export function searchKusp(query, { limit = 20 } = {}) {
  requireLoaded();
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { query: '', results: [], provenance: provenance() };

  const exact = [];
  const prefix = [];
  const contains = [];
  for (const a of state.atgarder) {
    const code = a.code.toLowerCase();
    const title = a.title.toLowerCase();
    if (code === q) exact.push(a);
    else if (code.startsWith(q) || title.startsWith(q)) prefix.push(a);
    else if (title.includes(q)) contains.push(a);
  }
  const ordered = exact.concat(prefix, contains).slice(0, limit);
  return {
    query: q,
    results: ordered.map((a) => getAction(a.code)),
    truncated: exact.length + prefix.length + contains.length > limit,
    provenance: provenance(),
  };
}

/**
 * Projektion för den framtida svenska schemaläggaren.
 *
 * Detta är ett SCHEMALÄGGNINGSUNDERLAG, inte en diagnos. `kuspCandidates` är
 * "material som kan vara relevant att titta på", inget annat — och objektet
 * bär den flaggan så att ingen konsument kan missförstå det.
 */
export function toRoutingObject({ urgency, careCategory, providerType, actionCodes = [] }) {
  requireLoaded();
  return {
    jurisdiction: 'SE',
    urgency: urgency || null,
    care_category: careCategory || null,
    provider_type: providerType || 'general_dentist',
    kusp_candidates: actionCodes
      .map((code) => getAction(code))
      .filter(Boolean)
      .map((a) => ({ type: 'action', code: a.code, title: a.title })),
    kusp_version: {
      regulation: state.manifest.regulation,
      effectiveFrom: state.manifest.effective_from,
    },
    // Sagt rakt ut, i objektet självt, eftersom det kommer att läsas av kod
    // som ingen av oss har skrivit ännu.
    notADiagnosis: true,
    decisionSupportOnly: true,
  };
}

export const KUSP_DATA_PATHS = DATA_PATHS;
