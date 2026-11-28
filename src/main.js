import {
  AGE_COEF,
  BIOMARKERS,
  MODEL_CONSTANTS,
  PRESETS,
  calculatePhenoAge,
  computeTornadoLeverage,
  computeWhatIfOptimizer,
  formatBiomarkerValue,
  generateDoctorSummaryMarkdown,
  generateSurvivalCurve,
  getBiomarkerStatus,
  getBiomarkerUnit,
} from './model/phenoage.js';
import nhanesValidation from './data/nhanes_validation_results.json';

const state = {
  unitSystem: 'SI', // 'SI' or 'US'
  activePreset: 'average',
  targetDropYears: 3,
  previousInputsForUndo: null,
  inputs: { ...PRESETS.average.values },
};

// Smooth gauge animation state
const gaugeAnim = {
  currentPhenoAge: null,
  targetPhenoAge: null,
  rafId: null,
};

// DOM References
const presetGridEl = document.getElementById('preset-grid');
const bioageGaugeEl = document.getElementById('bioage-gauge');
const biomarkersListEl = document.getElementById('biomarkers-list');
const tornadoChartEl = document.getElementById('tornado-chart');
const tornadoTotalPillEl = document.getElementById('tornado-total-pill');
const survivalChartEl = document.getElementById('survival-chart');
const coefTableBodyEl = document.getElementById('coef-table-body');

const optimizerHeadingEl = document.getElementById('optimizer-heading');
const optimizerSummaryEl = document.getElementById('optimizer-summary');
const optimizerShiftsEl = document.getElementById('optimizer-shifts');
const btnApplyOptimizer = document.getElementById('btn-apply-optimizer');
const btnUndoOptimizer = document.getElementById('btn-undo-optimizer');
const btnDownloadMd = document.getElementById('btn-download-md');
const btnPrintSummary = document.getElementById('btn-print-summary');
const printDoctorSummaryEl = document.getElementById('print-doctor-summary');

const valSummaryLeadEl = document.getElementById('val-summary-lead');
const valMetricsListEl = document.getElementById('val-metrics-list');
const valCycleTbodyEl = document.getElementById('val-cycle-tbody');
const valTableCaptionEl = document.getElementById('val-table-caption');

const inputAgeEl = document.getElementById('input-age');
const sliderAgeEl = document.getElementById('slider-age');
const btnApplyAllOptimal = document.getElementById('btn-apply-all-optimal');

const outAccelEl = document.getElementById('out-accel');
const outAccelBadgeEl = document.getElementById('out-accel-badge');
const outMortalityEl = document.getElementById('out-mortality');
const outMortalityRefEl = document.getElementById('out-mortality-ref');
const outHrEl = document.getElementById('out-hr');
const outXbEl = document.getElementById('out-xb');

