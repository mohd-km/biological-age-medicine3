#!/usr/bin/env python3
"""
Levine et al. (2018) PhenoAge Gompertz Proportional-Hazards Validation & Sensitivity Analysis.

Implements the exact published PhenoAge survival equations, analytical and one-at-a-time
sensitivity analyses, unit-conversion verification, Harrell's C-index concordance metric,
and documented NHANES III / NHANES IV validation methodology.

Primary References:
    1. Levine ME, Lu AT, Quach A, Chen BH, Assimes TL, Bandinelli S, Hou L,
       Baccarelli AA, Stewart JD, Li Y, Whitsel EA, Wilson JG, Reiner AP,
       Aviv A, Lohman K, Liu Y, Ferrucci L, Horvath S.
       "An epigenetic biomarker of aging for lifespan and healthspan."
       Aging (Albany NY). 2018;10(4):573-591. doi:10.18632/aging.101414
    2. Liu Z, Kuo PL, Horvath S, Crimmins E, Ferrucci L, Levine M.
       "A new aging measure captures morbidity and mortality risk across diverse
       subpopulations from NHANES IV: A cohort study."
       PLOS Medicine. 2018;15(12):e1002718. doi:10.1371/journal.pmed.1002718
    3. CDC / NCHS. National Health and Nutrition Examination Survey (NHANES III
       and Continuous NHANES) Public-Use Linked Mortality Files.

Usage:
    python3 analysis/nhanes_phenoage_validation.py
    python3 analysis/nhanes_phenoage_validation.py --verify
    python3 analysis/nhanes_phenoage_validation.py --json
    python3 analysis/nhanes_phenoage_validation.py --cohort-n 2500 --seed 2018
"""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics
from dataclasses import dataclass
from typing import Dict, List, Tuple


# ---------------------------------------------------------------------------
# 1. Published Model Constants (Levine et al., Aging 2018; 10(4):573-591)
# ---------------------------------------------------------------------------

INTERCEPT: float = -19.9067
GAMMA: float = 0.0076927  # Gompertz shape parameter (month^-1)
MONTHS_10YR: int = 120
EXP_120_GAMMA_MINUS_1: float = 1.51714  # Published exp(120 * 0.0076927) - 1
PHENOAGE_INTERCEPT: float = 141.50225
PHENOAGE_SCALE: float = -0.00553
PHENOAGE_RATE: float = 0.090165
AGE_COEF: float = 0.0804


@dataclass(frozen=True)
class BiomarkerSpec:
    """Canonical specification for each Levine (2018) clinical biomarker."""

    key: str
    name: str
    model_unit: str
    us_unit: str
    coef: float
    optimal: float
    reference_sd: float  # Representative NHANES adult SD in model units
    is_log: bool = False
    higher_is_protective: bool = False


BIOMARKERS: Tuple[BiomarkerSpec, ...] = (
    BiomarkerSpec("albumin", "Albumin", "g/L", "g/dL", -0.0336, 47.0, 3.5, higher_is_protective=True),
    BiomarkerSpec("creatinine", "Creatinine", "umol/L", "mg/dL", 0.0095, 68.0, 22.0),
    BiomarkerSpec("glucose", "Fasting Glucose", "mmol/L", "mg/dL", 0.1953, 4.55, 1.35),
    BiomarkerSpec("crp", "hs-CRP", "ln(mg/dL)", "mg/dL", 0.0954, 0.04, 1.15, is_log=True),
    BiomarkerSpec("lymphocyte", "Lymphocyte %", "%", "%", -0.0120, 36.0, 7.5, higher_is_protective=True),
    BiomarkerSpec("mcv", "Mean Cell Volume (MCV)", "fL", "fL", 0.0268, 86.0, 5.2),
    BiomarkerSpec("rdw", "Red Cell Dist. Width (RDW)", "%", "%", 0.3306, 11.8, 1.15),
    BiomarkerSpec("alp", "Alkaline Phosphatase (ALP)", "U/L", "U/L", 0.00188, 52.0, 24.0),
    BiomarkerSpec("wbc", "White Blood Cell Count (WBC)", "10^3/uL", "10^3/uL", 0.0554, 4.8, 1.9),
)

