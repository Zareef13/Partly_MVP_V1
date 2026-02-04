

# discoveryService — Design & Feature Overview

## Purpose

`discoveryService.ts` is responsible for **discovering the most likely canonical product page**
for a given **(MPN, manufacturer)** pair using public web search results.

It does **not** crawl pages, extract specifications, or generate content.

Its single responsibility is to answer:

> “Given noisy and heterogeneous web search results, which URL is most likely the correct product page for this part?”

This separation is intentional and foundational to Partly’s architecture.

---

## Inputs

- `mpn: string`  
  Manufacturer Part Number (exact string as provided by the distributor or manufacturer)

- `manufacturer: string`  
  Manufacturer name used for relevance validation

---

## Outputs

```ts
{
  primaryProductUrl: string | null
  backupUrls: string[]
  pdfUrls: string[]
  confidence: "high" | "medium" | "low"
}
```

### Output guarantees

- `primaryProductUrl` is always the **top-ranked candidate**, never selected via hard thresholds
- `confidence` is **relative**, based on ranking separation, not absolute score values
- Failure is **graceful**: low confidence and/or null primary rather than throwing errors

---

## High-level Pipeline

1. Query Serper (Google Search API)
2. Normalize heterogeneous Serper response formats
3. Extract interpretable ranking features from each result
4. Statistically normalize features on a per-query basis
5. Score results using a logistic-regression–style linear model
6. Rank results and estimate confidence via score separation

---

## Feature Signals Used

Each candidate URL is represented using the following signals:

| Feature    | Description              |              Rationale                     |
|------------|--------------------------|--------------------------------------------|
| `mpnInUrl` | Exact MPN present in URL | Strongest indicator of a true product page |
| `mpnInTitle` | Exact MPN in page title | High-signal but noisier than URL |
| `mfgInText` | Manufacturer name in title/snippet | Validates brand relevance |
| `productPath` | URL path resembles `/product` or `/products` | Structural hint |
| `domainTrust` | Continuous trust prior derived from domain patterns | Handles long-tail distributors |
| `junkPath` | Search, forum, blog, or viewer patterns | Penalizes noise |

All features are:
- interpretable
- loggable
- stable across distributors

---

## Statistical Normalization

Features are **mean-centered per query**:

```
xᵢ = featureᵢ − mean(featureᵢ across all candidates)
```

This ensures:
- Common signals do not dominate
- Rare but discriminative signals are emphasized
- Scores are query-adaptive rather than globally biased

---

## Scoring Model

Candidates are scored using a **logistic regression–style linear model**:

```
score = sigmoid(w · x + b)
```

Important notes:

- Weights are hand-initialized for MVP
- Model is deterministic
- Scores are used strictly for **ranking**, not probability claims
- Weights can later be learned offline (e.g., scikit-learn) and copied back without refactoring

---

## Domain Trust System

Domains are **not whitelisted**.

Instead, a bootstrap trust prior is assigned using pattern-based inference:

- Strong negatives: forums, blogs, viewers, mirrors
- Strong positives: major distributors
- Structural inference: manufacturer-like domains
- Neutral default for unseen domains

This design allows the system to scale to **hundreds of distributors**
without maintaining brittle allowlists.

The domain trust signal is continuous, not binary.

---

## Confidence Estimation

Confidence is computed using **relative score separation**:

```
confidence = f(score₁ − score₂)
```

This avoids brittle absolute thresholds and reflects true ranking certainty.

---

## Expected Failure Modes

The function is designed to fail gracefully:

| Situation | Behavior |
|---------|----------|
| No relevant results | `primaryProductUrl = null`, `low` confidence |
| Only PDFs available | PDFs returned, no primary |
| Viewer-heavy / aggregator results | Penalized via `junkPath` and `domainTrust` |
| Conflicting candidates | Reduced confidence, backups populated |

The function **never throws due to ranking ambiguity**.

---

## Non-goals (By Design)

This file intentionally does **not**:

- Crawl product pages
- Extract specifications
- Parse PDFs
- Generate marketing content
- Guarantee correctness

It provides **best-effort discovery**, not ground truth.

---

## Observability & Logging

The design assumes future logging of:
- feature vectors
- domain outcomes
- final rank selections

This enables:
- offline weight learning
- domain trust calibration
- regression analysis

Logging is intentionally decoupled from discovery logic.

---

## Robustness Assessment

**Conceptual robustness:** High  
**Statistical robustness:** High  
**Operational robustness:** Medium (expected for MVP)

Known operational gaps (intentional for MVP):
- Retry/backoff on Serper failures
- CAPTCHA / HTML error detection
- Duplicate-domain suppression
- Persistent telemetry

None of these require architectural changes.

---

## Expected Evolution

Planned future improvements:

- Offline learning of feature weights
- Learned domain trust from historical outcomes
- Fuzzy MPN matching
- Token similarity features
- Duplicate-domain penalties

The current design explicitly supports these upgrades without refactoring.

---

## Summary

`discoveryService.ts` is a **statistically principled, domain-aware discovery engine**
that prioritizes interpretability, graceful failure, and future extensibility.

It is intentionally scoped, well-isolated, and safe to evolve.






#werite the todos in the zareef alignment file 