const drawerMathPillEl = document.getElementById('drawer-math-pill');
const auditXbEl = document.getElementById('audit-xb');
const auditMEl = document.getElementById('audit-m');
const auditPhenoAgeEl = document.getElementById('audit-phenoage');

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function drawBioAgeGauge(displayedPhenoAge, chronoAge) {
  const accel = displayedPhenoAge - chronoAge;
  const minDelta = -15;
  const maxDelta = 15;
  const clampedDelta = clamp(accel, minDelta, maxDelta);

  // 220-degree editorial arc: -110 deg (left, -15 yrs) to +110 deg (right, +15 yrs)
  const startDeg = -110;
  const endDeg = 110;
  const angleForDelta = (d) => startDeg + ((d - minDelta) / (maxDelta - minDelta)) * (endDeg - startDeg);

  const needleDeg = angleForDelta(clampedDelta);
  const cx = 180;
  const cy = 156;
  const radius = 116;

  // Color based on acceleration zone
  let accentStroke = '#1b5e43'; // Forest green (decelerated)
  if (accel > 2.0) {
    accentStroke = '#a33636'; // Muted crimson (accelerated)
  } else if (accel > -2.0) {
    accentStroke = '#8f5814'; // Warm amber (near baseline)
  }

  // Arc segments for subtle zones
  const greenEnd = angleForDelta(-2);
  const amberEnd = angleForDelta(2);

  // Active sweep from 0 (chronological baseline, top 0 deg) to needleDeg
  const sweepStart = Math.min(0, needleDeg);
  const sweepEnd = Math.max(0, needleDeg);
  const hasSweep = Math.abs(sweepEnd - sweepStart) > 0.5;

  const needleTip = polarToCartesian(cx, cy, radius - 14, needleDeg);
  const needleBaseL = polarToCartesian(cx, cy, 8, needleDeg - 90);
  const needleBaseR = polarToCartesian(cx, cy, 8, needleDeg + 90);

  const chronoTickOuter = polarToCartesian(cx, cy, radius + 11, 0);
  const chronoTickInner = polarToCartesian(cx, cy, radius - 11, 0);

  const ticks = [-15, -10, -5, 0, 5, 10, 15]
    .map((d) => {
      const a = angleForDelta(d);
      const p1 = polarToCartesian(cx, cy, radius - 6, a);
      const p2 = polarToCartesian(cx, cy, radius + 6, a);
      const lbl = polarToCartesian(cx, cy, radius + 22, a);
      const text = d === 0 ? `${chronoAge.toFixed(0)}` : `${d > 0 ? '+' : ''}${d}`;
      return `
        <line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}"
          stroke="${d === 0 ? '#111111' : '#b8b8b3'}" stroke-width="${d === 0 ? 2 : 1.2}" />
        <text x="${lbl.x.toFixed(1)}" y="${(lbl.y + 4).toFixed(1)}" text-anchor="middle"
          fill="${d === 0 ? '#111111' : '#6b6b68'}" font-size="11.5" font-weight="${d === 0 ? 600 : 400}"
          font-family="JetBrains Mono, monospace">${text}</text>
      `;
    })
    .join('');

  const sign = accel >= 0 ? '+' : '';

  bioageGaugeEl.innerHTML = `
    <svg class="gauge-svg" viewBox="0 0 360 236" role="img" aria-label="Biological age gauge showing ${displayedPhenoAge.toFixed(1)} years versus chronological age ${chronoAge.toFixed(0)} years">
      <!-- Zone track arcs -->
      <path d="${describeArc(cx, cy, radius, startDeg, greenEnd)}" fill="none" stroke="#dceee4" stroke-width="14" stroke-linecap="butt" />
      <path d="${describeArc(cx, cy, radius, greenEnd, amberEnd)}" fill="none" stroke="#f5ead7" stroke-width="14" stroke-linecap="butt" />
      <path d="${describeArc(cx, cy, radius, amberEnd, endDeg)}" fill="none" stroke="#f5dede" stroke-width="14" stroke-linecap="butt" />

      <!-- Active deviation sweep from chronological age -->
      ${
        hasSweep
          ? `<path d="${describeArc(cx, cy, radius, sweepStart, sweepEnd)}" fill="none" stroke="${accentStroke}" stroke-width="14" stroke-linecap="round" />`
          : ''
      }

      <!-- Scale ticks -->
      ${ticks}

      <!-- Chronological anchor marker -->
      <line x1="${chronoTickInner.x.toFixed(1)}" y1="${chronoTickInner.y.toFixed(1)}"
        x2="${chronoTickOuter.x.toFixed(1)}" y2="${chronoTickOuter.y.toFixed(1)}"
        stroke="#111111" stroke-width="2.4" stroke-linecap="round" />

      <!-- Animated Needle -->
      <polygon points="${needleTip.x.toFixed(1)},${needleTip.y.toFixed(1)} ${needleBaseL.x.toFixed(1)},${needleBaseL.y.toFixed(1)} ${needleBaseR.x.toFixed(1)},${needleBaseR.y.toFixed(1)}"
        fill="${accentStroke}" opacity="0.22" />
      <line x1="${cx}" y1="${cy}" x2="${needleTip.x.toFixed(1)}" y2="${needleTip.y.toFixed(1)}"
        stroke="${accentStroke}" stroke-width="3" stroke-linecap="round" />
      <circle cx="${cx}" cy="${cy}" r="6" fill="#ffffff" stroke="${accentStroke}" stroke-width="3" />

      <!-- Center Digital Readout -->
      <text x="${cx}" y="${cy + 36}" text-anchor="middle" fill="#111111"
        font-size="38" font-weight="500" font-family="JetBrains Mono, monospace">${displayedPhenoAge.toFixed(1)}</text>
      <text x="${cx}" y="${cy + 55}" text-anchor="middle" fill="#555555"
        font-size="12" font-family="Inter, sans-serif">biological age &middot; you are ${chronoAge.toFixed(0)} (${sign}${accel.toFixed(1)})</text>
    </svg>
  `;
}

function animateBioAgeGauge(targetPhenoAge, chronoAge) {
  if (gaugeAnim.currentPhenoAge === null) {
    gaugeAnim.currentPhenoAge = targetPhenoAge;
    gaugeAnim.targetPhenoAge = targetPhenoAge;
    drawBioAgeGauge(targetPhenoAge, chronoAge);
    return;
  }

  gaugeAnim.targetPhenoAge = targetPhenoAge;
  if (gaugeAnim.rafId) {
    cancelAnimationFrame(gaugeAnim.rafId);
  }

  const startVal = gaugeAnim.currentPhenoAge;
  const delta = targetPhenoAge - startVal;
  if (Math.abs(delta) < 0.02) {
    gaugeAnim.currentPhenoAge = targetPhenoAge;
    drawBioAgeGauge(targetPhenoAge, chronoAge);
    return;
  }

  const duration = 260;
  const startTime = performance.now();

  const step = (now) => {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = startVal + delta * eased;
    gaugeAnim.currentPhenoAge = val;
    drawBioAgeGauge(val, chronoAge);
    if (t < 1) {
      gaugeAnim.rafId = requestAnimationFrame(step);
    } else {
      gaugeAnim.rafId = null;
    }
  };

  gaugeAnim.rafId = requestAnimationFrame(step);
}

