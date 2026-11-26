/**
 * Levine et al. (2018) PhenoAge Gompertz Proportional-Hazards Model
 *
 * Reference:
 * Levine ME, Lu AT, Quach A, Chen BH, Assimes TL, Bandinelli S, Hou L,
 * Baccarelli AA, Stewart JD, Li Y, Whitsel EA, Wilson JG, Reiner AP,
 * Aviv A, Lohman K, Liu Y, Ferrucci L, Horvath S.
 * "An epigenetic biomarker of aging for lifespan and healthspan."
 * Aging (Albany NY). 2018;10(4):573-591. doi:10.18632/aging.101414
 *
 * All calculations execute 100% client-side. No data is transmitted or stored.
 */

export const MODEL_CONSTANTS = Object.freeze({
  INTERCEPT: -19.9067,
  GAMMA: 0.0076927, // Gompertz shape parameter (per month)
  MONTHS_10YR: 120,
  EXP_120_GAMMA_MINUS_1: 1.51714, // exp(120 * 0.0076927) - 1
  PHENOAGE_INTERCEPT: 141.50225,
  PHENOAGE_SCALE: -0.00553,
  PHENOAGE_RATE: 0.090165,
});

/**
 * Canonical internal units match Levine et al. (2018) directly:
 * - albumin: g/L
 * - creatinine: umol/L
 * - glucose: mmol/L
 * - crp: mg/dL (Levine 2018 uses ln(CRP in mg/dL))
 * - lymphocyte: %
 * - mcv: fL
 * - rdw: %
 * - alp: U/L
 * - wbc: 10^3/uL (equivalent numerically to 10^9/L)
 * - age: years
 */
