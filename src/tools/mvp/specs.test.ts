import { describe, expect, test } from "vitest";
import type { ToolComputeResult } from "./runtime";
import { TOOL_RUNTIME_SPECS } from "./specs";

type KeyExpectation = {
  label: string;
  min?: number;
  max?: number;
};

const KEY_EXPECTATION_BY_SLUG: Record<string, KeyExpectation> = {
  "torsion-calculator": { label: "Max shear stress", min: 0 },
  "stress-transformation-mohrs-circle": { label: "Max in-plane shear", min: 0 },
  "column-buckling": { label: "Euler critical load Pcr", min: 0 },
  "section-properties": { label: "Area A", min: 0 },
  "combined-stress-check": { label: "Von Mises equivalent", min: 0 },
  "reynolds-number": { label: "Reynolds number", min: 0 },
  "pipe-pressure-drop": { label: "Total pressure drop", min: 0 },
  "pump-power-calculator": { label: "Required motor input", min: 0 },
  "open-channel-flow": { label: "Discharge Q", min: 0 },
  "compressible-flow": { label: "Static pressure", min: 0 },
  "ideal-gas-law": { label: "Pressure P", min: 0 },
  "heat-transfer-conduction": { label: "Heat transfer rate q", min: 0 },
  "heat-exchanger-sizing": { label: "Required area", min: 0 },
  "steam-properties": { label: "Enthalpy h", min: 0 },
  "psychrometrics": { label: "Humidity ratio w", min: 0 },
  "material-property-database": { label: "Rows returned", min: 1 },
  "safety-factor-calculator": { label: "Factor of safety", min: 0 },
  "fatigue-life-estimator": { label: "Estimated life N", min: 0 },
  "material-selection-matrix": { label: "Weight normalization", min: 0.99, max: 1.01 },
  "matrix-solver": { label: "Residual norm ||Ax-b||", min: 0, max: 1e-6 },
  "ode-solver": { label: "Final y(xEnd)" },
  "curve-fitting-regression": { label: "R^2", min: -1, max: 1 },
  "unit-converter": { label: "Converted" },
  "unit-conversions": { label: "Output" },
  "engineering-constants": { label: "Rows returned", min: 1 },
  "quick-plot-tool": { label: "Data points", min: 2 },
  "data-table-csv-tool": { label: "Rows", min: 1 },
  "equation-cheatsheet": { label: "Rows returned", min: 1 },
  "ac-circuit-analyzer": { label: "Impedance |Z|", min: 0 },
  "three-phase-power": { label: "Real power", min: 0 },
  "cable-sizing-voltage-drop": { label: "Estimated voltage drop", min: 0 },
  "retaining-wall-check": { label: "FS sliding", min: 0 },
  "concrete-mix-designer": { label: "Water content", min: 0 },
  "survey-traverse-adjustment": { label: "Misclosure", min: 0 },
};

function extractFirstNumber(text: string): number | null {
  const match = text.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function findValue(result: ToolComputeResult, label: string): string | null {
  const output = result.outputs.find((item) => item.label === label);
  if (output) return output.value;
  const check = result.checks.find((item) => item.label === label);
  if (check) return check.value;
  return null;
}

describe("mvp specs happy path", () => {
  for (const spec of TOOL_RUNTIME_SPECS) {
    test(`${spec.slug} computes stable outputs`, () => {
      const issues = spec.validate(spec.sampleValid);
      expect(issues).toEqual([]);

      const result = spec.compute(spec.sampleValid);
      const payloadSize =
        result.outputs.length +
        result.checks.length +
        result.warnings.length +
        (result.table ? 1 : 0) +
        (result.series ? 1 : 0);
      expect(payloadSize).toBeGreaterThan(0);

      for (const warning of result.warnings) {
        expect(["input", "range", "stability", "assumption"]).toContain(warning.code);
        expect(warning.message.length).toBeGreaterThan(3);
      }

      const expectation = KEY_EXPECTATION_BY_SLUG[spec.slug];
      expect(expectation).toBeTruthy();
      if (!expectation) return;

      const rawValue = findValue(result, expectation.label);
      expect(rawValue).not.toBeNull();
      if (!rawValue) return;

      const numeric = extractFirstNumber(rawValue);
      expect(numeric).not.toBeNull();
      if (numeric === null) return;

      if (expectation.min !== undefined) expect(numeric).toBeGreaterThanOrEqual(expectation.min);
      if (expectation.max !== undefined) expect(numeric).toBeLessThanOrEqual(expectation.max);
    });
  }
});

describe("mvp specs invalid input validation", () => {
  for (const spec of TOOL_RUNTIME_SPECS) {
    test(`${spec.slug} rejects sample invalid input`, () => {
      const issues = spec.validate(spec.sampleInvalid);
      expect(issues.length).toBeGreaterThan(0);
      for (const issue of issues) {
        expect(issue.trim().length).toBeGreaterThan(3);
      }
    });
  }
});
