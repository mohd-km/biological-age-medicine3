#!/usr/bin/env python3
"""
Independent Real-Data Survival Validation of Levine et al. (2018) PhenoAge
on Public CDC NHANES (1999-2010) & NCHS 2019 Linked Mortality Files.

Attribution:
    The PhenoAge Gompertz proportional-hazards formula and all biomarker
    coefficients were derived and trained by Levine et al. (2018, Aging
    10(4):573-591, doi:10.18632/aging.101414) on NHANES III and validated
    on NHANES IV. This script implements their exact published formula and
    runs an independent survival concordance validation on public CDC
    Continuous NHANES (1999-2010) lab/demographic XPT files linked to the
    NCHS 2019 Public-Use Linked Mortality Files.

Zero external dependencies (Python 3 standard library only):
    - Pure-Python SAS XPORT (XPT v5) binary parser with IBM 360 float64 decoding
    - Fixed-width NCHS 2019 Linked Mortality File parser
    - Exact O(n log n) Fenwick-tree Harrell's C-index (cross-checked against O(n^2))

Usage:
    python3 analysis/nhanes_phenoage_validation.py --verify
    python3 analysis/nhanes_phenoage_validation.py --write-json
    python3 analysis/nhanes_phenoage_validation.py --json
"""

from __future__ import annotations

import argparse
import datetime
import json
import math
import statistics
import struct
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


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
    key: str
    name: str
    model_unit: str
    us_unit: str
    coef: float
    optimal: float
    is_log: bool = False
    higher_is_protective: bool = False


BIOMARKERS: Tuple[BiomarkerSpec, ...] = (
    BiomarkerSpec("albumin", "Albumin", "g/L", "g/dL", -0.0336, 47.0, higher_is_protective=True),
    BiomarkerSpec("creatinine", "Creatinine", "umol/L", "mg/dL", 0.0095, 68.0),
    BiomarkerSpec("glucose", "Glucose (serum)", "mmol/L", "mg/dL", 0.1953, 4.55),
    BiomarkerSpec("crp", "C-Reactive Protein (CRP)", "ln(mg/dL)", "mg/dL", 0.0954, 0.04, is_log=True),
    BiomarkerSpec("lymphocyte", "Lymphocyte %", "%", "%", -0.0120, 36.0, higher_is_protective=True),
    BiomarkerSpec("mcv", "Mean Cell Volume (MCV)", "fL", "fL", 0.0268, 86.0),
    BiomarkerSpec("rdw", "Red Cell Dist. Width (RDW)", "%", "%", 0.3306, 11.8),
    BiomarkerSpec("alp", "Alkaline Phosphatase (ALP)", "U/L", "U/L", 0.00188, 52.0),
    BiomarkerSpec("wbc", "White Blood Cell Count (WBC)", "10^3/uL", "10^3/uL", 0.0554, 4.8),
)

BIOMARKER_MAP: Dict[str, BiomarkerSpec] = {bm.key: bm for bm in BIOMARKERS}

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
# 2. Core Gompertz Proportional-Hazards Survival Equations (Levine et al. 2018)
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
    Compute Levine et al. (2018) PhenoAge, 10-year mortality score M,
    Gompertz linear predictor xb, age acceleration, and relative hazard.
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
    months = years * 12.0
    if months <= 0.0:
        return 1.0
    cum_hazard = ((math.exp(GAMMA * months) - 1.0) / GAMMA) * math.exp(xb)
    return math.exp(-cum_hazard)


# ---------------------------------------------------------------------------
# 3. Pure-Python SAS XPORT (XPT v5) Reader (IBM 360 Float64 -> IEEE 754)
# ---------------------------------------------------------------------------