export const BIOMARKERS = Object.freeze([
  {
    key: 'albumin',
    name: 'Albumin',
    shortName: 'Albumin',
    domain: 'Hepatic & Nutritional',
    coef: -0.0336,
    direction: 'higher', // higher is protective (within physiological range)
    min: 25,
    max: 55,
    stepSI: 0.5,
    stepUS: 0.05,
    optimal: 47.0, // g/L (4.7 g/dL)
    optimalBand: [45.0, 51.0],
    clinicalRef: [35.0, 50.0],
    unitSI: 'g/L',
    unitUS: 'g/dL',
    toSI: (v) => v,
    fromSI: (v) => v,
    toUS: (v) => v / 10,
    fromUS: (v) => v * 10,
    decimalsSI: 1,
    decimalsUS: 2,
    rationale: 'Reflects hepatic synthetic capacity, nutritional reserve, and chronic systemic inflammation.',
  },
  {
    key: 'creatinine',
    name: 'Creatinine',
    shortName: 'Creatinine',
    domain: 'Renal Filtration',
    coef: 0.0095,
    direction: 'lower',
    min: 35,
    max: 220,
    stepSI: 1,
    stepUS: 0.02,
    optimal: 68.0, // umol/L (~0.77 mg/dL)
    optimalBand: [55.0, 80.0],
    clinicalRef: [53.0, 115.0],
    unitSI: 'umol/L',
    unitUS: 'mg/dL',
    toSI: (v) => v,
    fromSI: (v) => v,
    toUS: (v) => v / 88.42,
    fromUS: (v) => v * 88.42,
    decimalsSI: 0,
    decimalsUS: 2,
    rationale: 'Primary filtration marker of glomerular clearance and muscle turnover.',
  },
  {
    key: 'glucose',
    name: 'Fasting Glucose',
    shortName: 'Glucose',
    domain: 'Glycemic Control',
    coef: 0.1953,
    direction: 'lower',
    min: 3.3,
    max: 14.0,
    stepSI: 0.1,
    stepUS: 1,
    optimal: 4.55, // mmol/L (~82 mg/dL)
    optimalBand: [4.1, 4.9],
    clinicalRef: [3.9, 5.5],
    unitSI: 'mmol/L',
    unitUS: 'mg/dL',
    toSI: (v) => v,
    fromSI: (v) => v,
    toUS: (v) => v * 18.0182,
    fromUS: (v) => v / 18.0182,
    decimalsSI: 2,
    decimalsUS: 0,
    rationale: 'Captures insulin sensitivity, glycation burden, and cardiometabolic trajectory.',
  },
  {
    key: 'crp',
    name: 'C-Reactive Protein (hs-CRP)',
    shortName: 'hs-CRP',
    domain: 'Systemic Inflammation',
    coef: 0.0954,
    isLog: true,
    direction: 'lower',
    min: 0.01, // mg/dL (0.1 mg/L)
    max: 3.0, // mg/dL (30 mg/L)
    stepSI: 0.1, // mg/L
    stepUS: 0.01, // mg/dL
    optimal: 0.04, // mg/dL (0.4 mg/L)
    optimalBand: [0.01, 0.08],
    clinicalRef: [0.01, 0.30],
    unitSI: 'mg/L',
    unitUS: 'mg/dL',
    toSI: (v) => v * 10,
    fromSI: (v) => v / 10,
    toUS: (v) => v,
    fromUS: (v) => v,
    decimalsSI: 2,
    decimalsUS: 2,
    rationale: 'Acute-phase reactant measuring low-grade vascular and inflammaging burden (entered as ln(mg/dL)).',
  },
  {
    key: 'lymphocyte',
    name: 'Lymphocyte Percent',
    shortName: 'Lymphocyte %',
    domain: 'Adaptive Immunity',
    coef: -0.0120,
    direction: 'higher',
    min: 8,
    max: 55,
    stepSI: 0.5,
    stepUS: 0.5,
    optimal: 36.0, // %
    optimalBand: [30.0, 42.0],
    clinicalRef: [20.0, 40.0],
    unitSI: '%',
    unitUS: '%',
    toSI: (v) => v,
    fromSI: (v) => v,
    toUS: (v) => v,
    fromUS: (v) => v,
    decimalsSI: 1,
    decimalsUS: 1,
    rationale: 'Lower relative lymphocyte fraction tracks immunosenescence and physiological stress.',
  },
  {
    key: 'mcv',
    name: 'Mean Cell Volume (MCV)',
    shortName: 'MCV',
    domain: 'Erythropoiesis',
    coef: 0.0268,
    direction: 'lower',
    min: 70,
    max: 110,
    stepSI: 0.5,
    stepUS: 0.5,
    optimal: 86.0, // fL
    optimalBand: [82.0, 89.0],
    clinicalRef: [80.0, 100.0],
    unitSI: 'fL',
    unitUS: 'fL',
    toSI: (v) => v,
    fromSI: (v) => v,
    toUS: (v) => v,
    fromUS: (v) => v,
    decimalsSI: 1,
    decimalsUS: 1,
    rationale: 'Average erythrocyte volume; macrocytosis associates with B12/folate status and marrow aging.',
  },
  {
    key: 'rdw',
    name: 'Red Cell Distribution Width (RDW)',
    shortName: 'RDW',
    domain: 'Hematologic Stability',
    coef: 0.3306,
    direction: 'lower',
    min: 10.5,
    max: 18.5,
    stepSI: 0.1,
    stepUS: 0.1,
    optimal: 11.8, // %
    optimalBand: [11.2, 12.4],
    clinicalRef: [11.5, 14.5],
    unitSI: '%',
    unitUS: '%',
    toSI: (v) => v,
    fromSI: (v) => v,
    toUS: (v) => v,
    fromUS: (v) => v,
    decimalsSI: 1,
    decimalsUS: 1,
    rationale: 'Anisocytosis index; one of the strongest routine-lab predictors of all-cause mortality.',
  },
  {
    key: 'alp',
    name: 'Alkaline Phosphatase (ALP)',
    shortName: 'ALP',
    domain: 'Hepatobiliary & Bone',
    coef: 0.00188,
    direction: 'lower',
    min: 25,
    max: 200,
    stepSI: 1,
    stepUS: 1,
    optimal: 52.0, // U/L
    optimalBand: [40.0, 68.0],
    clinicalRef: [44.0, 147.0],
    unitSI: 'U/L',
    unitUS: 'U/L',
    toSI: (v) => v,
    fromSI: (v) => v,
    toUS: (v) => v,
    fromUS: (v) => v,
    decimalsSI: 0,
    decimalsUS: 0,
    rationale: 'Reflects hepatobiliary turnover, bone remodeling, and vascular calcification risk.',
  },
  {
    key: 'wbc',
    name: 'White Blood Cell Count (WBC)',
    shortName: 'WBC',
    domain: 'Innate Immunity',
    coef: 0.0554,
    direction: 'lower',
    min: 2.5,
    max: 14.0,
    stepSI: 0.1,
    stepUS: 0.1,
    optimal: 4.8, // 10^3/uL
    optimalBand: [4.0, 5.8],
    clinicalRef: [4.5, 11.0],
    unitSI: '10^9/L',
    unitUS: '10^3/uL',
    toSI: (v) => v,
    fromSI: (v) => v,
    toUS: (v) => v,
    fromUS: (v) => v,
    decimalsSI: 1,
    decimalsUS: 1,
    rationale: 'Elevated baseline leukocyte count within normal limits tracks chronic inflammatory tone.',
  },
]);