function renderNhanesValidation() {
  const { cohort, concordance, data_source: src, by_cycle: byCycle } = nhanesValidation;
  const full = concordance.full_followup;
  const ten = concordance.ten_year_window;
  const mid = concordance.midlife_ages_50_65;
  const cycleSpan = `${src.cycles[0].split('-')[0]}-${src.cycles[src.cycles.length - 1].split('-')[1]}`;

  valSummaryLeadEl.textContent =
    `NHANES is a large US government health survey. ${cohort.n.toLocaleString('en-US')} adults aged ${cohort.age_min} to ${cohort.age_max} ` +
    `from ${src.cycles.length} survey waves (${cycleSpan}) had all 9 blood results, and their records were later linked to national death records, ` +
    `so we know who died and when. The test: how often does the model correctly say which of two people died first? ` +
    `This ranking score (Harrell's C-index) is 0.5 for a coin flip and 1.0 for perfect. Age alone already scores ` +
    `${full.c_index_chrono_age.toFixed(3)} because age is the strongest single risk factor; PhenoAge scores ${full.c_index_phenoage.toFixed(3)}. ` +
    `Among ${mid.n.toLocaleString('en-US')} people aged 50 to 65, where age alone says less, it lifts the score from ` +
    `${mid.c_index_chrono_age.toFixed(3)} to ${mid.c_index_phenoage.toFixed(3)}.`;

  valMetricsListEl.innerHTML = `
    <div class="breakdown-row">
      <dt>Who was included and for how long</dt>
      <dd>
        <strong>${cohort.n.toLocaleString('en-US')}</strong> adults with every result available across cycles
        <code>${src.cycles.join(', ')}</code>; median follow-up <strong>${cohort.followup_median_years.toFixed(1)} years</strong>
        (${cohort.followup_median_months.toFixed(0)} months, max ${cohort.followup_max_months} months) through Dec 31, 2019;
        <strong>${cohort.deaths_all_followup.toLocaleString('en-US')}</strong> observed all-cause deaths
        (${cohort.mortality_rate_all_followup_pct.toFixed(2)}%), including
        <strong>${cohort.deaths_10yr.toLocaleString('en-US')}</strong> within 10 years.
      </dd>
    </div>
    <div class="breakdown-row">
      <dt>Ranking score, full follow-up (Harrell's C-index)</dt>
      <dd>
        PhenoAge <strong>${full.c_index_phenoage.toFixed(4)}</strong> vs. Chronological Age alone
        <strong>${full.c_index_chrono_age.toFixed(4)}</strong>
        (<strong>+${full.c_index_delta.toFixed(4)}</strong> better at ranking who died first).
      </dd>
    </div>
    <div class="breakdown-row">
      <dt>Ranking score, first 10 years only</dt>
      <dd>
        Counting only deaths in the first 120 months: PhenoAge <strong>${ten.c_index_phenoage.toFixed(4)}</strong> vs. Chronological Age
        <strong>${ten.c_index_chrono_age.toFixed(4)}</strong> (<strong>+${ten.c_index_delta.toFixed(4)}</strong>).
      </dd>
    </div>
    <div class="breakdown-row">
      <dt>Ages 50 to 65 only (${mid.n.toLocaleString('en-US')} people, ${mid.deaths.toLocaleString('en-US')} deaths)</dt>
      <dd>
        PhenoAge achieves C-index <strong>${mid.c_index_phenoage.toFixed(4)}</strong> vs. Chronological Age
        <strong>${mid.c_index_chrono_age.toFixed(4)}</strong> (<strong>+${mid.c_index_delta.toFixed(4)}</strong>).
      </dd>
    </div>
    <div class="breakdown-row">
      <dt>How much one result moves your biological age</dt>
      <dd>
        <code>d(PhenoAge) / dx_j = beta_j / 0.090165</code>: <code>+1%</code> RDW adds
        <code>+3.67</code> yrs, <code>+1 mmol/L</code> glucose adds <code>+2.17</code> yrs, and
        <code>+1 g/L</code> albumin subtracts <code>0.37</code> yrs.
      </dd>
    </div>
  `;

  valTableCaptionEl.textContent =
    `${src.survey} (${cycleSpan}), ${src.mortality_linkage}. In every survey wave, PhenoAge ranked who died sooner better than age alone.`;

  valCycleTbodyEl.innerHTML = byCycle
    .map(
      (row) => `
      <tr>
        <td class="mono"><strong>${row.cycle}</strong></td>
        <td class="mono">${row.n.toLocaleString('en-US')}</td>
        <td class="mono">${row.deaths.toLocaleString('en-US')}</td>
        <td class="mono">${row.median_followup_months.toFixed(0)} mo</td>
        <td class="mono">${row.c_index_phenoage.toFixed(4)}</td>
        <td class="mono">${row.c_index_chrono_age.toFixed(4)}</td>
        <td class="mono delta-pos">+${row.c_index_delta.toFixed(4)}</td>
      </tr>
    `
    )
    .join('');
}