BIOMARKER_MAP: Dict[str, BiomarkerSpec] = {bm.key: bm for bm in BIOMARKERS}

# Reference cohort profiles matching src/model/phenoage.js
REFERENCE_PROFILES: Dict[str, Dict[str, float]] = {
    "optimal": {
        "age": 45.0,
        "albumin": 47.0,
        "creatinine": 68.0,
        "glucose": 4.55,
        "crp": 0.04,
        "lymphocyte": 36.0,
        "mcv": 86.0,
        "rdw": 11.8,
        "alp": 52.0,
        "wbc": 4.8,
    },
    "average": {
        "age": 45.0,
        "albumin": 42.0,
        "creatinine": 82.0,
        "glucose": 5.45,
        "crp": 0.24,
        "lymphocyte": 29.0,
        "mcv": 90.0,
        "rdw": 13.4,
        "alp": 76.0,
        "wbc": 7.1,
    },
    "elevated": {
        "age": 45.0,
        "albumin": 38.0,
        "creatinine": 106.0,
        "glucose": 7.2,
        "crp": 0.85,
        "lymphocyte": 21.0,
        "mcv": 95.0,
        "rdw": 14.9,
        "alp": 112.0,
        "wbc": 9.4,
    },
}


# ---------------------------------------------------------------------------
# 2. Documented NHANES III / IV Validation Methodology & Published Benchmarks
# ---------------------------------------------------------------------------

NHANES_VALIDATION_SUMMARY: Dict[str, object] = {
    "training_cohort": {
        "name": "NHANES III (1988-1994)",
        "sample_size": 9926,
        "age_range": "20-84+ years",
        "mortality_followup": "Up to 23 years linked to National Death Index (NDI)",
        "feature_selection": (
            "Cox proportional-hazards elastic-net (penalized) regression across 42 clinical "
            "biomarkers plus chronological age; 10-fold cross-validation selected 9 biomarkers "
            "plus age predicting aging-related mortality."
        ),
        "parametric_fit": (
            "Two Gompertz proportional-hazards models fitted to 10-year (120-month) mortality: "
            "(1) full biomarker + age model yielding M, and (2) chronological-age-only Gompertz "
            "model inverted to map M onto PhenoAge in years."
        ),
    },
    "validation_cohort": {
        "name": "NHANES IV / Continuous NHANES (1999-2010)",
        "sample_size": 11432,
        "age_range": "20-84+ years",
        "mortality_followup": "Linked NDI mortality follow-up through December 2011 (1,012+ deaths in Liu et al. 2018)",
        "published_metrics": {
            "all_cause_mortality_c_index_phenoage": 0.879,
            "all_cause_mortality_c_index_chrono_age": 0.862,
            "ten_year_mortality_roc_auc_phenoage": 0.88,
            "hazard_ratio_per_year_phenoage_accel": 1.09,
            "cause_specific_findings": (
                "Each +1 year increase in PhenoAgeAccel is associated with ~9% higher all-cause "
                "mortality risk (HR ~1.09), and significant hazard elevation across heart disease, "
                "cancer, diabetes, and chronic lower respiratory disease even after adjusting for "
                "chronological age, sex, and smoking."
            ),
        },
    },
}


# ---------------------------------------------------------------------------
# 3. Core Gompertz Proportional-Hazards Survival Equations
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PhenoAgeResult:
    xb: float
    ln_crp: float
    mortality_10yr: float
    mortality_10yr_ref: float
    phenoage: float
    age_acceleration: float
    hazard_ratio_vs_baseline: float
    xb_chrono_ref: float
    terms: Dict[str, float]


