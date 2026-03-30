import type { SolveResult, Step } from "../_shared/steps/stepTypes";
import type {
  AssumptionsProfile,
  BeamDisplayUnits,
  BeamBendingInputs,
  BeamBendingOutputs,
  BeamBendingPlots,
  BeamTheory,
  CombinationSummary,
  CriticalPoint,
  EnvelopePoint,
  InfluenceLinePoint,
  InternalRelease,
  Load,
  LoadCombination,
  SupportRestraintType,
  SupportStation,
  StressOutputs,
  WarningDetail,
  WarningSeverity,
} from "./model";
import { MATERIAL_PRESETS } from "./materials";
import { resolveSectionProperties } from "./sections";
import { formatUnitNumber, getDisplayUnits, quantityUnitSymbol } from "./units";
import { assertBeamInputs } from "./validation";

type Profile = {
  xs: number[];
  sfd: { x: number; V: number }[];
  bmd: { x: number; M: number }[];
  deflection: { x: number; y: number }[];
  theta: { x: number; theta: number }[];
  end: { V: number; M: number; y: number; theta: number };
};

type PropState = {
  E: number;
  I: number;
  A?: number;
  G?: number;
  kappaShear?: number;
  Z?: number;
  depth?: number;
  segmentId?: string;
};

type SingleResult = {
  outputs: BeamBendingOutputs;
  plots: BeamBendingPlots;
  internals: {
    xs: number[];
    V0: number;
    M0: number;
    theta0: number;
    y0: number;
    totalVertical: number;
    totalMomentLeft: number;
    maxCurvature: number;
    supportStations: SupportStation[];
    activeReleases: InternalRelease[];
  };
};

const BEAM_MODEL_VERSION = "beam-inputs-v3";
const BEAM_SOLVER_VERSION = "beam-solver-v3";

function linspace(a: number, b: number, n: number) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

function fmt(x: number, sig = 6) {
  if (!Number.isFinite(x)) return "-";
  const abs = Math.abs(x);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return x.toExponential(3);
  return Number(x.toPrecision(sig)).toString();
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function uniqueSorted(xs: number[]) {
  return Array.from(new Set(xs.map((x) => Number(x.toFixed(9))))).sort((a, b) => a - b);
}

function interpolateAt(xs: number[], ys: number[], x: number) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const x1 = xs[lo];
  const x2 = xs[hi];
  const y1 = ys[lo];
  const y2 = ys[hi];
  const t = (x - x1) / (x2 - x1);
  return y1 + t * (y2 - y1);
}

function solve2x2(
  a11: number,
  a12: number,
  a21: number,
  a22: number,
  b1: number,
  b2: number
): [number, number] {
  const det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-14) throw new Error("Unable to solve support equations (singular system).");
  return [(b1 * a22 - b2 * a12) / det, (a11 * b2 - a21 * b1) / det];
}

function solveLinearSystem(matrix: number[][], rhs: number[]) {
  const n = matrix.length;
  if (n === 0) return [];
  if (rhs.length !== n) throw new Error("Linear solve size mismatch.");
  const a = matrix.map((row) => row.slice());
  const b = rhs.slice();
  for (let i = 0; i < n; i++) {
    if (a[i].length !== n) throw new Error("Linear system must be square.");
  }

  for (let col = 0; col < n; col++) {
    let pivot = col;
    let pivotAbs = Math.abs(a[col][col]);
    for (let row = col + 1; row < n; row++) {
      const cand = Math.abs(a[row][col]);
      if (cand > pivotAbs) {
        pivot = row;
        pivotAbs = cand;
      }
    }
    if (pivotAbs < 1e-14) {
      throw new Error("Unable to solve generalized support/release equations (singular system).");
    }
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }

    const diag = a[col][col];
    for (let j = col; j < n; j++) a[col][j] /= diag;
    b[col] /= diag;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      if (Math.abs(factor) < 1e-16) continue;
      for (let j = col; j < n; j++) a[row][j] -= factor * a[col][j];
      b[row] -= factor * b[col];
    }
  }
  return b;
}

const MATERIAL_PRESET_MAP = new Map(MATERIAL_PRESETS.map((preset) => [preset.id, preset]));

function resolveSupportStations(inp: BeamBendingInputs): SupportStation[] {
  const fromLayout = (inp.supportLayout?.stations ?? [])
    .filter((s) => s.active !== false)
    .map((s) => ({ ...s }))
    .sort((a, b) => a.x - b.x);
  if (fromLayout.length > 0) return fromLayout;

  const leftSettlement = inp.supportConditions?.leftSettlement ?? 0;
  const rightSettlement = inp.supportConditions?.rightSettlement ?? 0;
  const leftRotation = inp.supportConditions?.leftRotation ?? 0;
  const rightRotation = inp.supportConditions?.rightRotation ?? 0;
  const leftVerticalSpring = inp.supportConditions?.leftVerticalSpring;
  const rightVerticalSpring = inp.supportConditions?.rightVerticalSpring;
  const leftRotationalSpring = inp.supportConditions?.leftRotationalSpring;
  const rightRotationalSpring = inp.supportConditions?.rightRotationalSpring;

  if (inp.support === "cantilever") {
    return [
      {
        id: "S1",
        x: 0,
        restraint: "fixed",
        settlement: leftSettlement,
        imposedRotation: leftRotation,
        verticalSpring: leftVerticalSpring,
        rotationalSpring: leftRotationalSpring,
      },
    ];
  }

  const leftRestraint: SupportRestraintType =
    inp.support === "fixed_fixed" || inp.support === "propped_cantilever" ? "fixed" : "pinned";
  const rightRestraint: SupportRestraintType = inp.support === "fixed_fixed" ? "fixed" : "pinned";
  return [
    {
      id: "S1",
      x: 0,
      restraint: leftRestraint,
      settlement: leftSettlement,
      imposedRotation: leftRotation,
      verticalSpring: leftVerticalSpring,
      rotationalSpring: leftRotationalSpring,
    },
    {
      id: "S2",
      x: inp.L,
      restraint: rightRestraint,
      settlement: rightSettlement,
      imposedRotation: rightRotation,
      verticalSpring: rightVerticalSpring,
      rotationalSpring: rightRotationalSpring,
    },
  ];
}

function activeMomentReleases(inp: BeamBendingInputs) {
  return (inp.internalReleases ?? [])
    .filter((r) => r.active !== false && r.type === "moment")
    .slice()
    .sort((a, b) => a.x - b.x);
}

type ResponseQuantity = "V" | "M" | "y" | "theta";

function quantityAt(profile: Profile, quantity: ResponseQuantity, x: number) {
  const xx = clamp(x, 0, profile.xs[profile.xs.length - 1] ?? x);
  if (quantity === "V") return interpolateAt(profile.xs, profile.sfd.map((p) => p.V), xx);
  if (quantity === "M") return interpolateAt(profile.xs, profile.bmd.map((p) => p.M), xx);
  if (quantity === "theta") return interpolateAt(profile.xs, profile.theta.map((p) => p.theta), xx);
  return interpolateAt(profile.xs, profile.deflection.map((p) => p.y), xx);
}

function scaleLoad(load: Load, factor: number, prefix = ""): Load {
  const id = prefix ? `${prefix}_${load.id}` : load.id;
  if (load.type === "point_load") return { ...load, id, P: load.P * factor };
  if (load.type === "udl") return { ...load, id, w: load.w * factor };
  if (load.type === "linear_dist") return { ...load, id, w1: load.w1 * factor, w2: load.w2 * factor };
  if (load.type === "moment") return { ...load, id, M: load.M * factor };
  if (load.type === "thermal") return { ...load, id, dT: load.dT * factor };
  return { ...load, id, kappa0: load.kappa0 * factor };
}

function dedupeLoadsById(loads: Load[]) {
  const map = new Map<string, Load>();
  for (const load of loads) map.set(load.id, load);
  return Array.from(map.values());
}

function buildCaseLoadMap(inp: BeamBendingInputs) {
  const map = new Map<string, Load[]>();
  map.set("BASE", inp.loads);
  const caseDefs = inp.loadCases ?? [];
  const caseIdSet = new Set(caseDefs.map((c) => c.id));
  for (const c of caseDefs) {
    if (c.active === false) {
      map.set(c.id, []);
      continue;
    }
    const assigned = inp.loads.filter((l) => l.caseId === c.id);
    const combined = dedupeLoadsById([...(c.loads ?? []), ...assigned]);
    map.set(c.id, combined);
  }
  for (const l of inp.loads) {
    if (!l.caseId) continue;
    if (caseIdSet.has(l.caseId)) continue;
    const current = map.get(l.caseId) ?? [];
    map.set(l.caseId, dedupeLoadsById([...current, l]));
  }
  return map;
}

function combineLoads(inp: BeamBendingInputs, combo: LoadCombination, caseMap?: Map<string, Load[]>) {
  if (combo.active === false) return [];
  const map = caseMap ?? buildCaseLoadMap(inp);
  const out: Load[] = [];
  for (const term of combo.terms) {
    if (term.active === false) continue;
    const loads = map.get(term.caseId) ?? [];
    for (const l of loads) out.push(scaleLoad(l, term.factor, term.caseId));
  }
  return out;
}

