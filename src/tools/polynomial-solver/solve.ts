import type { Step } from "../_shared/steps/stepTypes";
import type { Complex, PolynomialInputs, PolynomialOutputs, PolynomialPlots, PolynomialSensitivity, PolynomialSolveResult, RootResult } from "./model";
import { c, cAbs, cDist, cDiv, cMul, cSub, evalPoly, evalPolyDerivative, normalizeMonic, rootsFromConjugatePairs } from "./complex";
import { polynomialLatex } from "./format";
import { solveExactMonic } from "./exact";
import { preparePolynomialInputs } from "./validation";

const REAL_SNAP_BASE = 1e-9;
const CLUSTER_BASE = 1e-6;
const NUMERIC_JITTER = 1e-9;

type Diagnostic = { code: string; message: string; severity: "info" | "warn" };

type RootMeta = {
  value: Complex;
  multiplicity: number;
  classification: "real" | "complex";
  residual: number;
  residualBeforePolish: number;
  magnitude: number;
  pairId?: number;
  qualityBadge: "high" | "medium" | "low";
};

function cauchyRadius(coeffs: number[]) {
  const absCoeffs = coeffs.slice(1).map((x) => Math.abs(x));
  return 1 + (absCoeffs.length ? Math.max(...absCoeffs) : 0);
}

function createSeedRoots(degree: number, coeffs: number[]) {
  const radius = cauchyRadius(coeffs);
  return Array.from({ length: degree }, (_, k) => {
    const theta = (2 * Math.PI * k) / degree + 0.02 * (k + 1);
    return c(radius * Math.cos(theta), radius * Math.sin(theta));
  });
}

function maxResidual(coeffs: number[], roots: Complex[]) {
  return Math.max(...roots.map((r) => cAbs(evalPoly(coeffs, r))));
}

function numericRootsDK(coeffs: number[], maxIterations: number, deltaTolerance: number, residualTolerance: number) {
  const degree = coeffs.length - 1;
  let roots = createSeedRoots(degree, coeffs);
  let converged = false;
  let iterationsUsed = 0;
  let stagnationHits = 0;
  let prevDelta = Number.POSITIVE_INFINITY;

  for (let iter = 0; iter < maxIterations; iter += 1) {
    const next = roots.map((z, i) => {
      let denom = c(1, 0);
      for (let j = 0; j < roots.length; j += 1) {
        if (j === i) continue;
        let gap = cSub(z, roots[j]);
        if (cAbs(gap) < 1e-13) {
          const phase = (i + 1) * (j + 2);
          gap = c(NUMERIC_JITTER * Math.cos(phase), NUMERIC_JITTER * Math.sin(phase));
        }
        denom = cMul(denom, gap);
      }
      const corr = cDiv(evalPoly(coeffs, z), denom);
      return cSub(z, corr);
    });

    const maxDelta = Math.max(...next.map((z, i) => cDist(z, roots[i])));
    roots = next;
    iterationsUsed = iter + 1;
    const residual = maxResidual(coeffs, roots);
    if (maxDelta < deltaTolerance && residual < residualTolerance) {
      converged = true;
      break;
    }

    if (maxDelta > 0.98 * prevDelta) stagnationHits += 1;
    else stagnationHits = 0;
    prevDelta = maxDelta;
    if (stagnationHits >= 10) break;
  }

  return { roots, converged, iterationsUsed };
}

function numericRootsAberth(coeffs: number[], maxIterations: number, deltaTolerance: number, residualTolerance: number) {
  const degree = coeffs.length - 1;
  let roots = createSeedRoots(degree, coeffs);
  let converged = false;
  let iterationsUsed = 0;

  for (let iter = 0; iter < maxIterations; iter += 1) {
    const next = roots.map((z, i) => {
      const pz = evalPoly(coeffs, z);
      const dpz = evalPolyDerivative(coeffs, z);
      if (cAbs(dpz) < 1e-14) return z;
      const g = cDiv(pz, dpz);
      let sumInv = c(0, 0);
      for (let j = 0; j < roots.length; j += 1) {
        if (j === i) continue;
        const gap = cSub(z, roots[j]);
        if (cAbs(gap) < 1e-14) continue;
        sumInv = {
          re: sumInv.re + gap.re / (gap.re * gap.re + gap.im * gap.im),
          im: sumInv.im - gap.im / (gap.re * gap.re + gap.im * gap.im),
        };
      }
      const denom = cSub(c(1, 0), cMul(g, sumInv));
      const correction = cDiv(g, denom);
      return cSub(z, correction);
    });
    const maxDelta = Math.max(...next.map((z, i) => cDist(z, roots[i])));
    roots = next;
    iterationsUsed = iter + 1;
    const residual = maxResidual(coeffs, roots);
    if (maxDelta < deltaTolerance && residual < residualTolerance) {
      converged = true;
      break;
    }
  }
  return { roots, converged, iterationsUsed };
}