export const AGE_COEF = 0.0804;

export const PRESETS = Object.freeze({
  optimal: {
    id: 'optimal',
    label: 'Optimal Longevity Profile',
    tag: 'Medicine 3.0 Target',
    description: 'Low systemic inflammation, tight fasting glycemia, high albumin reserve, and low erythrocyte heterogeneity.',
    values: {
      age: 45,
      albumin: 47.0,
      creatinine: 68.0,
      glucose: 4.55,
      crp: 0.04,
      lymphocyte: 36.0,
      mcv: 86.0,
      rdw: 11.8,
      alp: 52.0,
      wbc: 4.8,
    },
  },
  average: {
    id: 'average',
    label: 'Average Adult',
    tag: 'NHANES Population Baseline',
    description: 'Representative mid-life adult within standard clinical reference intervals across all 9 biomarkers.',
    values: {
      age: 45,
      albumin: 42.0,
      creatinine: 82.0,
      glucose: 5.45,
      crp: 0.24,
      lymphocyte: 29.0,
      mcv: 90.0,
      rdw: 13.4,
      alp: 76.0,
      wbc: 7.1,
    },
  },
  elevated: {
    id: 'elevated',
    label: 'Elevated Metabolic Risk',
    tag: 'Accelerated Aging Signal',
    description: 'Impaired fasting glucose, subclinical inflammation, elevated RDW and leukocytes, and reduced albumin.',
    values: {
      age: 45,
      albumin: 38.0,
      creatinine: 106.0,
      glucose: 7.2,
      crp: 0.85,
      lymphocyte: 21.0,
      mcv: 95.0,
      rdw: 14.9,
      alp: 112.0,
      wbc: 9.4,
    },
  },
});

/**
 * Computes the exact Levine et al. (2018) PhenoAge, Age Acceleration,
 * 10-year mortality score M, linear predictor xb, and per-term contributions.
 */
