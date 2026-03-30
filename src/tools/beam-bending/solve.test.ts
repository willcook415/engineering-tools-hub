import { describe, expect, test } from "vitest";
import type { BeamBendingInputs } from "./model";
import { resolveSectionProperties } from "./sections";
import { solveBeamBending } from "./solve";
import { runVerificationSuite } from "./verification";

const E = 200e9;
const I = 1e-6;
const L = 5;
const P = 1000;

function approx(actual: number, expected: number, relTol = 0.02) {
  const denom = Math.max(1e-12, Math.abs(expected));
  expect(Math.abs(actual - expected) / denom).toBeLessThanOrEqual(relTol);
}

describe("beam bending solver", () => {
  test("verification suite passes at 2% tolerance", () => {
    const results = runVerificationSuite(0.02);
    for (const r of results) {
      expect(r.pass).toBe(true);
    }
  });

  test("verification suite exposes benchmark rationale and explicit metric tolerances", () => {
    const results = runVerificationSuite(0.02);
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.whyItMatters.length).toBeGreaterThan(0);
      expect(result.metrics.length).toBeGreaterThan(0);
      for (const metric of result.metrics) {
        expect(metric.tolerance).toBeGreaterThan(0);
        expect(Number.isFinite(metric.tolerance)).toBe(true);
      }
    }
  });

  test("simply supported center point load matches textbook values", () => {
    const input: BeamBendingInputs = {
      support: "simply_supported",
      L,
      E,
      I,
      loads: [{ id: "P1", type: "point_load", x: L / 2, P }],
    };
    const out = solveBeamBending(input).outputs;
    approx(out.reactions.R1, P / 2, 0.01);
    approx(out.reactions.R2, P / 2, 0.01);
    approx(out.MabsMax, (P * L) / 4, 0.02);
    approx(out.yAbsMax, (P * L ** 3) / (48 * E * I), 0.03);
  });

  test("cantilever tip point load matches textbook values", () => {
    const input: BeamBendingInputs = {
      support: "cantilever",
      L,
      E,
      I,
      loads: [{ id: "P1", type: "point_load", x: L, P }],
    };
    const out = solveBeamBending(input).outputs;
    approx(out.reactions.R, P, 0.01);
    approx(out.MabsMax, P * L, 0.02);
    approx(out.yAbsMax, (P * L ** 3) / (3 * E * I), 0.03);
  });

  test("fixed-fixed center point load returns stable end moments and reactions", () => {
    const input: BeamBendingInputs = {
      support: "fixed_fixed",
      L,
      E,
      I,
      loads: [{ id: "P1", type: "point_load", x: L / 2, P }],
    };
    const out = solveBeamBending(input).outputs;
    approx(out.reactions.R1, P / 2, 0.02);
    approx(out.reactions.R2, P / 2, 0.02);
    approx(Math.abs(out.reactions.M1), (P * L) / 8, 0.08);
    approx(Math.abs(out.reactions.M2), (P * L) / 8, 0.08);
    expect(Math.abs(out.equilibriumResiduals.force)).toBeLessThan(1e-6);
    expect(Math.abs(out.equilibriumResiduals.momentAboutLeft)).toBeLessThan(1e-4);
  });

  test("propped cantilever solves with bounded equilibrium residuals", () => {
    const input: BeamBendingInputs = {
      support: "propped_cantilever",
      L,
      E,
      I,
      loads: [
        { id: "U1", type: "udl", x1: 0, x2: L, w: 200 },
        { id: "P1", type: "point_load", x: 0.65 * L, P: 500 },
      ],
    };
    const out = solveBeamBending(input).outputs;
    expect(Number.isFinite(out.reactions.R1)).toBe(true);
    expect(Number.isFinite(out.reactions.R2)).toBe(true);
    expect(Number.isFinite(out.reactions.M1)).toBe(true);
    expect(Math.abs(out.equilibriumResiduals.force)).toBeLessThan(1e-6);
    expect(Math.abs(out.equilibriumResiduals.momentAboutLeft)).toBeLessThan(1e-3);
  });

  test("section property resolver returns finite values for valid section inputs", () => {
    const sections: NonNullable<BeamBendingInputs["section"]>[] = [
      { id: "rectangular", unit: "mm", dims: { b: 300, h: 600 } },
      { id: "circular_solid", unit: "mm", dims: { D: 406 } },
      { id: "circular_hollow", unit: "mm", dims: { Do: 508, Di: 456 } },
      { id: "i_beam", unit: "mm", dims: { bf: 250, tf: 18, tw: 10, h: 450 } },
      { id: "channel", unit: "mm", dims: { b: 150, tf: 16, tw: 9, h: 300 } },
    ];
    for (const section of sections) {
      const resolved = resolveSectionProperties(section);
      expect(resolved).toBeTruthy();
      expect(Number.isFinite(resolved!.I)).toBe(true);
      expect(resolved!.I).toBeGreaterThan(0);
      expect(resolved!.A ?? 0).toBeGreaterThan(0);
      expect(resolved!.Z ?? 0).toBeGreaterThan(0);
      expect(resolved!.depth ?? 0).toBeGreaterThan(0);
    }
  });

  test("invalid section dimensions fail validation and do not crash the solver", () => {
    const bad: BeamBendingInputs = {
      support: "simply_supported",
      L: 5,
      E: 200e9,
      I: 1e-6,
      section: { id: "circular_hollow", unit: "mm", dims: { Do: 100, Di: 120 } },
      loads: [{ id: "P1", type: "point_load", x: 2.5, P: 1000 }],
    };
    expect(() => solveBeamBending(bad)).toThrow();
  });

  test("moving load train produces critical output when enabled", () => {
    const input: BeamBendingInputs = {
      support: "simply_supported",
      L,
      E,
      I,
      loads: [],
      movingLoad: {
        enabled: true,
        axleLoads: [80e3, 120e3],
        axleSpacings: [2.8],
        step: 0.25,
      },
    };
    const out = solveBeamBending(input).outputs;
    expect(out.movingLoadCritical).toBeTruthy();
    expect((out.movingLoadCritical?.MabsMax ?? 0) > 0).toBe(true);
    expect((out.movingLoadCritical?.VabsMax ?? 0) > 0).toBe(true);
  });

  test("design checks output exists when criteria and stresses are available", () => {
    const input: BeamBendingInputs = {
      support: "simply_supported",
      L,
      E,
      I,
      section: { id: "rectangular", unit: "mm", dims: { b: 300, h: 600 } },
      designCriteria: {
        allowableBendingStress: 250e6,
        allowableShearStress: 145e6,
        deflectionLimitRatio: 360,
      },
      loads: [{ id: "P1", type: "point_load", x: L / 2, P }],
    };
    const out = solveBeamBending(input).outputs;
    expect(out.designChecks).toBeTruthy();
    expect(Number.isFinite(out.designChecks!.deflectionUtilization)).toBe(true);
  });

  test("quality metadata exposes convergence and confidence fields", () => {
    const input: BeamBendingInputs = {
      support: "simply_supported",
      L,
      E,
      I,
      loads: [{ id: "U1", type: "udl", x1: 0, x2: L, w: 300 }],
    };
    const out = solveBeamBending(input).outputs;
    expect(out.quality).toBeTruthy();
    expect(Number.isFinite(out.quality!.meshSensitivityRatio ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(out.quality!.confidenceScore ?? Number.NaN)).toBe(true);
    expect(["high", "medium", "low"]).toContain(out.quality!.confidenceBadge);
  });

  test("validity warnings include trigger, consequence, and mitigation text", () => {
    const input: BeamBendingInputs = {
      support: "simply_supported",
      theory: "euler_bernoulli",
      L: 2,
      E,
      I,
      section: { id: "rectangular", unit: "m", dims: { b: 0.3, h: 0.35 } },
      loads: [{ id: "P1", type: "point_load", x: 1, P: 6e7 }],
    };
    const out = solveBeamBending(input).outputs;
    expect(out.validityWarnings.some((x) => x.includes("Trigger:"))).toBe(true);
    expect(out.validityWarnings.some((x) => x.includes("Consequence:"))).toBe(true);
    expect(out.validityWarnings.some((x) => x.includes("Mitigation:"))).toBe(true);
  });

  test("combination summaries expose utilization, governing location, and envelope critical metadata", () => {
    const input: BeamBendingInputs = {
      support: "simply_supported",
      L,
      E,
      I,
      loads: [{ id: "Pbase", type: "point_load", x: 1.5, P: 300 }],
      loadCases: [
        { id: "DL", name: "Dead", category: "dead", active: true, loads: [{ id: "DL1", type: "udl", x1: 0, x2: L, w: 200 }] },
        { id: "LL", name: "Live", category: "live", active: true, loads: [{ id: "LL1", type: "point_load", x: 2.2, P: 800 }] },
      ],
      loadCombinations: [
        {
          id: "ULS",
          name: "ULS",
          category: "ULS",
          active: true,
          terms: [
            { caseId: "DL", factor: 1.35, active: true },
            { caseId: "LL", factor: 1.5, active: true },
          ],
        },
        {
          id: "SLS",
          name: "SLS",
          category: "SLS",
          active: true,
          terms: [
            { caseId: "DL", factor: 1.0, active: true },
            { caseId: "LL", factor: 1.0, active: true },
          ],
        },
      ],
      envelopeDefinitions: [{ id: "ENV", name: "All", active: true, combinationIds: ["ULS", "SLS"] }],
    };
    const out = solveBeamBending(input).outputs;
    expect(out.combinations?.length).toBe(2);
    for (const c of out.combinations ?? []) {
      expect(Number.isFinite(c.utilization ?? Number.NaN)).toBe(true);
      expect(c.governingMode).toBeTruthy();
      expect(Number.isFinite(c.governingX ?? Number.NaN)).toBe(true);
      expect(typeof c.pass).toBe("boolean");
    }
    expect(out.envelope?.length).toBeGreaterThan(0);
    expect(out.envelopeMeta?.criticalCombinationId).toBeTruthy();
    expect(out.envelopeMeta?.criticalCombinationName).toBeTruthy();
  });

  test("informational envelope generation warning does not penalize warning-burden confidence", () => {
    const input: BeamBendingInputs = {
      support: "simply_supported",
      L,
      E,
      I,
      loads: [],
      loadCases: [
        { id: "DL", name: "Dead", category: "dead", active: true, loads: [{ id: "DL1", type: "udl", x1: 0, x2: L, w: 200 }] },
        { id: "LL", name: "Live", category: "live", active: true, loads: [{ id: "LL1", type: "point_load", x: 2.5, P: 600 }] },
      ],
      loadCombinations: [
        {
          id: "ULS",
          name: "ULS",
          category: "ULS",
          active: true,
          terms: [
            { caseId: "DL", factor: 1.35, active: true },
            { caseId: "LL", factor: 1.5, active: true },
          ],
        },
      ],
      envelopeDefinitions: [{ id: "ENV", name: "All active", active: true, combinationIds: ["ULS"] }],
    };
    const out = solveBeamBending(input).outputs;
    expect((out.warningDetails ?? []).some((w) => w.id === "envelope_generated")).toBe(true);
    expect(out.quality?.confidenceSubscores?.warningBurden).toBe(1);
    expect(out.quality?.warningPenalty).toBe(0);
  });

  test("trust layer outputs assumptions, structured warnings, confidence subscores, and solve audit", () => {
    const input: BeamBendingInputs = {
      support: "simply_supported",
      theory: "euler_bernoulli",
      L: 2,
      E,
      I,
      section: { id: "rectangular", unit: "m", dims: { b: 0.3, h: 0.35 } },
      loads: [
        { id: "P1", type: "point_load", x: 0.05, P: 6e7 },
        { id: "TH1", type: "thermal", x1: 0, x2: 2, alpha: 12e-6, dT: 20, depth: 0.35 },
      ],
      analysisOptions: { meshDensity: "coarse", adaptiveRefinement: true },
    };
    const out = solveBeamBending(input).outputs;
    expect(out.assumptions).toBeTruthy();
    expect(out.assumptions?.exclusions.some((x) => x.toLowerCase().includes("plasticity"))).toBe(true);
    expect((out.warningDetails ?? []).length).toBeGreaterThan(0);
    expect((out.warningDetails ?? []).every((w) => w.trigger.length > 0 && w.consequence.length > 0 && w.mitigation.length > 0)).toBe(true);
    expect(out.quality?.confidenceSubscores).toBeTruthy();
    expect(Number.isFinite(out.quality?.confidenceSubscores?.equilibrium ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(out.quality?.confidenceSubscores?.mesh ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(out.quality?.confidenceSubscores?.applicability ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(out.quality?.confidenceSubscores?.modelCompleteness ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(out.quality?.confidenceSubscores?.warningBurden ?? Number.NaN)).toBe(true);
    expect(out.solveAudit).toBeTruthy();
    expect(out.solveAudit?.inputHash.length).toBeGreaterThan(6);
    expect(out.solveAudit?.solverVersion.length).toBeGreaterThan(0);
    expect(out.solveAudit?.warningSet).toBeTruthy();
  });

  test("simply-supported support stations allow overhang solve with finite response", () => {
    const input: BeamBendingInputs = {
      support: "simply_supported",
      L: 8,
      E,
      I,
      supportLayout: {
        stations: [
          { id: "S1", x: 1.2, restraint: "pinned", settlement: 0 },
          { id: "S2", x: 6.4, restraint: "pinned", settlement: 0 },
        ],
      },
      loads: [
        { id: "U1", type: "udl", x1: 0, x2: 8, w: 400 },
        { id: "P1", type: "point_load", x: 7.4, P: 1200 },
      ],
    };
    const solved = solveBeamBending(input);
    expect(Number.isFinite(solved.outputs.reactions.R1)).toBe(true);
    expect(Number.isFinite(solved.outputs.reactions.R2)).toBe(true);
    expect(Math.abs(solved.outputs.equilibriumResiduals.force)).toBeLessThan(1e-6);
    expect(Math.abs(solved.outputs.equilibriumResiduals.momentAboutLeft)).toBeLessThan(1e-4);
    expect(solved.outputs.supportRotations?.length).toBe(2);
  });

  test("internal moment release enforces near-zero moment at release location", () => {
    const input: BeamBendingInputs = {
      support: "fixed_fixed",
      L: 6,
      E,
      I,
      internalReleases: [{ id: "H1", x: 3, type: "moment", active: true }],
      loads: [{ id: "U1", type: "udl", x1: 0, x2: 6, w: 600 }],
    };
    const solved = solveBeamBending(input);
    const atHinge = solved.outputs.criticalPoints.find((p) => Math.abs(p.x - 3) < 0.02);
    expect(atHinge).toBeTruthy();
    expect(Math.abs(atHinge?.M ?? 1)).toBeLessThan(1e-2);
  });

  test("rotation plot and extrema are exposed as first-class outputs", () => {
    const input: BeamBendingInputs = {
      support: "simply_supported",
      L,
      E,
      I,
      loads: [{ id: "P1", type: "point_load", x: L / 2, P }],
    };
    const solved = solveBeamBending(input);
    expect(solved.plots.rotation.length).toBeGreaterThan(0);
    expect(Number.isFinite(solved.outputs.thetaAbsMax ?? Number.NaN)).toBe(true);
    expect((solved.outputs.rotationExtrema ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("piecewise segment material presets and custom material reduce local stiffness response as expected", () => {
    const uniform: BeamBendingInputs = {
      support: "simply_supported",
      L: 6,
      E: 210e9,
      I: 2.2e-5,
      loads: [{ id: "U1", type: "udl", x1: 0, x2: 6, w: 20e3 }],
    };
    const base = solveBeamBending(uniform).outputs;

    const segmented: BeamBendingInputs = {
      ...uniform,
      stiffnessSegments: [
        { id: "SEG_A", x1: 2, x2: 3.5, materialPresetId: "aluminium_6061_t6" },
        {
          id: "SEG_B",
          x1: 3.5,
          x2: 5,
          materialPresetId: "custom",
          material: { id: "custom", name: "Soft custom segment", E: 70e9, nu: 0.33 },
        },
      ],
    };
    const withSegments = solveBeamBending(segmented).outputs;

    expect(withSegments.yAbsMax).toBeGreaterThan(base.yAbsMax);
    expect(withSegments.assumptions?.propertyVariation.toLowerCase()).toContain("piecewise");
  });
});