function polishRoots(roots: Complex[], coeffs: number[]) {
  return roots.map((root) => {
    const before = cAbs(evalPoly(coeffs, root));
    let best = root;
    let bestResidual = before;
    let z = root;
    for (let i = 0; i < 3; i += 1) {
      const pz = evalPoly(coeffs, z);
      const dpz = evalPolyDerivative(coeffs, z);
      if (cAbs(dpz) < 1e-12) break;
      const next = cSub(z, cDiv(pz, dpz));
      const nextResidual = cAbs(evalPoly(coeffs, next));
      if (nextResidual <= bestResidual) {
        best = next;
        bestResidual = nextResidual;
      }
      z = next;
    }
    return { root: best, beforeResidual: before };
  });
}

function qualityBadge(residual: number, residualTolerance: number): "high" | "medium" | "low" {
  if (residual <= residualTolerance * 0.2) return "high";
  if (residual <= residualTolerance * 5) return "medium";
  return "low";
}

function postProcessRoots(rawRoots: Array<{ root: Complex; beforeResidual: number }>, coeffs: number[]): RootMeta[] {
  const snapped = rawRoots.map((item) => {
    const tol = REAL_SNAP_BASE * (1 + cAbs(item.root));
    return {
      root: {
        re: Math.abs(item.root.re) < tol ? 0 : item.root.re,
        im: Math.abs(item.root.im) < tol ? 0 : item.root.im,
      },
      beforeResidual: item.beforeResidual,
    };
  });

  const clusters: Array<{ center: Complex; members: Array<{ root: Complex; beforeResidual: number }> }> = [];
  for (const item of snapped) {
    let target = -1;
    for (let i = 0; i < clusters.length; i += 1) {
      const tol = CLUSTER_BASE * (1 + cAbs(clusters[i].center));
      if (cDist(item.root, clusters[i].center) <= tol) {
        target = i;
        break;
      }
    }
    if (target < 0) {
      clusters.push({ center: { ...item.root }, members: [item] });
    } else {
      const bucket = clusters[target];
      bucket.members.push(item);
      const n = bucket.members.length;
      const re = bucket.members.reduce((s, x) => s + x.root.re, 0) / n;
      const im = bucket.members.reduce((s, x) => s + x.root.im, 0) / n;
      bucket.center = { re, im };
    }
  }

  const pairs = rootsFromConjugatePairs(clusters.map((x) => x.center));
  return clusters
    .map((bucket, idx) => {
      const value = {
        re: Math.abs(bucket.center.re) < REAL_SNAP_BASE ? 0 : bucket.center.re,
        im: Math.abs(bucket.center.im) < REAL_SNAP_BASE ? 0 : bucket.center.im,
      };
      const residual = cAbs(evalPoly(coeffs, value));
      const beforeResidual = bucket.members.reduce((m, x) => Math.max(m, x.beforeResidual), 0);
      return {
        value,
        multiplicity: bucket.members.length,
        classification: (Math.abs(value.im) < REAL_SNAP_BASE ? "real" : "complex") as "real" | "complex",
        residual,
        residualBeforePolish: beforeResidual,
        magnitude: cAbs(value),
        pairId: pairs.get(idx),
        qualityBadge: "medium" as const,
      };
    })
    .sort((a, b) => (a.value.re - b.value.re) || (a.value.im - b.value.im));
}

function computeSensitivity(coeffs: number[], baseRoots: RootMeta[], maxIterations: number, deltaTolerance: number, residualTolerance: number): PolynomialSensitivity {
  const perturbFactor = 0.01;
  const perturbed = coeffs.map((c0, i) => (i === 0 ? c0 : c0 * (1 + perturbFactor)));
  const num = numericRootsDK(perturbed, maxIterations, deltaTolerance, residualTolerance);
  const polished = polishRoots(num.roots, perturbed);
  const processed = postProcessRoots(polished, perturbed);
  if (processed.length === 0 || baseRoots.length === 0) {
    return { perturbationPct: 1, maxRootShift: 0, meanRootShift: 0 };
  }
  const shifts: number[] = [];
  const remaining = [...processed];
  for (const base of baseRoots) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const d = cDist(base.value, remaining[i].value);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    shifts.push(bestDist);
    remaining.splice(bestIdx, 1);
  }
  const maxRootShift = shifts.length ? Math.max(...shifts) : 0;
  const meanRootShift = shifts.length ? shifts.reduce((s, x) => s + x, 0) / shifts.length : 0;
  return { perturbationPct: 1, maxRootShift, meanRootShift };
}