function buildSampleXs(
  L: number,
  loads: Load[],
  anchors: number[] = [],
  meshDensity: "coarse" | "normal" | "fine" = "normal",
  adaptiveRefinement = true
) {
  const densityScale = meshDensity === "coarse" ? 0.65 : meshDensity === "fine" ? 1.5 : 1;
  const minN = Math.max(220, Math.round(700 * densityScale));
  const maxN = Math.max(minN + 200, Math.round(2600 * densityScale));
  const n = Math.min(maxN, Math.max(minN, Math.round((520 + loads.length * 140) * densityScale)));
  const base = linspace(0, L, n);
  const eps = Math.max(L / (adaptiveRefinement ? 12000 : 6000), 1e-6);
  const events = [0, L, ...anchors];
  for (const l of loads) {
    if (l.type === "point_load" || l.type === "moment") events.push(l.x);
    else events.push(l.x1, l.x2);
  }
  if (!adaptiveRefinement) return uniqueSorted(base);
  const around = events.flatMap((x) => [clamp(x - eps, 0, L), x, clamp(x + eps, 0, L)]);
  return uniqueSorted([...base, ...around]);
}

function zeroCrossings(series: { x: number; y: number }[]) {
  const xs: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    if (a.y === 0) xs.push(a.x);
    if (b.y === 0) xs.push(b.x);
    if (a.y * b.y < 0) {
      const t = Math.abs(a.y) / (Math.abs(a.y) + Math.abs(b.y));
      xs.push(a.x + t * (b.x - a.x));
    }
  }
  return uniqueSorted(xs);
}

function safeRelDiff(a: number, b: number) {
  const denom = Math.max(1e-12, Math.abs(a));
  return Math.abs(a - b) / denom;
}

function estimateMeshSensitivity(sfd: { x: number; V: number }[], bmd: { x: number; M: number }[], deflection: { x: number; y: number }[]) {
  if (sfd.length < 20 || bmd.length < 20 || deflection.length < 20) return 0;
  const pickMaxAbs = (vals: number[]) => vals.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0);
  const full = {
    v: pickMaxAbs(sfd.map((p) => p.V)),
    m: pickMaxAbs(bmd.map((p) => p.M)),
    y: pickMaxAbs(deflection.map((p) => p.y)),
  };
  const coarseByStride = (n: number) => {
    const keep = <T,>(arr: T[]) => arr.filter((_, i) => i % n === 0 || i === arr.length - 1);
    return {
      v: pickMaxAbs(keep(sfd).map((p) => p.V)),
      m: pickMaxAbs(keep(bmd).map((p) => p.M)),
      y: pickMaxAbs(keep(deflection).map((p) => p.y)),
    };
  };
  const c2 = coarseByStride(2);
  const c4 = coarseByStride(4);
  const rels = [
    safeRelDiff(full.v, c2.v),
    safeRelDiff(full.m, c2.m),
    safeRelDiff(full.y, c2.y),
    safeRelDiff(full.v, c4.v),
    safeRelDiff(full.m, c4.m),
    safeRelDiff(full.y, c4.y),
  ];
  return Math.max(...rels);
}

