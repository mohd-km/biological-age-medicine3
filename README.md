# Biological Age & Medicine 3.0 Survival Model

By Mohammed KM

A self-contained, 100% client-side interactive clinical-editorial web application implementing the peer-reviewed **Levine et al. (2018) PhenoAge** Gompertz proportional-hazards biological age and 10-year all-cause mortality model.

## Key Capabilities

- **Exact Levine et al. (2018) Mathematics**: Implements the full Gompertz proportional-hazards linear predictor (`xb`), 10-year mortality score (`M`), and phenotypic age (`PhenoAge`) across chronological age and 9 routine clinical biomarkers.
- **US / SI Unit System Toggle**: Instant switching between SI (`mmol/L`, `g/L`, `umol/L`, `mg/L`, `10^9/L`) and US (`mg/dL`, `g/dL`, `10^3/uL`) units while maintaining canonical internal precision.
- **Cohort Reference Presets**: Compare *Optimal Longevity Profile*, *Average Adult (NHANES Baseline)*, and *Elevated Metabolic Risk* profiles at any chronological age.
- **10-Year Gompertz Survival Curve**: Live SVG visualization of projected 10-year survival probability $S(t)$ against age-matched baseline and optimal Medicine 3.0 targets.
- **Modifiable Leverage Tornado Chart**: Ranks all 9 modifiable biomarkers by the exact biological age reduction (in years) gained when moving each single marker toward its optimal range.
- **Zero Data Collection**: All calculations execute locally in the browser; no personal data is transmitted or persisted.

## Development & Build

```bash
npm install
npm test
npm run build
```

The production single-file bundle is emitted to `dist/index.html`.

## Scientific References

1. Levine ME, Lu AT, Quach A, et al. *An epigenetic biomarker of aging for lifespan and healthspan.* Aging (Albany NY). 2018;10(4):573-591. https://doi.org/10.18632/aging.101414
2. Liu Z, Kuo PL, Horvath S, Crimmins E, Ferrucci L, Levine M. *A new aging measure captures morbidity and mortality risk across diverse subpopulations from NHANES IV: A cohort study.* PLOS Medicine. 2018;15(12):e1002718. https://doi.org/10.1371/journal.pmed.1002718
3. CDC / NCHS National Health and Nutrition Examination Survey (NHANES) Linked Mortality Files.

## Medical Disclaimer

This software is provided strictly for educational and research modeling purposes. It is not a medical device and does not constitute medical advice, diagnosis, or treatment. Consult a licensed physician before making clinical or health decisions.