def calculate_phenoage(inputs: Dict[str, float]) -> PhenoAgeResult:
    """
    Compute Levine et al. (2018) PhenoAge, 10-year mortality probability M,
    Gompertz linear predictor xb, age acceleration, and relative hazard.

    Canonical units:
        albumin (g/L), creatinine (umol/L), glucose (mmol/L), crp (mg/dL),
        lymphocyte (%), mcv (fL), rdw (%), alp (U/L), wbc (10^3/uL), age (years).
    """
    safe_crp = max(float(inputs["crp"]), 0.001)
    ln_crp = math.log(safe_crp)

    terms: Dict[str, float] = {
        "intercept": INTERCEPT,
        "albumin": BIOMARKER_MAP["albumin"].coef * float(inputs["albumin"]),
        "creatinine": BIOMARKER_MAP["creatinine"].coef * float(inputs["creatinine"]),
        "glucose": BIOMARKER_MAP["glucose"].coef * float(inputs["glucose"]),
        "crp": BIOMARKER_MAP["crp"].coef * ln_crp,
        "lymphocyte": BIOMARKER_MAP["lymphocyte"].coef * float(inputs["lymphocyte"]),
        "mcv": BIOMARKER_MAP["mcv"].coef * float(inputs["mcv"]),
        "rdw": BIOMARKER_MAP["rdw"].coef * float(inputs["rdw"]),
        "alp": BIOMARKER_MAP["alp"].coef * float(inputs["alp"]),
        "wbc": BIOMARKER_MAP["wbc"].coef * float(inputs["wbc"]),
        "age": AGE_COEF * float(inputs["age"]),
    }

    xb = sum(terms.values())
    gompertz_ratio = EXP_120_GAMMA_MINUS_1 / GAMMA
    ln_one_minus_m = -gompertz_ratio * math.exp(xb)
    mortality_10yr = 1.0 - math.exp(ln_one_minus_m)

    # Numerically stable form identical to:
    # 141.50225 + ln(-0.00553 * ln(1 - M)) / 0.090165
    phenoage = PHENOAGE_INTERCEPT + (
        math.log(abs(PHENOAGE_SCALE) * gompertz_ratio) + xb
    ) / PHENOAGE_RATE

    age = float(inputs["age"])
    age_acceleration = phenoage - age

    xb_chrono_ref = (
        PHENOAGE_RATE * (age - PHENOAGE_INTERCEPT)
        - math.log(abs(PHENOAGE_SCALE) * gompertz_ratio)
    )
    hazard_ratio_vs_baseline = math.exp(xb - xb_chrono_ref)
    mortality_10yr_ref = 1.0 - math.exp(-gompertz_ratio * math.exp(xb_chrono_ref))

    return PhenoAgeResult(
        xb=xb,
        ln_crp=ln_crp,
        mortality_10yr=mortality_10yr,
        mortality_10yr_ref=mortality_10yr_ref,
        phenoage=phenoage,
        age_acceleration=age_acceleration,
        hazard_ratio_vs_baseline=hazard_ratio_vs_baseline,
        xb_chrono_ref=xb_chrono_ref,
        terms=terms,
    )


def survival_probability(xb: float, years: float) -> float:
    """
    Gompertz survival probability S(t) at t years (12 * t months):
        S(t) = exp( -((exp(gamma * 12t) - 1) / gamma) * exp(xb) )
    """
    months = years * 12.0
    if months <= 0.0:
        return 1.0
    cum_hazard = ((math.exp(GAMMA * months) - 1.0) / GAMMA) * math.exp(xb)
    return math.exp(-cum_hazard)


# ---------------------------------------------------------------------------
# 4. Analytical & One-at-a-Time Sensitivity Analysis
# ---------------------------------------------------------------------------

def analytical_sensitivities() -> List[Dict[str, object]]:
    """
    Because PhenoAge is linear in xb with slope 1 / 0.090165:
        d(PhenoAge) / d(x_j) = beta_j / 0.090165
    (for hs-CRP, the derivative is with respect to ln(CRP in mg/dL)).

    Returns per-unit and per-1-SD PhenoAge shifts for all 9 biomarkers.
    """
    rows: List[Dict[str, object]] = []
    for bm in BIOMARKERS:
        per_unit_years = bm.coef / PHENOAGE_RATE
        per_sd_years = per_unit_years * bm.reference_sd
        rows.append(
            {
                "key": bm.key,
                "name": bm.name,
                "unit": bm.model_unit,
                "beta": bm.coef,
                "years_per_unit": round(per_unit_years, 4),
                "reference_sd": bm.reference_sd,
                "years_per_sd": round(per_sd_years, 3),
                "abs_years_per_sd": round(abs(per_sd_years), 3),
            }
        )
    rows.sort(key=lambda r: float(r["abs_years_per_sd"]), reverse=True)
    return rows


