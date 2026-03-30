import type { PolynomialInputs } from "./model";

export const POLY_MAX_DEGREE = 10;
export const POLY_TRIM_EPS = 1e-14;
export const DEFAULT_DELTA_TOLERANCE = 1e-10;
export const DEFAULT_RESIDUAL_TOLERANCE = 1e-9;
export const DEFAULT_MAX_ITERATIONS = 200;

export type PreparedPolynomialInputs = {
  coefficients: number[];
  degree: number;
  deltaTolerance: number;
  residualTolerance: number;
  maxIterations: number;
  stepDetail: "brief" | "detailed";
  solveMode: "auto" | "exact" | "numeric";
  numericMethod: "dk" | "aberth";
};

export function trimLeadingNearZero(coefficients: number[], eps = POLY_TRIM_EPS) {
  let idx = 0;
  while (idx < coefficients.length - 1 && Math.abs(coefficients[idx]) < eps) idx += 1;
  return coefficients.slice(idx);
}

export function getPolynomialInputIssues(inputs: PolynomialInputs) {
  const issues: string[] = [];

  if (!Array.isArray(inputs.coefficients)) {
    return ["Coefficients must be an array of numbers."];
  }
  if (inputs.coefficients.length < 2) {
    issues.push("Provide at least two coefficients (degree >= 1).");
  }
  if (inputs.coefficients.some((v) => !Number.isFinite(v))) {
    issues.push("All coefficients must be finite numbers.");
  }

  const trimmed = trimLeadingNearZero(inputs.coefficients);
  const degree = trimmed.length - 1;
  const hasAnyNonZero = trimmed.some((v) => Math.abs(v) > POLY_TRIM_EPS);
  if (!hasAnyNonZero) {
    issues.push("All coefficients are zero; polynomial is undefined.");
  }
  if (degree < 1) {
    issues.push("Constant polynomials do not have roots to solve for.");
  }
  if (degree > POLY_MAX_DEGREE) {
    issues.push(`Degree ${degree} exceeds max supported degree ${POLY_MAX_DEGREE}.`);
  }

  const deltaTolerance = inputs.deltaTolerance ?? inputs.tolerance ?? DEFAULT_DELTA_TOLERANCE;
  if (!Number.isFinite(deltaTolerance) || deltaTolerance <= 0 || deltaTolerance > 1) {
    issues.push("Delta tolerance must be > 0 and <= 1.");
  }

  const residualTolerance = inputs.residualTolerance ?? DEFAULT_RESIDUAL_TOLERANCE;
  if (!Number.isFinite(residualTolerance) || residualTolerance <= 0 || residualTolerance > 1) {
    issues.push("Residual tolerance must be > 0 and <= 1.");
  }

  const maxIterations = inputs.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (!Number.isInteger(maxIterations) || maxIterations < 5 || maxIterations > 5000) {
    issues.push("Max iterations must be an integer in range [5, 5000].");
  }

  if (inputs.solveMode && !["auto", "exact", "numeric"].includes(inputs.solveMode)) {
    issues.push("Solve mode must be auto, exact, or numeric.");
  }
  if (inputs.numericMethod && !["dk", "aberth"].includes(inputs.numericMethod)) {
    issues.push("Numeric method must be dk or aberth.");
  }

  return issues;
}

export function preparePolynomialInputs(inputs: PolynomialInputs): PreparedPolynomialInputs {
  const issues = getPolynomialInputIssues(inputs);
  if (issues.length > 0) throw new Error(issues.join(" "));

  const coefficients = trimLeadingNearZero(inputs.coefficients);
  return {
    coefficients,
    degree: coefficients.length - 1,
    deltaTolerance: inputs.deltaTolerance ?? inputs.tolerance ?? DEFAULT_DELTA_TOLERANCE,
    residualTolerance: inputs.residualTolerance ?? DEFAULT_RESIDUAL_TOLERANCE,
    maxIterations: inputs.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    stepDetail: inputs.stepDetail ?? "brief",
    solveMode: inputs.solveMode ?? "auto",
    numericMethod: inputs.numericMethod ?? "dk",
  };
}
