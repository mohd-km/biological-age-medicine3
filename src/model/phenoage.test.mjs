import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BIOMARKERS,
  PRESETS,
  calculatePhenoAge,
  computeTornadoLeverage,
  generateSurvivalCurve,
} from './phenoage.js';

test('exact Levine et al. (2018) PhenoAge formula matches direct reference calculation', () => {
  const sample = {
    age: 50,
    albumin: 43,
    creatinine: 80,
    glucose: 5.2,
    crp: 0.2,
    lymphocyte: 30,
    mcv: 90,
    rdw: 13.0,
    alp: 70,
    wbc: 6.5,
  };

  // Direct formula from Levine et al. (2018), Aging 10(4):573-591
  const expectedXb =
    -19.9067 -
    0.0336 * sample.albumin +
    0.0095 * sample.creatinine +
    0.1953 * sample.glucose +
    0.0954 * Math.log(sample.crp) -
    0.0120 * sample.lymphocyte +
    0.0268 * sample.mcv +
    0.3306 * sample.rdw +
    0.00188 * sample.alp +
    0.0554 * sample.wbc +
    0.0804 * sample.age;

  const expectedM = 1 - Math.exp((-1.51714 * Math.exp(expectedXb)) / 0.0076927);
  const expectedPhenoAge =
    141.50225 + Math.log(-0.00553 * Math.log(1 - expectedM)) / 0.090165;

  const result = calculatePhenoAge(sample);

  assert.ok(Math.abs(result.xb - expectedXb) < 1e-12, `xb mismatch: ${result.xb} vs ${expectedXb}`);
  assert.ok(
    Math.abs(result.mortality10Yr - expectedM) < 1e-12,
    `M mismatch: ${result.mortality10Yr} vs ${expectedM}`
  );
  assert.ok(
    Math.abs(result.phenoAge - expectedPhenoAge) < 1e-9,
    `PhenoAge mismatch: ${result.phenoAge} vs ${expectedPhenoAge}`
  );
});

test('presets produce clinically ordered PhenoAge and mortality scores', () => {
  const optimal = calculatePhenoAge(PRESETS.optimal.values);
  const average = calculatePhenoAge(PRESETS.average.values);
  const elevated = calculatePhenoAge(PRESETS.elevated.values);

  assert.ok(optimal.phenoAge < average.phenoAge, 'Optimal must have lower PhenoAge than Average');
  assert.ok(average.phenoAge < elevated.phenoAge, 'Average must have lower PhenoAge than Elevated');
  assert.ok(optimal.ageAcceleration < -5, `Expected strong negative acceleration for optimal, got ${optimal.ageAcceleration}`);
  assert.ok(elevated.ageAcceleration > 8, `Expected strong positive acceleration for elevated, got ${elevated.ageAcceleration}`);
  assert.ok(optimal.mortality10Yr < average.mortality10Yr && average.mortality10Yr < elevated.mortality10Yr);
});

test('SI <-> US unit conversions are exact round-trips for all 9 biomarkers', () => {
  for (const bm of BIOMARKERS) {
    const mid = (bm.min + bm.max) / 2;
    const viaSI = bm.fromSI(bm.toSI(mid));
    const viaUS = bm.fromUS(bm.toUS(mid));
    assert.ok(Math.abs(viaSI - mid) < 1e-10, `SI round-trip failed for ${bm.key}`);
    assert.ok(Math.abs(viaUS - mid) < 1e-10, `US round-trip failed for ${bm.key}`);
  }
});

test('tornado leverage ranks highest-impact modifiable biomarkers first', () => {
  const tornado = computeTornadoLeverage(PRESETS.elevated.values);
  assert.equal(tornado.items.length, 9);
  for (let i = 1; i < tornado.items.length; i++) {
    assert.ok(
      tornado.items[i - 1].reductionYears >= tornado.items[i].reductionYears - 1e-9,
      'Tornado items must be sorted descending by biological age reduction'
    );
  }
  assert.ok(tornado.items[0].reductionYears > 5, 'Top lever in elevated risk profile should exceed 5 years');

  // Optimal profile should have ~0 modifiable leverage remaining
  const optTornado = computeTornadoLeverage(PRESETS.optimal.values);
  assert.ok(optTornado.totalModifiableYears < 0.01);
});

test('survival curve starts at 1.0 and ends at 1 - M at year 10', () => {
  const res = calculatePhenoAge(PRESETS.average.values);
  const curve = generateSurvivalCurve(res.xb, 10);
  assert.equal(curve.length, 11);
  assert.equal(curve[0].survival, 1);
  assert.ok(Math.abs(curve[10].mortality - res.mortality10Yr) < 1e-5);
});
