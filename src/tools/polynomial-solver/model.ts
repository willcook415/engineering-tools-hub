import type { SolveResult } from "../_shared/steps/stepTypes";

export type StepDetail = "brief" | "detailed";

export type PolynomialInputs = {
  coefficients: number[]; // highest degree to constant term
  tolerance?: number; // backward-compatible alias for deltaTolerance
  deltaTolerance?: number;
  residualTolerance?: number;
  maxIterations?: number;
  stepDetail?: StepDetail;
  solveMode?: "auto" | "exact" | "numeric";
  numericMethod?: "dk" | "aberth";
};

export type Complex = {
  re: number;
  im: number;
};

export type RootResult = {
  value: Complex;
  multiplicity: number;
  residual: number;
  residualBeforePolish?: number;
  classification: "real" | "complex";
  method: "exact" | "numeric" | "fallback_numeric";
  pairId?: number;
  magnitude: number;
  qualityBadge?: "high" | "medium" | "low";
};

export type PolynomialSensitivity = {
  perturbationPct: number;
  maxRootShift: number;
  meanRootShift: number;
};

export type PolynomialOutputs = {
  degree: number;
  normalizedCoefficients: number[];
  roots: RootResult[];
  maxResidual: number;
  converged: boolean;
  iterationsUsed: number;
  methodUsed: "exact" | "numeric" | "hybrid_fallback";
  residualTolerance: number;
  deltaTolerance: number;
  conditioningWarning?: string;
  validityWarnings: string[];
  diagnostics: Array<{ code: string; message: string; severity: "info" | "warn" }>;
  confidenceScore: number;
  confidenceBadge: "high" | "medium" | "low";
  sensitivity?: PolynomialSensitivity;
};

export type PolynomialPlots = {
  complexPlane: Array<{ re: number; im: number; label: string }>;
  realAxisSample?: Array<{ x: number; y: number }>;
};

export type PolynomialSolveResult = SolveResult<PolynomialOutputs, PolynomialPlots>;