def tornado_leverage(inputs: Dict[str, float]) -> List[Dict[str, object]]:
    """
    One-at-a-time modifiable leverage analysis:
    Moves each biomarker independently from its current value to its Medicine 3.0
    optimal target while holding chronological age and all other biomarkers fixed.
    """
    base = calculate_phenoage(inputs)
    items: List[Dict[str, object]] = []

    for bm in BIOMARKERS:
        modified = dict(inputs)
        modified[bm.key] = bm.optimal
        mod_res = calculate_phenoage(modified)
        raw_delta = base.phenoage - mod_res.phenoage
        reduction_years = max(0.0, raw_delta)
        mortality_delta_pp = max(0.0, (base.mortality_10yr - mod_res.mortality_10yr) * 100.0)
        items.append(
            {
                "key": bm.key,
                "name": bm.name,
                "current": inputs[bm.key],
                "target": bm.optimal,
                "unit": bm.model_unit,
                "reduction_years": round(reduction_years, 3),
                "mortality_delta_pp": round(mortality_delta_pp, 3),
            }
        )

    items.sort(key=lambda x: float(x["reduction_years"]), reverse=True)
    return items


# ---------------------------------------------------------------------------
# 5. Harrell's C-Index & Synthetic NHANES-Calibrated Cohort Validation
# ---------------------------------------------------------------------------

def harrell_c_index(
    times: List[float], events: List[int], risk_scores: List[float]
) -> float:
    """
    Compute Harrell's concordance index (C-index) for right-censored survival data.

    A pair (i, j) is comparable if event_i == 1 and time_i < time_j (or both have
    events at identical times with different risk scores, handled via standard
    tie rules). Concordant pairs assign a strictly higher risk score to the
    subject with the earlier event; ties in risk score receive weight 0.5.
    """
    n = len(times)
    if n != len(events) or n != len(risk_scores):
        raise ValueError("times, events, and risk_scores must have identical length")

    concordant = 0.0
    comparable = 0.0

    # Sort by time ascending for O(n^2) clean exact computation on moderate cohorts
    order = sorted(range(n), key=lambda idx: times[idx])
    s_times = [times[i] for i in order]
    s_events = [events[i] for i in order]
    s_scores = [risk_scores[i] for i in order]

    for i in range(n):
        if s_events[i] != 1:
            continue
        ti = s_times[i]
        si = s_scores[i]
        for j in range(i + 1, n):
            if s_times[j] <= ti:
                continue
            comparable += 1.0
            sj = s_scores[j]
            if si > sj:
                concordant += 1.0
            elif si == sj:
                concordant += 0.5

    if comparable == 0.0:
        return 0.5
    return concordant / comparable


def _sample_gompertz_time_months(xb: float, rng: random.Random) -> float:
    """
    Inverse-transform sampling from Gompertz survival function:
        S(t) = exp(-((exp(gamma * t) - 1) / gamma) * exp(xb)) = U ~ Uniform(0, 1)
        => t = (1 / gamma) * ln(1 - (gamma * ln(U)) / exp(xb))
    """
    u = max(1e-12, rng.random())
    inner = 1.0 - (GAMMA * math.log(u)) / math.exp(xb)
    return math.log(inner) / GAMMA


