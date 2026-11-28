# Biological Age & Medicine 3.0 Survival Model

By Mohammed KM

Two people can both be 45 and be ageing at very different speeds. This page runs the peer-reviewed **Levine et al. (2018) PhenoAge** formula in your browser: 9 routine blood results plus age go into a Gompertz proportional-hazards model, which gives a biological age and a 10-year risk of dying from any cause. I then checked the formula on public CDC NHANES 1999-2010 data linked to death records.

## Where the model comes from, and how it was checked

- **Published formula**: all PhenoAge Gompertz coefficients were fitted by Levine et al. (2018, Aging 10(4):573-591, https://doi.org/10.18632/aging.101414) on NHANES III/IV. The app runs their published equations without changing any coefficient.
- **NHANES check**: `analysis/nhanes_phenoage_validation.py` downloads the public CDC Continuous NHANES (1999-2010) lab and demographic XPT files and the NCHS 2019 Public-Use Linked Mortality Files. It computes PhenoAge for every adult with all results present (`n = 28,316`) and scores it against real deaths with Harrell's C-index (how often it ranks correctly which of two people died first), as compared to age alone. PhenoAge scores 0.8645 and age alone 0.8484. Output: `src/data/nhanes_validation_results.json`.

## Run, check and build

```bash
python3 analysis/nhanes_phenoage_validation.py --verify
python3 analysis/nhanes_phenoage_validation.py --write-json
npm install
npm test
npm run build
```

The production single-file bundle is emitted to `dist/index.html` with `dist/og-card.png`.

## Scientific References

1. Levine ME, Lu AT, Quach A, et al. An epigenetic biomarker of aging for lifespan and healthspan. Aging (Albany NY). 2018;10(4):573-591. https://doi.org/10.18632/aging.101414
2. Liu Z, Kuo PL, Horvath S, Crimmins E, Ferrucci L, Levine M. A new aging measure captures morbidity and mortality risk across diverse subpopulations from NHANES IV: A cohort study. PLOS Medicine. 2018;15(12):e1002718. https://doi.org/10.1371/journal.pmed.1002718
3. CDC / NCHS Continuous NHANES (1999-2010) and 2019 Public-Use Linked Mortality Files.

## Medical Disclaimer

For learning and research only. It is not a medical device and it is not medical advice, a diagnosis or a treatment. Talk to a licensed doctor before making health decisions.