function renderPresets() {
  presetGridEl.innerHTML = '';
  const shortDesc = {
    optimal: 'Low inflammation, steady blood sugar, strong blood protein.',
    average: 'A typical mid-life adult, every result inside the normal lab range.',
    elevated: 'Higher blood sugar, inflammation, RDW and white cells.',
  };

  for (const preset of Object.values(PRESETS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `preset-card${state.activePreset === preset.id ? ' active' : ''}`;
    btn.dataset.preset = preset.id;
    btn.innerHTML = `
      <div class="preset-card-top">
        <span class="preset-title">${preset.label}</span>
        <span class="preset-tag">${preset.tag}</span>
      </div>
      <div class="preset-desc">${shortDesc[preset.id] || preset.description}</div>
    `;
    btn.addEventListener('click', () => {
      state.activePreset = preset.id;
      state.previousInputsForUndo = null;
      state.inputs = { ...preset.values, age: state.inputs.age };
      renderAll();
    });
    presetGridEl.appendChild(btn);
  }
}

function buildBiomarkerControls() {
  biomarkersListEl.innerHTML = '';

  for (const bm of BIOMARKERS) {
    const card = document.createElement('div');
    card.className = 'biomarker-card';
    card.dataset.key = bm.key;

    const unit = getBiomarkerUnit(bm, state.unitSystem);
    const minDisp = state.unitSystem === 'US' ? bm.toUS(bm.min) : bm.toSI(bm.min);
    const maxDisp = state.unitSystem === 'US' ? bm.toUS(bm.max) : bm.toSI(bm.max);
    const stepDisp = state.unitSystem === 'US' ? bm.stepUS : bm.stepSI;
    const valDisp = formatBiomarkerValue(bm, state.inputs[bm.key], state.unitSystem);
    const optDisp = formatBiomarkerValue(bm, bm.optimal, state.unitSystem);
    const status = getBiomarkerStatus(bm, state.inputs[bm.key]);

    const leftPct = ((bm.optimalBand[0] - bm.min) / (bm.max - bm.min)) * 100;
    const widthPct = ((bm.optimalBand[1] - bm.optimalBand[0]) / (bm.max - bm.min)) * 100;

    card.innerHTML = `
      <div class="biomarker-top">
        <div class="bm-title-group">
          <span class="bm-name">${bm.name}</span>
          <span class="bm-status ${status.code}" data-role="status">${status.label}</span>
        </div>
        <p class="bm-plain">${bm.plain || ''}</p>
        <div class="bm-input-group">
          <input
            type="number"
            class="num-input"
            data-role="number"
            min="${minDisp.toFixed(2)}"
            max="${maxDisp.toFixed(2)}"
            step="${stepDisp}"
            value="${valDisp}"
            aria-label="${bm.name} in ${unit}"
          />
          <span class="unit-tag">${unit}</span>
        </div>
      </div>
      <div class="slider-track-wrap">
        <div class="optimal-band-bar" style="left:${leftPct.toFixed(2)}%;width:${widthPct.toFixed(2)}%;"></div>
        <input
          type="range"
          class="range-slider"
          data-role="range"
          min="${minDisp}"
          max="${maxDisp}"
          step="${stepDisp}"
          value="${valDisp}"
          aria-label="${bm.name} slider"
        />
      </div>
      <div class="slider-scale">
        <span>${formatBiomarkerValue(bm, bm.min, state.unitSystem)}</span>
        <span class="slider-opt-label">Target: ${optDisp} ${unit}</span>
        <span>${formatBiomarkerValue(bm, bm.max, state.unitSystem)}</span>
      </div>
    `;

    const numInput = card.querySelector('[data-role="number"]');
    const rangeInput = card.querySelector('[data-role="range"]');

    const handleUpdate = (rawDisplayValue, source) => {
      const parsed = parseFloat(rawDisplayValue);
      if (Number.isNaN(parsed)) return;
      const canonical = state.unitSystem === 'US' ? bm.fromUS(parsed) : bm.fromSI(parsed);
      state.inputs[bm.key] = clamp(canonical, bm.min, bm.max);
      state.activePreset = null;
      state.previousInputsForUndo = null;

      if (source !== 'number') {
        numInput.value = formatBiomarkerValue(bm, state.inputs[bm.key], state.unitSystem);
      }
      if (source !== 'range') {
        rangeInput.value =
          state.unitSystem === 'US'
            ? bm.toUS(state.inputs[bm.key])
            : bm.toSI(state.inputs[bm.key]);
      }

      const nextStatus = getBiomarkerStatus(bm, state.inputs[bm.key]);
      const statusEl = card.querySelector('[data-role="status"]');
      statusEl.className = `bm-status ${nextStatus.code}`;
      statusEl.textContent = nextStatus.label;

      updatePresetActiveClass();
      renderOutputs();
    };

    rangeInput.addEventListener('input', (e) => handleUpdate(e.target.value, 'range'));
    numInput.addEventListener('input', (e) => handleUpdate(e.target.value, 'number'));

    biomarkersListEl.appendChild(card);
  }
}

function updatePresetActiveClass() {
  const cards = presetGridEl.querySelectorAll('.preset-card');
  cards.forEach((card) => {
    card.classList.toggle('active', card.dataset.preset === state.activePreset);
  });
}

function renderSurvivalSvg(currentRes, optimizerPlan) {
  const optimalProfile = { ...PRESETS.optimal.values, age: state.inputs.age };
  const optimalRes = calculatePhenoAge(optimalProfile);

  const currentCurve = generateSurvivalCurve(currentRes.xb, 10);
  const baselineCurve = generateSurvivalCurve(currentRes.xbChronoRef, 10);
  const optimalCurve = generateSurvivalCurve(optimalRes.xb, 10);
  const whatIfCurve =
    !optimizerPlan.alreadyOptimal && optimizerPlan.achievedDropYears > 0.05
      ? generateSurvivalCurve(optimizerPlan.projectedXb, 10)
      : null;

  const minSurvival = Math.min(
    currentCurve[10].survival,
    baselineCurve[10].survival,
    optimalCurve[10].survival
  );
  const yFloor = Math.max(0, Math.floor((minSurvival - 0.04) * 20) / 20);
  const yCeil = 1.0;

  const width = 580;
  const height = 200;
  const pad = { top: 14, right: 18, bottom: 28, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const xScale = (year) => pad.left + (year / 10) * plotW;
  const yScale = (surv) => {
    const ratio = (surv - yFloor) / Math.max(0.001, yCeil - yFloor);
    return pad.top + plotH * (1 - clamp(ratio, 0, 1));
  };

  const toPath = (pts) =>
    pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.year).toFixed(1)},${yScale(p.survival).toFixed(1)}`)
      .join(' ');

  const yTicks = 4;
  let gridLines = '';
  for (let i = 0; i <= yTicks; i++) {
    const val = yFloor + ((yCeil - yFloor) * i) / yTicks;
    const y = yScale(val);
    gridLines += `
      <line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}"
        stroke="#e5e5e3" stroke-width="1" />
      <text x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end"
        fill="#555555" font-size="11.5" font-family="JetBrains Mono, monospace">${(val * 100).toFixed(1)}%</text>
    `;
  }

  let xTicks = '';
  for (let yr = 0; yr <= 10; yr += 2) {
    const x = xScale(yr);
    xTicks += `
      <text x="${x.toFixed(1)}" y="${height - 8}" text-anchor="middle"
        fill="#555555" font-size="11.5" font-family="JetBrains Mono, monospace">Yr ${yr}</text>
    `;
  }

  const endCur = currentCurve[10];
  const endOpt = optimalCurve[10];

  survivalChartEl.innerHTML = `
    <svg class="survival-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="10-year Gompertz survival curve">
      ${gridLines}
      ${xTicks}

      <path d="${toPath(optimalCurve)}" fill="none" stroke="#8f5814" stroke-width="1.6" stroke-dasharray="4 4" opacity="0.8" />
      <path d="${toPath(baselineCurve)}" fill="none" stroke="#8a8a85" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.85" />
      ${
        whatIfCurve
          ? `<path d="${toPath(whatIfCurve)}" fill="none" stroke="#2d7a5a" stroke-width="2" stroke-dasharray="6 4" />`
          : ''
      }
      <path d="${toPath(currentCurve)}" fill="none" stroke="#1b5e43" stroke-width="2.6" />

      <circle cx="${xScale(10).toFixed(1)}" cy="${yScale(endOpt.survival).toFixed(1)}" r="3.2" fill="#8f5814" />
      <circle cx="${xScale(10).toFixed(1)}" cy="${yScale(endCur.survival).toFixed(1)}" r="4.5" fill="#ffffff" stroke="#1b5e43" stroke-width="2.4" />
    </svg>
  `;
}

function renderOptimizer(optimizerPlan) {
  const tgt = state.targetDropYears;
  optimizerHeadingEl.textContent = `The 3 smallest changes that take ${tgt} ${tgt === 1 ? 'year' : 'years'} off`;

  if (optimizerPlan.alreadyOptimal || optimizerPlan.shifts.length === 0) {
    optimizerSummaryEl.innerHTML = `Your results are already on target. Biological age is <strong>${optimizerPlan.basePhenoAge.toFixed(1)} yrs</strong>.`;
    optimizerShiftsEl.innerHTML = `
      <div class="optimizer-empty">
        All 9 results are at or better than target, so there are no more years to take off.
      </div>
    `;
    btnApplyOptimizer.disabled = true;
  } else {
    const capNote = optimizerPlan.isFullyAchievable
      ? ''
      : ` (the most possible while staying within targets)`;
    optimizerSummaryEl.innerHTML =
      `Takes your biological age from <strong>${optimizerPlan.basePhenoAge.toFixed(1)}</strong> to ` +
      `<strong>${optimizerPlan.projectedPhenoAge.toFixed(1)} yrs</strong> ` +
      `(<strong>-${optimizerPlan.achievedDropYears.toFixed(2)} yrs</strong>${capNote}).`;

    optimizerShiftsEl.innerHTML = optimizerPlan.shifts
      .map((s, idx) => {
        const unit = getBiomarkerUnit(s.biomarker, state.unitSystem);
        const curFmt = formatBiomarkerValue(s.biomarker, s.currentVal, state.unitSystem);
        const tgtFmt = formatBiomarkerValue(s.biomarker, s.targetVal, state.unitSystem);
        return `
          <div class="shift-card">
            <div class="shift-head">
              <span class="shift-name">#${idx + 1} ${s.shortName}</span>
              <span class="shift-drop">-${s.dropYears.toFixed(2)} yrs</span>
            </div>
            <div class="shift-values">${curFmt} &rarr; <strong>${tgtFmt} ${unit}</strong></div>
          </div>
        `;
      })
      .join('');

    btnApplyOptimizer.disabled = false;
  }

  btnUndoOptimizer.classList.toggle('hidden', !state.previousInputsForUndo);
}

function renderTornado() {
  const tornado = computeTornadoLeverage(state.inputs);
  const maxReduction = Math.max(0.5, ...tornado.items.map((i) => i.reductionYears));

  tornadoTotalPillEl.textContent = `Total: -${tornado.totalModifiableYears.toFixed(1)} yrs`;
  tornadoChartEl.innerHTML = '';

  tornado.items.forEach((item, index) => {
    const bm = item.biomarker;
    const unit = getBiomarkerUnit(bm, state.unitSystem);
    const curFmt = formatBiomarkerValue(bm, item.currentVal, state.unitSystem);
    const tgtFmt = formatBiomarkerValue(bm, item.targetVal, state.unitSystem);
    const barPct = item.isAlreadyOptimal ? 0 : Math.min(100, (item.reductionYears / maxReduction) * 100);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = `tornado-row${item.isAlreadyOptimal ? ' is-optimal' : ''}`;
    row.disabled = item.isAlreadyOptimal;
    row.title = item.isAlreadyOptimal
      ? `${item.name} is already at or better than target`
      : `Click to set ${item.name} to its target (${tgtFmt} ${unit})`;

    row.innerHTML = `
      <div class="tornado-row-head">
        <div>
          <span class="tornado-rank">#${index + 1}</span>
          <span class="tornado-name">${item.shortName}</span>
        </div>
        <span class="tornado-delta${item.isAlreadyOptimal ? ' zero' : ''}">
          ${item.isAlreadyOptimal ? 'On target' : `-${item.reductionYears.toFixed(2)} yrs`}
        </span>
      </div>
      <div class="tornado-bar-track">
        <div class="tornado-bar-fill" style="width:${barPct.toFixed(1)}%;"></div>
      </div>
      <div class="tornado-row-meta">
        <span>${curFmt} &rarr; ${tgtFmt} ${unit}</span>
        <span>${
          item.isAlreadyOptimal
            ? 'Target met'
            : `10-yr risk -${item.mortalityDeltaPct.toFixed(2)} pts`
        }</span>
      </div>
    `;

    if (!item.isAlreadyOptimal) {
      row.addEventListener('click', () => {
        state.inputs[bm.key] = bm.optimal;
        state.activePreset = null;
        state.previousInputsForUndo = null;
        renderAll();
      });
    }

    tornadoChartEl.appendChild(row);
  });
}

function renderAuditTable(res) {
  const rows = [
    {
      label: 'Intercept (beta_0)',
      unit: 'Constant',
      coef: MODEL_CONSTANTS.INTERCEPT.toFixed(4),
      input: '1',
      contrib: res.terms.intercept.toFixed(4),
      mech: 'Starting point of the risk score, fitted by Levine et al. (2018) on the US health survey (NHANES III).',
    },
    {
      label: 'Chronological Age',
      unit: 'years',
      coef: `+${AGE_COEF.toFixed(4)}`,
      input: `${state.inputs.age.toFixed(0)}`,
      contrib: `${res.terms.age >= 0 ? '+' : ''}${res.terms.age.toFixed(4)}`,
      mech: 'Risk of dying rises exponentially with every year of age.',
    },
    ...BIOMARKERS.map((bm) => {
      const val = state.inputs[bm.key];
      const coefStr = `${bm.coef >= 0 ? '+' : ''}${bm.coef}`;
      const inputStr = bm.isLog
        ? `ln(${val.toFixed(2)}) = ${Math.log(Math.max(val, 0.001)).toFixed(3)}`
        : val.toFixed(bm.decimalsSI);
      const contrib = res.terms[bm.key];
      return {
        label: bm.name,
        unit: bm.isLog ? 'ln(mg/dL)' : bm.unitSI,
        coef: coefStr,
        input: inputStr,
        contrib: `${contrib >= 0 ? '+' : ''}${contrib.toFixed(4)}`,
        mech: bm.rationale,
      };
    }),
  ];

  coefTableBodyEl.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td><strong>${r.label}</strong></td>
        <td class="mono">${r.unit}</td>
        <td class="mono">${r.coef}</td>
        <td class="mono">${r.input}</td>
        <td class="mono">${r.contrib}</td>
        <td>${r.mech}</td>
      </tr>
    `
    )
    .join('');
}