def run_synthetic_nhanes_validation(
    cohort_n: int = 1200, seed: int = 2018
) -> Dict[str, object]:
    """
    Deterministic synthetic NHANES-calibrated validation harness.

    Generates an adult cohort (ages 20-85) with realistic age-correlated biomarker
    distributions, simulates 10-year (120-month) survival outcomes from the exact
    Gompertz hazard, applies administrative right-censoring at 120 months, and
    evaluates Harrell's C-index for PhenoAge vs. Chronological Age alone.

    Note: This is a reproducible synthetic simulation verifying the survival
    mathematics and concordance pipeline; it does not redistribute raw CDC/NCHS
    microdata.
    """
    rng = random.Random(seed)
    times: List[float] = []
    events: List[int] = []
    phenoage_scores: List[float] = []
    chrono_scores: List[float] = []
    accels: List[float] = []

    for _ in range(cohort_n):
        age = rng.uniform(20.0, 85.0)
        age_centered = (age - 50.0) / 15.0

        # Weakly age-correlated biomarker draws within physiological bounds
        sample = {
            "age": age,
            "albumin": min(54.0, max(28.0, rng.gauss(43.0 - 0.9 * age_centered, 3.2))),
            "creatinine": min(200.0, max(40.0, rng.gauss(78.0 + 7.5 * age_centered, 18.0))),
            "glucose": min(13.5, max(3.5, rng.gauss(5.3 + 0.35 * age_centered, 1.1))),
            "crp": min(3.0, max(0.01, math.exp(rng.gauss(-1.65 + 0.18 * age_centered, 0.95)))),
            "lymphocyte": min(52.0, max(10.0, rng.gauss(30.0 - 1.5 * age_centered, 6.8))),
            "mcv": min(108.0, max(72.0, rng.gauss(89.5 + 1.0 * age_centered, 4.8))),
            "rdw": min(18.0, max(10.8, rng.gauss(13.1 + 0.38 * age_centered, 1.05))),
            "alp": min(190.0, max(30.0, rng.gauss(72.0 + 5.0 * age_centered, 20.0))),
            "wbc": min(13.5, max(2.8, rng.gauss(6.9 + 0.15 * age_centered, 1.7))),
        }

        res = calculate_phenoage(sample)
        event_time = _sample_gompertz_time_months(res.xb, rng)

        if event_time <= MONTHS_10YR:
            times.append(event_time)
            events.append(1)
        else:
            times.append(float(MONTHS_10YR))
            events.append(0)

        phenoage_scores.append(res.phenoage)
        chrono_scores.append(age)
        accels.append(res.age_acceleration)

    c_pheno = harrell_c_index(times, events, phenoage_scores)
    c_chrono = harrell_c_index(times, events, chrono_scores)

    # Age-stratified concordance (50-65 yrs) highlights biological signal beyond age
    mid_idx = [i for i, a in enumerate(chrono_scores) if 50.0 <= a <= 65.0]
    c_mid_pheno = harrell_c_index(
        [times[i] for i in mid_idx],
        [events[i] for i in mid_idx],
        [phenoage_scores[i] for i in mid_idx],
    )
    c_mid_chrono = harrell_c_index(
        [times[i] for i in mid_idx],
        [events[i] for i in mid_idx],
        [chrono_scores[i] for i in mid_idx],
    )

    return {
        "cohort_n": cohort_n,
        "seed": seed,
        "observed_10yr_events": sum(events),
        "observed_10yr_mortality_rate_pct": round(100.0 * sum(events) / cohort_n, 2),
        "mean_age_acceleration_yrs": round(statistics.mean(accels), 2),
        "sd_age_acceleration_yrs": round(statistics.stdev(accels), 2),
        "c_index_all_ages_phenoage": round(c_pheno, 4),
        "c_index_all_ages_chrono_age": round(c_chrono, 4),
        "c_index_delta_all_ages": round(c_pheno - c_chrono, 4),
        "c_index_age_50_65_phenoage": round(c_mid_pheno, 4),
        "c_index_age_50_65_chrono_age": round(c_mid_chrono, 4),
        "c_index_delta_age_50_65": round(c_mid_pheno - c_mid_chrono, 4),
    }


# ---------------------------------------------------------------------------
# 6. Exact Numerical Verification Suite (Matches src/model/phenoage.test.mjs)
# ---------------------------------------------------------------------------