function confidenceFromDiagnostics(maxResidualValue: number, residualTol: number, dynamicRange: number, usedFallback: boolean, converged: boolean) {
  let score = 100;
  const ratio = maxResidualValue / Math.max(residualTol, 1e-16);
  if (ratio > 1) score -= Math.min(40, Math.log10(ratio + 1) * 12);
  if (!converged) score -= 22;
  if (dynamicRange > 1e8) score -= Math.min(28, Math.log10(dynamicRange / 1e8 + 1) * 10);
  if (usedFallback) score -= 8;
  score = Math.max(0, Math.min(100, score));
  const badge = score >= 80 ? "high" : score >= 55 ? "medium" : "low";
  return { score, badge: badge as "high" | "medium" | "low" };
}

function buildSteps(monicCoeffs: number[], outputs: PolynomialOutputs, detail: "brief" | "detailed", diagnostics: Diagnostic[]): Step[] {
  const steps: Step[] = [
    {
      title: "Polynomial Form",
      latex: polynomialLatex(monicCoeffs),
      note: `Degree ${outputs.degree}. Coefficients normalized and scaled for numerical stability.`,
    },
    {
      title: "Method Selection",
      note: `Path ${outputs.methodUsed}. Delta tol ${outputs.deltaTolerance}, residual tol ${outputs.residualTolerance}.`,
    },
    {
      title: "Convergence Summary",
      note: outputs.converged
        ? `Converged in ${outputs.iterationsUsed} iterations with max residual ${outputs.maxResidual.toExponential(3)}.`
        : `Stopped at ${outputs.iterationsUsed} iterations; max residual ${outputs.maxResidual.toExponential(3)}.`,
    },
  ];

  if (detail === "detailed") {
    steps.push({
      title: "Iterative Core",
      latex: "z_k^{(m+1)} = z_k^{(m)} - \\frac{p(z_k^{(m)})}{\\prod_{j \\ne k}(z_k^{(m)} - z_j^{(m)})}",
      note: "Durand-Kerner or Aberth correction path used for numeric solving and fallback.",
    });
    steps.push({
      title: "Root Polish",
      latex: "z \\leftarrow z - \\frac{p(z)}{p'(z)}",
      note: "Each root polished for up to 3 Newton iterations when derivative is stable.",
    });
  }

  if (diagnostics.length > 0) {
    steps.push({
      title: "Diagnostics",
      note: diagnostics.map((d) => `${d.code}: ${d.message}`).join(" | "),
    });
  }

  return steps;
}

function realAxisSample(coeffs: number[], roots: Array<{ value: Complex; classification: "real" | "complex" }>, lightweight: boolean) {
  const hasReal = roots.some((r) => r.classification === "real");
  if (!hasReal) return undefined;
  const realRoots = roots.filter((r) => r.classification === "real").map((r) => r.value.re);
  const minX = realRoots.length ? Math.min(...realRoots) : -2;
  const maxX = realRoots.length ? Math.max(...realRoots) : 2;
  const lo = minX - 2;
  const hi = maxX + 2;
  const n = lightweight ? 120 : 180;
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const x = lo + (hi - lo) * t;
    points.push({ x, y: evalPoly(coeffs, c(x, 0)).re });
  }
  return points;
}

