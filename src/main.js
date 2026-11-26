import {
  AGE_COEF,
  BIOMARKERS,
  MODEL_CONSTANTS,
  PRESETS,
  calculatePhenoAge,
  computeTornadoLeverage,
  formatBiomarkerValue,
  generateSurvivalCurve,
  getBiomarkerStatus,
  getBiomarkerUnit,
} from './model/phenoage.js';
import nhanesValidation from './data/nhanes_validation_results.json';

const state = {
  unitSystem: 'SI', // 'SI' or 'US'
  activePreset: 'average',
  inputs: { ...PRESETS.average.values },
};

// DOM References
const presetGridEl = document.getElementById('preset-grid');
const biomarkersListEl = document.getElementById('biomarkers-list');
const tornadoChartEl = document.getElementById('tornado-chart');
const tornadoTotalPillEl = document.getElementById('tornado-total-pill');
const survivalChartEl = document.getElementById('survival-chart');
const coefTableBodyEl = document.getElementById('coef-table-body');

const valSummaryLeadEl = document.getElementById('val-summary-lead');
const valMetricsListEl = document.getElementById('val-metrics-list');
const valCycleTbodyEl = document.getElementById('val-cycle-tbody');
const valTableCaptionEl = document.getElementById('val-table-caption');

const inputAgeEl = document.getElementById('input-age');
const sliderAgeEl = document.getElementById('slider-age');
const btnApplyAllOptimal = document.getElementById('btn-apply-all-optimal');

const outPhenoAgeEl = document.getElementById('out-phenoage');
const outChronoCompareEl = document.getElementById('out-chrono-compare');
const outAccelEl = document.getElementById('out-accel');
const outAccelBadgeEl = document.getElementById('out-accel-badge');
const outMortalityEl = document.getElementById('out-mortality');
const outMortalityRefEl = document.getElementById('out-mortality-ref');
const outHrEl = document.getElementById('out-hr');
const outXbEl = document.getElementById('out-xb');