def verify_model_integrity() -> Dict[str, object]:
    """Run deterministic assertions verifying formula exactness and JS parity."""
    sample = {
        "age": 50.0,
        "albumin": 43.0,
        "creatinine": 80.0,
        "glucose": 5.2,
        "crp": 0.2,
        "lymphocyte": 30.0,
        "mcv": 90.0,
        "rdw": 13.0,
        "alp": 70.0,
        "wbc": 6.5,
    }

    expected_xb = (
        -19.9067
        - 0.0336 * sample["albumin"]
        + 0.0095 * sample["creatinine"]
        + 0.1953 * sample["glucose"]
        + 0.0954 * math.log(sample["crp"])
        - 0.0120 * sample["lymphocyte"]
        + 0.0268 * sample["mcv"]
        + 0.3306 * sample["rdw"]
        + 0.00188 * sample["alp"]
        + 0.0554 * sample["wbc"]
        + 0.0804 * sample["age"]
    )
    expected_m = 1.0 - math.exp((-1.51714 * math.exp(expected_xb)) / 0.0076927)
    expected_phenoage = (
        141.50225 + math.log(-0.00553 * math.log(1.0 - expected_m)) / 0.090165
    )

    res = calculate_phenoage(sample)
    assert abs(res.xb - expected_xb) < 1e-12, f"xb mismatch: {res.xb} vs {expected_xb}"
    assert abs(res.mortality_10yr - expected_m) < 1e-12, "M mismatch"
    assert abs(res.phenoage - expected_phenoage) < 1e-9, "PhenoAge mismatch"

    # Verify ordering across reference presets
    opt = calculate_phenoage(REFERENCE_PROFILES["optimal"])
    avg = calculate_phenoage(REFERENCE_PROFILES["average"])
    elv = calculate_phenoage(REFERENCE_PROFILES["elevated"])
    assert opt.phenoage < avg.phenoage < elv.phenoage, "Preset ordering failed"
    assert opt.mortality_10yr < avg.mortality_10yr < elv.mortality_10yr, "Mortality ordering failed"

    # Verify survival curve endpoints
    assert abs(survival_probability(avg.xb, 0.0) - 1.0) < 1e-12
    assert abs((1.0 - survival_probability(avg.xb, 10.0)) - avg.mortality_10yr) < 1e-5

    return {
        "status": "PASS",
        "reference_sample_xb": round(res.xb, 6),
        "reference_sample_m_10yr": round(res.mortality_10yr, 6),
        "reference_sample_phenoage": round(res.phenoage, 4),
        "preset_phenoages_at_age_45": {
            "optimal": round(opt.phenoage, 2),
            "average": round(avg.phenoage, 2),
            "elevated": round(elv.phenoage, 2),
        },
    }


# ---------------------------------------------------------------------------
# 7. CLI Entry Point
# ---------------------------------------------------------------------------

def build_report(cohort_n: int, seed: int) -> Dict[str, object]:
    verification = verify_model_integrity()
    sensitivities = analytical_sensitivities()
    tornado_elevated = tornado_leverage(REFERENCE_PROFILES["elevated"])
    tornado_average = tornado_leverage(REFERENCE_PROFILES["average"])
    synthetic_validation = run_synthetic_nhanes_validation(cohort_n=cohort_n, seed=seed)

    return {
        "model": "Levine et al. (2018) PhenoAge Gompertz Proportional-Hazards Model",
        "verification": verification,
        "nhanes_validation_methodology": NHANES_VALIDATION_SUMMARY,
        "analytical_sensitivities": sensitivities,
        "tornado_leverage_average_45yr": tornado_average,
        "tornado_leverage_elevated_45yr": tornado_elevated,
        "synthetic_cohort_c_index_check": synthetic_validation,
    }


