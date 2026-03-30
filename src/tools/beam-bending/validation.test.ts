import { describe, expect, test } from "vitest";
import type { BeamBendingInputs } from "./model";
import { getBeamInputIssues } from "./validation";

const base: BeamBendingInputs = {
  support: "simply_supported",
  L: 6,
  E: 200e9,
  I: 1e-6,
  loads: [{ id: "P1", type: "point_load", x: 3, P: 1000 }],
};

describe("beam section validation", () => {
  test("rejects missing required section dimensions", () => {
    const inp: BeamBendingInputs = {
      ...base,
      section: { id: "rectangular", unit: "mm", dims: { b: 300 } },
    };
    const issues = getBeamInputIssues(inp);
    expect(issues.some((x) => x.includes("required"))).toBe(true);
  });

  test("rejects circular hollow section with Di >= Do", () => {
    const inp: BeamBendingInputs = {
      ...base,
      section: { id: "circular_hollow", unit: "mm", dims: { Do: 200, Di: 200 } },
    };
    const issues = getBeamInputIssues(inp);
    expect(issues.some((x) => x.includes("Di must be less than Do"))).toBe(true);
  });

  test("accepts valid i-beam geometry", () => {
    const inp: BeamBendingInputs = {
      ...base,
      section: { id: "i_beam", unit: "mm", dims: { bf: 220, tf: 16, tw: 10, h: 400 } },
    };
    const issues = getBeamInputIssues(inp);
    expect(issues.length).toBe(0);
  });

  test("rejects invalid i-beam flange-depth relation", () => {
    const inp: BeamBendingInputs = {
      ...base,
      section: { id: "i_beam", unit: "mm", dims: { bf: 220, tf: 110, tw: 10, h: 200 } },
    };
    const issues = getBeamInputIssues(inp);
    expect(issues.some((x) => x.includes("h > 2*tf"))).toBe(true);
  });

  test("rejects invalid channel flange-depth relation", () => {
    const inp: BeamBendingInputs = {
      ...base,
      section: { id: "channel", unit: "mm", dims: { b: 220, tf: 120, tw: 10, h: 100 } },
    };
    const issues = getBeamInputIssues(inp);
    expect(issues.some((x) => x.includes("h > tf"))).toBe(true);
  });

  test("rejects moving load with inconsistent spacing count", () => {
    const inp: BeamBendingInputs = {
      ...base,
      movingLoad: {
        enabled: true,
        axleLoads: [100e3, 120e3, 120e3],
        axleSpacings: [2.5],
        step: 0.2,
      },
    };
    const issues = getBeamInputIssues(inp);
    expect(issues.some((x) => x.includes("spacings count"))).toBe(true);
  });

  test("accepts custom load category usage when category is defined", () => {
    const inp: BeamBendingInputs = {
      ...base,
      loadCategories: [{ id: "wind", name: "Wind", active: true }],
      loadCases: [{ id: "WIND", name: "Wind Case", category: "wind", active: true, loads: [] }],
      loads: [{ id: "P1", type: "point_load", x: 3, P: 1000, category: "wind", caseId: "WIND" }],
    };
    const issues = getBeamInputIssues(inp);
    expect(issues.length).toBe(0);
  });

  test("rejects undefined custom load category when category definitions are explicit", () => {
    const inp: BeamBendingInputs = {
      ...base,
      loadCategories: [{ id: "wind", name: "Wind", active: true }],
      loadCases: [{ id: "Q", name: "Q", category: "seismic", active: true, loads: [] }],
      loads: [{ id: "P1", type: "point_load", x: 3, P: 1000, category: "seismic", caseId: "Q" }],
    };
    const issues = getBeamInputIssues(inp);
    expect(issues.some((x) => x.includes("not defined") || x.includes("not supported"))).toBe(true);
  });

  test("rejects overlapping piecewise stiffness segments", () => {
    const inp: BeamBendingInputs = {
      ...base,
      stiffnessSegments: [
        { id: "SEG1", x1: 0, x2: 3, E: 200e9, I: 1e-6 },
        { id: "SEG2", x1: 2.5, x2: 6, E: 120e9, I: 0.8e-6 },
      ],
    };
    const issues = getBeamInputIssues(inp);
    expect(issues.some((x) => x.includes("overlap"))).toBe(true);
  });

  test("accepts custom simply-supported station layout with overhangs", () => {
    const inp: BeamBendingInputs = {
      ...base,
      support: "simply_supported",
      supportLayout: {
        stations: [
          { id: "S1", x: 1.2, restraint: "pinned", settlement: 0 },
          { id: "S2", x: 5.1, restraint: "pinned", settlement: 0 },
        ],
      },
    };
    const issues = getBeamInputIssues(inp);
    expect(issues.length).toBe(0);
  });

  test("rejects explicit support stations for unsupported support models", () => {
    const inp: BeamBendingInputs = {
      ...base,
      support: "fixed_fixed",
      supportLayout: {
        stations: [
          { id: "S1", x: 0, restraint: "fixed" },
          { id: "S2", x: 6, restraint: "fixed" },
        ],
      },
    };
    const issues = getBeamInputIssues(inp);
    expect(issues.some((x) => x.includes("not yet supported"))).toBe(true);
  });

  test("rejects explicit support stations for cantilever model in current scope", () => {
    const inp: BeamBendingInputs = {
      ...base,
      support: "cantilever",
      supportLayout: {
        stations: [{ id: "S1", x: 0, restraint: "fixed" }],
      },
    };
    const issues = getBeamInputIssues(inp);
    expect(issues.some((x) => x.includes("explicit support-station layouts are not yet supported"))).toBe(true);
  });

  test("rejects internal releases with simply supported model", () => {
    const inp: BeamBendingInputs = {
      ...base,
      support: "simply_supported",
      internalReleases: [{ id: "H1", x: 2.5, type: "moment", active: true }],
    };
    const issues = getBeamInputIssues(inp);
    expect(issues.some((x) => x.includes("Internal moment releases"))).toBe(true);
  });
});