def _ibm_to_ieee_float(raw: bytes) -> Optional[float]:
    """
    Decode an IBM 360/370 big-endian 8-byte floating-point number from SAS XPT.
    Returns None for SAS missing values (., ._, .A-.Z).
    """
    if len(raw) < 8:
        raw = raw + b"\x00" * (8 - len(raw))

    b0 = raw[0]
    rest = raw[1:]

    # SAS missing values have all trailing bytes zero and b0 in {0x2E ('.'), 0x5F ('_'), 0x41..0x5A ('A'..'Z')}
    if rest == b"\x00\x00\x00\x00\x00\x00\x00":
        if b0 == 0x00:
            return 0.0
        if b0 == 0x2E or b0 == 0x5F or (0x41 <= b0 <= 0x5A):
            return None

    sign = -1.0 if (b0 & 0x80) else 1.0
    exponent = (b0 & 0x7F) - 64
    mantissa_int = int.from_bytes(rest, "big")
    if mantissa_int == 0:
        return 0.0

    # Value = sign * (mantissa_int / 2^56) * 16^exponent = sign * mantissa_int * 2^(4*exponent - 56)
    val = math.ldexp(sign * mantissa_int, 4 * exponent - 56)
    if not math.isfinite(val):
        return None
    return val


def read_xpt_columns(path: Path, wanted_columns: Sequence[str]) -> Dict[int, Dict[str, Optional[float]]]:
    """
    Parse a SAS Transport (XPT v5) file and return {SEQN: {col: float_or_None}}
    for the requested numeric columns (always keyed by integer SEQN).
    """
    wanted_upper = {c.upper() for c in wanted_columns}
    wanted_upper.add("SEQN")
    data = path.read_bytes()
    n_bytes = len(data)
    pos = 0

    def next_card() -> bytes:
        nonlocal pos
        if pos + 80 > n_bytes:
            return b""
        card = data[pos : pos + 80]
        pos += 80
        return card

    # Advance until NAMESTR header record
    n_vars = 0
    while pos < n_bytes:
        card = next_card()
        if card.startswith(b"HEADER RECORD*******NAMESTR HEADER RECORD!!!!!!!"):
            # Number of variables sits at bytes 54:58 (4 ASCII digits)
            n_vars = int(card[54:58].decode("ascii").strip())
            break

    if n_vars <= 0:
        raise ValueError(f"Could not find NAMESTR header in {path}")

    # Each NAMESTR descriptor is 140 bytes; padded to 80-byte card boundary
    namestr_bytes_len = n_vars * 140
    padded_len = ((namestr_bytes_len + 79) // 80) * 80
    namestr_blob = data[pos : pos + namestr_bytes_len]
    pos += padded_len

    fields: List[Tuple[str, int, int, int]] = []  # (name, ntype, nlng, npos)
    row_len = 0
    for i in range(n_vars):
        desc = namestr_blob[i * 140 : (i + 1) * 140]
        ntype, _nhfun, nlng, _nvar0 = struct.unpack(">hhhh", desc[0:8])
        name = desc[8:16].decode("ascii", errors="ignore").strip().upper()
        npos = struct.unpack(">i", desc[84:88])[0]
        end = npos + nlng
        if end > row_len:
            row_len = end
        if name in wanted_upper:
            fields.append((name, ntype, nlng, npos))

    # Advance to OBS header record
    while pos < n_bytes:
        card = next_card()
        if card.startswith(b"HEADER RECORD*******OBS     HEADER RECORD!!!!!!!"):
            break

    if pos >= n_bytes or row_len <= 0:
        raise ValueError(f"Could not find OBS records in {path}")

    seqn_field = next((f for f in fields if f[0] == "SEQN"), None)
    if seqn_field is None:
        raise ValueError(f"SEQN column missing in {path}")

    other_fields = [f for f in fields if f[0] != "SEQN"]
    obs_bytes = data[pos:]
    n_obs = len(obs_bytes) // row_len

    rows: Dict[int, Dict[str, Optional[float]]] = {}
    _, _, seqn_len, seqn_off = seqn_field

    for r in range(n_obs):
        base = r * row_len
        chunk = obs_bytes[base : base + row_len]
        # Trailing padding card is ASCII spaces (0x20)
        if chunk == b" " * row_len:
            break
        seqn_raw = chunk[seqn_off : seqn_off + seqn_len]
        if seqn_raw == b" " * seqn_len:
            break
        seqn_val = _ibm_to_ieee_float(seqn_raw)
        if seqn_val is None or seqn_val <= 0:
            continue
        seqn_id = int(round(seqn_val))
        rec: Dict[str, Optional[float]] = {}
        for name, ntype, nlng, npos in other_fields:
            if ntype == 1:
                rec[name] = _ibm_to_ieee_float(chunk[npos : npos + nlng])
            else:
                rec[name] = None
        rows[seqn_id] = rec

    return rows


# ---------------------------------------------------------------------------
# 4. NCHS 2019 Public-Use Linked Mortality Fixed-Width File Parser
# ---------------------------------------------------------------------------

def read_mortality_dat(path: Path) -> Dict[int, Tuple[int, int, int]]:
    """
    Parse NCHS 2019 Public-Use Linked Mortality fixed-width .dat file.
    Returns {SEQN: (eligstat, mortstat, permth_exm)} for eligible rows with
    valid mortality status and MEC examination follow-up months.
    """
    records: Dict[int, Tuple[int, int, int]] = {}
    with path.open("r", encoding="ascii", errors="ignore") as fh:
        for line in fh:
            if len(line) < 48:
                continue
            seqn_s = line[0:6].strip()
            elig_s = line[14:15].strip()
            mort_s = line[15:16].strip()
            permth_exm_s = line[45:48].strip()
            if not seqn_s.isdigit() or elig_s != "1" or mort_s not in ("0", "1"):
                continue
            if not permth_exm_s.isdigit():
                continue
            records[int(seqn_s)] = (1, int(mort_s), int(permth_exm_s))
    return records


# ---------------------------------------------------------------------------
# 5. Exact O(n log n) Harrell's C-Index (Fenwick Tree) + O(n^2) Reference
# ---------------------------------------------------------------------------

class _FenwickTree:
    __slots__ = ("n", "tree")

    def __init__(self, n: int) -> None:
        self.n = n
        self.tree = [0] * (n + 1)

    def add(self, idx: int, delta: int) -> None:
        tree = self.tree
        n = self.n
        while idx <= n:
            tree[idx] += delta
            idx += idx & -idx

    def prefix_sum(self, idx: int) -> int:
        s = 0
        tree = self.tree
        while idx > 0:
            s += tree[idx]
            idx -= idx & -idx
        return s


def harrell_c_index(
    times: Sequence[float], events: Sequence[int], risk_scores: Sequence[float]
) -> float:
    """
    Exact O(n log n) Harrell's concordance index for right-censored survival data.

    A pair (i, j) is comparable iff event_i == 1 and time_i < time_j.
    Concordant if risk_i > risk_j; ties (risk_i == risk_j) receive weight 0.5.
    """
    n = len(times)
    if n == 0 or n != len(events) or n != len(risk_scores):
        raise ValueError("times, events, and risk_scores must have equal non-zero length")

    # Coordinate-compress risk scores to 1..m
    unique_scores = sorted(set(risk_scores))
    rank_of = {val: i + 1 for i, val in enumerate(unique_scores)}
    m = len(unique_scores)

    # Group indices by time descending so when processing time t, the Fenwick
    # tree contains strictly all subjects j with time_j > t.
    order = sorted(range(n), key=lambda idx: times[idx], reverse=True)
    bit = _FenwickTree(m)
    count_by_rank = [0] * (m + 1)
    total_inserted = 0

    concordant = 0.0
    comparable = 0.0

    k = 0
    while k < n:
        t_cur = times[order[k]]
        group_end = k + 1
        while group_end < n and times[order[group_end]] == t_cur:
            group_end += 1

        # Query all events in this time group against strictly later times
        if total_inserted > 0:
            for p in range(k, group_end):
                idx = order[p]
                if events[idx] != 1:
                    continue
                r = rank_of[risk_scores[idx]]
                strictly_lower = bit.prefix_sum(r - 1)
                tied = count_by_rank[r]
                comparable += total_inserted
                concordant += strictly_lower + 0.5 * tied

        # Insert all subjects in this time group into the tree
        for p in range(k, group_end):
            idx = order[p]
            r = rank_of[risk_scores[idx]]
            bit.add(r, 1)
            count_by_rank[r] += 1
            total_inserted += 1

        k = group_end

    return 0.5 if comparable == 0.0 else concordant / comparable


def harrell_c_index_quadratic_reference(
    times: Sequence[float], events: Sequence[int], risk_scores: Sequence[float]
) -> float:
    """Simple O(n^2) reference implementation used only to unit-verify the O(n log n) algorithm."""
    n = len(times)
    concordant = 0.0
    comparable = 0.0
    for i in range(n):
        if events[i] != 1:
            continue
        ti = times[i]
        si = risk_scores[i]
        for j in range(n):
            if times[j] > ti:
                comparable += 1.0
                if si > risk_scores[j]:
                    concordant += 1.0
                elif si == risk_scores[j]:
                    concordant += 0.5
    return 0.5 if comparable == 0.0 else concordant / comparable


# ---------------------------------------------------------------------------
# 6. Public CDC NHANES 1999-2010 Cycle Definitions & Downloader
# ---------------------------------------------------------------------------

NHANES_BASE_XPT = "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public"
NHANES_BASE_MORT = "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/datalinkage/linked_mortality"


@dataclass(frozen=True)
class CycleConfig:
    label: str
    year_dir: str
    demo_file: str
    biopro_file: str
    crp_file: str
    cbc_file: str
    mort_file: str


NHANES_CYCLES: Tuple[CycleConfig, ...] = (
    CycleConfig(
        label="1999-2000",
        year_dir="1999",
        demo_file="DEMO.xpt",
        biopro_file="LAB18.xpt",
        crp_file="LAB11.xpt",
        cbc_file="LAB25.xpt",
        mort_file="NHANES_1999_2000_MORT_2019_PUBLIC.dat",
    ),
    CycleConfig(
        label="2001-2002",
        year_dir="2001",
        demo_file="DEMO_B.xpt",
        biopro_file="L40_B.xpt",
        crp_file="L11_B.xpt",
        cbc_file="L25_B.xpt",
        mort_file="NHANES_2001_2002_MORT_2019_PUBLIC.dat",
    ),
    CycleConfig(
        label="2003-2004",
        year_dir="2003",
        demo_file="DEMO_C.xpt",
        biopro_file="L40_C.xpt",
        crp_file="L11_C.xpt",
        cbc_file="L25_C.xpt",
        mort_file="NHANES_2003_2004_MORT_2019_PUBLIC.dat",
    ),
    CycleConfig(
        label="2005-2006",
        year_dir="2005",
        demo_file="DEMO_D.xpt",
        biopro_file="BIOPRO_D.xpt",
        crp_file="CRP_D.xpt",
        cbc_file="CBC_D.xpt",
        mort_file="NHANES_2005_2006_MORT_2019_PUBLIC.dat",
    ),
    CycleConfig(
        label="2007-2008",
        year_dir="2007",
        demo_file="DEMO_E.xpt",
        biopro_file="BIOPRO_E.xpt",
        crp_file="CRP_E.xpt",
        cbc_file="CBC_E.xpt",
        mort_file="NHANES_2007_2008_MORT_2019_PUBLIC.dat",
    ),
    CycleConfig(
        label="2009-2010",
        year_dir="2009",
        demo_file="DEMO_F.xpt",
        biopro_file="BIOPRO_F.xpt",
        crp_file="CRP_F.xpt",
        cbc_file="CBC_F.xpt",
        mort_file="NHANES_2009_2010_MORT_2019_PUBLIC.dat",
    ),
)


def _download_cached(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    req = urllib.request.Request(url, headers={"User-Agent": "MKM-NHANES-PhenoAge-Validator/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = resp.read()
    dest.write_bytes(payload)
    return dest


def _extract_first(rec: Dict[str, Optional[float]], names: Sequence[str]) -> Optional[float]:
    for name in names:
        val = rec.get(name)
        if val is not None and math.isfinite(val):
            return val
    return None


def validate_real_nhanes(cache_dir: Path) -> Dict[str, object]:
    """
    Download and validate Levine et al. (2018) PhenoAge on public CDC NHANES
    1999-2010 complete-case adult participants linked to NCHS 2019 mortality.
    """
    all_times_full: List[float] = []
    all_events_full: List[int] = []
    all_times_10yr: List[float] = []
    all_events_10yr: List[int] = []
    all_phenoage: List[float] = []
    all_chrono: List[float] = []
    all_accel: List[float] = []

    cycle_summaries: List[Dict[str, object]] = []

    for cyc in NHANES_CYCLES:
        cyc_dir = cache_dir / cyc.label
        demo_path = _download_cached(
            f"{NHANES_BASE_XPT}/{cyc.year_dir}/DataFiles/{cyc.demo_file}",
            cyc_dir / cyc.demo_file,
        )
        biopro_path = _download_cached(
            f"{NHANES_BASE_XPT}/{cyc.year_dir}/DataFiles/{cyc.biopro_file}",
            cyc_dir / cyc.biopro_file,
        )
        crp_path = _download_cached(
            f"{NHANES_BASE_XPT}/{cyc.year_dir}/DataFiles/{cyc.crp_file}",
            cyc_dir / cyc.crp_file,
        )
        cbc_path = _download_cached(
            f"{NHANES_BASE_XPT}/{cyc.year_dir}/DataFiles/{cyc.cbc_file}",
            cyc_dir / cyc.cbc_file,
        )
        mort_path = _download_cached(
            f"{NHANES_BASE_MORT}/{cyc.mort_file}",
            cyc_dir / cyc.mort_file,
        )

        demo = read_xpt_columns(demo_path, ["RIDAGEYR"])
        biopro = read_xpt_columns(
            biopro_path,
            [
                "LBDSALSI", "LBXSAL",
                "LBDSCRSI", "LBXSCR",
                "LBDSGLSI", "LBXSGL",
                "LBXSAPSI", "LBDSAPSI",
            ],
        )
        crp = read_xpt_columns(crp_path, ["LBXCRP"])
        cbc = read_xpt_columns(cbc_path, ["LBXLYPCT", "LBXMCVSI", "LBXRDW", "LBXWBCSI"])
        mort = read_mortality_dat(mort_path)

        c_times: List[float] = []
        c_events: List[int] = []
        c_pheno: List[float] = []
        c_chrono: List[float] = []

        for seqn, d_rec in demo.items():
            age = d_rec.get("RIDAGEYR")
            if age is None or age < 20.0:
                continue
            m_rec = mort.get(seqn)
            if m_rec is None:
                continue
            b_rec = biopro.get(seqn)
            crp_rec = crp.get(seqn)
            cbc_rec = cbc.get(seqn)
            if b_rec is None or crp_rec is None or cbc_rec is None:
                continue

            # Canonical Levine (2018) units:
            # albumin (g/L), creatinine (umol/L), glucose (mmol/L), crp (mg/dL),
            # lymphocyte (%), mcv (fL), rdw (%), alp (U/L), wbc (10^3/uL)
            alb = _extract_first(b_rec, ["LBDSALSI"])
            if alb is None:
                alb_us = _extract_first(b_rec, ["LBXSAL"])
                alb = alb_us * 10.0 if alb_us is not None else None

            crea = _extract_first(b_rec, ["LBDSCRSI"])
            if crea is None:
                crea_us = _extract_first(b_rec, ["LBXSCR"])
                crea = crea_us * 88.42 if crea_us is not None else None

            glu = _extract_first(b_rec, ["LBDSGLSI"])
            if glu is None:
                glu_us = _extract_first(b_rec, ["LBXSGL"])
                glu = glu_us / 18.0182 if glu_us is not None else None

            alp = _extract_first(b_rec, ["LBXSAPSI", "LBDSAPSI"])
            crp_val = _extract_first(crp_rec, ["LBXCRP"])
            lym = _extract_first(cbc_rec, ["LBXLYPCT"])
            mcv = _extract_first(cbc_rec, ["LBXMCVSI"])
            rdw = _extract_first(cbc_rec, ["LBXRDW"])
            wbc = _extract_first(cbc_rec, ["LBXWBCSI"])

            if (
                alb is None
                or crea is None
                or glu is None
                or alp is None
                or crp_val is None
                or crp_val <= 0.0
                or lym is None
                or mcv is None
                or rdw is None
                or wbc is None
            ):
                continue

            res = calculate_phenoage(
                {
                    "age": age,
                    "albumin": alb,
                    "creatinine": crea,
                    "glucose": glu,
                    "crp": crp_val,
                    "lymphocyte": lym,
                    "mcv": mcv,
                    "rdw": rdw,
                    "alp": alp,
                    "wbc": wbc,
                }
            )
            if not math.isfinite(res.phenoage):
                continue

            _elig, mortstat, permth_exm = m_rec
            t_full = float(permth_exm)
            e_full = int(mortstat)

            # 10-year (120-month) administrative censoring window
            if t_full <= MONTHS_10YR:
                t_10 = t_full
                e_10 = e_full
            else:
                t_10 = float(MONTHS_10YR)
                e_10 = 0

            c_times.append(t_full)
            c_events.append(e_full)
            c_pheno.append(res.phenoage)
            c_chrono.append(age)

            all_times_full.append(t_full)
            all_events_full.append(e_full)
            all_times_10yr.append(t_10)
            all_events_10yr.append(e_10)
            all_phenoage.append(res.phenoage)
            all_chrono.append(age)
            all_accel.append(res.age_acceleration)

        cycle_c_pheno = harrell_c_index(c_times, c_events, c_pheno)
        cycle_c_chrono = harrell_c_index(c_times, c_events, c_chrono)
        cycle_summaries.append(
            {
                "cycle": cyc.label,
                "n": len(c_times),
                "deaths": sum(c_events),
                "median_followup_months": round(statistics.median(c_times), 1),
                "c_index_phenoage": round(cycle_c_pheno, 4),
                "c_index_chrono_age": round(cycle_c_chrono, 4),
                "c_index_delta": round(cycle_c_pheno - cycle_c_chrono, 4),
            }
        )

    n_total = len(all_times_full)
    deaths_full = sum(all_events_full)
    deaths_10yr = sum(all_events_10yr)

    c_full_pheno = harrell_c_index(all_times_full, all_events_full, all_phenoage)
    c_full_chrono = harrell_c_index(all_times_full, all_events_full, all_chrono)

    c_10yr_pheno = harrell_c_index(all_times_10yr, all_events_10yr, all_phenoage)
    c_10yr_chrono = harrell_c_index(all_times_10yr, all_events_10yr, all_chrono)

    # Mid-life subgroup (ages 50-65) where chronological age spread is narrow
    mid_idx = [i for i, a in enumerate(all_chrono) if 50.0 <= a <= 65.0]
    c_mid_pheno = harrell_c_index(
        [all_times_full[i] for i in mid_idx],
        [all_events_full[i] for i in mid_idx],
        [all_phenoage[i] for i in mid_idx],
    )
    c_mid_chrono = harrell_c_index(
        [all_times_full[i] for i in mid_idx],
        [all_events_full[i] for i in mid_idx],
        [all_chrono[i] for i in mid_idx],
    )

    return {
        "model_attribution": {
            "authors": "Levine ME, Lu AT, Quach A, et al. (2018)",
            "journal": "Aging (Albany NY). 2018;10(4):573-591",
            "doi": "10.18632/aging.101414",
            "note": (
                "All PhenoAge Gompertz coefficients were derived and trained by Levine et al. (2018) "
                "on NHANES III/IV. This JSON records Mohammed KM's independent survival concordance "
                "validation of that published formula on public CDC NHANES 1999-2010 microdata linked "
                "to the NCHS 2019 Public-Use Linked Mortality Files."
            ),
        },
        "computed_at_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data_source": {
            "survey": "CDC Continuous NHANES",
            "cycles": [c.label for c in NHANES_CYCLES],
            "mortality_linkage": "NCHS 2019 Public-Use Linked Mortality Files (follow-up through Dec 31, 2019)",
            "inclusion_criteria": "Complete-case adults age >= 20 yrs with mortality linkage (eligstat = 1), valid MEC exam follow-up (permth_exm), and all 9 required biomarkers (CRP > 0).",
        },
        "cohort": {
            "n": n_total,
            "age_min": int(min(all_chrono)),
            "age_max": int(max(all_chrono)),
            "mean_age_years": round(statistics.mean(all_chrono), 2),
            "mean_phenoage_years": round(statistics.mean(all_phenoage), 2),
            "mean_age_acceleration_years": round(statistics.mean(all_accel), 2),
            "sd_age_acceleration_years": round(statistics.stdev(all_accel), 2),
            "followup_median_months": round(statistics.median(all_times_full), 1),
            "followup_median_years": round(statistics.median(all_times_full) / 12.0, 2),
            "followup_max_months": int(max(all_times_full)),
            "deaths_all_followup": deaths_full,
            "mortality_rate_all_followup_pct": round(100.0 * deaths_full / n_total, 2),
            "deaths_10yr": deaths_10yr,
            "mortality_rate_10yr_pct": round(100.0 * deaths_10yr / n_total, 2),
        },
        "concordance": {
            "full_followup": {
                "window": "Full NCHS 2019 linked follow-up (median {:.1f} yrs)".format(
                    statistics.median(all_times_full) / 12.0
                ),
                "c_index_phenoage": round(c_full_pheno, 4),
                "c_index_chrono_age": round(c_full_chrono, 4),
                "c_index_delta": round(c_full_pheno - c_full_chrono, 4),
            },
            "ten_year_window": {
                "window": "10-year (120-month) administrative censoring",
                "c_index_phenoage": round(c_10yr_pheno, 4),
                "c_index_chrono_age": round(c_10yr_chrono, 4),
                "c_index_delta": round(c_10yr_pheno - c_10yr_chrono, 4),
            },
            "midlife_ages_50_65": {
                "n": len(mid_idx),
                "deaths": sum(all_events_full[i] for i in mid_idx),
                "c_index_phenoage": round(c_mid_pheno, 4),
                "c_index_chrono_age": round(c_mid_chrono, 4),
                "c_index_delta": round(c_mid_pheno - c_mid_chrono, 4),
            },
        },
        "by_cycle": cycle_summaries,
    }


# ---------------------------------------------------------------------------
# 7. Exact Numerical Verification Suite (Matches src/model/phenoage.test.mjs)
# ---------------------------------------------------------------------------

def verify_model_integrity() -> Dict[str, object]:
    """Run deterministic assertions verifying formula exactness and C-index equivalence."""
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

    opt = calculate_phenoage(REFERENCE_PROFILES["optimal"])
    avg = calculate_phenoage(REFERENCE_PROFILES["average"])
    elv = calculate_phenoage(REFERENCE_PROFILES["elevated"])
    assert opt.phenoage < avg.phenoage < elv.phenoage, "Preset ordering failed"
    assert opt.mortality_10yr < avg.mortality_10yr < elv.mortality_10yr, "Mortality ordering failed"

    assert abs(survival_probability(avg.xb, 0.0) - 1.0) < 1e-12
    assert abs((1.0 - survival_probability(avg.xb, 10.0)) - avg.mortality_10yr) < 1e-5

    # Cross-check O(n log n) Fenwick C-index against O(n^2) reference including ties
    test_times = [10, 10, 20, 30, 30, 40, 50, 60, 60, 70]
    test_events = [1, 0, 1, 1, 1, 0, 1, 1, 0, 0]
    test_scores = [9.0, 5.0, 7.0, 7.0, 4.0, 6.0, 3.0, 2.0, 8.0, 1.0]
    c_fast = harrell_c_index(test_times, test_events, test_scores)
    c_ref = harrell_c_index_quadratic_reference(test_times, test_events, test_scores)
    assert abs(c_fast - c_ref) < 1e-12, f"C-index mismatch: {c_fast} vs {c_ref}"

    return {
        "status": "PASS",
        "reference_sample_xb": round(res.xb, 6),
        "reference_sample_m_10yr": round(res.mortality_10yr, 6),
        "reference_sample_phenoage": round(res.phenoage, 4),
        "c_index_fast_vs_quadratic_diff": abs(c_fast - c_ref),
    }


def print_human_report(results: Dict[str, object]) -> None:
    cohort = results["cohort"]
    conc = results["concordance"]
    full = conc["full_followup"]
    ten = conc["ten_year_window"]
    mid = conc["midlife_ages_50_65"]

    print("=" * 78)
    print("REAL CDC NHANES (1999-2010) SURVIVAL VALIDATION OF LEVINE ET AL. (2018)")
    print("=" * 78)
    print(f"Cycles Validated     : {', '.join(results['data_source']['cycles'])}")
    print(f"Complete-Case Adults : n = {cohort['n']:,} (ages {cohort['age_min']}-{cohort['age_max']} yrs)")
    print(
        f"Follow-Up (NCHS 2019): median {cohort['followup_median_months']} mo "
        f"({cohort['followup_median_years']} yrs), max {cohort['followup_max_months']} mo"
    )
    print(
        f"Observed Deaths      : {cohort['deaths_all_followup']:,} all follow-up "
        f"({cohort['mortality_rate_all_followup_pct']}%) | "
        f"{cohort['deaths_10yr']:,} within 10 yrs ({cohort['mortality_rate_10yr_pct']}%)"
    )
    print()
    print("HARRELL'S C-INDEX (OBSERVED ALL-CAUSE MORTALITY)")
    print("-" * 78)
    print(
        f"Full Follow-Up       : PhenoAge = {full['c_index_phenoage']:.4f} vs "
        f"Chrono Age = {full['c_index_chrono_age']:.4f} (delta = {full['c_index_delta']:+.4f})"
    )
    print(
        f"10-Year Window       : PhenoAge = {ten['c_index_phenoage']:.4f} vs "
        f"Chrono Age = {ten['c_index_chrono_age']:.4f} (delta = {ten['c_index_delta']:+.4f})"
    )
    print(
        f"Mid-Life (50-65 yrs) : PhenoAge = {mid['c_index_phenoage']:.4f} vs "
        f"Chrono Age = {mid['c_index_chrono_age']:.4f} (delta = {mid['c_index_delta']:+.4f}, "
        f"n={mid['n']:,}, deaths={mid['deaths']:,})"
    )
    print()
    print("PER-CYCLE BREAKDOWN")
    print("-" * 78)
    print(f"{'Cycle':<12} {'N':>7} {'Deaths':>7} {'Med Mo':>8} {'C(Pheno)':>10} {'C(Age)':>10} {'Delta':>9}")
    for row in results["by_cycle"]:
        print(
            f"{row['cycle']:<12} {row['n']:>7,} {row['deaths']:>7,} {row['median_followup_months']:>8.1f} "
            f"{row['c_index_phenoage']:>10.4f} {row['c_index_chrono_age']:>10.4f} {row['c_index_delta']:>+9.4f}"
        )
    print("=" * 78)


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Real CDC NHANES (1999-2010) survival validation of Levine et al. (2018) PhenoAge."
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Run formula integrity and C-index unit assertions only.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=repo_root / ".cache" / "nhanes",
        help="Local cache directory for downloaded CDC XPT and NCHS mortality files.",
    )
    parser.add_argument(
        "--write-json",
        action="store_true",
        help="Write computed validation JSON to src/data/nhanes_validation_results.json.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repo_root / "src" / "data" / "nhanes_validation_results.json",
        help="Output JSON path when --write-json is set.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print validation JSON to stdout.",
    )
    args = parser.parse_args()

    verify_res = verify_model_integrity()
    if args.verify:
        print(json.dumps(verify_res, indent=2))
        return

    results = validate_real_nhanes(args.cache_dir)
    if args.write_json:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print_human_report(results)


if __name__ == "__main__":
    main()
