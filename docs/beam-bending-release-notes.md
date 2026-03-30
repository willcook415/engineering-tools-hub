# Beam Bending Release Notes (Production Readiness Pass)

## Reliability and Numerical Trust

- Added quality metadata for mesh sensitivity and confidence scoring.
- Added confidence badge (`high`/`medium`/`low`) derived from:
  - equilibrium residual quality,
  - mesh sensitivity comparison,
  - warning burden.
- Expanded warning language to include trigger, consequence, and mitigation guidance.
- Expanded verification coverage (superposition, spring support sanity, moving load regression).

## UX and Workflow

- Added confidence visibility in status bar for faster decision context.
- Improved explainability section with governing contributor summary and show-more behavior.
- Added explicit scenario empty/compare-unavailable/import-error states.
- Standardized load naming fallback across diagrams and explainability displays.
- Improved load-edit interaction safety (no accidental row reselect while typing).
- Improved moment glyph direction logic and drag-state feedback.

## PDF/Report Hardening

- Added export preflight checks for detached/hidden sections.
- Added classified export error reporting (`EMPTY_SECTIONS`, `PREFLIGHT`, `TIMEOUT`, `CANVAS`, `CAPTURE`).
- Added section slicing for tall captures to avoid truncation on multi-page exports.
- Added report audit block (mesh/theory/material/warnings/confidence).

## Compatibility Statement

- No breaking changes to `solveBeamBending(inp, opts?)`.
- No breaking changes to scenario JSON storage shape or URL-state payload shape.
- Existing output fields remain intact; only additive optional quality metadata was introduced.

## Known Limitations

- Confidence remains a numerical health indicator, not a code-compliance proof.
- Export capture still depends on browser canvas capabilities and external asset availability.
