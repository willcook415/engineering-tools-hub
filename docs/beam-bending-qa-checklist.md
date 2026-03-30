# Beam Bending Production QA Checklist

## Core Functional

- [ ] Standard simply-supported case solves without opening advanced drawers.
- [ ] Cantilever, fixed-fixed, and propped cantilever solve with finite outputs.
- [ ] Load editing, naming, and deletion work for all load types.
- [ ] Dragging loads is smooth and preserves a logical undo checkpoint.

## Numerical Trust

- [ ] Equilibrium residuals are finite and near zero for stable benchmark cases.
- [ ] Confidence badge updates when warnings increase or mesh is coarsened.
- [ ] Mesh sensitivity ratio is present in quality metadata.

## Scenario Workflow

- [ ] Save/load/delete checkpoint works.
- [ ] Empty checkpoint state renders clear guidance.
- [ ] Compare unavailable state appears when selected scenario is invalid.
- [ ] JSON import/export and URL share round-trip without schema change.

## Report/PDF

- [ ] Export succeeds for all report templates.
- [ ] Multi-page report retains readable headers/footers.
- [ ] Tall sections paginate without clipping top/bottom content.
- [ ] Export failures show classified fallback guidance.

## UX/Accessibility

- [ ] Collapsible drawers are keyboard operable (`Enter`/`Space`) and focus-visible.
- [ ] Number fields do not trigger accidental row selection while editing.
- [ ] Mobile/tablet layouts avoid clipped controls and preserve button hit targets.

## Regression Gates

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit -p tsconfig.app.json`
- [ ] `npm test`