function renderPrintSummary(res, optimizerPlan) {
  const today = new Date().toISOString().slice(0, 10);
  const sign = res.ageAcceleration >= 0 ? '+' : '';
  const markerRows = BIOMARKERS.map((bm) => {
    const unit = getBiomarkerUnit(bm, state.unitSystem);
    const cur = formatBiomarkerValue(bm, state.inputs[bm.key], state.unitSystem);
    const opt = formatBiomarkerValue(bm, bm.optimal, state.unitSystem);
    const status = getBiomarkerStatus(bm, state.inputs[bm.key]).label;
    return `<tr><td>${bm.name}</td><td>${bm.domain}</td><td class="mono">${cur} ${unit}</td><td class="mono">${opt} ${unit}</td><td>${status}</td></tr>`;
  }).join('');

  const planBlock =
    optimizerPlan.alreadyOptimal || optimizerPlan.shifts.length === 0
      ? `<p>All 9 biomarkers are already at or near longevity targets.</p>`
      : `<p>Projected PhenoAge: <strong>${optimizerPlan.projectedPhenoAge.toFixed(1)} yrs</strong> (-${optimizerPlan.achievedDropYears.toFixed(2)} yrs; 10-yr mortality ${(optimizerPlan.projectedMortality10Yr * 100).toFixed(2)}%).</p>
         <table class="print-table">
           <thead><tr><th>Priority</th><th>Biomarker</th><th>Current</th><th>Target Shift</th><th>Impact</th></tr></thead>
           <tbody>
             ${optimizerPlan.shifts
               .map((s, idx) => {
                 const unit = getBiomarkerUnit(s.biomarker, state.unitSystem);
                 const cur = formatBiomarkerValue(s.biomarker, s.currentVal, state.unitSystem);
                 const tgt = formatBiomarkerValue(s.biomarker, s.targetVal, state.unitSystem);
                 return `<tr><td>#${idx + 1}</td><td>${s.name}</td><td class="mono">${cur} ${unit}</td><td class="mono">${tgt} ${unit}</td><td class="mono">-${s.dropYears.toFixed(2)} yrs</td></tr>`;
               })
               .join('')}
           </tbody>
         </table>`;

  printDoctorSummaryEl.innerHTML = `
    <h1>Biological Age (PhenoAge) Doctor Discussion Brief</h1>
    <div class="print-meta">
      Date: ${today} &middot; Unit System: ${state.unitSystem} &middot; Model: Levine et al. (2018) PhenoAge Gompertz Formula &middot; 100% Client-Side
    </div>
    <h2>Summary Outcomes</h2>
    <table class="print-table">
      <tbody>
        <tr><th>Chronological Age</th><td class="mono">${state.inputs.age.toFixed(1)} yrs</td><th>PhenoAge</th><td class="mono"><strong>${res.phenoAge.toFixed(1)} yrs</strong></td></tr>
        <tr><th>Age Acceleration</th><td class="mono"><strong>${sign}${res.ageAcceleration.toFixed(1)} yrs</strong></td><th>10-Year Mortality (M)</th><td class="mono">${(res.mortality10Yr * 100).toFixed(2)}% (ref ${(res.mortality10YrRef * 100).toFixed(2)}%)</td></tr>
        <tr><th>Relative Hazard</th><td class="mono">${res.hazardRatioVsBaseline.toFixed(2)}x</td><th>Linear Predictor (xb)</th><td class="mono">${res.xb.toFixed(4)}</td></tr>
      </tbody>
    </table>
    <h2>Current Biomarker Panel</h2>
    <table class="print-table">
      <thead><tr><th>Biomarker</th><th>Domain</th><th>Current</th><th>Optimal Target</th><th>Status</th></tr></thead>
      <tbody>${markerRows}</tbody>
    </table>
    <h2>Private &ldquo;What-If&rdquo; 3-Marker Plan (-${state.targetDropYears} yr Target)</h2>
    ${planBlock}
    <div class="print-disclaimer">
      Educational and research summary only. Implements Levine et al. (2018, Aging 10(4):573-591, doi:10.18632/aging.101414). Not a medical device or clinical diagnosis. Discuss lab targets with a licensed physician.
    </div>
  `;
}

function renderOutputs() {
  const res = calculatePhenoAge(state.inputs);
  const optimizerPlan = computeWhatIfOptimizer(state.inputs, state.targetDropYears, 3);

  animateBioAgeGauge(res.phenoAge, state.inputs.age);

  const sign = res.ageAcceleration >= 0 ? '+' : '';
  outAccelEl.textContent = `${sign}${res.ageAcceleration.toFixed(1)} yrs`;

  if (res.ageAcceleration <= -2.0) {
    outAccelEl.className = 'kpi-stat-value positive-good';
    outAccelBadgeEl.className = 'kpi-badge good';
    outAccelBadgeEl.textContent = 'Aging slower';
  } else if (res.ageAcceleration <= 2.0) {
    outAccelEl.className = 'kpi-stat-value neutral-warn';
    outAccelBadgeEl.className = 'kpi-badge warn';
    outAccelBadgeEl.textContent = 'Aging on pace';
  } else {
    outAccelEl.className = 'kpi-stat-value negative-risk';
    outAccelBadgeEl.className = 'kpi-badge risk';
    outAccelBadgeEl.textContent = 'Aging faster';
  }

  const mortPct = res.mortality10Yr * 100;
  const mortRefPct = res.mortality10YrRef * 100;
  outMortalityEl.textContent = `${mortPct.toFixed(2)}%`;
  outMortalityRefEl.textContent = `Typical for your age: ${mortRefPct.toFixed(2)}%`;

  outHrEl.textContent = `${res.hazardRatioVsBaseline.toFixed(2)}x`;
  outHrEl.className =
    res.hazardRatioVsBaseline < 0.85
      ? 'kpi-stat-value positive-good'
      : res.hazardRatioVsBaseline > 1.2
      ? 'kpi-stat-value negative-risk'
      : 'kpi-stat-value';

  outXbEl.textContent = res.xb.toFixed(4);
  drawerMathPillEl.textContent = `xb = ${res.xb.toFixed(3)}`;

  auditXbEl.textContent = res.xb.toFixed(5);
  auditMEl.textContent = `${mortPct.toFixed(3)}% (${res.mortality10Yr.toFixed(5)})`;
  auditPhenoAgeEl.textContent = res.phenoAge.toFixed(2);

  renderSurvivalSvg(res, optimizerPlan);
  renderOptimizer(optimizerPlan);
  renderTornado();
  renderAuditTable(res);
  renderPrintSummary(res, optimizerPlan);
}

function renderAll() {
  inputAgeEl.value = state.inputs.age;
  sliderAgeEl.value = state.inputs.age;
  renderPresets();
  buildBiomarkerControls();
  renderOutputs();
}

// Event Listeners
document.querySelectorAll('.unit-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const nextUnit = btn.dataset.unit;
    if (nextUnit === state.unitSystem) return;
    state.unitSystem = nextUnit;

    document.querySelectorAll('.unit-btn').forEach((b) => {
      const isActive = b.dataset.unit === nextUnit;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', String(isActive));
    });

    buildBiomarkerControls();
    renderOutputs();
  });
});

document.querySelectorAll('.target-pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    const drop = parseFloat(btn.dataset.drop);
    if (Number.isNaN(drop) || drop === state.targetDropYears) return;
    state.targetDropYears = drop;

    document.querySelectorAll('.target-pill').forEach((b) => {
      const isActive = parseFloat(b.dataset.drop) === drop;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', String(isActive));
    });

    renderOutputs();
  });
});

btnApplyOptimizer.addEventListener('click', () => {
  const plan = computeWhatIfOptimizer(state.inputs, state.targetDropYears, 3);
  if (plan.alreadyOptimal || plan.shifts.length === 0) return;
  state.previousInputsForUndo = { ...state.inputs };
  state.inputs = { ...plan.projectedInputs };
  state.activePreset = null;
  renderAll();
});

btnUndoOptimizer.addEventListener('click', () => {
  if (!state.previousInputsForUndo) return;
  state.inputs = { ...state.previousInputsForUndo };
  state.previousInputsForUndo = null;
  renderAll();
});

btnDownloadMd.addEventListener('click', () => {
  const res = calculatePhenoAge(state.inputs);
  const plan = computeWhatIfOptimizer(state.inputs, state.targetDropYears, 3);
  const md = generateDoctorSummaryMarkdown(state.inputs, res, plan, state.unitSystem);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `phenoage-doctor-summary-${today}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

btnPrintSummary.addEventListener('click', () => {
  window.print();
});

sliderAgeEl.addEventListener('input', (e) => {
  state.inputs.age = clamp(parseFloat(e.target.value) || 45, 18, 95);
  inputAgeEl.value = state.inputs.age;
  renderOutputs();
});

inputAgeEl.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  if (Number.isNaN(val)) return;
  state.inputs.age = clamp(val, 18, 95);
  sliderAgeEl.value = state.inputs.age;
  renderOutputs();
});

btnApplyAllOptimal.addEventListener('click', () => {
  state.previousInputsForUndo = { ...state.inputs };
  for (const bm of BIOMARKERS) {
    state.inputs[bm.key] = bm.optimal;
  }
  state.activePreset = 'optimal';
  renderAll();
});

// Initial Boot
renderNhanesValidation();
renderAll();
