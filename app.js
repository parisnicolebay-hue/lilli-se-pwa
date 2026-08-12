'use strict';

/* Lilli Sweden — standalone synthetic demonstration.
 *
 * SYNTETISK DEMONSTRATION — inga verkliga patientuppgifter.
 *
 * The scripted patient conversation, running entirely in the browser. The
 * wording, the choice-only answers, the safety short-circuit, and the visual
 * identity mirror the real Lilli Sweden app. What is deliberately ABSENT is
 * any transmission: no API, no backend, no analytics. "Sending" a request is
 * simulated locally and produces an unmistakably synthetic reference.
 *
 * Nothing here asks for or stores a name, personnummer, phone number, email,
 * photograph, or any other real patient information — the contact steps of
 * the real flow are intentionally not part of the demo.
 */

(function () {
  const STORE_KEY = 'lilliSeDemo.v1';
  const LOCALES = ['sv-SE', 'en-SE'];

  /* ── State ──────────────────────────────────────────────────────────────── */

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return LOCALES.indexOf(parsed.locale) === -1 ? null : parsed;
    } catch (err) { return null; }
  }

  const state = load() || {
    locale: 'sv-SE',
    view: 'conversation',       // conversation | status
    journey: null,              // in-flight scripted journey
    completed: null,            // { reference, timeCritical, urgent }
    refCounter: 0,              // TEST-PERSON-001, -002, …
  };
  state.view = state.view === 'status' ? 'status' : 'conversation';

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (err) { /* full/blocked: demo continues in memory */ }
  }

  function t(key, params) {
    const bundle = I18N[state.locale] || I18N['sv-SE'];
    let msg = bundle[key];
    if (msg === undefined) msg = I18N['sv-SE'][key];
    if (msg === undefined) return key;
    if (params) {
      Object.keys(params).forEach(function (p) {
        msg = msg.replace('{' + p + '}', String(params[p]));
      });
    }
    return msg;
  }

  /* ── The scripted flow ──────────────────────────────────────────────────── */

  const RED_FLAGS = ['breathing', 'swallowing', 'spreadingSwelling', 'swellingNearEye',
    'highFever', 'uncontrolledBleeding', 'severeTrauma', 'feelsSeriouslyIll',
    'chestPain', 'strokeSigns', 'severeAllergicReaction'];
  // These three are medical, not dental: they get the harder "ring 112 nu" turn.
  const MEDICAL_112 = ['chestPain', 'strokeSigns', 'severeAllergicReaction'];

  const opts = function (prefix, values) {
    return values.map(function (v) { return { v: v, label: prefix + '.' + v }; });
  };

  const STEPS = {
    concern: {
      ask: 'lilli.conv.ask.concern', kind: 'choice',
      options: opts('intake.concern', ['pain', 'broken_tooth', 'swelling', 'checkup', 'other']),
      next: function () { return 'redflags'; },
    },
    redflags: {
      ask: 'lilli.conv.ask.redflags', kind: 'multi',
      options: opts('lilli.conv.redFlag', RED_FLAGS),
      noneLabel: 'lilli.conv.redFlagNone',
      next: function (a) {
        if (a.redflags.length) return 'EMERGENCY';
        return { pain: 'pain_area', broken_tooth: 'trauma_type', swelling: 'swelling_location' }[a.concern] || 'urgency';
      },
    },
    pain_area: {
      ask: 'lilli.conv.ask.pain_area', kind: 'choice',
      options: opts('lilli.conv.painArea', ['tooth', 'gums', 'jaw', 'whole_mouth', 'not_sure']),
      next: function (a) { return a.pain_area === 'tooth' ? 'tooth_region' : 'pain_character'; },
    },
    tooth_region: {
      ask: 'lilli.conv.ask.pain_tooth_region', kind: 'choice',
      options: opts('lilli.conv.toothRegion', ['front', 'canine', 'premolar', 'molar', 'wisdom', 'not_sure']),
      next: function () { return 'pain_character'; },
    },
    pain_character: {
      ask: 'lilli.conv.ask.pain_character', kind: 'multi',
      options: opts('lilli.conv.painCharacter', ['dull_ache', 'sharp', 'throbbing', 'pressure', 'burning', 'sensitivity']),
      noneLabel: 'lilli.conv.action.none',
      next: function () { return 'pain_duration'; },
    },
    pain_duration: {
      ask: 'lilli.conv.ask.pain_duration', kind: 'choice',
      options: opts('lilli.conv.painDuration', ['today', 'one_two_days', 'three_seven_days', 'over_a_week', 'over_a_month']),
      next: function () { return 'pain_level'; },
    },
    pain_level: {
      ask: 'lilli.conv.ask.pain_level', kind: 'scale',
      next: function () { return 'swelling_present'; },
    },
    swelling_present: {
      ask: 'lilli.conv.ask.swelling_present', kind: 'choice',
      options: [{ v: 'yes', label: 'lilli.conv.yes' }, { v: 'no', label: 'lilli.conv.no' }],
      next: function (a) { return a.swelling_present === 'yes' ? 'swelling_location' : 'urgency'; },
    },
    swelling_location: {
      ask: 'lilli.conv.ask.swelling_location', kind: 'choice',
      options: opts('lilli.conv.swellingLocation', ['gum', 'cheek', 'jaw', 'under_chin', 'neck', 'not_sure']),
      next: function () { return 'fever'; },
    },
    fever: {
      ask: 'lilli.conv.ask.fever', kind: 'choice',
      options: [{ v: 'yes', label: 'lilli.conv.yes' }, { v: 'no', label: 'lilli.conv.no' }],
      next: function () { return 'urgency'; },
    },
    trauma_type: {
      ask: 'lilli.conv.ask.trauma_type', kind: 'choice',
      options: opts('lilli.conv.traumaType', ['knocked_out', 'loose', 'chipped', 'cracked', 'other_damage']),
      next: function (a) { return a.trauma_type === 'knocked_out' ? 'avulsion_tooth_type' : 'pain_duration'; },
    },
    avulsion_tooth_type: {
      ask: 'lilli.conv.ask.avulsion_tooth_type', kind: 'choice',
      options: opts('lilli.conv.toothType', ['permanent', 'primary', 'not_sure']),
      next: function () { return 'guidance'; },
    },
    guidance: {
      ask: 'lilli.conv.ask.avulsion_guidance', kind: 'guidance',
      next: function () { return 'urgency'; },
    },
    urgency: {
      ask: 'lilli.conv.ask.urgency', kind: 'choice',
      options: opts('intake.urgency', ['same_day', 'soon', 'routine']),
      next: function () { return 'timing'; },
    },
    timing: {
      ask: 'lilli.conv.ask.timing', kind: 'choice',
      options: opts('intake.preferredTiming', ['morning', 'afternoon', 'evening', 'any']),
      next: function () { return 'openings'; },
    },
    openings: {
      ask: 'lilli.conv.ask.openings', kind: 'openings',
      next: function () { return 'review'; },
    },
    review: { ask: 'lilli.conv.ask.review', kind: 'review' },
  };

  // Synthetic published openings, shown as information only.
  const OPENINGS = [
    { date: '2026-08-14', time: '09:40' },
    { date: '2026-08-14', time: '14:20' },
    { date: '2026-08-17', time: '11:00' },
  ];

  function newJourney() {
    return {
      stepId: 'concern',
      answers: {},
      transcript: [{ who: 'lilli', keys: ['lilli.conv.ask.welcome'] }],
      history: [],
      multi: [],
      emergency: null,          // { reasons: [...] } — the hard stop
      timeCritical: false,
      guidanceKey: null,
      questionCount: 1,
      requestId: null,
      reference: null,
      simulateOffline: false,
      failedOnce: false,
      sending: false,
      offline: false,
      resumed: false,
    };
  }

  function urgentDisposition(a) {
    if (a.fever === 'yes') return true;
    if (typeof a.pain_level === 'number' && a.pain_level >= 7) return true;
    return a.urgency === 'same_day';
  }

  /* ── Answer handling ────────────────────────────────────────────────────── */

  function snapshot(j) {
    j.history.push(JSON.stringify({
      stepId: j.stepId, answers: j.answers, transcript: j.transcript,
      multi: j.multi, timeCritical: j.timeCritical, guidanceKey: j.guidanceKey,
      questionCount: j.questionCount,
    }));
  }

  function goBack() {
    const j = state.journey;
    if (!j || j.sending) return;
    const prev = j.history.pop();
    if (!prev) { restart(); return; }
    const s = JSON.parse(prev);
    j.stepId = s.stepId; j.answers = s.answers; j.transcript = s.transcript;
    j.multi = s.multi; j.timeCritical = s.timeCritical; j.guidanceKey = s.guidanceKey;
    j.questionCount = s.questionCount;
    j.emergency = null; j.requestId = null; j.reference = null;
    j.offline = false; j.failedOnce = false; j.simulateOffline = false;
    save(); render();
  }

  function restart() {
    state.journey = null;
    state.view = 'conversation';
    save(); render();
  }

  function advance(patientEntry, answerKey, answerValue) {
    const j = state.journey;
    const step = STEPS[j.stepId];
    snapshot(j);
    if (patientEntry) j.transcript.push(patientEntry);
    if (answerKey) j.answers[answerKey] = answerValue;
    j.multi = [];

    const nextId = step.next(j.answers);
    if (nextId === 'EMERGENCY') {
      j.emergency = { reasons: j.answers.redflags.slice() };
      j.transcript.push({ who: 'emergency', keys: ['lilli.conv.emergency.heading'] });
    } else {
      if (j.stepId === 'guidance') j.timeCritical = true;
      j.stepId = nextId;
      j.questionCount += 1;
      j.transcript.push({ who: 'lilli', keys: [STEPS[nextId].ask] });
      if (nextId === 'review') {
        // The request identity is minted ONCE, before any send attempt, and
        // the synthetic reference is reserved with it — this is what makes
        // the simulated retry idempotent.
        if (!j.requestId) {
          state.refCounter += 1;
          j.requestId = 'demo-' + state.refCounter;
          j.reference = 'TEST-PERSON-' + String(state.refCounter).padStart(3, '0');
        }
      }
    }
    save(); render(); scrollToLatest();
  }

  function answerChoice(step, value, labelKey) {
    advance({ who: 'patient', keys: [labelKey] }, step === 'redflags' ? null : step, value);
  }

  function submit() {
    const j = state.journey;
    if (j.sending || state.completed && state.completed.requestId === j.requestId) return;
    j.sending = true; j.offline = false;
    save(); render();
    setTimeout(function () {
      j.sending = false;
      if (j.simulateOffline && !j.failedOnce) {
        // The simulated network drop: the attempt dies, the answers stay,
        // and the reserved reference waits for the retry.
        j.failedOnce = true;
        j.offline = true;
        save(); render();
        return;
      }
      state.completed = {
        requestId: j.requestId,
        reference: j.reference,
        timeCritical: j.timeCritical,
        urgent: urgentDisposition(j.answers),
        retried: j.failedOnce,
      };
      state.journey = null;
      save(); render(); scrollToLatest();
    }, 600);
  }

  /* ── Rendering ──────────────────────────────────────────────────────────── */

  const app = document.getElementById('app');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function bubble(entry) {
    if (entry.who === 'emergency') return '';
    const who = entry.who === 'patient' ? t('lilli.conv.you') : t('lilli.conv.lilli');
    const text = entry.text !== undefined ? entry.text
      : entry.keys.map(function (k) { return t(k); }).join(', ');
    return '<li class="lilli-msg lilli-msg--' + entry.who + '">' +
      '<span class="lilli-msg__who">' + esc(who) + '</span>' +
      '<span class="lilli-msg__bubble">' + esc(text) + '</span></li>';
  }

  function choiceButtons(step, def) {
    return '<ul class="lilli-choices">' + def.options.map(function (o) {
      const on = def.kind === 'multi' && state.journey.multi.indexOf(o.v) !== -1;
      return '<li><button type="button" class="lilli-choice' + (on ? ' lilli-choice--on' : '') + '"' +
        ' data-choice="' + esc(o.v) + '" data-label="' + esc(o.label) + '"' +
        (def.kind === 'multi' ? ' aria-pressed="' + on + '"' : '') + '>' +
        esc(t(o.label)) + '</button></li>';
    }).join('') + '</ul>';
  }

  function emergencyPanel(em) {
    const medical = em.reasons.some(function (r) { return MEDICAL_112.indexOf(r) !== -1; });
    const heading = medical ? t('lilli.conv.emergency.medicalHeading') : t('lilli.conv.emergency.heading');
    const body = medical ? t('lilli.conv.emergency.medicalBody') : t('lilli.conv.emergency.body');
    const reasons = em.reasons.map(function (r) {
      return '<p class="lilli-guidance__seek">' + esc(t('lilli.conv.emergency.reason.' + r)) + '</p>';
    }).join('');
    const bleeding = em.reasons.indexOf('uncontrolledBleeding') !== -1
      ? '<p class="lilli-guidance__seek">' + esc(t('lilli.conv.emergency.firstAidBleeding')) + '</p>' : '';
    return '<li class="lilli-msg lilli-msg--emergency lilli-msg--full">' +
      '<div class="lilli-msg__bubble" role="alert">' +
      '<strong>' + esc(heading) + '</strong>\n\n' + esc(body) + '</div></li>' +
      '<li class="lilli-msg lilli-msg--full"><div class="lilli-msg__bubble">' +
      reasons + bleeding +
      '<p class="lilli-note">' + esc(t('lilli.conv.emergency.noCallPlaced')) +
      (medical ? ' ' + esc(t('lilli.conv.emergency.medicalSource')) : '') + '</p></div></li>';
  }

  function guidancePanel(a) {
    const kind = a.avulsion_tooth_type || 'not_sure';
    return '<div class="lilli-guidance" role="alert">' +
      '<p class="lilli-guidance__badge">' + esc(t('lilli.conv.timeCritical.badge')) + '</p>' +
      '<h2 class="lilli-guidance__heading">' + esc(t('lilli.conv.guidance.heading')) + '</h2>' +
      '<p class="lilli-guidance__do">' + esc(t('lilli.conv.guidance.' + kind)) + '</p>' +
      '<p class="lilli-guidance__speed">' + esc(t('lilli.conv.guidance.speed')) + '</p>' +
      '<p class="lilli-guidance__seek">' + esc(t('lilli.conv.guidance.seekCare')) + '</p>' +
      '<p class="lilli-guidance__seek">' + esc(t('lilli.conv.guidance.notEmergencyNumber')) + '</p>' +
      '<p class="lilli-guidance__source">' + esc(t('lilli.conv.guidance.source')) + '</p>' +
      '</div>';
  }

  function reviewPanel(j) {
    const a = j.answers;
    const row = function (labelKey, value, critical) {
      return '<div class="lilli-review__row' + (critical ? ' lilli-review__row--critical' : '') + '">' +
        '<dt>' + esc(t(labelKey)) + '</dt><dd>' + esc(value) + '</dd></div>';
    };
    let rows = '';
    if (j.timeCritical) rows += row('lilli.conv.review.heading', t('lilli.conv.timeCritical.reviewLine'), true);
    rows += row('lilli.conv.review.concern', t('intake.concern.' + a.concern));
    if (a.pain_character && a.pain_character.length) {
      rows += row('lilli.conv.review.symptoms', a.pain_character.map(function (v) {
        return t('lilli.conv.painCharacter.' + v);
      }).join(', ') + (typeof a.pain_level === 'number' ? ' · ' + a.pain_level + '/10' : ''));
    }
    rows += row('lilli.conv.review.urgency', t('intake.urgency.' + a.urgency));
    rows += row('lilli.conv.review.timing', t('intake.preferredTiming.' + a.timing));
    rows += row('lilli.conv.review.contact', t('lilli.conv.review.contactWithheld'));
    return '<dl class="lilli-review">' + rows + '</dl>' +
      '<p class="lilli-note">' + esc(t('lilli.conv.review.noPersonalData')) + '</p>';
  }

  function offlinePanel() {
    return '<div class="app-offline" role="alert">' +
      '<p>' + esc(t('lilli.app.offline')) + '</p>' +
      '<p class="lilli-note">' + esc(t('demo.offlineNote')) + '</p>' +
      '<div class="lilli-actions"><button type="button" class="lilli-btn" data-act="retry">' +
      esc(t('lilli.app.retry')) + '</button></div></div>';
  }

  function donePanel(c) {
    const disposition = c.timeCritical ? 'lilli.conv.timeCritical.closing'
      : (c.urgent ? 'lilli.conv.disposition.urgent' : 'lilli.conv.disposition.routine');
    return '<div class="lilli-done">' +
      '<h2>' + esc(t('lilli.doneHeading')) + '</h2>' +
      '<p>' + esc(t(disposition)) + '</p>' +
      '<p class="lilli-note">' + esc(t('lilli.conv.done.notBooked')) + '</p>' +
      '<p>' + esc(t('lilli.conv.done.reference')) + '</p>' +
      '<span class="lilli__reference">' + esc(c.reference) + '</span>' +
      '<p class="lilli-note">' + esc(t('lilli.conv.done.referenceNote')) + '</p>' +
      '<div class="lilli-actions">' +
      '<button type="button" class="lilli-btn" data-act="status">' + esc(t('lilli.conv.status.heading')) + '</button>' +
      '<button type="button" class="lilli-btn lilli-btn--quiet" data-act="start">' + esc(t('lilli.startOver')) + '</button>' +
      '</div></div>';
  }

  function statusView() {
    const c = state.completed;
    let body;
    if (!c) {
      body = '<p class="app-status__line">' + esc(t('lilli.conv.status.none')) + '</p>';
    } else {
      body = '<p class="app-status__line">' + esc(t('lilli.conv.status.received')) + '</p>' +
        '<p>' + esc(t('lilli.conv.done.reference')) + '</p>' +
        '<span class="lilli__reference">' + esc(c.reference) + '</span>' +
        '<p class="lilli-note">' + esc(t('lilli.conv.done.notBooked')) + '</p>';
    }
    return '<div class="app-status"><h2 class="app-status__heading">' + esc(t('lilli.conv.status.heading')) + '</h2>' +
      body +
      '<div class="lilli-actions"><button type="button" class="lilli-btn lilli-btn--quiet" data-act="home">' +
      esc(t('lilli.app.back')) + '</button></div></div>';
  }

  function composer() {
    const j = state.journey;
    const step = STEPS[j.stepId];
    let inner = '';
    let actions = '';

    if (j.emergency) {
      actions = '<button type="button" class="lilli-btn" data-act="restart">' +
        esc(t('lilli.conv.action.restart')) + '</button>';
      return '<div class="lilli-composer"><div class="lilli-actions">' + actions + '</div></div>';
    }

    if (step.kind === 'choice') {
      inner = choiceButtons(j.stepId, step);
    } else if (step.kind === 'multi') {
      inner = choiceButtons(j.stepId, step) +
        '<div class="lilli-actions">' +
        '<button type="button" class="lilli-btn lilli-btn--quiet" data-act="none">' + esc(t(step.noneLabel)) + '</button>' +
        '<button type="button" class="lilli-btn" data-act="multi-next"' + (j.multi.length ? '' : ' disabled') + '>' +
        esc(t('lilli.conv.action.next')) + '</button></div>';
    } else if (step.kind === 'scale') {
      inner = '<ul class="lilli-scale">' + Array.from({ length: 11 }, function (_, n) {
        return '<li><button type="button" class="lilli-scale__n" data-scale="' + n + '">' + n + '</button></li>';
      }).join('') + '</ul>';
    } else if (step.kind === 'guidance') {
      inner = guidancePanel(j.answers) +
        '<div class="lilli-actions"><button type="button" class="lilli-btn" data-act="ack">' +
        esc(t('lilli.conv.guidance.acknowledge')) + '</button></div>';
    } else if (step.kind === 'openings') {
      inner = '<ul class="lilli__openings">' + OPENINGS.map(function (o) {
        return '<li class="lilli__opening">' + esc(o.date + ' · ' + o.time) + '</li>';
      }).join('') + '</ul>' +
        '<p class="lilli-note">' + esc(t('lilli.conv.openings.notSelectable')) + '</p>' +
        '<div class="lilli-actions"><button type="button" class="lilli-btn" data-act="openings-next">' +
        esc(t('lilli.conv.action.next')) + '</button></div>';
    } else if (step.kind === 'review') {
      inner = reviewPanel(j) +
        (j.offline ? offlinePanel() : '') +
        '<div class="lilli-actions">' +
        '<button type="button" class="lilli-btn" data-act="send"' + (j.sending || j.offline ? ' disabled' : '') + '>' +
        esc(j.sending ? t('lilli.conv.action.sending') : t('lilli.conv.action.send')) + '</button>' +
        '<button type="button" class="lilli-choice lilli-demo-toggle' + (j.simulateOffline ? ' lilli-choice--on' : '') + '"' +
        ' data-act="toggle-offline" aria-pressed="' + j.simulateOffline + '">' +
        esc(t('demo.simulateOffline')) + '</button>' +
        '</div>';
    }

    return '<div class="lilli-composer">' + inner + '</div>' +
      '<div class="lilli-nav">' +
      '<button type="button" class="lilli-btn lilli-btn--quiet" data-act="back">' + esc(t('lilli.conv.action.back')) + '</button>' +
      '<button type="button" class="lilli-btn lilli-btn--quiet" data-act="restart">' + esc(t('lilli.conv.action.restart')) + '</button>' +
      '</div>';
  }

  function conversationView() {
    const j = state.journey;
    if (!j) {
      const c = state.completed;
      const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
      return '<div class="app-brand"><h1 class="app-brand__name" tabindex="-1">' + esc(t('lilli.appName')) + '</h1>' +
        '<p class="lilli-head__office">' + esc(t('demo.office')) + '</p></div>' +
        '<ol class="lilli-transcript">' +
        bubble({ who: 'lilli', keys: ['lilli.conv.greeting'] }) +
        bubble({ who: 'lilli', text: t('lilli.conv.greetingSub') }) +
        bubble({ who: 'lilli', text: t('lilli.conv.notADentist') }) +
        bubble({ who: 'lilli', text: t('lilli.conv.emergencyUpfront') }) +
        '</ol>' +
        (c ? donePanel(c) :
          '<div class="lilli-actions">' +
          '<button type="button" class="lilli-btn app-menu__primary" data-act="start">' + esc(t('lilli.conv.startButton')) + '</button>' +
          '<button type="button" class="lilli-btn lilli-btn--quiet" data-act="status">' + esc(t('lilli.app.status')) + '</button>' +
          '</div>') +
        (!standalone
          ? '<div class="app-install"><p>' + esc(t('lilli.app.install')) +
            ' <span class="app-install--note">' + esc(t('lilli.app.installIos')) + '</span></p></div>'
          : '');
    }

    return '<div class="lilli-head"><p class="lilli-head__name">' + esc(t('lilli.appName')) + '</p>' +
      '<p class="lilli-head__office">' + esc(t('demo.office')) + '</p></div>' +
      (j.resumed ? '<p class="lilli-note">' + esc(t('demo.resumed')) + '</p>' : '') +
      (j.emergency ? '' :
        '<p class="lilli__progress">' + esc(t('lilli.conv.progress', { current: j.questionCount })) + '</p>') +
      '<ol class="lilli-transcript" aria-live="polite">' +
      j.transcript.map(bubble).join('') +
      (j.emergency ? emergencyPanel(j.emergency) : '') +
      '</ol>' +
      composer();
  }

  function render() {
    const banner = '<p class="lilli__banner">' + esc(t('lilli.syntheticBanner')) + '</p>';
    const body = state.view === 'status' ? statusView() : conversationView();
    const foot =
      '<div class="lilli__disclaimers">' +
      '<p>' + esc(t('lilli.conv.notADentist')) + '</p>' +
      '<p>' + esc(t('lilli.noPersonalData')) + '</p>' +
      '<p>' + esc(t('demo.about')) + '</p></div>' +
      '<div class="lilli-locale"><label for="locale">' + esc(t('lilli.language')) + '</label>' +
      '<select id="locale" class="lilli-locale__select">' +
      LOCALES.map(function (l) {
        return '<option value="' + l + '"' + (l === state.locale ? ' selected' : '') + '>' +
          (l === 'sv-SE' ? 'Svenska' : 'English') + '</option>';
      }).join('') + '</select></div>';
    app.innerHTML = banner + body + foot;
    document.documentElement.lang = state.locale === 'sv-SE' ? 'sv' : 'en';
  }

  function scrollToLatest() {
    const items = app.querySelectorAll('.lilli-transcript > li');
    if (items.length) items[items.length - 1].scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /* ── Events ─────────────────────────────────────────────────────────────── */

  app.addEventListener('click', function (ev) {
    const btn = ev.target.closest('button');
    if (!btn) return;
    const j = state.journey;
    const act = btn.getAttribute('data-act');

    if (act === 'start') {
      state.journey = newJourney();
      state.view = 'conversation'; state.completed = null;
      save(); render(); scrollToLatest(); return;
    }
    if (act === 'status') { state.view = 'status'; save(); render(); return; }
    if (act === 'home') { state.view = 'conversation'; save(); render(); return; }
    if (act === 'restart') { restart(); return; }
    if (act === 'back') { goBack(); return; }
    if (!j) return;

    const step = STEPS[j.stepId];

    if (btn.hasAttribute('data-scale')) {
      const n = Number(btn.getAttribute('data-scale'));
      advance({ who: 'patient', text: String(n) }, 'pain_level', n); return;
    }
    if (btn.hasAttribute('data-choice')) {
      const v = btn.getAttribute('data-choice');
      if (step.kind === 'multi') {
        const i = j.multi.indexOf(v);
        if (i === -1) j.multi.push(v); else j.multi.splice(i, 1);
        save(); render(); return;
      }
      answerChoice(j.stepId, v, btn.getAttribute('data-label')); return;
    }
    if (act === 'none') {
      advance({ who: 'patient', keys: [step.noneLabel] }, j.stepId === 'redflags' ? 'redflags' : j.stepId,
        []); return;
    }
    if (act === 'multi-next') {
      const selected = j.multi.slice();
      advance({ who: 'patient', keys: selected.map(function (v) { return step.options.filter(function (o) { return o.v === v; })[0].label; }) },
        j.stepId, selected); return;
    }
    if (act === 'ack') {
      advance({ who: 'patient', keys: ['lilli.conv.guidance.acknowledge'] }, null, null); return;
    }
    if (act === 'openings-next') {
      advance({ who: 'patient', keys: ['lilli.conv.action.next'] }, null, null); return;
    }
    if (act === 'toggle-offline') {
      j.simulateOffline = !j.simulateOffline; save(); render(); return;
    }
    if (act === 'send' || act === 'retry') { submit(); return; }
  });

  app.addEventListener('change', function (ev) {
    if (ev.target && ev.target.id === 'locale') {
      state.locale = ev.target.value;
      save(); render();
    }
  });

  /* ── Boot ───────────────────────────────────────────────────────────────── */

  if (state.journey && !state.journey.sending) {
    // An interrupted journey greets the patient where they left off.
    state.journey.resumed = true;
  } else if (state.journey && state.journey.sending) {
    state.journey.sending = false;
  }
  render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(function () {
      // Local file preview has no service worker; the demo still runs.
    });
  }
})();
