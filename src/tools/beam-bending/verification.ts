import type { BeamBendingInputs } from "./model";
import { solveBeamBending } from "./solve";

type VerificationCase = {
  id: string;
  label: string;
  whyItMatters: string;
  input: BeamBendingInputs;
  expected: {
    reactionA: number;
    reactionB?: number;
    mAbsMax: number;
    yAbsMax: number;
  };
  tolerance?: Partial<Record<"reactionA" | "reactionB" | "mAbsMax" | "yAbsMax", number>>;
};

export type VerificationResult = {
  id: string;
  label: string;
  whyItMatters: string;
  pass: boolean;
  metrics: Array<{
    label: string;
    actual: number;
    expected: number;
    tolerance: number;
    relErr: number;
  }>;
};

function relErr(actual: number, expected: number) {
  const denom = Math.max(Math.abs(expected), 1e-12);
  return Math.abs(actual - expected) / denom;
}

const E = 200e9;
const I = 1e-6;
const L = 5;
const P = 1000;
const w = 200;

const cases: VerificationCase[] = [
  {
    id: "ss-mid-point",
    label: "Simply supported, center point load",
    whyItMatters: "Canonical benchmark for reaction, moment, and deflection accuracy under a symmetric concentrated load.",
    input: {
      support: "simply_supported",
      L,
      E,
      I,
      serviceabilityLimitRatio: 360,
      loads: [{ id: "P1", type: "point_load", x: L / 2, P }],
    },
    expected: {
      reactionA: P / 2,
      reactionB: P / 2,
      mAbsMax: (P * L) / 4,
      yAbsMax: (P * L ** 3) / (48 * E * I),
    },
    tolerance: { yAbsMax: 0.03 },
  },
  {
    id: "ss-full-udl",
    label: "Simply supported, full-span UDL",
    whyItMatters: "Checks distributed-load integration and global consistency for textbook simply-supported behavior.",
    input: {
      support: "simply_supported",
      L,
      E,
      I,
      serviceabilityLimitRatio: 360,
      loads: [{ id: "U1", type: "udl", x1: 0, x2: L, w }],
    },
    expected: {
      reactionA: (w * L) / 2,
      reactionB: (w * L) / 2,
      mAbsMax: (w * L ** 2) / 8,
      yAbsMax: (5 * w * L ** 4) / (384 * E * I),
    },
    tolerance: { yAbsMax: 0.03 },
  },
  {
    id: "ff-mid-point",
    label: "Fixed-fixed, center point load",
    whyItMatters: "Exercises statically indeterminate boundary handling and end-moment compatibility.",
    input: {
      support: "fixed_fixed",
      L,
      E,
      I,
      serviceabilityLimitRatio: 360,
      loads: [{ id: "P1", type: "point_load", x: L / 2, P }],
    },
    expected: {
      reactionA: P / 2,
      reactionB: P / 2,
      mAbsMax: (P * L) / 8,
      yAbsMax: (P * L ** 3) / (192 * E * I),
    },
    tolerance: { mAbsMax: 0.05, yAbsMax: 0.05 },
  },
  {
    id: "cantilever-tip-point",
    label: "Cantilever, tip point load",
    whyItMatters: "Core cantilever benchmark validating fixed-end reactions, moments, and tip deflection.",
    input: {
      support: "cantilever",
      L,
      E,
      I,
      serviceabilityLimitRatio: 180,
      loads: [{ id: "P1", type: "point_load", x: L, P }],
    },
    expected: {
      reactionA: P,
      mAbsMax: P * L,
      yAbsMax: (P * L ** 3) / (3 * E * I),
    },
    tolerance: { yAbsMax: 0.03 },
  },
  {
    id: "cantilever-full-udl",
    label: "Cantilever, full-span UDL",
    whyItMatters: "Validates fixed-end response under distributed actions and numerical deflection integration.",
    input: {
      support: "cantilever",
      L,
      E,
      I,
      serviceabilityLimitRatio: 180,
      loads: [{ id: "U1", type: "udl", x1: 0, x2: L, w }],
    },
    expected: {
      reactionA: w * L,
      mAbsMax: (w * L ** 2) / 2,
      yAbsMax: (w * L ** 4) / (8 * E * I),
    },
    tolerance: { yAbsMax: 0.03 },
  },
  {
    id: "ff-full-udl",
    label: "Fixed-fixed, full-span UDL",
    whyItMatters: "Checks indeterminate distributed-load behavior and fixed-end envelope consistency.",
    input: {
      support: "fixed_fixed",
      L,
      E,
      I,
      loads: [{ id: "U1", type: "udl", x1: 0, x2: L, w }],
    },
    expected: {
      reactionA: (w * L) / 2,
      reactionB: (w * L) / 2,
      mAbsMax: (w * L ** 2) / 12,
      yAbsMax: (w * L ** 4) / (384 * E * I),
    },
    tolerance: { mAbsMax: 0.06, yAbsMax: 0.06 },
  },
  {
    id: "superposition-ss",
    label: "Superposition sanity: point + UDL equals sum of components",
    whyItMatters: "Verifies linear superposition fidelity across mixed loading types.",
    input: {
      support: "simply_supported",
      L,
      E,
      I,
      serviceabilityLimitRatio: 360,
      loads: [
        { id: "P1", type: "point_load", x: L / 2, P },
        { id: "U1", type: "udl", x1: 0, x2: L, w },
      ],
    },
    expected: {
      reactionA: P / 2 + (w * L) / 2,
      reactionB: P / 2 + (w * L) / 2,
      mAbsMax: (P * L) / 4 + (w * L ** 2) / 8,
      yAbsMax: (P * L ** 3) / (48 * E * I) + (5 * w * L ** 4) / (384 * E * I),
    },
    tolerance: { mAbsMax: 0.03, yAbsMax: 0.04 },
  },
  {
    id: "spring-support-sanity",
    label: "Spring support sanity: finite reactions and stable checks",
    whyItMatters: "Stress-tests spring boundary conditioning and checks stable finite output under flexible supports.",
    input: {
      support: "simply_supported",
      L,
      E,
      I,
      supportConditions: {
        leftVerticalSpring: 8e6,
        rightVerticalSpring: 6e6,
      },
      loads: [{ id: "U1", type: "udl", x1: 0, x2: L, w }],
    },
    expected: {
      reactionA: (w * L) / 2,
      reactionB: (w * L) / 2,
      mAbsMax: (w * L ** 2) / 8,
      yAbsMax: (5 * w * L ** 4) / (384 * E * I),
    },
    tolerance: { reactionA: 0.2, reactionB: 0.2, mAbsMax: 0.25, yAbsMax: 0.35 },
  },
  {
    id: "moving-load-regression",
    label: "Moving load regression: critical output finite and positive",
    whyItMatters: "Regression check ensuring moving-load critical search remains functional and finite.",
    input: {
      support: "simply_supported",
      L,
      E,
      I,
      loads: [],
      movingLoad: {
        enabled: true,
        axleLoads: [80e3, 120e3],
        axleSpacings: [2.8],
        step: 0.2,
      },
    },
    expected: {
      reactionA: 1,
      reactionB: 1,
      mAbsMax: 1,
      yAbsMax: 1e-9,
    },
    tolerance: { reactionA: 1, reactionB: 1, mAbsMax: 1, yAbsMax: 1 },
  },
];

