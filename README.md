# Engineering Tools Hub

Engineering Tools Hub is a React + TypeScript web app for fast engineering calculations, checks, and visual workflows.

It currently ships with **36 tools across 8 categories**:

- Solid Mechanics: 6
- Fluids: 5
- Thermodynamics: 5
- Materials: 4
- Maths: 5
- Electrical: 3
- Civil: 3
- Utilities: 5

## Highlights

- Unified tool catalog with search and category grouping.
- Two execution models:
  - **Rich tools** for custom high-interaction workflows.
  - **MVP runtime tools** generated from shared runtime specs.
- Export and reporting support (including PDF flows in Beam Bending).
- Built-in lint, type-check, and unit-test quality gates in CI.

Current rich tools:

- Beam Bending
- Polynomial Solver

## Tech Stack

- React 19
- TypeScript 5
- Vite 8
- React Router 7
- Recharts
- KaTeX (`react-katex`)
- `jsPDF` + `html2canvas`
- ESLint + Vitest

## Getting Started

### Prerequisites

- Node.js 22.x (matches CI)
- npm 10+

### Install

```bash
npm ci
```

### Run Dev Server

```bash
npm run dev
```

### Build

```bash
npm run build
```

## Scripts

- `npm run dev`: start local dev server
- `npm run build`: type-check and build for production
- `npm run preview`: preview production build locally
- `npm run lint`: run ESLint
- `npm test`: run Vitest once
- `npm run test:watch`: run Vitest in watch mode

## CI Quality Gates

GitHub Actions (`.github/workflows/ci.yml`) runs on push and pull request:

1. `npm ci`
2. `npm run lint`
3. `npx tsc --noEmit -p tsconfig.app.json`
4. `npm test`

## Project Structure

```text
src/
  app/                     # App shell, routes, layout
  pages/                   # Home and dynamic tool page
  components/              # Shared UI primitives
  features/                # Cross-tool features (pdf, plotting)
  tools/
    _registry/             # Tool metadata + resolver
    beam-bending/          # Rich tool implementation
    polynomial-solver/     # Rich tool implementation
    mvp/                   # Runtime-driven tool specs and engine
```

Key files:

- `src/tools/_registry/tools.ts`: tool catalog metadata
- `src/tools/_registry/resolver.tsx`: maps tool metadata to rendered tool view
- `src/tools/mvp/specs.ts`: MVP runtime tool definitions and compute logic

## Adding a Tool

### Add an MVP Runtime Tool

1. Add metadata in `src/tools/_registry/tools.ts` (`RAW_TOOLS`).
2. Add a runtime spec in `src/tools/mvp/specs.ts`.
3. Ensure the slug is covered by the expected spec list there.
4. Add tests for validation/compute logic where appropriate.

### Add a Rich Tool

1. Create a dedicated tool folder under `src/tools/<your-tool>/`.
2. Add metadata in `src/tools/_registry/tools.ts`.
3. Register a renderer in `src/tools/_registry/resolver.tsx`.
4. Mark the tool as `rich` in the registry engine-type mapping logic.
5. Add targeted unit tests and UI-level checks.

## Beam Bending Documentation

- `docs/beam-bending-quickstart.md`
- `docs/beam-bending-qa-checklist.md`
- `docs/beam-bending-release-notes.md`

## Disclaimer

These calculators are intended for engineering workflow support, learning, and preliminary checks. They are **not** a substitute for independent engineering judgment, code compliance review, or formal design sign-off.