export function calculatePhenoAge(inputs) {
  const safeCrp = Math.max(inputs.crp, 0.001);
  const lnCrp = Math.log(safeCrp);

  const terms = {
    intercept: MODEL_CONSTANTS.INTERCEPT,
    albumin: -0.0336 * inputs.albumin,
    creatinine: 0.0095 * inputs.creatinine,
    glucose: 0.1953 * inputs.glucose,
    crp: 0.0954 * lnCrp,
    lymphocyte: -0.0120 * inputs.lymphocyte,
    mcv: 0.0268 * inputs.mcv,
    rdw: 0.3306 * inputs.rdw,
    alp: 0.00188 * inputs.alp,
    wbc: 0.0554 * inputs.wbc,
    age: AGE_COEF * inputs.age,
  };

  const xb =
    terms.intercept +
    terms.albumin +
    terms.creatinine +
    terms.glucose +
    terms.crp +
    terms.lymphocyte +
    terms.mcv +
    terms.rdw +
    terms.alp +
    terms.wbc +
    terms.age;

  const expXb = Math.exp(xb);
  const gompertzRatio = MODEL_CONSTANTS.EXP_120_GAMMA_MINUS_1 / MODEL_CONSTANTS.GAMMA;
  const lnOneMinusM = -gompertzRatio * expXb;

  // 10-year mortality probability M = 1 - exp(lnOneMinusM)
  const mortality10Yr = 1 - Math.exp(lnOneMinusM);

  // Analytically identical to 141.50225 + ln(-0.00553 * ln(1 - M)) / 0.090165
  // while remaining numerically stable even when M approaches 1.0
  const phenoAge =
    MODEL_CONSTANTS.PHENOAGE_INTERCEPT +
    (Math.log(Math.abs(MODEL_CONSTANTS.PHENOAGE_SCALE) * gompertzRatio) + xb) /
      MODEL_CONSTANTS.PHENOAGE_RATE;

  const ageAcceleration = phenoAge - inputs.age;

  // Chronological-age-matched population reference (where PhenoAge == Chronological Age)
  const xbChronoRef =
    MODEL_CONSTANTS.PHENOAGE_RATE * (inputs.age - MODEL_CONSTANTS.PHENOAGE_INTERCEPT) -
    Math.log(Math.abs(MODEL_CONSTANTS.PHENOAGE_SCALE) * gompertzRatio);
  const hazardRatioVsBaseline = Math.exp(xb - xbChronoRef);
  const mortality10YrRef = 1 - Math.exp(-gompertzRatio * Math.exp(xbChronoRef));

  return {
    xb,
    lnCrp,
    mortality10Yr,
    mortality10YrRef,
    phenoAge,
    ageAcceleration,
    hazardRatioVsBaseline,
    xbChronoRef,
    terms,
  };
}

/**
 * Generates 10-year Gompertz survival probabilities S(t) for t in [0..10] years.
 * Under the Levine Gompertz proportional-hazards model:
 * S(t_months) = exp( -((exp(gamma * t_months) - 1) / gamma) * exp(xb) )
 */
export function generateSurvivalCurve(xb, years = 10) {
  const points = [];
  const expXb = Math.exp(xb);
  for (let y = 0; y <= years; y++) {
    const months = y * 12;
    const cumHazard =
      months === 0
        ? 0
        : ((Math.exp(MODEL_CONSTANTS.GAMMA * months) - 1) / MODEL_CONSTANTS.GAMMA) * expXb;
    const survival = Math.exp(-cumHazard);
    points.push({
      year: y,
      survival,
      mortality: 1 - survival,
    });
  }
  return points;
}

/**
 * Modifiable Leverage Tornado Analysis:
 * Evaluates moving each single biomarker independently from its current value
 * to its Medicine 3.0 optimal target, ranking by biological age reduction (years).
 */
export function computeTornadoLeverage(inputs) {
  const base = calculatePhenoAge(inputs);

  const items = BIOMARKERS.map((bm) => {
    const currentVal = inputs[bm.key];
    const targetVal = bm.optimal;

    // Determine whether moving toward optimal would actually improve (reduce) PhenoAge
    const modifiedInputs = { ...inputs, [bm.key]: targetVal };
    const modified = calculatePhenoAge(modifiedInputs);

    // Positive reductionYears means moving to optimal reduces PhenoAge (beneficial)
    const rawDeltaYears = base.phenoAge - modified.phenoAge;
    const reductionYears = Math.max(0, rawDeltaYears);
    const surplusYears = Math.max(0, -rawDeltaYears);
    const mortalityDeltaPct = (base.mortality10Yr - modified.mortality10Yr) * 100;

    return {
      key: bm.key,
      name: bm.name,
      shortName: bm.shortName,
      domain: bm.domain,
      currentVal,
      targetVal,
      reductionYears,
      surplusYears,
      rawDeltaYears,
      mortalityDeltaPct: Math.max(0, mortalityDeltaPct),
      isAlreadyOptimal: reductionYears < 0.05,
      biomarker: bm,
    };
  });

  // Sort by highest modifiable reduction first, then by surplus/name
  items.sort((a, b) => {
    if (Math.abs(b.reductionYears - a.reductionYears) > 1e-6) {
      return b.reductionYears - a.reductionYears;
    }
    return a.surplusYears - b.surplusYears;
  });

  return {
    base,
    items,
    totalModifiableYears: items.reduce((sum, item) => sum + item.reductionYears, 0),
  };
}

/**
 * Formats a canonical value into the active display unit system ('SI' or 'US').
 */