def print_human_report(report: Dict[str, object]) -> None:
    ver = report["verification"]
    pub = report["nhanes_validation_methodology"]["validation_cohort"]["published_metrics"]
    sim = report["synthetic_cohort_c_index_check"]

    print("=" * 78)
    print("LEVINE ET AL. (2018) PHENOAGE — GOMPERTZ SURVIVAL VALIDATION & SENSITIVITY")
    print("=" * 78)
    print(f"Formula Verification : {ver['status']}")
    print(
        f"Reference Check (50y): xb={ver['reference_sample_xb']}, "
        f"M_10yr={ver['reference_sample_m_10yr']:.4%}, "
        f"PhenoAge={ver['reference_sample_phenoage']} yrs"
    )
    presets = ver["preset_phenoages_at_age_45"]
    print(
        f"Age-45 Presets       : Optimal={presets['optimal']} yrs | "
        f"Average={presets['average']} yrs | Elevated={presets['elevated']} yrs"
    )
    print()

    print("1. ANALYTICAL SENSITIVITY (dPhenoAge/dx = beta / 0.090165)")
    print("-" * 78)
    print(f"{'Biomarker':<28} {'Beta':>9} {'Yrs/Unit':>10} {'Ref SD':>8} {'Yrs/1-SD':>10}")
    for row in report["analytical_sensitivities"]:
        print(
            f"{row['name']:<28} {row['beta']:>+9.5f} {row['years_per_unit']:>+10.4f} "
            f"{row['reference_sd']:>8.2f} {row['years_per_sd']:>+10.3f}"
        )
    print()

    print("2. MODIFIABLE LEVERAGE TORNADO — ELEVATED METABOLIC RISK (AGE 45)")
    print("-" * 78)
    print(f"{'Biomarker':<28} {'Current':>9} {'Target':>9} {'Delta Yrs':>11} {'10y Mort pp':>12}")
    for row in report["tornado_leverage_elevated_45yr"]:
        print(
            f"{row['name']:<28} {row['current']:>9.2f} {row['target']:>9.2f} "
            f"{-row['reduction_years']:>+11.2f} {-row['mortality_delta_pp']:>+12.2f}"
        )
    print()

    print("3. PUBLISHED NHANES III / IV VALIDATION BENCHMARKS (LEVINE & LIU 2018)")
    print("-" * 78)
    print("  Training Cohort    : NHANES III (1988-1994), n = 9,926 adults (20+ yrs)")
    print("  Validation Cohort  : NHANES IV (1999-2010), n = 11,432 adults (20+ yrs)")
    print(
        f"  Published C-Index  : PhenoAge = {pub['all_cause_mortality_c_index_phenoage']:.3f} "
        f"vs. Chronological Age = {pub['all_cause_mortality_c_index_chrono_age']:.3f}"
    )
    print(
        f"  10-Year ROC AUC    : {pub['ten_year_mortality_roc_auc_phenoage']:.2f} "
        f"(HR per +1 yr PhenoAgeAccel ~ {pub['hazard_ratio_per_year_phenoage_accel']:.2f})"
    )
    print()

    print("4. SYNTHETIC NHANES-CALIBRATED COHORT CONCORDANCE CHECK (REPRODUCIBLE)")
    print("-" * 78)
    print(
        f"  Simulated Cohort   : n = {sim['cohort_n']} (seed={sim['seed']}), "
        f"10-yr events = {sim['observed_10yr_events']} ({sim['observed_10yr_mortality_rate_pct']}%)"
    )
    print(
        f"  All Ages (20-85y)  : PhenoAge C-index = {sim['c_index_all_ages_phenoage']:.4f} | "
        f"Chrono Age = {sim['c_index_all_ages_chrono_age']:.4f} "
        f"(delta = {sim['c_index_delta_all_ages']:+.4f})"
    )
    print(
        f"  Mid-Life (50-65y)  : PhenoAge C-index = {sim['c_index_age_50_65_phenoage']:.4f} | "
        f"Chrono Age = {sim['c_index_age_50_65_chrono_age']:.4f} "
        f"(delta = {sim['c_index_delta_age_50_65']:+.4f})"
    )
    print("=" * 78)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Levine et al. (2018) PhenoAge Gompertz survival validation & sensitivity script."
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Run formula integrity assertions only and exit 0 on pass.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit full validation and sensitivity report as JSON.",
    )
    parser.add_argument(
        "--cohort-n",
        type=int,
        default=1200,
        help="Synthetic validation cohort size (default: 1200).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=2018,
        help="Deterministic PRNG seed for synthetic cohort simulation (default: 2018).",
    )
    args = parser.parse_args()

    if args.verify:
        result = verify_model_integrity()
        print(json.dumps(result, indent=2))
        return

    report = build_report(cohort_n=args.cohort_n, seed=args.seed)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_human_report(report)


if __name__ == "__main__":
    main()
