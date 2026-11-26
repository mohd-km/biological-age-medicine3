# Biological Age & Medicine 3.0 Survival Model

By Mohammed KM

A client-side interactive web application implementing the peer-reviewed **Levine et al. (2018) PhenoAge** Gompertz proportional-hazards biological age and 10-year all-cause mortality model, paired with an independent real-data survival concordance validation on public CDC NHANES 1999-2010 linked mortality data.

## Model Attribution & Independent Validation

- **Published Formula**: All PhenoAge Gompertz coefficients were derived and trained by Levine et al. (2018, *Aging* 10(4):573-591, https://doi.org/10.18632/aging.101414) on NHANES III/IV. This app implements their exact published equations without modifying any coefficient.
- **Independent CDC NHANES Validation**: `analysis/nhanes_phenoage_validation.py` downloads public CDC Continuous NHANES (1999-2010) laboratory and demographic XPT files plus the NCHS 2019 Public-Use Linked Mortality Files, computes PhenoAge on every complete-case adult (`n = 28,316`), and evaluates exact Harrell's C-index for PhenoAge vs. chronological age alone against observed all-cause mortality (`src/data/nhanes_validation_results.json`).

## Development, Validation & Build

```bash
python3 analysis/nhanes_phenoage_validation.py --verify
python3 analysis/nhanes_phenoage_validation.py --write-json
npm install
npm test
npm run build
```

The production single-file bundle is emitted to `dist/index.html` with `dist/og-card.png`.

## Scientific References

1. Levine ME, Lu AT, Quach A, et al. *An epigenetic biomarker of aging for lifespan and healthspan.* Aging (Albany NY). 2018;10(4):573-591. https://doi.org/10.18632/aging.101414
2. Liu Z, Kuo PL, Horvath S, Crimmins E, Ferrucci L, Levine M. *A new aging measure captures morbidity and mortality risk across diverse subpopulations from NHANES IV: A cohort study.* PLOS Medicine. 2018;15(12):e1002718. https://doi.org/10.1371/journal.pmed.1002718
3. CDC / NCHS Continuous NHANES (1999-2010) and 2019 Public-Use Linked Mortality Files.

## Medical Disclaimer

This software is provided strictly for educational and research modeling purposes. It is not a medical device and does not constitute medical advice, diagnosis, or treatment. Consult a licensed physician before making clinical or health decisions.
