# Beam Bending Quick Start

1. Open `Beam Bending` and complete `1. Setup` with span, support type, and base stiffness/material.
2. Add loads in `2. Loads & Cases`, then drag each load directly on the beam for placement.
3. Review `3. Analysis & Checks` for reactions, extremes, serviceability, and warning guidance.
4. Use `4. Compare & Report` to save checkpoints, compare scenarios, and export a PDF report.

## Sign Convention

- Downward distributed/point loads are positive.
- Clockwise applied moments are positive.
- Diagram signs follow the tool's internal convention and are consistent across SFD/BMD outputs.

## Interpreting Trust Indicators

- `Confidence` combines equilibrium residuals, mesh sensitivity, and warning burden.
- `HIGH` indicates low residual error and stable mesh response.
- `MEDIUM` indicates acceptable but sensitivity-informed caution.
- `LOW` indicates warning-heavy or mesh-sensitive behavior; use refined checks before decisions.

## Warnings

Warnings are structured as:
- `Trigger`: what threshold was crossed.
- `Consequence`: likely effect on engineering interpretation.
- `Mitigation`: recommended next action.

## Scenario Interoperability

- `Copy JSON`: exports current `BeamBendingInputs`.
- `Import JSON`: loads a prior state (strict schema-compatible).
- `Copy Share URL`: encodes the same state for link sharing.