const auditXbEl = document.getElementById('audit-xb');
const auditMEl = document.getElementById('audit-m');
const auditPhenoAgeEl = document.getElementById('audit-phenoage');

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function renderNhanesValidation() {
  const { cohort, concordance, data_source: src, by_cycle: byCycle } = nhanesValidation;
  const full = concordance.full_followup;
  const ten = concordance.ten_year_window;
  const mid = concordance.midlife_ages_50_65;
  const cycleSpan = `${src.cycles[0].split('-')[0]}-${src.cycles[src.cycles.length - 1].split('-')[1]}`;

  valSummaryLeadEl.textContent =
    `Independent evaluation across ${src.cycles.length} public CDC NHANES cycles (${cycleSpan}), ` +
    `covering n = ${cohort.n.toLocaleString('en-US')} complete-case adults (ages ${cohort.age_min}-${cohort.age_max}) ` +
    `linked to the NCHS 2019 Public-Use Linked Mortality Files.`;

  valMetricsListEl.innerHTML = `
    <div class="breakdown-row">
      <dt>Cohort &amp; Follow-Up Window</dt>
      <dd>
        <strong>n = ${cohort.n.toLocaleString('en-US')}</strong> complete-case adults across cycles
        <code>${src.cycles.join(', ')}</code>; median follow-up <strong>${cohort.followup_median_years.toFixed(1)} years</strong>
        (${cohort.followup_median_months.toFixed(0)} months, max ${cohort.followup_max_months} months) through Dec 31, 2019;
        <strong>${cohort.deaths_all_followup.toLocaleString('en-US')}</strong> observed all-cause deaths
        (${cohort.mortality_rate_all_followup_pct.toFixed(2)}%), including
        <strong>${cohort.deaths_10yr.toLocaleString('en-US')}</strong> within 10 years.
      </dd>
    </div>
    <div class="breakdown-row">
      <dt>Harrell's C-Index (Full Follow-Up)</dt>
      <dd>
        PhenoAge <strong>${full.c_index_phenoage.toFixed(4)}</strong> vs. Chronological Age alone
        <strong>${full.c_index_chrono_age.toFixed(4)}</strong>
        (<strong>+${full.c_index_delta.toFixed(4)}</strong> concordance gain on observed all-cause mortality).
      </dd>
    </div>
    <div class="breakdown-row">
      <dt>Harrell's C-Index (10-Year Window)</dt>
      <dd>
        Censored at 120 months to match the model's 10-year horizon: PhenoAge
        <strong>${ten.c_index_phenoage.toFixed(4)}</strong> vs. Chronological Age alone
        <strong>${ten.c_index_chrono_age.toFixed(4)}</strong>
        (<strong>+${ten.c_index_delta.toFixed(4)}</strong>).
      </dd>
    </div>
    <div class="breakdown-row">
      <dt>Mid-Life Subgroup (Ages 50-65, n = ${mid.n.toLocaleString('en-US')}, ${mid.deaths.toLocaleString('en-US')} deaths)</dt>
      <dd>
        Where chronological age has narrow spread, PhenoAge achieves C-index
        <strong>${mid.c_index_phenoage.toFixed(4)}</strong> vs. Chronological Age
        <strong>${mid.c_index_chrono_age.toFixed(4)}</strong>
        (<strong>+${mid.c_index_delta.toFixed(4)}</strong>).
      </dd>
    </div>
    <div class="breakdown-row">
      <dt>Analytical Biomarker Sensitivity</dt>
      <dd>
        Because PhenoAge is linear in <code>xb</code>, each marker's biological-age slope is
        <code>d(PhenoAge) / dx_j = beta_j / 0.090165</code>: <code>+1%</code> RDW adds
        <code>+3.67</code> yrs, <code>+1 mmol/L</code> glucose adds <code>+2.17</code> yrs, and
        <code>+1 g/L</code> albumin subtracts <code>0.37</code> yrs.
      </dd>
    </div>
  `;

  valTableCaptionEl.textContent =
    `${src.survey} (${cycleSpan}), ${src.mortality_linkage}. Every cycle independently shows higher mortality concordance for PhenoAge than chronological age alone.`;

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
      <div class="preset-desc">${preset.description}</div>
    `;
    btn.addEventListener('click', () => {
      state.activePreset = preset.id;
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
          <span class="bm-domain">${bm.domain}</span>
          <span class="bm-status ${status.code}" data-role="status">${status.label}</span>
        </div>
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
        <span>${formatBiomarkerValue(bm, bm.min, state.unitSystem)} ${unit}</span>
        <span class="slider-opt-label">Target: ${optDisp} ${unit}</span>
        <span>${formatBiomarkerValue(bm, bm.max, state.unitSystem)} ${unit}</span>
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

function renderSurvivalSvg(currentRes) {
  const optimalProfile = { ...PRESETS.optimal.values, age: state.inputs.age };
  const optimalRes = calculatePhenoAge(optimalProfile);

  const currentCurve = generateSurvivalCurve(currentRes.xb, 10);
  const baselineCurve = generateSurvivalCurve(currentRes.xbChronoRef, 10);
  const optimalCurve = generateSurvivalCurve(optimalRes.xb, 10);

  const minSurvival = Math.min(
    currentCurve[10].survival,
    baselineCurve[10].survival,
    optimalCurve[10].survival
  );
  const yFloor = Math.max(0, Math.floor((minSurvival - 0.04) * 20) / 20);
  const yCeil = 1.0;

  const width = 560;
  const height = 236;
  const pad = { top: 16, right: 20, bottom: 34, left: 54 };
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
        stroke="rgba(232,226,213,0.1)" stroke-width="1" />
      <text x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end"
        fill="#9aa7b8" font-size="12" font-family="JetBrains Mono, monospace">${(val * 100).toFixed(1)}%</text>
    `;
  }

  let xTicks = '';
  for (let yr = 0; yr <= 10; yr += 2) {
    const x = xScale(yr);
    xTicks += `
      <text x="${x.toFixed(1)}" y="${height - 10}" text-anchor="middle"
        fill="#9aa7b8" font-size="12" font-family="JetBrains Mono, monospace">Yr ${yr}</text>
    `;
  }

  const endCur = currentCurve[10];
  const endOpt = optimalCurve[10];

  survivalChartEl.innerHTML = `
    <svg class="survival-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="10-year Gompertz survival curve">
      ${gridLines}
      ${xTicks}

      <path d="${toPath(optimalCurve)}" fill="none" stroke="#d8a34c" stroke-width="1.75" stroke-dasharray="4 4" opacity="0.9" />
      <path d="${toPath(baselineCurve)}" fill="none" stroke="#cfc8bb" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.65" />
      <path d="${toPath(currentCurve)}" fill="none" stroke="#49b8ae" stroke-width="2.6" />

      <circle cx="${xScale(10).toFixed(1)}" cy="${yScale(endOpt.survival).toFixed(1)}" r="3.5" fill="#d8a34c" />
      <circle cx="${xScale(10).toFixed(1)}" cy="${yScale(endCur.survival).toFixed(1)}" r="4.5" fill="#0d1117" stroke="#49b8ae" stroke-width="2.4" />
    </svg>
  `;
}