export function formatBiomarkerValue(bm, canonicalValue, unitSystem) {
  const converted = unitSystem === 'US' ? bm.toUS(canonicalValue) : bm.toSI(canonicalValue);
  const decimals = unitSystem === 'US' ? bm.decimalsUS : bm.decimalsSI;
  return converted.toFixed(decimals);
}

export function getBiomarkerUnit(bm, unitSystem) {
  return unitSystem === 'US' ? bm.unitUS : bm.unitSI;
}

export function getBiomarkerStatus(bm, canonicalValue) {
  const [optMin, optMax] = bm.optimalBand;
  const [refMin, refMax] = bm.clinicalRef;

  if (canonicalValue >= optMin && canonicalValue <= optMax) {
    return { code: 'optimal', label: 'Optimal' };
  }
  if (bm.direction === 'lower') {
    if (canonicalValue < optMin && canonicalValue >= refMin * 0.85) {
      return { code: 'optimal', label: 'Optimal' };
    }
    if (canonicalValue <= refMax) {
      return { code: 'normal', label: 'Standard Ref' };
    }
    return { code: 'elevated', label: 'Elevated Risk' };
  } else {
    // higher is protective (albumin, lymphocyte)
    if (canonicalValue > optMax && canonicalValue <= refMax * 1.1) {
      return { code: 'optimal', label: 'Optimal' };
    }
    if (canonicalValue >= refMin) {
      return { code: 'normal', label: 'Standard Ref' };
    }
    return { code: 'elevated', label: 'Suboptimal' };
  }
}

/**
 * Private "What-If" Optimizer:
 * Computes the exact shifts across up to `maxMarkers` (default 3) highest-leverage
 * biomarkers needed to drop biological age by `targetDropYears` (default 3.0 yrs).
 *
 * Uses proportional scaling in linear-predictor (xb) space toward each marker's
 * Medicine 3.0 optimal target, handling ln(CRP) analytically so the resulting
 * PhenoAge drop is mathematically exact whenever achievable within optimal bounds.
 */
export function computeWhatIfOptimizer(inputs, targetDropYears = 3.0, maxMarkers = 3) {
  const tornado = computeTornadoLeverage(inputs);
  const base = tornado.base;

  const modifiable = tornado.items.filter((item) => item.reductionYears >= 0.05);
  const selected = modifiable.slice(0, maxMarkers);

  const maxAchievableYears = selected.reduce((sum, item) => sum + item.reductionYears, 0);

  if (selected.length === 0 || maxAchievableYears < 0.05) {
    return {
      targetDropYears,
      achievedDropYears: 0,
      isFullyAchievable: false,
      alreadyOptimal: true,
      basePhenoAge: base.phenoAge,
      projectedPhenoAge: base.phenoAge,
      projectedXb: base.xb,
      projectedMortality10Yr: base.mortality10Yr,
      projectedInputs: { ...inputs },
      shifts: [],
    };
  }

  const scale = Math.min(1, targetDropYears / maxAchievableYears);
  const projectedInputs = { ...inputs };
  const shifts = [];

  for (const item of selected) {
    const bm = item.biomarker;
    const curVal = inputs[bm.key];
    const optVal = bm.optimal;

    let targetVal;
    if (bm.isLog) {
      const lnCur = Math.log(Math.max(curVal, 0.001));
      const lnOpt = Math.log(Math.max(optVal, 0.001));
      targetVal = Math.exp(lnCur + scale * (lnOpt - lnCur));
    } else {
      targetVal = curVal + scale * (optVal - curVal);
    }

    projectedInputs[bm.key] = targetVal;
    shifts.push({
      key: bm.key,
      name: bm.name,
      shortName: bm.shortName,
      domain: bm.domain,
      currentVal: curVal,
      targetVal,
      optimalVal: optVal,
      dropYears: item.reductionYears * scale,
      biomarker: bm,
    });
  }

  const projected = calculatePhenoAge(projectedInputs);
  const achievedDropYears = Math.max(0, base.phenoAge - projected.phenoAge);

  return {
    targetDropYears,
    achievedDropYears,
    isFullyAchievable: maxAchievableYears + 1e-6 >= targetDropYears,
    alreadyOptimal: false,
    basePhenoAge: base.phenoAge,
    projectedPhenoAge: projected.phenoAge,
    projectedXb: projected.xb,
    projectedMortality10Yr: projected.mortality10Yr,
    projectedInputs,
    shifts,
  };
}

