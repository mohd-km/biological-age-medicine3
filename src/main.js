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
      // Preserve current chronological age so users can compare profiles at their own age,
      // unless they want the full preset; keep age synced cleanly.
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

    // Calculate optimal band percentage along slider track
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
        <span class="slider-opt-label">Optimal target: ${optDisp} ${unit}</span>
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

  // Determine dynamic y-axis floor so small mortality differences remain clearly legible
  const minSurvival = Math.min(
    currentCurve[10].survival,
    baselineCurve[10].survival,
    optimalCurve[10].survival
  );
  const yFloor = Math.max(0, Math.floor((minSurvival - 0.04) * 20) / 20);
  const yCeil = 1.0;

  const width = 560;
  const height = 232;
  const pad = { top: 16, right: 20, bottom: 34, left: 50 };
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
        stroke="rgba(232,226,213,0.09)" stroke-width="1" />
      <text x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end"
        fill="#8c9bae" font-size="11" font-family="JetBrains Mono, monospace">${(val * 100).toFixed(1)}%</text>
    `;
  }

  let xTicks = '';
  for (let yr = 0; yr <= 10; yr += 2) {
    const x = xScale(yr);
    xTicks += `
      <text x="${x.toFixed(1)}" y="${height - 10}" text-anchor="middle"
        fill="#8c9bae" font-size="11" font-family="JetBrains Mono, monospace">Yr ${yr}</text>
    `;
  }

  const endCur = currentCurve[10];
  const endOpt = optimalCurve[10];

  survivalChartEl.innerHTML = `
    <svg class="survival-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="10-year Gompertz survival curve">
      <defs>
        <linearGradient id="tealAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4fd1c5" stop-opacity="0.22" />
          <stop offset="100%" stop-color="#4fd1c5" stop-opacity="0.01" />
        </linearGradient>
      </defs>
      ${gridLines}
      ${xTicks}

      <!-- Area under current curve -->
      <path d="${toPath(currentCurve)} L${xScale(10).toFixed(1)},${(pad.top + plotH).toFixed(1)} L${xScale(0).toFixed(1)},${(pad.top + plotH).toFixed(1)} Z"
        fill="url(#tealAreaGrad)" />

      <!-- Optimal target curve -->
      <path d="${toPath(optimalCurve)}" fill="none" stroke="#e2a84b" stroke-width="1.75" stroke-dasharray="4 4" opacity="0.9" />

      <!-- Chronological baseline curve -->
      <path d="${toPath(baselineCurve)}" fill="none" stroke="#d6cfc2" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.6" />

      <!-- Current user curve -->
      <path d="${toPath(currentCurve)}" fill="none" stroke="#4fd1c5" stroke-width="2.6" />

      <!-- End markers -->
      <circle cx="${xScale(10).toFixed(1)}" cy="${yScale(endOpt.survival).toFixed(1)}" r="3.5" fill="#e2a84b" />
      <circle cx="${xScale(10).toFixed(1)}" cy="${yScale(endCur.survival).toFixed(1)}" r="4.5" fill="#0a0f14" stroke="#4fd1c5" stroke-width="2.4" />
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
      mech: 'Baseline Gompertz log-hazard anchor fitted to NHANES III.',
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
renderAll();