function renderTornado() {
  const tornado = computeTornadoLeverage(state.inputs);
  const maxReduction = Math.max(0.5, ...tornado.items.map((i) => i.reductionYears));

  tornadoTotalPillEl.textContent = `Modifiable gain: -${tornado.totalModifiableYears.toFixed(1)} yrs`;
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
      ? `${item.name} is already at or better than optimal target`
      : `Click to set ${item.name} to optimal target (${tgtFmt} ${unit})`;

    row.innerHTML = `
      <div class="tornado-row-head">
        <div>
          <span class="tornado-rank">#${index + 1}</span>
          <span class="tornado-name">${item.shortName}</span>
        </div>
        <span class="tornado-delta${item.isAlreadyOptimal ? ' zero' : ''}">
          ${item.isAlreadyOptimal ? 'At Optimal' : `-${item.reductionYears.toFixed(2)} yrs`}
        </span>
      </div>
      <div class="tornado-bar-track">
        <div class="tornado-bar-fill" style="width:${barPct.toFixed(1)}%;"></div>
      </div>
      <div class="tornado-row-meta">
        <span>${curFmt} &rarr; ${tgtFmt} ${unit}</span>
        <span>${
          item.isAlreadyOptimal
            ? item.surplusYears > 0.05
              ? `Protective buffer (+${item.surplusYears.toFixed(1)} yrs)`
              : 'Target achieved'
            : `10-yr mortality -${item.mortalityDeltaPct.toFixed(2)} pp`
        }</span>
      </div>
    `;

    if (!item.isAlreadyOptimal) {
      row.addEventListener('click', () => {
        state.inputs[bm.key] = bm.optimal;
        state.activePreset = null;
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
      mech: 'Baseline Gompertz log-hazard anchor fitted by Levine et al. (2018) on NHANES III.',
    },
    {
      label: 'Chronological Age',
      unit: 'years',
      coef: `+${AGE_COEF.toFixed(4)}`,
      input: `${state.inputs.age.toFixed(0)}`,
      contrib: `${res.terms.age >= 0 ? '+' : ''}${res.terms.age.toFixed(4)}`,
      mech: 'Time-dependent exponential mortality drift.',
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

function renderOutputs() {
  const res = calculatePhenoAge(state.inputs);

  outPhenoAgeEl.textContent = res.phenoAge.toFixed(1);
  outChronoCompareEl.textContent = `vs. Chronological Age ${state.inputs.age.toFixed(1)} years`;

  const sign = res.ageAcceleration >= 0 ? '+' : '';
  outAccelEl.textContent = `${sign}${res.ageAcceleration.toFixed(1)} yrs`;

  if (res.ageAcceleration <= -2.0) {
    outAccelEl.className = 'kpi-stat-value positive-good';
    outAccelBadgeEl.className = 'kpi-badge good';
    outAccelBadgeEl.textContent = 'Decelerated Aging';
  } else if (res.ageAcceleration <= 2.0) {
    outAccelEl.className = 'kpi-stat-value neutral-warn';
    outAccelBadgeEl.className = 'kpi-badge warn';
    outAccelBadgeEl.textContent = 'Near Baseline';
  } else {
    outAccelEl.className = 'kpi-stat-value negative-risk';
    outAccelBadgeEl.className = 'kpi-badge risk';
    outAccelBadgeEl.textContent = 'Accelerated Aging';
  }

  const mortPct = res.mortality10Yr * 100;
  const mortRefPct = res.mortality10YrRef * 100;
  outMortalityEl.textContent = `${mortPct.toFixed(2)}%`;
  outMortalityRefEl.textContent = `Age-matched ref: ${mortRefPct.toFixed(2)}%`;

  outHrEl.textContent = `${res.hazardRatioVsBaseline.toFixed(2)}x`;
  outHrEl.className =
    res.hazardRatioVsBaseline < 0.85
      ? 'kpi-stat-value positive-good'
      : res.hazardRatioVsBaseline > 1.2
      ? 'kpi-stat-value negative-risk'
      : 'kpi-stat-value';

  outXbEl.textContent = res.xb.toFixed(4);

  auditXbEl.textContent = res.xb.toFixed(5);
  auditMEl.textContent = `${mortPct.toFixed(3)}% (${res.mortality10Yr.toFixed(5)})`;
  auditPhenoAgeEl.textContent = res.phenoAge.toFixed(2);

  renderSurvivalSvg(res);
  renderTornado();
  renderAuditTable(res);
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
    renderTornado();
  });
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
  for (const bm of BIOMARKERS) {
    state.inputs[bm.key] = bm.optimal;
  }
  state.activePreset = 'optimal';
  renderAll();
});

// Initial Boot
renderNhanesValidation();
renderAll();