/**
 * Generates a 100% client-side private Markdown clinical discussion summary
 * for downloading or sharing with a physician.
 */
export function generateDoctorSummaryMarkdown(inputs, result, optimizerPlan, unitSystem = 'SI') {
  const today = new Date().toISOString().slice(0, 10);
  const sign = result.ageAcceleration >= 0 ? '+' : '';
  const lines = [
    `# Biological Age (PhenoAge) Discussion Summary`,
    ``,
    `- **Date:** ${today}`,
    `- **Model:** Levine et al. (2018) PhenoAge Gompertz Proportional-Hazards Model (*Aging* 10(4):573-591, doi:10.18632/aging.101414)`,
    `- **Privacy:** Computed 100% locally in browser; no values transmitted or stored.`,
    `- **Unit System:** ${unitSystem}`,
    ``,
    `## Summary Outcomes`,
    ``,
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Chronological Age | ${inputs.age.toFixed(1)} years |`,
    `| Phenotypic Biological Age (PhenoAge) | **${result.phenoAge.toFixed(1)} years** |`,
    `| Age Acceleration | **${sign}${result.ageAcceleration.toFixed(1)} years** |`,
    `| 10-Year All-Cause Mortality Score (M) | ${(result.mortality10Yr * 100).toFixed(2)}% (age-matched ref: ${(result.mortality10YrRef * 100).toFixed(2)}%) |`,
    `| Relative Hazard vs. Age-Matched Baseline | ${result.hazardRatioVsBaseline.toFixed(2)}x |`,
    `| Linear Predictor (xb) | ${result.xb.toFixed(4)} |`,
    ``,
    `## Current Biomarker Panel`,
    ``,
    `| Biomarker | Domain | Current | Optimal Target | Status |`,
    `| --- | --- | --- | --- | --- |`,
  ];

  for (const bm of BIOMARKERS) {
    const unit = getBiomarkerUnit(bm, unitSystem);
    const cur = formatBiomarkerValue(bm, inputs[bm.key], unitSystem);
    const opt = formatBiomarkerValue(bm, bm.optimal, unitSystem);
    const status = getBiomarkerStatus(bm, inputs[bm.key]).label;
    lines.push(`| ${bm.name} | ${bm.domain} | ${cur} ${unit} | ${opt} ${unit} | ${status} |`);
  }

  lines.push(``);
  lines.push(`## Private "What-If" Optimizer (-${optimizerPlan.targetDropYears.toFixed(0)} yr Target)`);
  lines.push(``);

  if (optimizerPlan.alreadyOptimal || optimizerPlan.shifts.length === 0) {
    lines.push(
      `All 9 biomarkers are already at or near Medicine 3.0 optimal targets. No high-leverage shifts remain.`
    );
  } else {
    lines.push(
      `Projected PhenoAge: **${optimizerPlan.projectedPhenoAge.toFixed(1)} years** (-${optimizerPlan.achievedDropYears.toFixed(2)} yrs; 10-yr mortality ${(optimizerPlan.projectedMortality10Yr * 100).toFixed(2)}%).`
    );
    lines.push(``);
    lines.push(`| Priority | Biomarker | Current | Suggested Target | Biological Age Impact |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    optimizerPlan.shifts.forEach((s, idx) => {
      const unit = getBiomarkerUnit(s.biomarker, unitSystem);
      const cur = formatBiomarkerValue(s.biomarker, s.currentVal, unitSystem);
      const tgt = formatBiomarkerValue(s.biomarker, s.targetVal, unitSystem);
      lines.push(`| #${idx + 1} | ${s.name} | ${cur} ${unit} | ${tgt} ${unit} | -${s.dropYears.toFixed(2)} yrs |`);
    });
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(
    `*Educational and research summary only. Not a medical device or clinical diagnosis. Discuss lab targets and any interventions with a licensed physician.*`
  );

  return lines.join('\n');
}