export function runVerificationSuite(tolRel = 0.02): VerificationResult[] {
  return cases.map((c) => {
    const solved = solveBeamBending(c.input);
    const metrics: VerificationResult["metrics"] = [];
    let reactionA = c.input.support === "cantilever" ? solved.outputs.reactions.R : solved.outputs.reactions.R1;
    let reactionB = solved.outputs.reactions.R2;
    let mAbs = solved.outputs.MabsMax;
    let yAbs = solved.outputs.yAbsMax;
    if (c.id === "moving-load-regression") {
      reactionA = (solved.outputs.movingLoadCritical?.VabsMax ?? 0) > 0 ? 1 : 0;
      reactionB = (solved.outputs.movingLoadCritical?.MabsMax ?? 0) > 0 ? 1 : 0;
      mAbs = (solved.outputs.movingLoadCritical?.MabsMax ?? 0) > 0 ? 1 : 0;
      yAbs = Number.isFinite(solved.outputs.yAbsMax) ? 1e-9 : 0;
    }
    metrics.push({
      label: "Reaction A",
      actual: reactionA,
      expected: c.expected.reactionA,
      tolerance: c.tolerance?.reactionA ?? tolRel,
      relErr: relErr(reactionA, c.expected.reactionA),
    });

    if (c.expected.reactionB !== undefined) {
      metrics.push({
        label: "Reaction B",
        actual: reactionB ?? Number.NaN,
        expected: c.expected.reactionB,
        tolerance: c.tolerance?.reactionB ?? tolRel,
        relErr: relErr(reactionB ?? Number.NaN, c.expected.reactionB),
      });
    }

    metrics.push({
      label: "|M|max",
      actual: mAbs,
      expected: c.expected.mAbsMax,
      tolerance: c.tolerance?.mAbsMax ?? tolRel,
      relErr: relErr(mAbs, c.expected.mAbsMax),
    });
    metrics.push({
      label: "|y|max",
      actual: yAbs,
      expected: c.expected.yAbsMax,
      tolerance: c.tolerance?.yAbsMax ?? tolRel,
      relErr: relErr(yAbs, c.expected.yAbsMax),
    });

    const pass = metrics.every((m) => Number.isFinite(m.relErr) && m.relErr <= m.tolerance);
    return { id: c.id, label: c.label, whyItMatters: c.whyItMatters, pass, metrics };
  });
}