function confidenceBadge(score: number): "high" | "medium" | "low" {
  if (score >= 0.8) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

function warningEntry(
  id: string,
  severity: WarningSeverity,
  trigger: string,
  consequence: string,
  mitigation: string
): WarningDetail {
  return { id, severity, trigger, consequence, mitigation };
}

function warningText(w: WarningDetail) {
  return `Trigger: ${w.trigger} Consequence: ${w.consequence} Mitigation: ${w.mitigation}`;
}

function warningPenaltyWeight(w: WarningDetail) {
  if (w.id === "envelope_generated") return 0;
  if (w.severity === "critical") return 0.18;
  if (w.severity === "warning") return 0.1;
  return 0.04;
}

function applicabilityPenaltyWeight(w: WarningDetail) {
  if (w.id === "envelope_generated") return 0;
  if (w.severity === "critical") return 0.2;
  if (w.severity === "warning") return 0.12;
  return 0.05;
}

function warningBurdenFromDetails(details: WarningDetail[]) {
  const penalty = details.reduce((acc, w) => acc + warningPenaltyWeight(w), 0);
  return Math.max(0, Math.min(1, 1 - Math.min(0.8, penalty)));
}

function confidenceDriverLabel(id: string) {
  if (id === "equilibrium") return "Equilibrium residuals reduce confidence.";
  if (id === "mesh") return "Mesh sensitivity/mesh policy limits confidence.";
  if (id === "applicability") return "Applicability warnings reduce confidence.";
  if (id === "modelCompleteness") return "Model completeness inputs could be strengthened.";
  return "Warning burden reduces confidence.";
}

function confidenceBlend(subscores: {
  equilibrium: number;
  mesh: number;
  applicability: number;
  modelCompleteness: number;
  warningBurden: number;
}) {
  const score = Math.max(
    0,
    Math.min(
      1,
      0.32 * subscores.equilibrium +
        0.22 * subscores.mesh +
        0.22 * subscores.applicability +
        0.14 * subscores.modelCompleteness +
        0.1 * subscores.warningBurden
    )
  );
  const driverPool = Object.entries(subscores).map(([id, value]) => ({ id, value }));
  driverPool.sort((a, b) => a.value - b.value);
  const confidenceDrivers = driverPool.slice(0, 2).map((entry) => confidenceDriverLabel(entry.id));
  return { score, confidenceDrivers };
}

function recomputeQualityConfidence(outputs: BeamBendingOutputs) {
  if (!outputs.quality?.confidenceSubscores) return;
  const details = outputs.warningDetails ?? [];
  const warningBurden = warningBurdenFromDetails(details);
  outputs.quality.confidenceSubscores.warningBurden = warningBurden;
  outputs.quality.warningPenalty = 1 - warningBurden;
  const blended = confidenceBlend(outputs.quality.confidenceSubscores);
  outputs.quality.confidenceScore = blended.score;
  outputs.quality.confidenceBadge = confidenceBadge(blended.score);
  outputs.quality.confidenceDrivers = blended.confidenceDrivers;
}

function supportLabel(support: BeamBendingInputs["support"]) {
  if (support === "simply_supported") return "Simply supported";
  if (support === "cantilever") return "Cantilever";
  if (support === "fixed_fixed") return "Fixed-fixed";
  return "Propped cantilever";
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    const primitive = JSON.stringify(value);
    return primitive ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map((v) => stableSerialize(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`).join(",")}}`;
}

function fnv1aHash(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function buildWorkedSteps(args: {
  detailLevel: "brief" | "detailed";
  supportName: string;
  L: number;
  E: number;
  I: number;
  theory: BeamTheory;
  totalLoad: number;
  totalMoment: number;
  outputs: BeamBendingOutputs;
  meshPoints: number;
  displayUnits?: Partial<BeamDisplayUnits>;
}): Step[] {
  const {
    detailLevel,
    supportName,
    L,
    E,
    I,
    theory,
    totalLoad,
    totalMoment,
    outputs,
    meshPoints,
    displayUnits,
  } = args;
  const units = getDisplayUnits(displayUnits);
  const detailed = detailLevel === "detailed";
  const steps: Step[] = [];
  const s = (title: string) => steps.push({ title });
  const n = (note: string) => steps.push({ note });
  const l = (latex: string) => steps.push({ latex });
  const fmtQ = (value: number, quantity: Parameters<typeof quantityUnitSymbol>[1], sig = 5) =>
    formatUnitNumber(value, units, quantity, sig);
  const u = (quantity: Parameters<typeof quantityUnitSymbol>[1]) =>
    quantityUnitSymbol(units, quantity).replaceAll("·", "\\cdot ");

  s("1. Structural Model");
  n(
    `Beam model: ${supportName}, span L=${fmtQ(
      L,
      "length"
    )} ${quantityUnitSymbol(units, "length")}, E=${fmtQ(
      E,
      "modulus"
    )} ${quantityUnitSymbol(units, "modulus")}, I=${fmtQ(
      I,
      "inertia"
    )} ${quantityUnitSymbol(units, "inertia")}.`
  );
  n(`Bending theory used: ${theory === "timoshenko" ? "Timoshenko (bending + shear deformation)" : "Euler-Bernoulli (bending deformation only)"}.`);
  if (detailed) n("Sign convention: downward transverse loads are positive; clockwise applied moments are positive.");

  s("2. Global Equilibrium Inputs");
  l(`\\sum F_{ext} = ${fmtQ(totalLoad, "force")}\\ \\text{${u("force")}}`);
  l(`\\sum M_{ext@x=0} = ${fmtQ(totalMoment, "moment")}\\ \\text{${u("moment")}}`);
  if (detailed) n("These totals must be balanced by support reactions to satisfy static admissibility.");

  s("3. Compatibility and Reaction Solution");
  n("Support reactions are solved from equilibrium plus compatibility (where statically indeterminate).");
  l(
    `\\Delta F = ${fmtQ(outputs.equilibriumResiduals.force, "force")}\\ \\text{${u(
      "force"
    )}},\\quad \\Delta M = ${fmtQ(
      outputs.equilibriumResiduals.momentAboutLeft,
      "moment"
    )}\\ \\text{${u("moment")}}`
  );
  if (detailed) n("Near-zero residuals confirm that the solved reactions are consistent with the applied loading.");

  s("4. Internal Actions and Deformation");
  l(`V'(x)=-w(x),\\quad M'(x)=V(x)`);
  l(
    `\\max |V|=${fmtQ(outputs.VabsMax, "force")}\\ \\text{${u(
      "force"
    )}},\\quad \\max |M|=${fmtQ(
      outputs.MabsMax,
      "moment"
    )}\\ \\text{${u("moment")}},\\quad \\max |y|=${fmtQ(
      outputs.yAbsMax,
      "deflection"
    )}\\ \\text{${u("deflection")}}`
  );
  n(`Numerical grid used: ${meshPoints} stations with event refinement around load discontinuities.`);
  if (detailed) n("Curvature is integrated along the span to obtain slope and deflection response.");

  s("5. Serviceability and Engineering Interpretation");
  l(`\\frac{L}{\\delta_{max}}=${fmt(outputs.serviceability.actualRatio)}\\quad\\text{limit}=${fmt(outputs.serviceability.limitRatio)}\\Rightarrow ${outputs.serviceability.passes ? "\\text{PASS}" : "\\text{FAIL}"}`);
  if (outputs.quality?.confidenceBadge) {
    n(`Numerical confidence: ${outputs.quality.confidenceBadge.toUpperCase()} (score ${fmt(outputs.quality.confidenceScore ?? 0, 3)}).`);
  }
  if (outputs.stress) {
    n(
      `Estimated maximum bending stress = ${fmtQ(
        outputs.stress.sigmaMax,
        "stress"
      )} ${quantityUnitSymbol(units, "stress")}, estimated peak shear stress = ${fmtQ(
        outputs.stress.tauMaxEstimate,
        "stress"
      )} ${quantityUnitSymbol(units, "stress")}.`
    );
  }
  if (detailed && outputs.validityWarnings.length > 0) {
    n(`Validity checks triggered ${outputs.validityWarnings.length} warning(s); review assumptions before design decisions.`);
  }
  return steps;
}

export function solveBeamBending(
  inp: BeamBendingInputs,
  opts?: { detailLevel?: "brief" | "detailed" }
): SolveResult<BeamBendingOutputs, BeamBendingPlots> {
  assertBeamInputs(inp);
  const detailLevel = opts?.detailLevel ?? "brief";

  const section = resolveSectionProperties(inp.section);
  const material = inp.material;
  const Ebase = material?.E ?? inp.E;
  const nubase = material?.nu ?? inp.nu ?? 0.3;
  const baseTheory: BeamTheory = inp.theory ?? "euler_bernoulli";
  const baseA = section?.A ?? inp.A;
  const baseI = section?.I ?? inp.I;
  const baseZ = section?.Z ?? (section?.depth ? baseI / (section.depth / 2) : undefined);
  const baseDepth = section?.depth;
  const baseG = inp.G ?? Ebase / (2 * (1 + nubase));
  const baseKappa = inp.kappaShear ?? 5 / 6;
  const supportStations = resolveSupportStations(inp);
  const activeReleases = activeMomentReleases(inp);
  const settlementL = inp.supportConditions?.leftSettlement ?? 0;
  const settlementR = inp.supportConditions?.rightSettlement ?? 0;
  const rotL = inp.supportConditions?.leftRotation ?? 0;
  const rotR = inp.supportConditions?.rightRotation ?? 0;
  const kL = inp.supportConditions?.leftVerticalSpring;
  const kR = inp.supportConditions?.rightVerticalSpring;
  const krL = inp.supportConditions?.leftRotationalSpring;
  const krR = inp.supportConditions?.rightRotationalSpring;
  const meshDensity = inp.analysisOptions?.meshDensity ?? "normal";
  const adaptiveRefinement = inp.analysisOptions?.adaptiveRefinement ?? true;
  const caseLoadMap = buildCaseLoadMap(inp);

  const allLoadsForMesh = [
    ...inp.loads,
    ...Array.from(caseLoadMap.values()).flat(),
    ...(inp.loadCombinations?.flatMap((co) => combineLoads(inp, co, caseLoadMap)) ?? []),
  ];
  const meshAnchors = [
    ...supportStations.map((s) => s.x),
    ...activeReleases.map((r) => r.x),
    ...(inp.stiffnessSegments ?? []).flatMap((seg) => [seg.x1, seg.x2]),
  ];
  const xs = buildSampleXs(inp.L, allLoadsForMesh, meshAnchors, meshDensity, adaptiveRefinement);

  const propAt = (x: number, EScale = 1, IScale = 1): PropState => {
    let E = Ebase * EScale;
    let I = baseI * IScale;
    let A = baseA;
    let G = baseG;
    let kappaShear = baseKappa;
    let Z = baseZ;
    let depth = baseDepth;
    let segmentId: string | undefined;
    for (const seg of inp.stiffnessSegments ?? []) {
      if (x >= seg.x1 && x <= seg.x2) {
        segmentId = seg.id;
        let segE = seg.E;
        let segG = seg.G;
        if (seg.materialPresetId && seg.materialPresetId !== "custom") {
          const preset = MATERIAL_PRESET_MAP.get(seg.materialPresetId);
          if (preset) {
            segE = preset.E;
            if (segG === undefined && preset.nu !== undefined) {
              segG = preset.E / (2 * (1 + preset.nu));
            }
          }
        }
        if (seg.material) {
          segE = seg.material.E;
          if (segG === undefined && seg.material.nu !== undefined) {
            segG = seg.material.E / (2 * (1 + seg.material.nu));
          }
        }
        if (seg.section) {
          const resolved = resolveSectionProperties(seg.section);
          if (resolved) {
            I = resolved.I * IScale;
            A = resolved.A ?? A;
            Z = resolved.Z ?? Z;
            depth = resolved.depth ?? depth;
          }
        }
        if (segE !== undefined) E = segE * EScale;
        if (seg.E !== undefined) E = seg.E * EScale;
        if (seg.I !== undefined) I = seg.I * IScale;
        if (seg.A !== undefined) A = seg.A;
        if (segG !== undefined) G = segG;
        if (seg.G !== undefined) G = seg.G;
        if (seg.kappaShear !== undefined) kappaShear = seg.kappaShear;
      }
    }
    if (Z === undefined && depth && depth > 0) {
      Z = I / (depth / 2);
    }
    return { E, I, A, G, kappaShear, Z, depth, segmentId };
  };

  const evalV = (x: number, V0: number, loads: Load[]) => {
    let V = V0;
    for (const l of loads) {
      if (l.type === "point_load") {
        if (x >= l.x) V -= l.P;
      } else if (l.type === "udl") {
        V -= l.w * clamp(x - l.x1, 0, l.x2 - l.x1);
      } else if (l.type === "linear_dist") {
        const Ls = l.x2 - l.x1;
        const s = clamp(x - l.x1, 0, Ls);
        const k = (l.w2 - l.w1) / Ls;
        V -= l.w1 * s + 0.5 * k * s * s;
      }
    }
    return V;
  };

  const evalM = (x: number, V0: number, M0: number, loads: Load[]) => {
    let M = M0 + V0 * x;
    for (const l of loads) {
      if (l.type === "point_load") {
        if (x >= l.x) M -= l.P * (x - l.x);
      } else if (l.type === "udl") {
        const s = clamp(x - l.x1, 0, l.x2 - l.x1);
        M -= 0.5 * l.w * s * s;
      } else if (l.type === "linear_dist") {
        const Ls = l.x2 - l.x1;
        const s = clamp(x - l.x1, 0, Ls);
        const k = (l.w2 - l.w1) / Ls;
        M -= 0.5 * l.w1 * s * s + (k * s ** 3) / 6;
      } else if (l.type === "moment") {
        if (x >= l.x) M -= l.M;
      }
    }
    return M;
  };

  const evalKappaSource = (x: number, loads: Load[]) => {
    let kappa0 = 0;
    for (const l of loads) {
      if ((l.type === "thermal" || l.type === "prestrain") && x >= l.x1 && x <= l.x2) {
        if (l.type === "thermal") kappa0 += (l.alpha * l.dT) / l.depth;
        else kappa0 += l.kappa0;
      }
    }
    return kappa0;
  };

  const totalVerticalLoad = (loads: Load[]) => {
    let total = 0;
    for (const l of loads) {
      if (l.type === "point_load") total += l.P;
      else if (l.type === "udl") total += l.w * (l.x2 - l.x1);
      else if (l.type === "linear_dist") total += 0.5 * (l.w1 + l.w2) * (l.x2 - l.x1);
    }
    return total;
  };

  const totalMomentLeft = (loads: Load[]) => {
    let total = 0;
    for (const l of loads) {
      if (l.type === "point_load") total += l.P * l.x;
      else if (l.type === "udl") total += l.w * (l.x2 - l.x1) * (0.5 * (l.x1 + l.x2));
      else if (l.type === "linear_dist") {
        const Ls = l.x2 - l.x1;
        const W = 0.5 * (l.w1 + l.w2) * Ls;
        const xbar = l.x1 + (Ls * (l.w1 + 2 * l.w2)) / (3 * (l.w1 + l.w2 || 1));
        total += W * xbar;
      } else if (l.type === "moment") total += l.M;
    }
    return total;
  };

  const buildProfile = (
    V0: number,
    M0: number,
    theta0: number,
    y0: number,
    loads: Load[],
    theory: BeamTheory,
    hingeJumps: Array<{ x: number; jump: number }> = [],
    EScale = 1,
    IScale = 1
  ): Profile => {
    const sfd = xs.map((x) => ({ x, V: evalV(x, V0, loads) }));
    const bmd = xs.map((x) => ({ x, M: evalM(x, V0, M0, loads) }));
    const theta = new Array(xs.length).fill(0);
    const y = new Array(xs.length).fill(0);
    const jumpTerms = hingeJumps
      .filter((h) => Number.isFinite(h.x) && Number.isFinite(h.jump) && Math.abs(h.jump) > 0)
      .slice()
      .sort((a, b) => a.x - b.x);
    let jumpIndex = 0;
    theta[0] = theta0;
    y[0] = y0;
    for (let i = 1; i < xs.length; i++) {
      const x0 = xs[i - 1];
      const x1 = xs[i];
      const dx = x1 - x0;
      const p0 = propAt(x0, EScale, IScale);
      const p1 = propAt(x1, EScale, IScale);
      const k0 = -bmd[i - 1].M / (p0.E * p0.I) + evalKappaSource(x0, loads);
      const k1 = -bmd[i].M / (p1.E * p1.I) + evalKappaSource(x1, loads);
      theta[i] = theta[i - 1] + 0.5 * (k0 + k1) * dx;
      while (jumpIndex < jumpTerms.length && jumpTerms[jumpIndex].x <= x1 + 1e-12) {
        if (jumpTerms[jumpIndex].x > x0 + 1e-12) {
          theta[i] += jumpTerms[jumpIndex].jump;
        }
        jumpIndex += 1;
      }

      const s0 =
        theory === "timoshenko" && p0.A && p0.G && p0.kappaShear
          ? theta[i - 1] + sfd[i - 1].V / (p0.kappaShear * p0.G * p0.A)
          : theta[i - 1];
      const s1 =
        theory === "timoshenko" && p1.A && p1.G && p1.kappaShear
          ? theta[i] + sfd[i].V / (p1.kappaShear * p1.G * p1.A)
          : theta[i];
      y[i] = y[i - 1] + 0.5 * (s0 + s1) * dx;
    }
    return {
      xs,
      sfd,
      bmd,
      theta: xs.map((x, i) => ({ x, theta: theta[i] })),
      deflection: xs.map((x, i) => ({ x, y: y[i] })),
      end: {
        V: sfd[sfd.length - 1].V,
        M: bmd[bmd.length - 1].M,
        y: y[y.length - 1],
        theta: theta[theta.length - 1],
      },
    };
  };

  const solveSingle = (
    loads: Load[],
    theory: BeamTheory,
    EScale = 1,
    IScale = 1
  ): SingleResult => {
    const totalLoad = totalVerticalLoad(loads);
    const mLeft = totalMomentLeft(loads);
    let V0 = 0;
    let M0 = 0;
    let theta0 = 0;
    let y0 = 0;
    const solvedReleaseJumps = new Map<string, number>();
    let final: Profile | null = null;
    let reactions: Record<string, number> = {};
    let forceResidual = 0;
    let momentResidual = 0;
    const hasExplicitStations = (inp.supportLayout?.stations ?? []).some((s) => s.active !== false);
    const stationSupportSolveActive = hasExplicitStations && inp.support === "simply_supported";
    const releaseSolveActive = activeReleases.length > 0;

    if (stationSupportSolveActive) {
      const left = supportStations[0];
      const right = supportStations[1];
      if (!left || !right) throw new Error("Simply supported station solve requires two active stations.");
      const denom = right.x - left.x;
      if (Math.abs(denom) < 1e-12) {
        throw new Error("Support station spacing is too small for stable reaction solution.");
      }
      const R2 = (mLeft - totalLoad * left.x) / denom;
      const R1 = totalLoad - R2;
      const augmentedLoads: Load[] = [
        ...loads,
        { id: "__SUP_R1__", type: "point_load", x: left.x, P: -R1 },
        { id: "__SUP_R2__", type: "point_load", x: right.x, P: -R2 },
      ];
      const base = buildProfile(0, 0, 0, 0, augmentedLoads, theory, [], EScale, IScale);
      const tBasis = buildProfile(0, 0, 1, 0, augmentedLoads, theory, [], EScale, IScale);
      const yBasis = buildProfile(0, 0, 0, 1, augmentedLoads, theory, [], EScale, IScale);
      const yBaseLeft = quantityAt(base, "y", left.x);
      const yBaseRight = quantityAt(base, "y", right.x);
      const cTL = quantityAt(tBasis, "y", left.x) - yBaseLeft;
      const cTR = quantityAt(tBasis, "y", right.x) - yBaseRight;
      const cYL = quantityAt(yBasis, "y", left.x) - yBaseLeft;
      const cYR = quantityAt(yBasis, "y", right.x) - yBaseRight;
      const targetLeft = left.settlement ?? 0;
      const targetRight = right.settlement ?? 0;
      [theta0, y0] = solve2x2(cTL, cYL, cTR, cYR, targetLeft - yBaseLeft, targetRight - yBaseRight);
      final = buildProfile(0, 0, theta0, y0, augmentedLoads, theory, [], EScale, IScale);
      reactions = { R1, R2 };
      forceResidual = R1 + R2 - totalLoad;
      momentResidual = R1 * left.x + R2 * right.x - mLeft;
      V0 = 0;
      M0 = 0;
    } else if (releaseSolveActive) {
      if (hasExplicitStations) {
        throw new Error("Internal moment releases are not yet supported with explicit support-station layouts.");
      }
      if (kL || kR || krL || krR) {
        throw new Error("Support springs with internal releases are outside current solver scope.");
      }
      const unknownKeys = ["V0", "M0", "theta0", "y0", ...activeReleases.map((r) => `jump:${r.id}`)];
      const baseUnknowns = Object.fromEntries(unknownKeys.map((key) => [key, 0])) as Record<string, number>;
      const profileFor = (unknowns: Record<string, number>) =>
        buildProfile(
          unknowns.V0,
          unknowns.M0,
          unknowns.theta0,
          unknowns.y0,
          loads,
          theory,
          activeReleases.map((release) => ({ x: release.x, jump: unknowns[`jump:${release.id}`] ?? 0 })),
          EScale,
          IScale
        );

      const base = profileFor(baseUnknowns);
      const basisByKey = new Map<string, Profile>();
      for (const key of unknownKeys) {
        const vec = { ...baseUnknowns, [key]: 1 };
        basisByKey.set(key, profileFor(vec));
      }

      type Equation = { quantity: ResponseQuantity; x: number; target: number };
      const eqs: Equation[] = [];
      const addEq = (quantity: ResponseQuantity, x: number, target: number) => eqs.push({ quantity, x, target });
      if (inp.support === "cantilever") {
        addEq("y", 0, settlementL);
        addEq("theta", 0, rotL);
        addEq("V", inp.L, 0);
        addEq("M", inp.L, 0);
      } else if (inp.support === "fixed_fixed") {
        addEq("y", 0, settlementL);
        addEq("theta", 0, rotL);
        addEq("y", inp.L, settlementR);
        addEq("theta", inp.L, rotR);
      } else if (inp.support === "propped_cantilever") {
        addEq("y", 0, settlementL);
        addEq("theta", 0, rotL);
        addEq("y", inp.L, settlementR);
        addEq("M", inp.L, 0);
      } else {
        addEq("M", 0, 0);
        addEq("M", inp.L, 0);
        addEq("y", 0, settlementL);
        addEq("y", inp.L, settlementR);
      }
      for (const release of activeReleases) addEq("M", release.x, 0);
      if (eqs.length !== unknownKeys.length) {
        throw new Error("Release compatibility system is ill-posed for this support model.");
      }

      const matrix = eqs.map((eq) =>
        unknownKeys.map((key) => {
          const basis = basisByKey.get(key);
          if (!basis) return 0;
          return quantityAt(basis, eq.quantity, eq.x) - quantityAt(base, eq.quantity, eq.x);
        })
      );
      const rhs = eqs.map((eq) => eq.target - quantityAt(base, eq.quantity, eq.x));
      const solved = solveLinearSystem(matrix, rhs);
      const solvedUnknowns = { ...baseUnknowns };
      unknownKeys.forEach((key, idx) => {
        solvedUnknowns[key] = solved[idx] ?? 0;
      });
      V0 = solvedUnknowns.V0 ?? 0;
      M0 = solvedUnknowns.M0 ?? 0;
      theta0 = solvedUnknowns.theta0 ?? 0;
      y0 = solvedUnknowns.y0 ?? 0;
      for (const release of activeReleases) {
        solvedReleaseJumps.set(release.id, solvedUnknowns[`jump:${release.id}`] ?? 0);
      }
      final = profileFor(solvedUnknowns);
      if (inp.support === "cantilever") {
        reactions = { R: V0, M0 };
        forceResidual = reactions.R - totalLoad;
        momentResidual = -reactions.M0 - mLeft;
      } else if (inp.support === "fixed_fixed") {
        reactions = { R1: V0, R2: totalLoad - V0, M1: M0, M2: -final.end.M };
        forceResidual = reactions.R1 + reactions.R2 - totalLoad;
        momentResidual = reactions.R2 * inp.L - reactions.M1 - reactions.M2 - mLeft;
      } else if (inp.support === "propped_cantilever") {
        reactions = { R1: V0, R2: totalLoad - V0, M1: M0 };
        forceResidual = reactions.R1 + reactions.R2 - totalLoad;
        momentResidual = reactions.R2 * inp.L - reactions.M1 - mLeft;
      } else {
        reactions = { R1: V0, R2: totalLoad - V0 };
        forceResidual = reactions.R1 + reactions.R2 - totalLoad;
        momentResidual = reactions.R2 * inp.L - mLeft;
      }
    } else {
      let targetSettleL = settlementL;
      let targetSettleR = settlementR;
      let targetRotL = rotL;
      let targetRotR = rotR;
      theta0 = inp.support === "simply_supported" ? 0 : targetRotL;
      for (let iter = 0; iter < 2; iter++) {
        const leftTheta = inp.support === "simply_supported" ? 0 : targetRotL;
        const base = buildProfile(0, 0, leftTheta, targetSettleL, loads, theory, [], EScale, IScale);
        const vBasis = buildProfile(1, 0, leftTheta, targetSettleL, loads, theory, [], EScale, IScale);
        const mBasis = buildProfile(0, 1, leftTheta, targetSettleL, loads, theory, [], EScale, IScale);
        const tBasis = buildProfile(0, 0, 1, targetSettleL, loads, theory, [], EScale, IScale);

        const cV = {
          V: vBasis.end.V - base.end.V,
          M: vBasis.end.M - base.end.M,
          y: vBasis.end.y - base.end.y,
          theta: vBasis.end.theta - base.end.theta,
        };
        const cM = {
          V: mBasis.end.V - base.end.V,
          M: mBasis.end.M - base.end.M,
          y: mBasis.end.y - base.end.y,
          theta: mBasis.end.theta - base.end.theta,
        };
        const cT = {
          V: tBasis.end.V - base.end.V,
          M: tBasis.end.M - base.end.M,
          y: tBasis.end.y - base.end.y,
          theta: tBasis.end.theta - base.end.theta,
        };

        theta0 = inp.support === "simply_supported" ? 0 : targetRotL;
        if (inp.support === "cantilever") {
          [V0, M0] = solve2x2(cV.V, cM.V, cV.M, cM.M, -base.end.V, -base.end.M);
        } else if (inp.support === "fixed_fixed") {
          [V0, M0] = solve2x2(cV.theta, cM.theta, cV.y, cM.y, targetRotR - base.end.theta, targetSettleR - base.end.y);
        } else if (inp.support === "propped_cantilever") {
          [V0, M0] = solve2x2(cV.M, cM.M, cV.y, cM.y, -base.end.M, targetSettleR - base.end.y);
        } else {
          [V0, theta0] = solve2x2(cV.M, cT.M, cV.y, cT.y, -base.end.M, targetSettleR - base.end.y);
          M0 = 0;
        }

        final = buildProfile(V0, M0, theta0, targetSettleL, loads, theory, [], EScale, IScale);
        y0 = targetSettleL;

        if (!kL && !kR && !krL && !krR) break;
        const trialR1 = V0;
        const trialR2 = totalLoad - V0;
        const trialM1 = M0;
        const trialM2 = -final.end.M;
        if (kL && Number.isFinite(kL) && kL > 0) targetSettleL = settlementL + trialR1 / kL;
        if (kR && Number.isFinite(kR) && kR > 0) targetSettleR = settlementR + trialR2 / kR;
        if (krL && Number.isFinite(krL) && krL > 0) targetRotL = rotL + trialM1 / krL;
        if (krR && Number.isFinite(krR) && krR > 0) targetRotR = rotR + trialM2 / krR;
      }
      if (inp.support === "cantilever") {
        reactions = { R: V0, M0 };
        forceResidual = reactions.R - totalLoad;
        momentResidual = -reactions.M0 - mLeft;
      } else if (inp.support === "fixed_fixed") {
        reactions = { R1: V0, R2: totalLoad - V0, M1: M0, M2: -(final?.end.M ?? 0) };
        forceResidual = reactions.R1 + reactions.R2 - totalLoad;
        momentResidual = reactions.R2 * inp.L - reactions.M1 - reactions.M2 - mLeft;
      } else if (inp.support === "propped_cantilever") {
        reactions = { R1: V0, R2: totalLoad - V0, M1: M0 };
        forceResidual = reactions.R1 + reactions.R2 - totalLoad;
        momentResidual = reactions.R2 * inp.L - reactions.M1 - mLeft;
      } else {
        reactions = { R1: V0, R2: totalLoad - V0 };
        forceResidual = reactions.R1 + reactions.R2 - totalLoad;
        momentResidual = reactions.R2 * inp.L - mLeft;
      }
    }

    if (!final) throw new Error("Unable to compute beam response profile.");
    const sfd = final.sfd;
    const bmd = final.bmd;
    const deflection = final.deflection;

    let yMin = Infinity;
    let yMax = -Infinity;
    let xAtYMin = 0;
    let xAtYMax = 0;
    for (const p of deflection) {
      if (p.y < yMin) {
        yMin = p.y;
        xAtYMin = p.x;
      }
      if (p.y > yMax) {
        yMax = p.y;
        xAtYMax = p.x;
      }
    }

    let Mmax = -Infinity;
    let Mmin = Infinity;
    let xMmax = 0;
    let xMmin = 0;
    for (const p of bmd) {
      if (p.M > Mmax) {
        Mmax = p.M;
        xMmax = p.x;
      }
      if (p.M < Mmin) {
        Mmin = p.M;
        xMmin = p.x;
      }
    }

    let VabsMax = -Infinity;
    let xAtVabsMax = 0;
    for (const p of sfd) {
      const absV = Math.abs(p.V);
      if (absV > VabsMax) {
        VabsMax = absV;
        xAtVabsMax = p.x;
      }
    }
    let thetaAbsMax = -Infinity;
    let xAtThetaAbsMax = 0;
    let thetaMax = -Infinity;
    let thetaMin = Infinity;
    let xAtThetaMax = 0;
    let xAtThetaMin = 0;
    for (const p of final.theta) {
      const absT = Math.abs(p.theta);
      if (absT > thetaAbsMax) {
        thetaAbsMax = absT;
        xAtThetaAbsMax = p.x;
      }
      if (p.theta > thetaMax) {
        thetaMax = p.theta;
        xAtThetaMax = p.x;
      }
      if (p.theta < thetaMin) {
        thetaMin = p.theta;
        xAtThetaMin = p.x;
      }
    }

    const yAbsMax = Math.max(Math.abs(yMin), Math.abs(yMax));
    const xAtYAbsMax = Math.abs(yMin) >= Math.abs(yMax) ? xAtYMin : xAtYMax;
    const mAbsMax = Math.max(Math.abs(Mmin), Math.abs(Mmax));
    const xAtMAbsMax = Math.abs(Mmin) >= Math.abs(Mmax) ? xMmin : xMmax;
    const limitRatio = inp.serviceabilityLimitRatio ?? 360;
    const actualRatio = yAbsMax === 0 ? Number.POSITIVE_INFINITY : inp.L / yAbsMax;
    const passes = actualRatio >= limitRatio;

    const propAtMomentMax = propAt(xAtMAbsMax, EScale, IScale);
    const propAtShearMax = propAt(xAtVabsMax, EScale, IScale);
    const depth = propAtMomentMax.depth ?? baseDepth;
    const Z = propAtMomentMax.Z ?? baseZ ?? (depth ? propAtMomentMax.I / (depth / 2) : undefined);
    const A = propAtShearMax.A ?? baseA;
    const stress: StressOutputs | undefined =
      Z && A
        ? {
            sigmaMax: mAbsMax / Z,
            tauAvgMax: VabsMax / A,
            tauMaxEstimate: 1.5 * (VabsMax / A),
            sectionModulus: Z,
          }
        : undefined;

    const maxCurvature = Math.max(
      ...bmd.map((p, i) => {
        const prop = propAt(final.xs[i], EScale, IScale);
        return Math.abs(-p.M / (prop.E * prop.I));
      })
    );
    const warningDetails: WarningDetail[] = [];
    const pushWarning = (
      id: string,
      severity: WarningSeverity,
      trigger: string,
      consequence: string,
      mitigation: string
    ) => {
      warningDetails.push(warningEntry(id, severity, trigger, consequence, mitigation));
    };

    if (yAbsMax > inp.L / 200) {
      pushWarning(
        "deflection_over_l200",
        "warning",
        "|delta|max exceeds L/200.",
        "Geometric nonlinearity may influence moment redistribution and deflection magnitudes.",
        "Run a large-deflection/nonlinear check before design sign-off."
      );
    }
    if (yAbsMax > inp.L / 100) {
      pushWarning(
        "deflection_over_l100",
        "critical",
        "|delta|max exceeds L/100.",
        "Small-deflection assumptions are likely weak and second-order effects may be significant.",
        "Escalate to nonlinear geometric analysis and validate support/load idealization."
      );
    }
    if (depth && baseTheory === "euler_bernoulli" && depth / inp.L > 0.1) {
      pushWarning(
        "deep_beam_euler",
        "warning",
        "Depth/span exceeds 0.1 under Euler-Bernoulli theory.",
        "Shear deformation may be under-predicted relative to deep-beam behavior.",
        "Switch to Timoshenko theory and compare governing results."
      );
    }
    if (maxCurvature > 1 / 20) {
      pushWarning(
        "high_curvature",
        "warning",
        "High curvature level detected in response profile.",
        "Local small-rotation assumptions can lose fidelity near critical sections.",
        "Refine mesh and review nonlinear demand at governing regions."
      );
    }
    if ((inp.stiffnessSegments ?? []).length > 0) {
      pushWarning(
        "piecewise_segments_active",
        "info",
        "Piecewise stiffness segments are active.",
        "Section transition zones may govern local slope/stress behavior.",
        "Inspect transition locations, detailing, and mesh density around boundaries."
      );
    }
    if ((inp.stiffnessSegments ?? []).length > 0) {
      const eiVals = (inp.stiffnessSegments ?? [])
        .map((seg) => {
          const mid = clamp(0.5 * (seg.x1 + seg.x2), 0, inp.L);
          const local = propAt(mid, EScale, IScale);
          return local.E * local.I;
        })
        .filter((x) => Number.isFinite(x) && x > 0);
      if (eiVals.length >= 2) {
        const minEi = Math.min(...eiVals);
        const maxEi = Math.max(...eiVals);
        const ratio = maxEi / minEi;
        if (ratio > 10) {
          pushWarning(
            "stiffness_contrast_high",
            "warning",
            `High stiffness contrast detected across segments (EI ratio ~ ${fmt(ratio, 3)}).`,
            "Sharp stiffness gradients can amplify local force and deformation concentration effects.",
            "Validate segment transitions and run sensitivity checks on segment properties."
          );
        }
      }
    }
    if (stress && material?.yieldStress && stress.sigmaMax > 0.9 * material.yieldStress) {
      pushWarning(
        "stress_near_yield",
        "critical",
        "Estimated sigma_max exceeds 90% of selected yield stress.",
        "Reserve against yielding is limited under uncertainty or load escalation.",
        "Increase section capacity, reduce actions, or perform a more detailed material-level check."
      );
    }
    if (inp.supportConditions?.leftVerticalSpring || inp.supportConditions?.rightVerticalSpring) {
      pushWarning(
        "vertical_springs_active",
        "info",
        "Vertical support springs are enabled.",
        "Reactions and deflections are sensitive to spring stiffness assumptions.",
        "Validate spring stiffness against soil-structure/test data and run bracketing checks."
      );
    }
    if (inp.supportConditions?.leftRotationalSpring || inp.supportConditions?.rightRotationalSpring) {
      pushWarning(
        "rotational_springs_active",
        "info",
        "Rotational support springs are enabled.",
        "End moments are stiffness-dependent and governing sections can shift.",
        "Bracket rotational stiffness and review envelope sensitivity to support assumptions."
      );
    }
    if (stationSupportSolveActive) {
      const left = supportStations[0];
      const right = supportStations[1];
      if (left && right && (left.x > 1e-9 || right.x < inp.L - 1e-9)) {
        pushWarning(
          "overhang_configuration_active",
          "info",
          "Support stations create left/right overhang regions.",
          "Critical moments and deflections may shift into overhang segments.",
          "Review overhang root sections and support-adjacent detailing."
        );
      }
    }
    if (releaseSolveActive) {
      pushWarning(
        "internal_release_active",
        "info",
        "Internal moment release(s) are active.",
        "Moment transfer is intentionally interrupted and slope discontinuities are permitted at release points.",
        "Confirm release positions and inspect local shear/rotation behavior near each release."
      );
      const jumpMagnitude = Math.max(
        0,
        ...activeReleases.map((release) => Math.abs(solvedReleaseJumps.get(release.id) ?? 0))
      );
      if (jumpMagnitude > 0.02) {
        pushWarning(
          "internal_release_rotation_jump_high",
          "warning",
          "Large rotation discontinuity detected at an internal release.",
          "Release-region kinematics may be highly sensitive to local detailing assumptions.",
          "Validate release intent and run sensitivity checks around released locations."
        );
      }
    }
    const supportXsForProximity = supportStations.length > 0 ? supportStations.map((s) => s.x) : [0, inp.L];
    const pointLoadNearSupport = loads.some(
      (l) =>
        l.type === "point_load" &&
        supportXsForProximity.some((sx) => Math.abs(l.x - sx) < 0.05 * inp.L)
    );
    if (pointLoadNearSupport) {
      pushWarning(
        "point_load_near_support",
        "warning",
        "A point load is applied very close to a support region.",
        "Local contact and bearing effects can exceed simple beam-theory stress estimates.",
        "Check local detailing/bearing stresses separately from global beam response."
      );
    }
    const hasThermalOrPrestrain = loads.some((l) => l.type === "thermal" || l.type === "prestrain");
    if (hasThermalOrPrestrain) {
      pushWarning(
        "thermal_prestrain_idealization",
        "info",
        "Thermal/prestrain actions are modeled with equivalent beam-theory idealizations.",
        "Local through-depth gradients and restraint details are simplified in 1D form.",
        "Use refined analysis if local thermal restraint effects govern."
      );
    }
    const springVals = [
      inp.supportConditions?.leftVerticalSpring ?? 0,
      inp.supportConditions?.rightVerticalSpring ?? 0,
      inp.supportConditions?.leftRotationalSpring ?? 0,
      inp.supportConditions?.rightRotationalSpring ?? 0,
    ].filter((x) => x > 0);
    if (springVals.length >= 2) {
      const minK = Math.min(...springVals);
      const maxK = Math.max(...springVals);
      if (maxK / minK > 20) {
        pushWarning(
          "spring_sensitivity_high",
          "warning",
          "Support spring stiffness contrast is high.",
          "Boundary sensitivity may strongly shift reactions, end moments, and governing locations.",
          "Run stiffness bracketing and compare governing checks before final decisions."
        );
      }
    }
    const hasSettlement = Math.abs(inp.supportConditions?.leftSettlement ?? 0) > 0 || Math.abs(inp.supportConditions?.rightSettlement ?? 0) > 0;
    const hasAnySpring = springVals.length > 0;
    if (hasSettlement && hasAnySpring) {
      pushWarning(
        "settlement_with_springs",
        "warning",
        "Support settlements are combined with spring supports.",
        "Compatibility assumptions can materially affect reaction redistribution.",
        "Confirm settlement assumptions and run sensitivity checks on spring stiffness."
      );
    }

    const validityWarnings = warningDetails.map((w) => warningText(w));

    const meshSensitivityRatio = estimateMeshSensitivity(sfd, bmd, deflection);
    const equilibriumScaleForce = Math.max(1, Math.abs(totalLoad));
    const stationMomentScale =
      stationSupportSolveActive && supportStations.length >= 2
        ? Math.abs((reactions.R1 ?? 0) * supportStations[0].x + (reactions.R2 ?? 0) * supportStations[1].x)
        : Math.abs((reactions.R2 ?? 0) * inp.L);
    const equilibriumScaleMoment = Math.max(1, Math.abs(mLeft), stationMomentScale);
    const equilibriumScore = Math.max(
      0,
      1 -
        Math.max(
          Math.abs(forceResidual) / equilibriumScaleForce,
          Math.abs(momentResidual) / equilibriumScaleMoment
        )
    );
    const meshPenalty = Math.min(0.45, meshSensitivityRatio * 2.2) + (meshDensity === "coarse" ? 0.08 : 0);
    const meshConfidence = Math.max(0, Math.min(1, 1 - meshPenalty));
    const applicabilityPenalty = warningDetails.reduce((acc, w) => acc + applicabilityPenaltyWeight(w), 0);
    const applicabilityConfidence = Math.max(0, Math.min(1, 1 - Math.min(0.85, applicabilityPenalty)));
    let modelCompletenessPenalty = 0;
    if (!inp.material) modelCompletenessPenalty += 0.08;
    if (!section && !baseA) modelCompletenessPenalty += 0.12;
    if (!inp.designCriteria?.allowableBendingStress && !inp.designCriteria?.allowableShearStress) {
      modelCompletenessPenalty += 0.08;
    }
    if (!inp.designCriteria?.deflectionLimitRatio && !inp.serviceabilityLimitRatio) {
      modelCompletenessPenalty += 0.05;
    }
    if ((inp.loadCases?.length ?? 0) > 0 && (inp.loadCombinations?.length ?? 0) === 0) {
      modelCompletenessPenalty += 0.06;
    }
    if (loads.length === 0 && !inp.movingLoad?.enabled) {
      modelCompletenessPenalty += 0.3;
    }
    const modelCompletenessConfidence = Math.max(0, Math.min(1, 1 - Math.min(0.75, modelCompletenessPenalty)));
    const warningBurden = warningBurdenFromDetails(warningDetails);
    const warningPenalty = 1 - warningBurden;
    const confidenceSubscores = {
      equilibrium: equilibriumScore,
      mesh: meshConfidence,
      applicability: applicabilityConfidence,
      modelCompleteness: modelCompletenessConfidence,
      warningBurden,
    };
    const blended = confidenceBlend(confidenceSubscores);
    const confidenceDrivers = blended.confidenceDrivers;
    const confidenceScore = blended.score;

    const yValues = deflection.map((p) => p.y);
    const mValues = bmd.map((p) => p.M);
    const vValues = sfd.map((p) => p.V);
    const pickCritical = (x: number): CriticalPoint => {
      const mAt = interpolateAt(xs, mValues, x);
      const vAt = interpolateAt(xs, vValues, x);
      const localProp = propAt(x, EScale, IScale);
      return {
        x,
        label: `x=${fmt(x)} m`,
        V: vAt,
        M: mAt,
        y: interpolateAt(xs, yValues, x),
        sigma: localProp.Z ? mAt / localProp.Z : undefined,
        tau: localProp.A ? 1.5 * (vAt / localProp.A) : undefined,
      };
    };

    const shearZeros = zeroCrossings(sfd.map((p) => ({ x: p.x, y: p.V })));
    const slopeZeros = zeroCrossings(final.theta.map((p) => ({ x: p.x, y: p.theta })));
    const candidates = [
      0,
      inp.L,
      xMmax,
      xMmin,
      xAtYMin,
      xAtYMax,
      ...supportStations.map((s) => s.x),
      ...activeReleases.map((r) => r.x),
      ...(inp.stiffnessSegments ?? []).flatMap((seg) => [seg.x1, seg.x2]),
      ...loads.flatMap((l) => (l.type === "point_load" || l.type === "moment" ? [l.x] : [l.x1, l.x2])),
      ...shearZeros,
      ...slopeZeros,
    ];
    const criticalPoints = uniqueSorted(candidates.map((x) => clamp(x, 0, inp.L)))
      .map((x) => pickCritical(x))
      .slice(0, 40);

    const deflectionLimit = inp.designCriteria?.deflectionLimitRatio ?? limitRatio;
    const bendingUtilization =
      stress && inp.designCriteria?.allowableBendingStress
        ? Math.abs(stress.sigmaMax) / inp.designCriteria.allowableBendingStress
        : undefined;
    const shearUtilization =
      stress && inp.designCriteria?.allowableShearStress
        ? Math.abs(stress.tauMaxEstimate) / inp.designCriteria.allowableShearStress
        : undefined;
    const deflectionUtilization =
      deflectionLimit > 0 ? (yAbsMax === 0 ? 0 : (inp.L / yAbsMax > 0 ? deflectionLimit / (inp.L / yAbsMax) : Number.POSITIVE_INFINITY)) : 0;
    const utilizationCandidates: Array<{ mode: "bending" | "shear" | "deflection"; value: number }> = [
      { mode: "deflection", value: deflectionUtilization },
    ];
    if (bendingUtilization !== undefined) utilizationCandidates.push({ mode: "bending", value: bendingUtilization });
    if (shearUtilization !== undefined) utilizationCandidates.push({ mode: "shear", value: shearUtilization });
    const governing = utilizationCandidates.reduce((a, b) => (b.value > a.value ? b : a), utilizationCandidates[0]);
    const supportSummaryText =
      supportStations.length > 0
        ? `${supportLabel(inp.support)} idealization with ${supportStations.length} support station(s) at x = ${supportStations
            .map((s) => fmt(s.x, 4))
            .join(", ")} m${activeReleases.length > 0 ? ` and ${activeReleases.length} internal moment release(s).` : "."}`
        : `${supportLabel(inp.support)} support idealization with optional spring/settlement modifiers.`;
    const assumptions: AssumptionsProfile = {
      linearElastic: "Linear elastic constitutive behavior is assumed.",
      smallDeflection: "Small-deflection kinematics are assumed for global response.",
      idealization: "Member is modeled as a 1D beam centerline idealization.",
      beamTheory:
        baseTheory === "timoshenko"
          ? "Timoshenko beam theory is used."
          : "Euler-Bernoulli beam theory is used.",
      shearDeformation:
        baseTheory === "timoshenko"
          ? "Shear deformation is included via Timoshenko formulation."
          : "Shear deformation is neglected (Euler-Bernoulli assumption).",
      supportIdealization: supportSummaryText,
      propertyVariation:
        (inp.stiffnessSegments ?? []).length > 0
          ? `Piecewise property variation is active across ${(inp.stiffnessSegments ?? []).length} user-defined segment(s).`
          : "Section/material properties are treated as constant along the span.",
      thermalPrestrainModel: hasThermalOrPrestrain
        ? "Thermal/prestrain effects are represented as equivalent beam-theory actions."
        : "No thermal/prestrain actions are currently active.",
      exclusions: [
        "Plasticity and nonlinear material behavior.",
        "Cracking and post-cracking section redistribution.",
        "Buckling and lateral-torsional instability checks.",
        "Dynamic/time-history and modal effects.",
        "3D effects and out-of-plane behavior.",
        "Local contact/stress concentration effects unless separately modeled.",
      ],
    };
    const rotationExtrema = Number.isFinite(thetaAbsMax)
      ? [
          { x: xAtThetaMax, theta: thetaMax, kind: "max" as const },
          { x: xAtThetaMin, theta: thetaMin, kind: "min" as const },
          { x: xAtThetaAbsMax, theta: interpolateAt(xs, final.theta.map((p) => p.theta), xAtThetaAbsMax), kind: "absmax" as const },
        ]
      : undefined;
    const supportRotations =
      supportStations.length > 0
        ? supportStations.map((station) => ({
            supportId: station.id,
            x: station.x,
            restraint: station.restraint,
            theta: quantityAt(final, "theta", station.x),
          }))
        : undefined;

    const outputs: BeamBendingOutputs = {
      reactions,
      Mmax,
      xMmax,
      Mmin,
      xMmin,
      MabsMax: mAbsMax,
      xAtMabsMax: xAtMAbsMax,
      yMaxDown: yMin,
      xAtYMaxDown: xAtYMin,
      yMaxUp: yMax,
      xAtYMaxUp: xAtYMax,
      yAbsMax,
      xAtYAbsMax,
      VabsMax,
      xAtVabsMax,
      thetaAbsMax: Number.isFinite(thetaAbsMax) ? thetaAbsMax : undefined,
      xAtThetaAbsMax: Number.isFinite(thetaAbsMax) ? xAtThetaAbsMax : undefined,
      rotationExtrema,
      supportRotations,
      serviceability: {
        limitRatio,
        actualRatio,
        passes,
      },
      equilibriumResiduals: {
        force: forceResidual,
        momentAboutLeft: momentResidual,
      },
      stress,
      designChecks: {
        bendingUtilization,
        shearUtilization,
        deflectionUtilization,
        pass: utilizationCandidates.every((u) => u.value <= 1),
        governingMode: governing.mode,
      },
      validityWarnings,
      warningDetails,
      assumptions,
      quality: {
        meshPoints: xs.length,
        adaptiveRefinementActive: adaptiveRefinement,
        estimatedComputeClass: xs.length > 2200 ? "heavy" : xs.length > 1100 ? "medium" : "light",
        meshSensitivityRatio,
        equilibriumScore,
        warningPenalty,
        confidenceSubscores,
        confidenceDrivers,
        confidenceScore,
        confidenceBadge: confidenceBadge(confidenceScore),
      },
      criticalPoints,
    };

    return {
      outputs,
      plots: {
        sfd,
        bmd,
        deflection,
        rotation: final.theta,
      },
      internals: {
        xs,
        V0,
        M0,
        theta0,
        y0,
        totalVertical: totalLoad,
        totalMomentLeft: mLeft,
        maxCurvature,
        supportStations,
        activeReleases,
      },
    };
  };

  const baseSolved = solveSingle(inp.loads, baseTheory);
  const outputs = { ...baseSolved.outputs };
  const xGov = baseSolved.outputs.xAtMabsMax;
  outputs.explainability = inp.loads.map((l) => {
    const single = solveSingle([l], baseTheory);
    const mAt = interpolateAt(single.plots.bmd.map((p) => p.x), single.plots.bmd.map((p) => p.M), xGov);
    const vAt = interpolateAt(single.plots.sfd.map((p) => p.x), single.plots.sfd.map((p) => p.V), xGov);
    return {
      loadId: l.id,
      loadType: l.type,
      dMAtGoverningX: mAt,
      dVAtGoverningX: vAt,
      contributionPctOfM: baseSolved.outputs.MabsMax === 0 ? 0 : (Math.abs(mAt) / baseSolved.outputs.MabsMax) * 100,
    };
  });

  const activeCombinations = (inp.loadCombinations ?? []).filter((combo) => combo.active !== false);
  if (activeCombinations.length > 0) {
    const summaries: CombinationSummary[] = [];
    const comboResults: Array<{ combo: LoadCombination; result: SingleResult }> = [];
    for (const combo of activeCombinations) {
      const loads = combineLoads(inp, combo, caseLoadMap);
      if (loads.length === 0) continue;
      const r = solveSingle(loads, baseTheory);
      comboResults.push({ combo, result: r });
      const comboUtilization = r.outputs.designChecks
        ? Math.max(
            r.outputs.designChecks.deflectionUtilization,
            r.outputs.designChecks.bendingUtilization ?? 0,
            r.outputs.designChecks.shearUtilization ?? 0
          )
        : undefined;
      const comboGoverningMode = r.outputs.designChecks?.governingMode;
      const comboGoverningX =
        comboGoverningMode === "shear"
          ? r.outputs.xAtVabsMax
          : comboGoverningMode === "deflection"
            ? r.outputs.xAtYAbsMax
            : comboGoverningMode === "bending"
              ? r.outputs.xAtMabsMax
              : undefined;
      summaries.push({
        id: combo.id,
        name: combo.name,
        category: combo.category,
        MabsMax: r.outputs.MabsMax,
        xAtMabsMax: r.outputs.xAtMabsMax,
        yAbsMax: r.outputs.yAbsMax,
        xAtYAbsMax: r.outputs.xAtYAbsMax,
        VabsMax: r.outputs.VabsMax,
        xAtVabsMax: r.outputs.xAtVabsMax,
        utilization: comboUtilization,
        pass: r.outputs.designChecks?.pass ?? r.outputs.serviceability.passes,
        governingMode: comboGoverningMode,
        governingX: comboGoverningX,
      });
    }
    if (comboResults.length > 0) {
      const activeEnvelope =
        inp.envelopeDefinitions?.find((env) => env.active !== false) ??
        (inp.envelopeDefinitions?.length ? inp.envelopeDefinitions[0] : undefined);
      const selectedIds =
        activeEnvelope && activeEnvelope.combinationIds.length > 0
          ? new Set(activeEnvelope.combinationIds)
          : null;
      const envelopeSourceResults = selectedIds
        ? comboResults.filter((entry) => selectedIds.has(entry.combo.id))
        : comboResults;
      const envelopeResults = envelopeSourceResults.length > 0 ? envelopeSourceResults : comboResults;

      const xsEnv = linspace(0, inp.L, 240);
      const envelope: EnvelopePoint[] = xsEnv.map((x) => {
        const Vs = envelopeResults.map((entry) =>
          interpolateAt(entry.result.plots.sfd.map((p) => p.x), entry.result.plots.sfd.map((p) => p.V), x)
        );
        const Ms = envelopeResults.map((entry) =>
          interpolateAt(entry.result.plots.bmd.map((p) => p.x), entry.result.plots.bmd.map((p) => p.M), x)
        );
        const Ys = envelopeResults.map((entry) =>
          interpolateAt(entry.result.plots.deflection.map((p) => p.x), entry.result.plots.deflection.map((p) => p.y), x)
        );
        return {
          x,
          Vmax: Math.max(...Vs),
          Vmin: Math.min(...Vs),
          Mmax: Math.max(...Ms),
          Mmin: Math.min(...Ms),
          ymax: Math.max(...Ys),
          ymin: Math.min(...Ys),
        };
      });
      outputs.combinations = summaries;
      outputs.envelope = envelope;
      const govCombo = summaries.reduce((a, b) =>
        Math.max(b.MabsMax, b.VabsMax, b.yAbsMax) > Math.max(a.MabsMax, a.VabsMax, a.yAbsMax) ? b : a
      );
      outputs.envelopeMeta = {
        id: activeEnvelope?.id,
        name: activeEnvelope?.name ?? "All active combinations",
        combinationIds: envelopeResults.map((entry) => entry.combo.id),
        criticalCombinationId: govCombo.id,
        criticalCombinationName: govCombo.name,
      };
      const envWarning = warningEntry(
        "envelope_generated",
        "info",
        `Envelope is generated from ${envelopeResults.length} active combination(s) (${outputs.envelopeMeta.name}).`,
        `Critical combination currently controlling envelope demand is ${govCombo.name}.`,
        "Confirm included combinations align with design intent and case activation state."
      );
      outputs.warningDetails = [...(outputs.warningDetails ?? []), envWarning];
      outputs.validityWarnings.push(warningText(envWarning));
      recomputeQualityConfidence(outputs);
    }
  }

  const uncertainty = inp.uncertainty;
  if (uncertainty && (uncertainty.EPercent || uncertainty.IPercent || uncertainty.loadPercent)) {
    const baseM = baseSolved.outputs.MabsMax;
    const baseY = baseSolved.outputs.yAbsMax;
    const eScale = 1 + (uncertainty.EPercent ?? 0) / 100;
    const iScale = 1 + (uncertainty.IPercent ?? 0) / 100;
    const lScale = 1 + (uncertainty.loadPercent ?? 0) / 100;
    const eRun = solveSingle(inp.loads, baseTheory, eScale, 1);
    const iRun = solveSingle(inp.loads, baseTheory, 1, iScale);
    const lLoads = inp.loads.map((l) => scaleLoad(l, lScale));
    const lRun = solveSingle(lLoads, baseTheory, 1, 1);
    outputs.sensitivity = {
      dMabsFromEPercent: baseM === 0 ? 0 : ((eRun.outputs.MabsMax - baseM) / baseM) * 100,
      dYabsFromEPercent: baseY === 0 ? 0 : ((eRun.outputs.yAbsMax - baseY) / baseY) * 100,
      dMabsFromIPercent: baseM === 0 ? 0 : ((iRun.outputs.MabsMax - baseM) / baseM) * 100,
      dYabsFromIPercent: baseY === 0 ? 0 : ((iRun.outputs.yAbsMax - baseY) / baseY) * 100,
      dMabsFromLoadPercent: baseM === 0 ? 0 : ((lRun.outputs.MabsMax - baseM) / baseM) * 100,
      dYabsFromLoadPercent: baseY === 0 ? 0 : ((lRun.outputs.yAbsMax - baseY) / baseY) * 100,
    };
  }

  const xRef = inp.L * 0.5;
  const ilSamples = linspace(0, inp.L, 41);
  const influenceLine: InfluenceLinePoint[] = ilSamples.map((xLoad) => {
    const unit = solveSingle([{ id: "IL", type: "point_load", x: xLoad, P: 1 }], baseTheory);
    return {
      xLoad,
      R1: unit.outputs.reactions.R1,
      R2: unit.outputs.reactions.R2,
      MxRef: interpolateAt(unit.plots.bmd.map((p) => p.x), unit.plots.bmd.map((p) => p.M), xRef),
      VxRef: interpolateAt(unit.plots.sfd.map((p) => p.x), unit.plots.sfd.map((p) => p.V), xRef),
    };
  });
  outputs.influenceLine = influenceLine;

  if (inp.movingLoad?.enabled && inp.movingLoad.axleLoads.length > 0) {
    const step = Math.max(0.05, inp.movingLoad.step ?? inp.L / 80);
    const spacings = inp.movingLoad.axleSpacings;
    const offsets: number[] = [0];
    for (let i = 0; i < inp.movingLoad.axleLoads.length - 1; i++) {
      offsets.push((offsets[i] ?? 0) + (spacings[i] ?? 0));
    }
    const baseMomentScale = Math.max(1, baseSolved.outputs.MabsMax);
    const baseShearScale = Math.max(1, baseSolved.outputs.VabsMax);
    let best: { leadPosition: number; MabsMax: number; VabsMax: number; score: number } | null = null;
    for (let lead = 0; lead <= inp.L + offsets[offsets.length - 1]; lead += step) {
      const trainLoads: Load[] = inp.movingLoad.axleLoads
        .map((P, i) => ({ x: lead - offsets[i], P, i }))
        .filter((a) => a.x >= 0 && a.x <= inp.L)
        .map((a) => ({ id: `ML${a.i}`, type: "point_load" as const, x: a.x, P: a.P }));
      if (trainLoads.length === 0) continue;
      const r = solveSingle(trainLoads, baseTheory);
      const score = Math.max(r.outputs.MabsMax / baseMomentScale, r.outputs.VabsMax / baseShearScale);
      if (!best || score > best.score) {
        best = {
          leadPosition: lead,
          MabsMax: r.outputs.MabsMax,
          VabsMax: r.outputs.VabsMax,
          score,
        };
      }
    }
    if (best) {
      const templateName =
        inp.movingLoad.name ||
        inp.movingLoadTemplates?.find((template) => template.id === inp.movingLoad?.templateId)?.name;
      outputs.movingLoadCritical = {
        leadPosition: best.leadPosition,
        MabsMax: best.MabsMax,
        VabsMax: best.VabsMax,
        scanStep: step,
        templateName,
      };
    }
  }

  const normalizedInput = stableSerialize(inp);
  const inputHash = fnv1aHash(normalizedInput);
  const units = getDisplayUnits(inp.displayUnits);
  outputs.solveAudit = {
    timestamp: new Date().toISOString(),
    inputHash,
    modelVersion: BEAM_MODEL_VERSION,
    solverVersion: BEAM_SOLVER_VERSION,
    beamTheory: baseTheory,
    unitSystem: units.system,
    meshPolicy: meshDensity,
    adaptiveRefinement,
    warningSet: (outputs.warningDetails ?? []).map((w) => w.id),
    confidenceSubscores: outputs.quality?.confidenceSubscores ?? {
      equilibrium: outputs.quality?.equilibriumScore ?? 0,
      mesh: Math.max(0, 1 - (outputs.quality?.meshSensitivityRatio ?? 1)),
      applicability: 0,
      modelCompleteness: 0,
      warningBurden: 0,
    },
  };

  const supportName = supportLabel(inp.support);

  const steps = buildWorkedSteps({
    detailLevel,
    supportName,
    L: inp.L,
    E: Ebase,
    I: baseI,
    theory: baseTheory,
    totalLoad: baseSolved.internals.totalVertical,
    totalMoment: baseSolved.internals.totalMomentLeft,
    outputs,
    meshPoints: baseSolved.internals.xs.length,
    displayUnits: inp.displayUnits,
  });

  return {
    outputs,
    plots: baseSolved.plots,
    steps,
  };
}