export function solvePolynomial(inputs: PolynomialInputs): PolynomialSolveResult {
  const prepared = preparePolynomialInputs(inputs);
  const scale = Math.max(...prepared.coefficients.map((x) => Math.abs(x)), 1);
  const scaledCoeffs = prepared.coefficients.map((x) => x / scale);
  const coeffs = normalizeMonic(scaledCoeffs);
  const degree = prepared.degree;
  const diagnostics: Diagnostic[] = [];

  const absCoeffs = coeffs.slice(1).map((x) => Math.abs(x));
  const maxAbs = absCoeffs.length ? Math.max(...absCoeffs) : 0;
  const minAbsNonZero = absCoeffs.filter((x) => x > 0).reduce((m, x) => Math.min(m, x), Number.POSITIVE_INFINITY);
  const dynamicRange = Number.isFinite(minAbsNonZero) ? maxAbs / minAbsNonZero : Number.POSITIVE_INFINITY;
  const conditioningWarning =
    dynamicRange > 1e12
      ? "Coefficient dynamic range is very high; roots can be sensitive to perturbations."
      : undefined;
  if (conditioningWarning) diagnostics.push({ code: "conditioning", message: conditioningWarning, severity: "warn" });

  let methodUsed: PolynomialOutputs["methodUsed"] = "numeric";
  let methodTag: RootResult["method"] = "numeric";
  let converged = false;
  let iterationsUsed = 0;
  let rawRoots: Array<{ root: Complex; beforeResidual: number }> = [];
  let usedFallback = false;

  const canExact = degree <= 4 && prepared.solveMode !== "numeric";
  if (prepared.solveMode === "exact" && degree > 4) {
    diagnostics.push({
      code: "fallback_used",
      message: "Exact mode is available up to degree 4; numeric solver used.",
      severity: "info",
    });
    methodUsed = "hybrid_fallback";
    methodTag = "fallback_numeric";
    usedFallback = true;
  }

  if (canExact) {
    try {
      const exact = solveExactMonic(coeffs);
      if (!exact) throw new Error("Exact unavailable");
      const polished = polishRoots(exact, coeffs);
      const exactMaxResidual = Math.max(...polished.map((x) => cAbs(evalPoly(coeffs, x.root))));
      if (exactMaxResidual <= prepared.residualTolerance * 100 || prepared.solveMode === "exact") {
        rawRoots = polished;
        converged = true;
        iterationsUsed = 0;
        methodUsed = "exact";
        methodTag = "exact";
      } else {
        throw new Error("Exact residual too high");
      }
    } catch {
      diagnostics.push({
        code: "fallback_used",
        message: "Exact path fell back to numeric due to branch instability.",
        severity: "warn",
      });
      methodUsed = "hybrid_fallback";
      methodTag = "fallback_numeric";
      usedFallback = true;
    }
  }

  if (rawRoots.length === 0) {
    const numeric =
      prepared.numericMethod === "aberth"
        ? numericRootsAberth(coeffs, prepared.maxIterations, prepared.deltaTolerance, prepared.residualTolerance)
        : numericRootsDK(coeffs, prepared.maxIterations, prepared.deltaTolerance, prepared.residualTolerance);
    rawRoots = polishRoots(numeric.roots, coeffs);
    converged = numeric.converged;
    iterationsUsed = numeric.iterationsUsed;
    if (methodUsed !== "hybrid_fallback") methodUsed = "numeric";
    if (methodTag !== "fallback_numeric") methodTag = "numeric";
  }

  const processed = postProcessRoots(rawRoots, coeffs).map((r) => ({
    ...r,
    qualityBadge: qualityBadge(r.residual, prepared.residualTolerance),
  }));
  const maxResidualValue = processed.length ? Math.max(...processed.map((r) => r.residual)) : Number.NaN;

  const validityWarnings: string[] = [];
  if (!converged) {
    const msg = "Solver reached max iterations/stagnation before strict convergence; roots may be approximate.";
    diagnostics.push({ code: "non_convergence", message: msg, severity: "warn" });
    validityWarnings.push(msg);
  }
  if (Number.isFinite(maxResidualValue) && maxResidualValue > prepared.residualTolerance) {
    const msg = `Residual check elevated (max |p(r)| = ${maxResidualValue.toExponential(3)}).`;
    diagnostics.push({ code: "high_residual", message: msg, severity: "warn" });
    validityWarnings.push(msg);
  }
  if (processed.some((r) => r.multiplicity > 1 && r.residual > prepared.residualTolerance * 10)) {
    const msg = "Possible multiplicity instability near repeated roots.";
    diagnostics.push({ code: "possible_multiplicity_instability", message: msg, severity: "warn" });
    validityWarnings.push(msg);
  }
  if (conditioningWarning) validityWarnings.push(conditioningWarning);

  const roots: RootResult[] = processed.map((r) => ({
    value: r.value,
    multiplicity: r.multiplicity,
    residual: r.residual,
    residualBeforePolish: r.residualBeforePolish,
    classification: r.classification,
    method: methodTag,
    pairId: r.pairId,
    magnitude: r.magnitude,
    qualityBadge: r.qualityBadge,
  }));

  const sensitivity = computeSensitivity(coeffs, processed, Math.min(prepared.maxIterations, 250), prepared.deltaTolerance, prepared.residualTolerance);
  const confidence = confidenceFromDiagnostics(maxResidualValue, prepared.residualTolerance, dynamicRange, usedFallback, converged);

  const plots: PolynomialPlots = {
    complexPlane: roots.map((root, idx) => ({
      re: root.value.re,
      im: root.value.im,
      label: root.multiplicity > 1 ? `r${idx + 1} (x${root.multiplicity})` : `r${idx + 1}`,
    })),
    realAxisSample: realAxisSample(coeffs, roots, false),
  };

  const outputs: PolynomialOutputs = {
    degree,
    normalizedCoefficients: coeffs,
    roots,
    maxResidual: maxResidualValue,
    converged,
    iterationsUsed,
    methodUsed,
    residualTolerance: prepared.residualTolerance,
    deltaTolerance: prepared.deltaTolerance,
    conditioningWarning,
    validityWarnings,
    diagnostics,
    confidenceScore: confidence.score,
    confidenceBadge: confidence.badge,
    sensitivity,
  };

  return {
    outputs,
    plots,
    steps: buildSteps(coeffs, outputs, prepared.stepDetail, diagnostics),
  };
}
