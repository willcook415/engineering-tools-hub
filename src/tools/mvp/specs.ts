import {
  ENGINEERING_CONSTANTS,
  EQUATION_ROWS,
  MATERIAL_ROWS,
  STEAM_SATURATION_ROWS,
} from "./data";
import { ENGINEERING_APPROXIMATION_DISCLAIMER } from "./disclaimer";
import {
  QUICK_CONVERSION_PRESETS,
  convertUnit,
  listDimensions,
  listUnits,
  runQuickPreset,
} from "./units";
import type {
  ToolCheck,
  ToolComputeResult,
  ToolOutput,
  ToolRuntimeSpec,
  ToolWarning,
} from "./runtime";
import {
  computeBowditchAdjustment,
  determinant,
  exponentialRegression,
  fmt,
  fmtSigned,
  interpolateSteamSaturation,
  invertMatrix,
  linearRegression,
  parseCsvRows,
  parseMatrixText,
  parseNumeric,
  parseVectorText,
  parseXYText,
  polynomial2Regression,
  solveLinearSystemGauss,
  toDeg,
  toRad,
} from "./utils";

const APPROX_DISCLAIMER = ENGINEERING_APPROXIMATION_DISCLAIMER;

function out(label: string, value: string): ToolOutput {
  return { label, value };
}

function outNum(label: string, value: number, unit = "", digits = 6): ToolOutput {
  return {
    label,
    value: `${fmt(value, digits)}${unit ? ` ${unit}` : ""}`,
  };
}

function check(label: string, value: string, pass?: boolean): ToolCheck {
  return { label, value, pass };
}

function warn(code: ToolWarning["code"], message: string): ToolWarning {
  return { code, message };
}

function emptyResult(): ToolComputeResult {
  return { outputs: [], checks: [], warnings: [] };
}

function asRecord<T extends { key: string; defaultValue: string }>(defs: T[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of defs) out[d.key] = d.defaultValue;
  return out;
}

const torsionInputs = [
  { key: "shape", label: "Shaft shape", type: "select", defaultValue: "solid", options: [
    { value: "solid", label: "Solid circular" },
    { value: "hollow", label: "Hollow circular" },
  ] },
  { key: "T", label: "Applied torque", type: "number", defaultValue: "1500", unit: "N*m", min: 0, step: 50 },
  { key: "L", label: "Shaft length", type: "number", defaultValue: "1.5", unit: "m", min: 0, step: 0.1 },
  { key: "G", label: "Shear modulus", type: "number", defaultValue: "79e9", unit: "Pa", min: 0, step: 1e9 },
  { key: "dOuter", label: "Outer diameter", type: "number", defaultValue: "0.05", unit: "m", min: 0, step: 0.001 },
  { key: "dInner", label: "Inner diameter", type: "number", defaultValue: "0.0", unit: "m", min: 0, step: 0.001 },
] as const;

const stressTransformInputs = [
  { key: "sigmaX", label: "sigma_x", type: "number", defaultValue: "120", unit: "MPa", step: 5 },
  { key: "sigmaY", label: "sigma_y", type: "number", defaultValue: "35", unit: "MPa", step: 5 },
  { key: "tauXY", label: "tau_xy", type: "number", defaultValue: "42", unit: "MPa", step: 2 },
  { key: "thetaDeg", label: "Plane angle", type: "number", defaultValue: "25", unit: "deg", step: 1 },
] as const;

const columnBucklingInputs = [
  { key: "E", label: "Young's modulus", type: "number", defaultValue: "200e9", unit: "Pa", min: 0, step: 1e9 },
  { key: "I", label: "Second moment I", type: "number", defaultValue: "8e-6", unit: "m^4", min: 0, step: 1e-7 },
  { key: "A", label: "Section area A", type: "number", defaultValue: "0.004", unit: "m^2", min: 0, step: 0.0001 },
  { key: "L", label: "Unsupported length", type: "number", defaultValue: "3.0", unit: "m", min: 0, step: 0.1 },
  { key: "K", label: "Effective length factor K", type: "number", defaultValue: "1.0", min: 0, step: 0.1 },
  { key: "P", label: "Applied compressive load", type: "number", defaultValue: "250000", unit: "N", min: 0, step: 5000 },
] as const;

const sectionPropsInputs = [
  { key: "shape", label: "Section shape", type: "select", defaultValue: "rect", options: [
    { value: "rect", label: "Rectangle" },
    { value: "circle", label: "Solid circle" },
    { value: "tube", label: "Hollow circle" },
  ] },
  { key: "b", label: "Width b", type: "number", defaultValue: "0.2", unit: "m", min: 0, step: 0.01 },
  { key: "h", label: "Depth h", type: "number", defaultValue: "0.4", unit: "m", min: 0, step: 0.01 },
  { key: "dOuter", label: "Outer diameter", type: "number", defaultValue: "0.3", unit: "m", min: 0, step: 0.01 },
  { key: "dInner", label: "Inner diameter", type: "number", defaultValue: "0.2", unit: "m", min: 0, step: 0.01 },
] as const;

const combinedStressInputs = [
  { key: "sigmaAxial", label: "Axial stress", type: "number", defaultValue: "80", unit: "MPa", step: 5 },
  { key: "sigmaBending", label: "Bending stress", type: "number", defaultValue: "60", unit: "MPa", step: 5 },
  { key: "tau", label: "Shear stress", type: "number", defaultValue: "30", unit: "MPa", step: 2 },
  { key: "yield", label: "Yield strength", type: "number", defaultValue: "250", unit: "MPa", min: 0, step: 5 },
] as const;

const reynoldsInputs = [
  { key: "rho", label: "Density", type: "number", defaultValue: "998", unit: "kg/m^3", min: 0, step: 1 },
  { key: "v", label: "Velocity", type: "number", defaultValue: "2.2", unit: "m/s", min: 0, step: 0.1 },
  { key: "L", label: "Characteristic length", type: "number", defaultValue: "0.05", unit: "m", min: 0, step: 0.001 },
  { key: "mu", label: "Dynamic viscosity", type: "number", defaultValue: "0.001", unit: "Pa*s", min: 0, step: 0.0001 },
] as const;

const pipeDropInputs = [
  { key: "rho", label: "Density", type: "number", defaultValue: "998", unit: "kg/m^3", min: 0, step: 1 },
  { key: "mu", label: "Dynamic viscosity", type: "number", defaultValue: "0.001", unit: "Pa*s", min: 0, step: 0.0001 },
  { key: "D", label: "Pipe diameter", type: "number", defaultValue: "0.1", unit: "m", min: 0, step: 0.005 },
  { key: "L", label: "Pipe length", type: "number", defaultValue: "50", unit: "m", min: 0, step: 1 },
  { key: "Q", label: "Flow rate", type: "number", defaultValue: "0.015", unit: "m^3/s", min: 0, step: 0.001 },
  { key: "rough", label: "Roughness", type: "number", defaultValue: "0.000045", unit: "m", min: 0, step: 0.000001 },
  { key: "kMinor", label: "Minor-loss K sum", type: "number", defaultValue: "3.5", min: 0, step: 0.1 },
] as const;

const pumpInputs = [
  { key: "rho", label: "Fluid density", type: "number", defaultValue: "998", unit: "kg/m^3", min: 0, step: 1 },
  { key: "Q", label: "Flow rate", type: "number", defaultValue: "0.02", unit: "m^3/s", min: 0, step: 0.001 },
  { key: "H", label: "Pump head", type: "number", defaultValue: "35", unit: "m", min: 0, step: 1 },
  { key: "etaPump", label: "Pump efficiency", type: "number", defaultValue: "0.78", min: 0, max: 1, step: 0.01 },
  { key: "etaMotor", label: "Motor efficiency", type: "number", defaultValue: "0.92", min: 0, max: 1, step: 0.01 },
] as const;

const openChannelInputs = [
  { key: "shape", label: "Channel shape", type: "select", defaultValue: "rect", options: [
    { value: "rect", label: "Rectangular" },
    { value: "trap", label: "Trapezoidal" },
  ] },
  { key: "b", label: "Bottom width b", type: "number", defaultValue: "2.5", unit: "m", min: 0, step: 0.1 },
  { key: "m", label: "Side slope z", type: "number", defaultValue: "1.0", unit: "H:V", min: 0, step: 0.1 },
  { key: "y", label: "Flow depth y", type: "number", defaultValue: "1.2", unit: "m", min: 0, step: 0.05 },
  { key: "n", label: "Manning n", type: "number", defaultValue: "0.015", min: 0, step: 0.001 },
  { key: "S", label: "Channel slope S", type: "number", defaultValue: "0.0012", min: 0, step: 0.0001 },
] as const;

const compressibleInputs = [
  { key: "gamma", label: "Specific heat ratio gamma", type: "number", defaultValue: "1.4", min: 1, step: 0.01 },
  { key: "R", label: "Gas constant", type: "number", defaultValue: "287", unit: "J/(kg*K)", min: 0, step: 1 },
  { key: "T0", label: "Stagnation temperature", type: "number", defaultValue: "600", unit: "K", min: 0, step: 5 },
  { key: "P0", label: "Stagnation pressure", type: "number", defaultValue: "500000", unit: "Pa", min: 0, step: 10000 },
  { key: "M", label: "Mach number", type: "number", defaultValue: "2.0", min: 0, step: 0.05 },
] as const;

const idealGasInputs = [
  { key: "solveFor", label: "Unknown", type: "select", defaultValue: "P", options: [
    { value: "P", label: "Pressure P" },
    { value: "V", label: "Volume V" },
    { value: "n", label: "Moles n" },
    { value: "T", label: "Temperature T" },
  ] },
  { key: "P", label: "Pressure", type: "number", defaultValue: "101325", unit: "Pa", min: 0, step: 1000 },
  { key: "V", label: "Volume", type: "number", defaultValue: "0.025", unit: "m^3", min: 0, step: 0.001 },
  { key: "n", label: "Moles", type: "number", defaultValue: "1.0", unit: "mol", min: 0, step: 0.01 },
  { key: "T", label: "Temperature", type: "number", defaultValue: "298", unit: "K", min: 0, step: 1 },
] as const;

const conductionInputs = [
  { key: "mode", label: "Conduction model", type: "select", defaultValue: "single", options: [
    { value: "single", label: "Single wall" },
    { value: "composite", label: "Composite wall" },
  ] },
  { key: "k", label: "Conductivity k", type: "number", defaultValue: "45", unit: "W/(m*K)", min: 0, step: 1 },
  { key: "A", label: "Area A", type: "number", defaultValue: "1.5", unit: "m^2", min: 0, step: 0.1 },
  { key: "L", label: "Thickness L", type: "number", defaultValue: "0.08", unit: "m", min: 0, step: 0.005 },
  { key: "Th", label: "Hot-side temperature", type: "number", defaultValue: "180", unit: "C", step: 1 },
  { key: "Tc", label: "Cold-side temperature", type: "number", defaultValue: "40", unit: "C", step: 1 },
  {
    key: "layers",
    label: "Composite layers (k:L per line)",
    type: "textarea",
    defaultValue: "45:0.02\n0.18:0.05\n16:0.01",
    rows: 4,
    placeholder: "Example: 0.2:0.04",
  },
] as const;

const hxInputs = [
  { key: "mode", label: "Sizing mode", type: "select", defaultValue: "lmtd", options: [
    { value: "lmtd", label: "LMTD / UA" },
    { value: "ntu", label: "epsilon-NTU" },
  ] },
  { key: "Q", label: "Heat duty Q", type: "number", defaultValue: "350000", unit: "W", step: 5000 },
  { key: "U", label: "Overall U", type: "number", defaultValue: "420", unit: "W/(m^2*K)", min: 0, step: 10 },
  { key: "Thi", label: "Hot in", type: "number", defaultValue: "180", unit: "C", step: 1 },
  { key: "Tho", label: "Hot out", type: "number", defaultValue: "120", unit: "C", step: 1 },
  { key: "Tci", label: "Cold in", type: "number", defaultValue: "35", unit: "C", step: 1 },
  { key: "Tco", label: "Cold out", type: "number", defaultValue: "90", unit: "C", step: 1 },
  { key: "Cmin", label: "Cmin", type: "number", defaultValue: "4200", unit: "W/K", min: 0, step: 50 },
  { key: "Cmax", label: "Cmax", type: "number", defaultValue: "6200", unit: "W/K", min: 0, step: 50 },
  { key: "NTU", label: "NTU", type: "number", defaultValue: "1.8", min: 0, step: 0.05 },
] as const;

const steamInputs = [
  { key: "mode", label: "Lookup by", type: "select", defaultValue: "temperature", options: [
    { value: "temperature", label: "Temperature" },
    { value: "pressure", label: "Pressure" },
  ] },
  { key: "value", label: "Lookup value", type: "number", defaultValue: "120", step: 1 },
  { key: "quality", label: "Quality x", type: "number", defaultValue: "0.85", min: 0, max: 1, step: 0.01 },
] as const;

const psychInputs = [
  { key: "Tdb", label: "Dry-bulb temperature", type: "number", defaultValue: "28", unit: "C", step: 1 },
  { key: "RH", label: "Relative humidity", type: "number", defaultValue: "55", unit: "%", min: 0, max: 100, step: 1 },
  { key: "P", label: "Atmospheric pressure", type: "number", defaultValue: "101.325", unit: "kPa", min: 50, step: 0.5 },
] as const;

const materialDbInputs = [
  { key: "query", label: "Search", type: "text", defaultValue: "steel", placeholder: "Name or category" },
  { key: "maxRows", label: "Max rows", type: "number", defaultValue: "8", min: 1, step: 1 },
] as const;

const safetyInputs = [
  { key: "stress", label: "Applied stress", type: "number", defaultValue: "125", unit: "MPa", min: 0, step: 1 },
  { key: "strength", label: "Material strength", type: "number", defaultValue: "300", unit: "MPa", min: 0, step: 1 },
  { key: "requiredFoS", label: "Required FoS", type: "number", defaultValue: "1.5", min: 0, step: 0.1 },
] as const;

const fatigueInputs = [
  { key: "sigmaA", label: "Alternating stress", type: "number", defaultValue: "140", unit: "MPa", min: 0, step: 1 },
  { key: "sigmaM", label: "Mean stress", type: "number", defaultValue: "35", unit: "MPa", step: 1 },
  { key: "Sut", label: "Ultimate strength", type: "number", defaultValue: "620", unit: "MPa", min: 0, step: 5 },
  { key: "sigmaFPrime", label: "Fatigue strength coeff", type: "number", defaultValue: "920", unit: "MPa", min: 0, step: 5 },
  { key: "b", label: "Basquin exponent b", type: "number", defaultValue: "-0.095", step: 0.005 },
  { key: "targetCycles", label: "Target life", type: "number", defaultValue: "1000000", min: 0, step: 10000 },
] as const;

const materialSelectInputs = [
  { key: "wStrength", label: "Weight: strength", type: "number", defaultValue: "0.35", min: 0, step: 0.05 },
  { key: "wDensity", label: "Weight: low density", type: "number", defaultValue: "0.25", min: 0, step: 0.05 },
  { key: "wCost", label: "Weight: low cost", type: "number", defaultValue: "0.2", min: 0, step: 0.05 },
  { key: "wThermal", label: "Weight: conductivity", type: "number", defaultValue: "0.2", min: 0, step: 0.05 },
] as const;

const matrixInputs = [
  {
    key: "A",
    label: "Matrix A (rows newline, values comma/space)",
    type: "textarea",
    defaultValue: "4,2,-1\n2,5,1\n-1,1,3",
    rows: 4,
  },
  {
    key: "b",
    label: "Vector b",
    type: "textarea",
    defaultValue: "9\n5\n1",
    rows: 3,
  },
] as const;

const odeInputs = [
  { key: "method", label: "Method", type: "select", defaultValue: "rk4", options: [
    { value: "euler", label: "Euler" },
    { value: "rk4", label: "RK4" },
  ] },
  { key: "a", label: "ODE coefficient a", type: "number", defaultValue: "-0.8", step: 0.1 },
  { key: "b", label: "ODE coefficient b", type: "number", defaultValue: "2.0", step: 0.1 },
  { key: "x0", label: "x0", type: "number", defaultValue: "0", step: 0.1 },
  { key: "y0", label: "y0", type: "number", defaultValue: "1", step: 0.1 },
  { key: "xEnd", label: "x end", type: "number", defaultValue: "10", step: 0.5 },
  { key: "h", label: "Step h", type: "number", defaultValue: "0.2", min: 0, step: 0.05 },
] as const;

const regressionInputs = [
  { key: "model", label: "Fit model", type: "select", defaultValue: "linear", options: [
    { value: "linear", label: "Linear" },
    { value: "poly2", label: "Polynomial (2nd order)" },
    { value: "exp", label: "Exponential" },
  ] },
  {
    key: "data",
    label: "Data (x,y per line)",
    type: "textarea",
    defaultValue: "0,1\n1,2.1\n2,3.9\n3,6.2\n4,7.8",
    rows: 5,
  },
] as const;

const unitConverterInputs = [
  { key: "dimension", label: "Dimension", type: "select", defaultValue: "length", options: listDimensions().map((d) => ({ value: d, label: d })) },
  { key: "value", label: "Value", type: "number", defaultValue: "1", step: 0.1 },
  { key: "from", label: "From unit", type: "text", defaultValue: "m" },
  { key: "to", label: "To unit", type: "text", defaultValue: "ft" },
] as const;

const quickUnitInputs = [
  {
    key: "preset",
    label: "Quick preset",
    type: "select",
    defaultValue: QUICK_CONVERSION_PRESETS[0]?.id ?? "m_to_ft",
    options: QUICK_CONVERSION_PRESETS.map((p) => ({ value: p.id, label: p.label })),
  },
  { key: "value", label: "Value", type: "number", defaultValue: "1", step: 0.1 },
] as const;

const constantsInputs = [
  { key: "query", label: "Search constants", type: "text", defaultValue: "", placeholder: "symbol or name" },
  { key: "maxRows", label: "Max rows", type: "number", defaultValue: "12", min: 1, step: 1 },
] as const;

const quickPlotInputs = [
  {
    key: "data",
    label: "XY data (x,y per line)",
    type: "textarea",
    defaultValue: "0,0\n1,1.2\n2,2.1\n3,3.2\n4,4.4",
    rows: 6,
  },
  {
    key: "fit",
    label: "Include linear best fit",
    type: "select",
    defaultValue: "yes",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
] as const;

const csvToolInputs = [
  {
    key: "csv",
    label: "CSV table",
    type: "textarea",
    defaultValue: "x,y\n1,2\n2,3\n3,4",
    rows: 6,
  },
  {
    key: "derived",
    label: "Derived column (new=colA*colB etc)",
    type: "text",
    defaultValue: "z=x*y",
    placeholder: "example: z=x*y",
  },
] as const;

const equationInputs = [
  { key: "query", label: "Search equations", type: "text", defaultValue: "stress" },
  { key: "maxRows", label: "Max rows", type: "number", defaultValue: "10", min: 1, step: 1 },
] as const;

const acInputs = [
  { key: "R", label: "Resistance R", type: "number", defaultValue: "25", unit: "ohm", min: 0, step: 1 },
  { key: "XL", label: "Inductive reactance XL", type: "number", defaultValue: "18", unit: "ohm", step: 1 },
  { key: "XC", label: "Capacitive reactance XC", type: "number", defaultValue: "5", unit: "ohm", step: 1 },
  { key: "V", label: "Supply voltage", type: "number", defaultValue: "230", unit: "V rms", min: 0, step: 1 },
] as const;

const threePhaseInputs = [
  { key: "conn", label: "Connection", type: "select", defaultValue: "wye", options: [
    { value: "wye", label: "Wye (star)" },
    { value: "delta", label: "Delta" },
  ] },
  { key: "VL", label: "Line voltage", type: "number", defaultValue: "400", unit: "V", min: 0, step: 5 },
  { key: "IL", label: "Line current", type: "number", defaultValue: "65", unit: "A", min: 0, step: 1 },
  { key: "pf", label: "Power factor", type: "number", defaultValue: "0.86", min: 0, max: 1, step: 0.01 },
] as const;

const cableInputs = [
  { key: "phase", label: "System", type: "select", defaultValue: "three", options: [
    { value: "single", label: "Single-phase" },
    { value: "three", label: "Three-phase" },
  ] },
  { key: "material", label: "Conductor", type: "select", defaultValue: "copper", options: [
    { value: "copper", label: "Copper" },
    { value: "aluminum", label: "Aluminum" },
  ] },
  { key: "L", label: "Route length", type: "number", defaultValue: "80", unit: "m", min: 0, step: 1 },
  { key: "I", label: "Current", type: "number", defaultValue: "120", unit: "A", min: 0, step: 1 },
  { key: "V", label: "Nominal voltage", type: "number", defaultValue: "400", unit: "V", min: 0, step: 5 },
  { key: "pf", label: "Power factor", type: "number", defaultValue: "0.9", min: 0, max: 1, step: 0.01 },
  { key: "maxDropPct", label: "Allowable drop", type: "number", defaultValue: "3.0", unit: "%", min: 0, step: 0.1 },
] as const;

const retainingInputs = [
  { key: "H", label: "Wall retained height", type: "number", defaultValue: "4.0", unit: "m", min: 0, step: 0.1 },
  { key: "gamma", label: "Soil unit weight", type: "number", defaultValue: "18", unit: "kN/m^3", min: 0, step: 0.5 },
  { key: "phi", label: "Soil friction angle", type: "number", defaultValue: "32", unit: "deg", min: 0, max: 89, step: 1 },
  { key: "B", label: "Base width", type: "number", defaultValue: "2.8", unit: "m", min: 0, step: 0.1 },
  { key: "W", label: "Wall self-weight", type: "number", defaultValue: "260", unit: "kN/m", min: 0, step: 5 },
  { key: "mu", label: "Base friction coeff", type: "number", defaultValue: "0.55", min: 0, step: 0.01 },
  { key: "qAllow", label: "Allowable bearing", type: "number", defaultValue: "250", unit: "kPa", min: 0, step: 5 },
] as const;

const concreteInputs = [
  { key: "fck", label: "Target strength", type: "number", defaultValue: "35", unit: "MPa", min: 0, step: 1 },
  { key: "slump", label: "Target slump", type: "number", defaultValue: "90", unit: "mm", min: 0, step: 5 },
  { key: "wc", label: "Water-cement ratio", type: "number", defaultValue: "0.48", min: 0, step: 0.01 },
  { key: "cement", label: "Cement content", type: "number", defaultValue: "360", unit: "kg/m^3", min: 0, step: 5 },
  { key: "air", label: "Air content", type: "number", defaultValue: "2", unit: "%", min: 0, step: 0.1 },
] as const;

const surveyInputs = [
  {
    key: "legs",
    label: "Traverse legs (distance,bearing_deg per line)",
    type: "textarea",
    defaultValue: "120,30\n95,105\n110,190\n102,280",
    rows: 6,
  },
] as const;

function withAssumptionWarning(base: ToolComputeResult, message: string): ToolComputeResult {
  return {
    ...base,
    warnings: [...base.warnings, warn("assumption", message)],
  };
}

function validatePositiveFields(raw: Record<string, string>, defs: Array<{ key: string; label: string; min?: number; max?: number }>) {
  const issues: string[] = [];
  for (const def of defs) {
    parseNumeric(raw, def.key, issues, def.label, {
      min: def.min,
      max: def.max,
    });
  }
  return issues;
}

function parseLayerText(text: string): Array<{ k: number; L: number }> {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const parsed: Array<{ k: number; L: number }> = [];
  for (const row of rows) {
    const [kRaw, lRaw] = row.split(":").map((token) => token.trim());
    const k = Number(kRaw);
    const L = Number(lRaw);
    if (Number.isFinite(k) && Number.isFinite(L) && k > 0 && L > 0) {
      parsed.push({ k, L });
    }
  }
  return parsed;
}

function parseTraverseInput(text: string): Array<{ distance: number; bearingDeg: number }> {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return rows
    .map((row) => {
      const parts = row.includes(",") ? row.split(",") : row.split(/\s+/);
      const distance = Number(parts[0]);
      const bearingDeg = Number(parts[1]);
      return { distance, bearingDeg };
    })
    .filter((leg) => Number.isFinite(leg.distance) && Number.isFinite(leg.bearingDeg));
}

function parseDerivedExpression(expr: string) {
  const cleaned = expr.replace(/\s+/g, "");
  const m = cleaned.match(/^([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z_][A-Za-z0-9_]*)([+\-*/])([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!m) return null;
  return {
    out: m[1],
    a: m[2],
    op: m[3],
    b: m[4],
  };
}

function applyBinary(a: number, b: number, op: string): number {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  return b === 0 ? Number.NaN : a / b;
}

const specs: ToolRuntimeSpec[] = [
  {
    slug: "torsion-calculator",
    name: "Torsion Calculator",
    summary: "Shaft shear stress, angle of twist, and torsional rigidity.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...torsionInputs],
    sampleValid: asRecord([...torsionInputs]),
    sampleInvalid: { ...asRecord([...torsionInputs]), G: "0" },
    validate: (raw) => {
      const issues = validatePositiveFields(raw, [
        { key: "T", label: "Torque", min: 0 },
        { key: "L", label: "Length", min: 0 },
        { key: "G", label: "Shear modulus", min: 1e3 },
        { key: "dOuter", label: "Outer diameter", min: 1e-9 },
        { key: "dInner", label: "Inner diameter", min: 0 },
      ]);
      const shape = raw.shape;
      const dOuter = Number(raw.dOuter);
      const dInner = Number(raw.dInner);
      if (shape === "hollow" && dInner >= dOuter) {
        issues.push("Inner diameter must be smaller than outer diameter for hollow shafts.");
      }
      return issues;
    },
    compute: (raw) => {
      const shape = raw.shape;
      const T = Number(raw.T);
      const L = Number(raw.L);
      const G = Number(raw.G);
      const dOuter = Number(raw.dOuter);
      const dInner = Number(raw.dInner);
      const J =
        shape === "hollow"
          ? (Math.PI * (dOuter ** 4 - dInner ** 4)) / 32
          : (Math.PI * dOuter ** 4) / 32;
      const rMax = dOuter / 2;
      const tauMax = (T * rMax) / Math.max(J, 1e-15);
      const twist = (T * L) / Math.max(J * G, 1e-15);
      const rigidity = G * J;

      return withAssumptionWarning(
        {
          outputs: [
            outNum("Polar moment J", J, "m^4"),
            outNum("Max shear stress", tauMax, "Pa"),
            outNum("Angle of twist", twist, "rad"),
            outNum("Torsional rigidity GJ", rigidity, "N*m^2"),
          ],
          checks: [
            check("Twist (deg)", fmt(toDeg(twist), 4)),
            check("Stress level (MPa)", fmt(tauMax / 1e6, 4)),
          ],
          warnings: [],
          steps: [
            "Use shaft geometry to compute polar moment J.",
            "Compute tau_max = T r / J at outer surface.",
            "Compute twist theta = T L / (G J).",
          ],
        },
        "Saint-Venant torsion assumption: uniform circular shaft with linear elastic behavior."
      );
    },
  },
  {
    slug: "stress-transformation-mohrs-circle",
    name: "Stress Transformation (Mohr's Circle)",
    summary: "Principal stresses, principal planes, and max shear via Mohr's circle.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...stressTransformInputs],
    sampleValid: asRecord([...stressTransformInputs]),
    sampleInvalid: { ...asRecord([...stressTransformInputs]), sigmaX: "abc" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "sigmaX", label: "sigma_x" },
      { key: "sigmaY", label: "sigma_y" },
      { key: "tauXY", label: "tau_xy" },
      { key: "thetaDeg", label: "theta" },
    ]),
    compute: (raw) => {
      const sx = Number(raw.sigmaX);
      const sy = Number(raw.sigmaY);
      const txy = Number(raw.tauXY);
      const theta = toRad(Number(raw.thetaDeg));

      const sAvg = 0.5 * (sx + sy);
      const radius = Math.sqrt((0.5 * (sx - sy)) ** 2 + txy ** 2);
      const s1 = sAvg + radius;
      const s2 = sAvg - radius;
      const tauMax = radius;
      const sigmaTheta = sAvg + 0.5 * (sx - sy) * Math.cos(2 * theta) + txy * Math.sin(2 * theta);
      const tauTheta = -0.5 * (sx - sy) * Math.sin(2 * theta) + txy * Math.cos(2 * theta);
      const principalAngle = 0.5 * toDeg(Math.atan2(2 * txy, sx - sy));

      return withAssumptionWarning(
        {
          outputs: [
            outNum("Principal stress sigma1", s1, "MPa"),
            outNum("Principal stress sigma2", s2, "MPa"),
            outNum("Max in-plane shear", tauMax, "MPa"),
            outNum("Transformed normal stress", sigmaTheta, "MPa"),
            outNum("Transformed shear stress", tauTheta, "MPa"),
          ],
          checks: [
            check("Principal plane angle", `${fmt(principalAngle, 4)} deg`),
            check("Mohr radius", fmt(radius, 4)),
          ],
          warnings: [],
          steps: [
            "Find center and radius of Mohr's circle.",
            "Principal stresses are center +/- radius.",
            "Apply 2*theta transformation equations for selected plane.",
          ],
        },
        "Plane stress state assumed (sigma_z and out-of-plane shear terms neglected)."
      );
    },
  },
  {
    slug: "column-buckling",
    name: "Column Buckling",
    summary: "Euler buckling load, slenderness, and end-condition effects.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...columnBucklingInputs],
    sampleValid: asRecord([...columnBucklingInputs]),
    sampleInvalid: { ...asRecord([...columnBucklingInputs]), I: "0" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "E", label: "E", min: 1 },
      { key: "I", label: "I", min: 1e-15 },
      { key: "A", label: "A", min: 1e-12 },
      { key: "L", label: "L", min: 1e-9 },
      { key: "K", label: "K", min: 1e-6 },
      { key: "P", label: "P", min: 0 },
    ]),
    compute: (raw) => {
      const E = Number(raw.E);
      const I = Number(raw.I);
      const A = Number(raw.A);
      const L = Number(raw.L);
      const K = Number(raw.K);
      const P = Number(raw.P);

      const r = Math.sqrt(I / A);
      const slenderness = (K * L) / Math.max(r, 1e-15);
      const pcr = (Math.PI ** 2 * E * I) / ((K * L) ** 2);
      const utilization = P / Math.max(pcr, 1e-15);

      return withAssumptionWarning(
        {
          outputs: [
            outNum("Radius of gyration r", r, "m"),
            outNum("Slenderness KL/r", slenderness, ""),
            outNum("Euler critical load Pcr", pcr, "N"),
            outNum("Utilization P/Pcr", utilization, ""),
          ],
          checks: [
            check("Buckling check", utilization <= 1 ? "PASS" : "FAIL", utilization <= 1),
            check("Preliminary regime", slenderness > 90 ? "Euler-likely" : "Inelastic risk"),
          ],
          warnings: utilization > 1 ? [warn("range", "Applied load exceeds Euler critical load.")] : [],
        },
        "Ideal straight column, elastic response, and small imperfection assumption."
      );
    },
  },
  {
    slug: "section-properties",
    name: "Section Properties",
    summary: "Area, centroid, second moment, section modulus, and radii of gyration.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...sectionPropsInputs],
    sampleValid: asRecord([...sectionPropsInputs]),
    sampleInvalid: { ...asRecord([...sectionPropsInputs]), shape: "tube", dInner: "0.4", dOuter: "0.3" },
    validate: (raw) => {
      const shape = raw.shape;
      const issues: string[] = [];
      if (shape === "rect") {
        parseNumeric(raw, "b", issues, "b", { min: 1e-9 });
        parseNumeric(raw, "h", issues, "h", { min: 1e-9 });
      } else {
        const doVal = parseNumeric(raw, "dOuter", issues, "outer diameter", { min: 1e-9 });
        const diVal = parseNumeric(raw, "dInner", issues, "inner diameter", { min: 0 });
        if (shape === "tube" && diVal >= doVal) issues.push("Inner diameter must be smaller than outer diameter.");
      }
      return issues;
    },
    compute: (raw) => {
      const shape = raw.shape;
      let A = 0;
      let Ixx = 0;
      let Iyy = 0;
      let cY = 0;
      let cX = 0;

      if (shape === "rect") {
        const b = Number(raw.b);
        const h = Number(raw.h);
        A = b * h;
        Ixx = (b * h ** 3) / 12;
        Iyy = (h * b ** 3) / 12;
        cX = b / 2;
        cY = h / 2;
      } else if (shape === "circle") {
        const d = Number(raw.dOuter);
        A = (Math.PI * d ** 2) / 4;
        Ixx = (Math.PI * d ** 4) / 64;
        Iyy = Ixx;
        cX = d / 2;
        cY = d / 2;
      } else {
        const doVal = Number(raw.dOuter);
        const diVal = Number(raw.dInner);
        A = (Math.PI * (doVal ** 2 - diVal ** 2)) / 4;
        Ixx = (Math.PI * (doVal ** 4 - diVal ** 4)) / 64;
        Iyy = Ixx;
        cX = doVal / 2;
        cY = doVal / 2;
      }

      const zx = Ixx / Math.max(cY, 1e-15);
      const zy = Iyy / Math.max(cX, 1e-15);
      const rx = Math.sqrt(Ixx / Math.max(A, 1e-15));
      const ry = Math.sqrt(Iyy / Math.max(A, 1e-15));

      return withAssumptionWarning(
        {
          outputs: [
            outNum("Area A", A, "m^2"),
            outNum("Centroid x", cX, "m"),
            outNum("Centroid y", cY, "m"),
            outNum("Ixx", Ixx, "m^4"),
            outNum("Iyy", Iyy, "m^4"),
            outNum("Section modulus Zx", zx, "m^3"),
            outNum("Section modulus Zy", zy, "m^3"),
            outNum("Radius gyration rx", rx, "m"),
            outNum("Radius gyration ry", ry, "m"),
          ],
          checks: [],
          warnings: [],
        },
        "Property formulas assume ideal geometry and no local cutouts/stiffener effects."
      );
    },
  },
  {
    slug: "combined-stress-check",
    name: "Combined Stress Check",
    summary: "Evaluate von Mises, Tresca, and principal stress utilization in one pass.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...combinedStressInputs],
    sampleValid: asRecord([...combinedStressInputs]),
    sampleInvalid: { ...asRecord([...combinedStressInputs]), yield: "0" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "sigmaAxial", label: "axial stress" },
      { key: "sigmaBending", label: "bending stress" },
      { key: "tau", label: "shear stress", min: 0 },
      { key: "yield", label: "yield strength", min: 1e-9 },
    ]),
    compute: (raw) => {
      const sigma = Number(raw.sigmaAxial) + Number(raw.sigmaBending);
      const tau = Number(raw.tau);
      const yieldStrength = Number(raw.yield);

      const principalRadius = Math.sqrt((sigma / 2) ** 2 + tau ** 2);
      const sigma1 = sigma / 2 + principalRadius;
      const sigma2 = sigma / 2 - principalRadius;
      const vonMises = Math.sqrt(sigma ** 2 + 3 * tau ** 2);
      const trescaEq = 2 * principalRadius;
      const utilVM = vonMises / yieldStrength;
      const utilTresca = trescaEq / yieldStrength;

      return withAssumptionWarning(
        {
          outputs: [
            outNum("Combined normal stress", sigma, "MPa"),
            outNum("Principal stress sigma1", sigma1, "MPa"),
            outNum("Principal stress sigma2", sigma2, "MPa"),
            outNum("Von Mises equivalent", vonMises, "MPa"),
            outNum("Tresca equivalent", trescaEq, "MPa"),
          ],
          checks: [
            check("Von Mises utilization", fmt(utilVM, 4), utilVM <= 1),
            check("Tresca utilization", fmt(utilTresca, 4), utilTresca <= 1),
          ],
          warnings: utilVM > 1 || utilTresca > 1 ? [warn("range", "One or more utilization checks exceed 1.0.")] : [],
        },
        "Plane stress combined criterion; does not include fatigue, notch, or residual stress effects."
      );
    },
  },
  {
    slug: "reynolds-number",
    name: "Reynolds Number",
    summary: "Flow regime classification from velocity, length scale, and viscosity.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...reynoldsInputs],
    sampleValid: asRecord([...reynoldsInputs]),
    sampleInvalid: { ...asRecord([...reynoldsInputs]), mu: "0" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "rho", label: "rho", min: 1e-12 },
      { key: "v", label: "v", min: 0 },
      { key: "L", label: "L", min: 1e-12 },
      { key: "mu", label: "mu", min: 1e-12 },
    ]),
    compute: (raw) => {
      const rho = Number(raw.rho);
      const v = Number(raw.v);
      const L = Number(raw.L);
      const mu = Number(raw.mu);
      const re = (rho * v * L) / mu;
      const regime = re < 2300 ? "Laminar" : re < 4000 ? "Transitional" : "Turbulent";
      const warnings: ToolWarning[] = [];
      if (re >= 2300 && re <= 4000) warnings.push(warn("stability", "Transition regime: small disturbances may shift behavior."));

      return {
        outputs: [outNum("Reynolds number", re, ""), out("Regime", regime)],
        checks: [check("Regime band", regime)],
        warnings,
        steps: ["Re = rho v L / mu.", "Classify by threshold bands (<2300, 2300-4000, >4000)."],
      };
    },
  },
  {
    slug: "pipe-pressure-drop",
    name: "Pipe Pressure Drop",
    summary: "Major/minor losses, friction factor, and total pressure drop.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...pipeDropInputs],
    sampleValid: asRecord([...pipeDropInputs]),
    sampleInvalid: { ...asRecord([...pipeDropInputs]), D: "0" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "rho", label: "rho", min: 1e-12 },
      { key: "mu", label: "mu", min: 1e-12 },
      { key: "D", label: "D", min: 1e-12 },
      { key: "L", label: "L", min: 0 },
      { key: "Q", label: "Q", min: 0 },
      { key: "rough", label: "roughness", min: 0 },
      { key: "kMinor", label: "kMinor", min: 0 },
    ]),
    compute: (raw) => {
      const rho = Number(raw.rho);
      const mu = Number(raw.mu);
      const D = Number(raw.D);
      const L = Number(raw.L);
      const Q = Number(raw.Q);
      const rough = Number(raw.rough);
      const kMinor = Number(raw.kMinor);
      const area = Math.PI * D ** 2 / 4;
      const v = Q / Math.max(area, 1e-15);
      const re = (rho * v * D) / Math.max(mu, 1e-15);
      const f = re < 2300
        ? 64 / Math.max(re, 1e-9)
        : 0.25 / (Math.log10(rough / (3.7 * D) + 5.74 / re ** 0.9) ** 2);

      const dpMajor = f * (L / D) * 0.5 * rho * v ** 2;
      const dpMinor = kMinor * 0.5 * rho * v ** 2;
      const dpTotal = dpMajor + dpMinor;
      const hLoss = dpTotal / (rho * 9.80665);

      return withAssumptionWarning(
        {
          outputs: [
            outNum("Velocity", v, "m/s"),
            outNum("Reynolds number", re, ""),
            outNum("Friction factor f", f, ""),
            outNum("Major loss dp", dpMajor, "Pa"),
            outNum("Minor loss dp", dpMinor, "Pa"),
            outNum("Total pressure drop", dpTotal, "Pa"),
            outNum("Head loss", hLoss, "m"),
          ],
          checks: [check("Flow regime", re < 2300 ? "Laminar" : re < 4000 ? "Transitional" : "Turbulent")],
          warnings: re < 4000 ? [warn("stability", "Friction-factor uncertainty is higher outside fully turbulent range.")] : [],
        },
        "Steady, incompressible, fully-developed internal flow approximation."
      );
    },
  },
  {
    slug: "pump-power-calculator",
    name: "Pump Power Calculator",
    summary: "Hydraulic power, shaft power, and efficiency-based sizing.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...pumpInputs],
    sampleValid: asRecord([...pumpInputs]),
    sampleInvalid: { ...asRecord([...pumpInputs]), etaPump: "1.3" },
    validate: (raw) => {
      const issues = validatePositiveFields(raw, [
        { key: "rho", label: "rho", min: 1e-12 },
        { key: "Q", label: "Q", min: 0 },
        { key: "H", label: "H", min: 0 },
        { key: "etaPump", label: "Pump efficiency", min: 1e-9, max: 1 },
        { key: "etaMotor", label: "Motor efficiency", min: 1e-9, max: 1 },
      ]);
      return issues;
    },
    compute: (raw) => {
      const rho = Number(raw.rho);
      const Q = Number(raw.Q);
      const H = Number(raw.H);
      const etaPump = Number(raw.etaPump);
      const etaMotor = Number(raw.etaMotor);

      const hydraulic = rho * 9.80665 * Q * H;
      const shaft = hydraulic / etaPump;
      const motor = shaft / etaMotor;

      return {
        outputs: [
          outNum("Hydraulic power", hydraulic, "W"),
          outNum("Required shaft power", shaft, "W"),
          outNum("Required motor input", motor, "W"),
        ],
        checks: [
          check("Pump efficiency", `${fmt(etaPump * 100, 2)} %`, etaPump > 0 && etaPump <= 1),
          check("Motor efficiency", `${fmt(etaMotor * 100, 2)} %`, etaMotor > 0 && etaMotor <= 1),
        ],
        warnings: [warn("assumption", "Assumes steady duty point and ignores NPSH/transient effects.")],
      };
    },
  },
  {
    slug: "open-channel-flow",
    name: "Open Channel Flow",
    summary: "Uniform flow depth/velocity using Manning and geometric section inputs.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...openChannelInputs],
    sampleValid: asRecord([...openChannelInputs]),
    sampleInvalid: { ...asRecord([...openChannelInputs]), n: "0" },
    validate: (raw) => {
      const issues = validatePositiveFields(raw, [
        { key: "b", label: "b", min: 1e-9 },
        { key: "m", label: "m", min: 0 },
        { key: "y", label: "y", min: 1e-9 },
        { key: "n", label: "n", min: 1e-9 },
        { key: "S", label: "S", min: 1e-12 },
      ]);
      return issues;
    },
    compute: (raw) => {
      const shape = raw.shape;
      const b = Number(raw.b);
      const m = Number(raw.m);
      const y = Number(raw.y);
      const n = Number(raw.n);
      const S = Number(raw.S);
      const area = shape === "rect" ? b * y : y * (b + m * y);
      const wetted = shape === "rect" ? b + 2 * y : b + 2 * y * Math.sqrt(1 + m * m);
      const topWidth = shape === "rect" ? b : b + 2 * m * y;
      const hydraulicRadius = area / wetted;
      const Q = (1 / n) * area * hydraulicRadius ** (2 / 3) * Math.sqrt(S);
      const velocity = Q / area;
      const hydraulicDepth = area / Math.max(topWidth, 1e-12);
      const froude = velocity / Math.sqrt(9.80665 * hydraulicDepth);
      const regime = froude < 1 ? "Subcritical" : froude > 1 ? "Supercritical" : "Critical";

      return withAssumptionWarning(
        {
          outputs: [
            outNum("Area", area, "m^2"),
            outNum("Hydraulic radius", hydraulicRadius, "m"),
            outNum("Discharge Q", Q, "m^3/s"),
            outNum("Average velocity", velocity, "m/s"),
            outNum("Froude number", froude, ""),
            out("Flow regime", regime),
          ],
          checks: [check("Regime", regime)],
          warnings: [],
        },
        "Uniform-flow Manning approximation; no rapidly varied flow effects included."
      );
    },
  },
  {
    slug: "compressible-flow",
    name: "Compressible Flow",
    summary: "Isentropic relations, Mach conversions, and nozzle flow quantities.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...compressibleInputs],
    sampleValid: asRecord([...compressibleInputs]),
    sampleInvalid: { ...asRecord([...compressibleInputs]), gamma: "1" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "gamma", label: "gamma", min: 1.0001 },
      { key: "R", label: "R", min: 1e-9 },
      { key: "T0", label: "T0", min: 1e-9 },
      { key: "P0", label: "P0", min: 1e-9 },
      { key: "M", label: "M", min: 0 },
    ]),
    compute: (raw) => {
      const gamma = Number(raw.gamma);
      const R = Number(raw.R);
      const T0 = Number(raw.T0);
      const P0 = Number(raw.P0);
      const M = Number(raw.M);
      const term = 1 + ((gamma - 1) / 2) * M * M;
      const T = T0 / term;
      const P = P0 / term ** (gamma / (gamma - 1));
      const rho = P / (R * T);
      const a = Math.sqrt(gamma * R * T);
      const v = M * a;
      const areaRatio =
        (1 / Math.max(M, 1e-9)) *
        ((2 / (gamma + 1)) * term) ** ((gamma + 1) / (2 * (gamma - 1)));

      const warnings: ToolWarning[] = [];
      if (M > 5) warnings.push(warn("range", "High Mach number: calorically perfect gas assumption may lose accuracy."));

      return {
        outputs: [
          outNum("Static temperature", T, "K"),
          outNum("Static pressure", P, "Pa"),
          outNum("Density", rho, "kg/m^3"),
          outNum("Speed of sound", a, "m/s"),
          outNum("Flow velocity", v, "m/s"),
          outNum("Area ratio A/A*", areaRatio, ""),
        ],
        checks: [check("Flow branch", M < 1 ? "Subsonic" : M > 1 ? "Supersonic" : "Sonic")],
        warnings: [
          warn("assumption", "Isentropic, 1D flow without shocks/friction/heat transfer."),
          ...warnings,
        ],
      };
    },
  },
  {
    slug: "ideal-gas-law",
    name: "Ideal Gas Law",
    summary: "Solve PV = nRT for pressure, volume, moles, or temperature.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...idealGasInputs],
    sampleValid: asRecord([...idealGasInputs]),
    sampleInvalid: { ...asRecord([...idealGasInputs]), solveFor: "P", V: "0" },
    validate: (raw) => {
      const issues: string[] = [];
      const unknown = raw.solveFor;
      for (const key of ["P", "V", "n", "T"] as const) {
        if (key === unknown) continue;
        parseNumeric(raw, key, issues, key, { min: 1e-12 });
      }
      return issues;
    },
    compute: (raw) => {
      const unknown = raw.solveFor as "P" | "V" | "n" | "T";
      const R = 8.314462618;
      const P = Number(raw.P);
      const V = Number(raw.V);
      const n = Number(raw.n);
      const T = Number(raw.T);

      const solved = { P, V, n, T };
      if (unknown === "P") solved.P = (n * R * T) / V;
      else if (unknown === "V") solved.V = (n * R * T) / P;
      else if (unknown === "n") solved.n = (P * V) / (R * T);
      else solved.T = (P * V) / (n * R);

      return {
        outputs: [
          outNum("Pressure P", solved.P, "Pa"),
          outNum("Volume V", solved.V, "m^3"),
          outNum("Moles n", solved.n, "mol"),
          outNum("Temperature T", solved.T, "K"),
        ],
        checks: [check("Solved variable", unknown)],
        warnings: [warn("assumption", "Ideal gas behavior assumed; high pressure/low temperature may deviate.")],
      };
    },
  },
  {
    slug: "heat-transfer-conduction",
    name: "Heat Transfer (Conduction)",
    summary: "Steady 1D conduction through plane walls and composite layers.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...conductionInputs],
    sampleValid: asRecord([...conductionInputs]),
    sampleInvalid: { ...asRecord([...conductionInputs]), mode: "single", k: "0" },
    validate: (raw) => {
      const issues = validatePositiveFields(raw, [
        { key: "A", label: "Area", min: 1e-12 },
        { key: "Th", label: "Hot temp" },
        { key: "Tc", label: "Cold temp" },
      ]);
      if (raw.mode === "single") {
        parseNumeric(raw, "k", issues, "k", { min: 1e-12 });
        parseNumeric(raw, "L", issues, "L", { min: 1e-12 });
      } else if (parseLayerText(raw.layers).length === 0) {
        issues.push("Provide at least one valid layer as k:L.");
      }
      return issues;
    },
    compute: (raw) => {
      const mode = raw.mode;
      const A = Number(raw.A);
      const Th = Number(raw.Th);
      const Tc = Number(raw.Tc);
      const dT = Th - Tc;

      let resistance = 0;
      const warnings: ToolWarning[] = [];
      if (mode === "single") {
        const k = Number(raw.k);
        const L = Number(raw.L);
        resistance = L / (k * A);
      } else {
        const layers = parseLayerText(raw.layers);
        resistance = layers.reduce((sum, layer) => sum + layer.L / (layer.k * A), 0);
        warnings.push(warn("assumption", "Composite wall assumed 1D with perfect contact between layers."));
      }

      const q = dT / Math.max(resistance, 1e-15);
      const qFlux = q / A;

      return {
        outputs: [
          outNum("Total thermal resistance", resistance, "K/W"),
          outNum("Heat transfer rate q", q, "W"),
          outNum("Heat flux", qFlux, "W/m^2"),
        ],
        checks: [check("Temperature difference", fmtSigned(dT, 4))],
        warnings: [warn("assumption", "Steady-state 1D conduction assumed (no internal generation)."), ...warnings],
      };
    },
  },
  {
    slug: "heat-exchanger-sizing",
    name: "Heat Exchanger Sizing",
    summary: "LMTD/epsilon-NTU based preliminary exchanger sizing.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...hxInputs],
    sampleValid: asRecord([...hxInputs]),
    sampleInvalid: { ...asRecord([...hxInputs]), mode: "lmtd", U: "0" },
    validate: (raw) => {
      const issues: string[] = [];
      if (raw.mode === "lmtd") {
        parseNumeric(raw, "Q", issues, "Q", { min: 0 });
        parseNumeric(raw, "U", issues, "U", { min: 1e-12 });
        parseNumeric(raw, "Thi", issues, "Thi");
        parseNumeric(raw, "Tho", issues, "Tho");
        parseNumeric(raw, "Tci", issues, "Tci");
        parseNumeric(raw, "Tco", issues, "Tco");
      } else {
        parseNumeric(raw, "Cmin", issues, "Cmin", { min: 1e-12 });
        parseNumeric(raw, "Cmax", issues, "Cmax", { min: 1e-12 });
        parseNumeric(raw, "NTU", issues, "NTU", { min: 0 });
        parseNumeric(raw, "Thi", issues, "Thi");
        parseNumeric(raw, "Tci", issues, "Tci");
      }
      return issues;
    },
    compute: (raw) => {
      const mode = raw.mode;
      if (mode === "lmtd") {
        const Q = Number(raw.Q);
        const U = Number(raw.U);
        const Thi = Number(raw.Thi);
        const Tho = Number(raw.Tho);
        const Tci = Number(raw.Tci);
        const Tco = Number(raw.Tco);
        const dT1 = Thi - Tco;
        const dT2 = Tho - Tci;
        const lmtd = Math.abs(dT1 - dT2) < 1e-12 ? dT1 : (dT1 - dT2) / Math.log(dT1 / dT2);
        const ua = Q / Math.max(lmtd, 1e-12);
        const area = ua / U;

        return {
          outputs: [
            outNum("DeltaT1", dT1, "K"),
            outNum("DeltaT2", dT2, "K"),
            outNum("LMTD", lmtd, "K"),
            outNum("UA", ua, "W/K"),
            outNum("Required area", area, "m^2"),
          ],
          checks: [check("LMTD sign", lmtd > 0 ? "Valid" : "Invalid", lmtd > 0)],
          warnings: [warn("assumption", "Counterflow LMTD approximation with constant U.")],
        };
      }

      const Cmin = Number(raw.Cmin);
      const Cmax = Number(raw.Cmax);
      const NTU = Number(raw.NTU);
      const Thi = Number(raw.Thi);
      const Tci = Number(raw.Tci);
      const cr = Cmin / Cmax;
      const eps = (1 - Math.exp(-NTU * (1 - cr))) / (1 - cr * Math.exp(-NTU * (1 - cr)));
      const qMax = Cmin * (Thi - Tci);
      const Q = eps * qMax;
      const ua = NTU * Cmin;

      return {
        outputs: [
          outNum("Capacity ratio Cr", cr, ""),
          outNum("Effectiveness", eps, ""),
          outNum("Heat duty Q", Q, "W"),
          outNum("UA", ua, "W/K"),
        ],
        checks: [check("Effectiveness <= 1", eps <= 1 ? "Yes" : "No", eps <= 1)],
        warnings: [warn("assumption", "Counterflow epsilon-NTU approximation, constant properties." )],
      };
    },
  },
  {
    slug: "steam-properties",
    name: "Steam Properties",
    summary: "Saturated/superheated lookup helper with interpolated property outputs.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...steamInputs],
    sampleValid: asRecord([...steamInputs]),
    sampleInvalid: { ...asRecord([...steamInputs]), quality: "1.2" },
    validate: (raw) => {
      const issues: string[] = [];
      parseNumeric(raw, "value", issues, "Lookup value", { min: 0 });
      parseNumeric(raw, "quality", issues, "Quality", { min: 0, max: 1 });
      return issues;
    },
    compute: (raw) => {
      const mode = raw.mode as "temperature" | "pressure";
      const value = Number(raw.value);
      const x = Number(raw.quality);
      const row = interpolateSteamSaturation(mode, value);
      if (!row) {
        const min = mode === "temperature" ? STEAM_SATURATION_ROWS[0].tC : STEAM_SATURATION_ROWS[0].pKPa;
        const max = mode === "temperature" ? STEAM_SATURATION_ROWS[STEAM_SATURATION_ROWS.length - 1].tC : STEAM_SATURATION_ROWS[STEAM_SATURATION_ROWS.length - 1].pKPa;
        return {
          outputs: [],
          checks: [],
          warnings: [warn("range", `Value outside embedded saturation range (${fmt(min, 2)} to ${fmt(max, 2)}).`)],
        };
      }

      const h = row.hf + x * row.hfg;
      const s = row.sf + x * row.sfg;
      const v = row.vf + x * (row.vg - row.vf);

      return {
        outputs: [
          outNum("Saturation temperature", row.tC, "C"),
          outNum("Saturation pressure", row.pKPa, "kPa"),
          outNum("Enthalpy h", h, "kJ/kg"),
          outNum("Entropy s", s, "kJ/(kg*K)"),
          outNum("Specific volume v", v, "m^3/kg"),
        ],
        checks: [check("Quality x", fmt(x, 4), x >= 0 && x <= 1)],
        warnings: [warn("assumption", "Embedded coarse saturation table interpolation for preliminary calculations only.")],
      };
    },
  },
  {
    slug: "psychrometrics",
    name: "Psychrometrics",
    summary: "Humidity ratio, dew point, enthalpy, and moist-air process plotting.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...psychInputs],
    sampleValid: asRecord([...psychInputs]),
    sampleInvalid: { ...asRecord([...psychInputs]), RH: "120" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "Tdb", label: "Tdb" },
      { key: "RH", label: "RH", min: 0, max: 100 },
      { key: "P", label: "Pressure", min: 1e-6 },
    ]),
    compute: (raw) => {
      const Tdb = Number(raw.Tdb);
      const RH = Number(raw.RH) / 100;
      const P = Number(raw.P);
      const pws = 0.61078 * Math.exp((17.2694 * Tdb) / (Tdb + 237.29));
      const pw = RH * pws;
      const w = 0.62198 * pw / Math.max(P - pw, 1e-12);
      const h = 1.006 * Tdb + w * (2501 + 1.86 * Tdb);
      const a = 17.27;
      const b = 237.7;
      const gamma = Math.log(Math.max(RH, 1e-9)) + (a * Tdb) / (b + Tdb);
      const dewPoint = (b * gamma) / (a - gamma);

      return {
        outputs: [
          outNum("Saturation pressure", pws, "kPa"),
          outNum("Water vapor partial pressure", pw, "kPa"),
          outNum("Humidity ratio w", w, "kg/kg dry air"),
          outNum("Moist-air enthalpy", h, "kJ/kg dry air"),
          outNum("Dew point", dewPoint, "C"),
        ],
        checks: [check("RH input", `${fmt(RH * 100, 2)} %`, RH >= 0 && RH <= 1)],
        warnings: [warn("assumption", "Approximate psychrometric relations at near-atmospheric pressure.")],
      };
    },
  },
  {
    slug: "material-property-database",
    name: "Material Property Database",
    summary: "Searchable reference for key mechanical and thermal properties.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...materialDbInputs],
    sampleValid: asRecord([...materialDbInputs]),
    sampleInvalid: { ...asRecord([...materialDbInputs]), maxRows: "0" },
    validate: (raw) => validatePositiveFields(raw, [{ key: "maxRows", label: "max rows", min: 1 }]),
    compute: (raw) => {
      const query = raw.query.trim().toLowerCase();
      const maxRows = Math.round(Number(raw.maxRows));
      const filtered = MATERIAL_ROWS.filter((row) => {
        if (!query) return true;
        return `${row.name} ${row.category}`.toLowerCase().includes(query);
      }).slice(0, maxRows);

      const warnings: ToolWarning[] = [];
      if (filtered.length === 0) warnings.push(warn("input", "No materials matched the current query."));

      return {
        outputs: [out("Rows returned", String(filtered.length))],
        checks: [check("Dataset size", String(MATERIAL_ROWS.length))],
        warnings,
        table: {
          columns: ["Material", "Category", "Density kg/m^3", "E GPa", "Yield MPa", "k W/mK"],
          rows: filtered.map((row) => [
            row.name,
            row.category,
            fmt(row.density, 2),
            fmt(row.youngsModulusGPa, 2),
            fmt(row.yieldStrengthMPa, 2),
            fmt(row.thermalConductivity, 2),
          ]),
        },
      };
    },
  },
  {
    slug: "safety-factor-calculator",
    name: "Safety Factor Calculator",
    summary: "Factor of safety and margin calculations from stress/strength inputs.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...safetyInputs],
    sampleValid: asRecord([...safetyInputs]),
    sampleInvalid: { ...asRecord([...safetyInputs]), strength: "0" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "stress", label: "stress", min: 1e-12 },
      { key: "strength", label: "strength", min: 1e-12 },
      { key: "requiredFoS", label: "required FoS", min: 0 },
    ]),
    compute: (raw) => {
      const stress = Number(raw.stress);
      const strength = Number(raw.strength);
      const required = Number(raw.requiredFoS);
      const fos = strength / stress;
      const margin = fos - 1;

      return {
        outputs: [outNum("Factor of safety", fos, ""), outNum("Margin", margin, "")],
        checks: [check("Requirement", fos >= required ? "PASS" : "FAIL", fos >= required)],
        warnings: [warn("assumption", "Static scalar stress-strength check only.")],
      };
    },
  },
  {
    slug: "fatigue-life-estimator",
    name: "Fatigue Life Estimator",
    summary: "S-N based fatigue check with mean stress corrections and safety margins.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...fatigueInputs],
    sampleValid: asRecord([...fatigueInputs]),
    sampleInvalid: { ...asRecord([...fatigueInputs]), b: "0" },
    validate: (raw) => {
      const issues = validatePositiveFields(raw, [
        { key: "sigmaA", label: "sigmaA", min: 1e-12 },
        { key: "Sut", label: "Sut", min: 1e-12 },
        { key: "sigmaFPrime", label: "sigmaFPrime", min: 1e-12 },
        { key: "targetCycles", label: "targetCycles", min: 0 },
      ]);
      const b = Number(raw.b);
      if (!Number.isFinite(b) || Math.abs(b) < 1e-12) issues.push("Basquin exponent b must be non-zero.");
      return issues;
    },
    compute: (raw) => {
      const sigmaA = Number(raw.sigmaA);
      const sigmaM = Number(raw.sigmaM);
      const Sut = Number(raw.Sut);
      const sigmaFPrime = Number(raw.sigmaFPrime);
      const b = Number(raw.b);
      const target = Number(raw.targetCycles);

      const goodmanDenom = 1 - sigmaM / Sut;
      const sigmaAeq = sigmaA / Math.max(goodmanDenom, 1e-12);
      const N = (sigmaAeq / sigmaFPrime) ** (1 / b);
      const damageIndex = target / Math.max(N, 1e-12);

      const warnings: ToolWarning[] = [];
      if (goodmanDenom <= 0) warnings.push(warn("range", "Mean stress exceeds Goodman limit (sigma_m >= Sut)."));

      return withAssumptionWarning(
        {
          outputs: [
            outNum("Goodman-corrected sigma_a", sigmaAeq, "MPa"),
            outNum("Estimated life N", N, "cycles"),
            outNum("Damage index target/N", damageIndex, ""),
          ],
          checks: [check("Target life check", damageIndex <= 1 ? "PASS" : "FAIL", damageIndex <= 1)],
          warnings,
        },
        "High-cycle Basquin + Goodman approximation, constant-amplitude loading."
      );
    },
  },
  {
    slug: "material-selection-matrix",
    name: "Material Selection Matrix",
    summary: "Rank materials by weighted criteria across strength, cost, density, and thermal traits.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...materialSelectInputs],
    sampleValid: asRecord([...materialSelectInputs]),
    sampleInvalid: { ...asRecord([...materialSelectInputs]), wStrength: "-1" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "wStrength", label: "wStrength", min: 0 },
      { key: "wDensity", label: "wDensity", min: 0 },
      { key: "wCost", label: "wCost", min: 0 },
      { key: "wThermal", label: "wThermal", min: 0 },
    ]),
    compute: (raw) => {
      const wStrength = Number(raw.wStrength);
      const wDensity = Number(raw.wDensity);
      const wCost = Number(raw.wCost);
      const wThermal = Number(raw.wThermal);
      const wSum = wStrength + wDensity + wCost + wThermal;

      const norm = {
        strength: wStrength / Math.max(wSum, 1e-12),
        density: wDensity / Math.max(wSum, 1e-12),
        cost: wCost / Math.max(wSum, 1e-12),
        thermal: wThermal / Math.max(wSum, 1e-12),
      };

      const strengths = MATERIAL_ROWS.map((m) => m.yieldStrengthMPa);
      const densities = MATERIAL_ROWS.map((m) => m.density);
      const costs = MATERIAL_ROWS.map((m) => m.relativeCost);
      const thermals = MATERIAL_ROWS.map((m) => m.thermalConductivity);
      const sMin = Math.min(...strengths);
      const sMax = Math.max(...strengths);
      const dMin = Math.min(...densities);
      const dMax = Math.max(...densities);
      const cMin = Math.min(...costs);
      const cMax = Math.max(...costs);
      const tMin = Math.min(...thermals);
      const tMax = Math.max(...thermals);

      const scored = MATERIAL_ROWS.map((m) => {
        const nStrength = (m.yieldStrengthMPa - sMin) / Math.max(sMax - sMin, 1e-12);
        const nDensity = (dMax - m.density) / Math.max(dMax - dMin, 1e-12);
        const nCost = (cMax - m.relativeCost) / Math.max(cMax - cMin, 1e-12);
        const nThermal = (m.thermalConductivity - tMin) / Math.max(tMax - tMin, 1e-12);
        const score =
          nStrength * norm.strength +
          nDensity * norm.density +
          nCost * norm.cost +
          nThermal * norm.thermal;
        return { ...m, score };
      }).sort((a, b) => b.score - a.score);

      return {
        outputs: [out("Top-ranked material", scored[0]?.name ?? "-")],
        checks: [check("Weight normalization", fmt(norm.strength + norm.density + norm.cost + norm.thermal, 4))],
        warnings: [warn("assumption", "Relative scoring depends on selected dataset and normalized criteria.")],
        table: {
          columns: ["Material", "Score", "Yield MPa", "Density", "Cost idx", "k"],
          rows: scored.slice(0, 8).map((m) => [
            m.name,
            fmt(m.score, 4),
            fmt(m.yieldStrengthMPa, 2),
            fmt(m.density, 2),
            fmt(m.relativeCost, 2),
            fmt(m.thermalConductivity, 2),
          ]),
        },
      };
    },
  },
  {
    slug: "matrix-solver",
    name: "Matrix Solver",
    summary: "Solve linear systems, determinant, inverse, and decomposition outputs.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...matrixInputs],
    sampleValid: asRecord([...matrixInputs]),
    sampleInvalid: { ...asRecord([...matrixInputs]), A: "1,2\n2,4", b: "3" },
    validate: (raw) => {
      const issues: string[] = [];
      const A = parseMatrixText(raw.A);
      const b = parseVectorText(raw.b);
      if (A.length === 0) issues.push("Matrix A must contain at least one row.");
      const n = A.length;
      if (A.some((row) => row.length !== n)) issues.push("Matrix A must be square.");
      if (b.length !== n) issues.push("Vector b length must match matrix size.");
      return issues;
    },
    compute: (raw) => {
      const A = parseMatrixText(raw.A);
      const b = parseVectorText(raw.b);
      const x = solveLinearSystemGauss(A, b);
      const det = determinant(A);
      const inv = invertMatrix(A);

      const warnings: ToolWarning[] = [];
      if (!x) warnings.push(warn("stability", "System could not be solved uniquely (likely singular)."));
      if (det !== null && Math.abs(det) < 1e-9) warnings.push(warn("stability", "Determinant is near zero; matrix is ill-conditioned/singular."));

      let residual = Number.NaN;
      if (x) {
        const residualVec = A.map((row, i) => row.reduce((sum, aij, j) => sum + aij * x[j], 0) - b[i]);
        residual = Math.sqrt(residualVec.reduce((sum, r) => sum + r * r, 0));
      }

      const outputs: ToolOutput[] = [
        out("Solution x", x ? `[${x.map((v) => fmt(v, 6)).join(", ")}]` : "No unique solution"),
        outNum("Determinant", det ?? Number.NaN, ""),
        outNum("Residual norm ||Ax-b||", residual, ""),
      ];

      return {
        outputs,
        checks: [check("Invertible", inv ? "Yes" : "No", Boolean(inv))],
        warnings,
        table: inv
          ? {
              columns: Array.from({ length: inv.length }, (_, i) => `c${i + 1}`),
              rows: inv.map((row) => row.map((v) => fmt(v, 6))),
            }
          : undefined,
      };
    },
  },
  {
    slug: "ode-solver",
    name: "ODE Solver",
    summary: "Numerical initial-value solver with RK methods and error controls.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...odeInputs],
    sampleValid: asRecord([...odeInputs]),
    sampleInvalid: { ...asRecord([...odeInputs]), h: "0" },
    validate: (raw) => {
      const issues = validatePositiveFields(raw, [
        { key: "a", label: "a" },
        { key: "b", label: "b" },
        { key: "x0", label: "x0" },
        { key: "y0", label: "y0" },
        { key: "xEnd", label: "xEnd" },
        { key: "h", label: "h", min: 1e-9 },
      ]);
      const x0 = Number(raw.x0);
      const xEnd = Number(raw.xEnd);
      if (xEnd <= x0) issues.push("xEnd must be greater than x0.");
      return issues;
    },
    compute: (raw) => {
      const method = raw.method;
      const a = Number(raw.a);
      const b = Number(raw.b);
      const x0 = Number(raw.x0);
      const y0 = Number(raw.y0);
      const xEnd = Number(raw.xEnd);
      const h = Number(raw.h);
      const f = (x: number, y: number) => a * y + b * Math.sin(0.2 * x);

      let x = x0;
      let y = y0;
      const points: Array<Record<string, number>> = [{ x, y }];

      while (x < xEnd - 1e-12) {
        const step = Math.min(h, xEnd - x);
        if (method === "euler") {
          y = y + step * f(x, y);
        } else {
          const k1 = f(x, y);
          const k2 = f(x + 0.5 * step, y + 0.5 * step * k1);
          const k3 = f(x + 0.5 * step, y + 0.5 * step * k2);
          const k4 = f(x + step, y + step * k3);
          y = y + (step / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
        }
        x += step;
        points.push({ x, y });
      }

      return {
        outputs: [
          outNum("Final y(xEnd)", y, ""),
          outNum("Number of steps", points.length - 1, ""),
        ],
        checks: [check("Method", method.toUpperCase())],
        warnings: [warn("assumption", "ODE model fixed to y' = a*y + b*sin(0.2x) for MVP workflow.")],
        series: {
          title: "Numerical solution y(x)",
          xKey: "x",
          xLabel: "x",
          yLabel: "y",
          lines: [{ key: "y", label: "y" }],
          points,
        },
      };
    },
  },
  {
    slug: "curve-fitting-regression",
    name: "Curve Fitting & Regression",
    summary: "Linear/nonlinear regression with residual diagnostics and fit quality metrics.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...regressionInputs],
    sampleValid: asRecord([...regressionInputs]),
    sampleInvalid: { ...asRecord([...regressionInputs]), data: "1\n2\n3" },
    validate: (raw) => {
      const points = parseXYText(raw.data);
      if (points.length < 2) return ["Provide at least two valid x,y points."];
      if (raw.model === "poly2" && points.length < 3) return ["Polynomial degree 2 fit requires at least three points."];
      if (raw.model === "exp" && points.some((p) => p.y <= 0)) return ["Exponential fit requires y > 0 for all points."];
      return [];
    },
    compute: (raw) => {
      const model = raw.model;
      const points = parseXYText(raw.data);
      const xMin = Math.min(...points.map((p) => p.x));
      const xMax = Math.max(...points.map((p) => p.x));

      let result = linearRegression(points);
      if (model === "poly2") {
        const poly = polynomial2Regression(points);
        if (poly) result = poly;
      } else if (model === "exp") {
        const exp = exponentialRegression(points);
        if (exp) result = exp;
      }

      const samples = Array.from({ length: 60 }, (_, i) => {
        const t = i / 59;
        const x = xMin + (xMax - xMin) * t;
        return { x, fit: result.predict(x) };
      });

      const measured = points.map((p) => ({ x: p.x, measured: p.y }));
      const merged = samples.map((s) => {
        const nearest = measured.reduce((best, p) => (Math.abs(p.x - s.x) < Math.abs(best.x - s.x) ? p : best), measured[0]);
        return {
          x: s.x,
          fit: s.fit,
          measured: Math.abs(nearest.x - s.x) < (xMax - xMin) / 120 ? nearest.measured : Number.NaN,
        };
      });

      const coeffStr =
        model === "linear"
          ? `y = ${fmt(result.coefficients[0], 6)}x + ${fmt(result.coefficients[1], 6)}`
          : model === "poly2"
            ? `y = ${fmt(result.coefficients[0], 6)}x^2 + ${fmt(result.coefficients[1], 6)}x + ${fmt(result.coefficients[2], 6)}`
            : `y = ${fmt(result.coefficients[0], 6)} * exp(${fmt(result.coefficients[1], 6)}x)`;

      return {
        outputs: [
          out("Fit equation", coeffStr),
          outNum("R^2", result.r2, ""),
          outNum("Points used", points.length, ""),
        ],
        checks: [check("Fit quality", result.r2 > 0.9 ? "High" : result.r2 > 0.75 ? "Moderate" : "Low")],
        warnings: [warn("assumption", "Least-squares fit only; no robust outlier handling in MVP.")],
        series: {
          title: "Measured vs fitted",
          xKey: "x",
          xLabel: "x",
          yLabel: "y",
          lines: [
            { key: "measured", label: "Measured" },
            { key: "fit", label: "Fit" },
          ],
          points: merged,
        },
      };
    },
  },
  {
    slug: "unit-converter",
    name: "Unit Converter",
    summary: "Engineering unit conversions across SI and imperial systems.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...unitConverterInputs],
    sampleValid: asRecord([...unitConverterInputs]),
    sampleInvalid: { ...asRecord([...unitConverterInputs]), from: "badunit" },
    validate: (raw) => {
      const issues: string[] = [];
      const dim = raw.dimension;
      parseNumeric(raw, "value", issues, "value");
      const units = listUnits(dim as Parameters<typeof listUnits>[0]);
      if (!units.includes(raw.from)) issues.push(`From unit must be one of: ${units.join(", ")}`);
      if (!units.includes(raw.to)) issues.push(`To unit must be one of: ${units.join(", ")}`);
      return issues;
    },
    compute: (raw) => {
      const dimension = raw.dimension as Parameters<typeof convertUnit>[0];
      const value = Number(raw.value);
      const result = convertUnit(dimension, value, raw.from, raw.to);
      return {
        outputs: [
          out("Input", `${fmt(value, 8)} ${raw.from}`),
          out("Converted", `${fmt(result, 8)} ${raw.to}`),
        ],
        checks: [check("Dimension", dimension)],
        warnings: [],
      };
    },
  },
  {
    slug: "unit-conversions",
    name: "Unit Conversions",
    summary: "Quick conversion shortcuts for the most common engineering quantities.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...quickUnitInputs],
    sampleValid: asRecord([...quickUnitInputs]),
    sampleInvalid: { ...asRecord([...quickUnitInputs]), preset: "missing" },
    validate: (raw) => {
      const issues: string[] = [];
      parseNumeric(raw, "value", issues, "value");
      if (!QUICK_CONVERSION_PRESETS.some((p) => p.id === raw.preset)) issues.push("Unknown preset.");
      return issues;
    },
    compute: (raw) => {
      const value = Number(raw.value);
      const { preset, result } = runQuickPreset(raw.preset, value);
      return {
        outputs: [
          out("Preset", preset.label),
          out("Input", `${fmt(value, 8)} ${preset.fromUnit}`),
          out("Output", `${fmt(result, 8)} ${preset.toUnit}`),
        ],
        checks: [check("Dimension", preset.dimension)],
        warnings: [],
      };
    },
  },
  {
    slug: "engineering-constants",
    name: "Engineering Constants",
    summary: "Reference constants and standard values used in calculations.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...constantsInputs],
    sampleValid: asRecord([...constantsInputs]),
    sampleInvalid: { ...asRecord([...constantsInputs]), maxRows: "0" },
    validate: (raw) => validatePositiveFields(raw, [{ key: "maxRows", label: "maxRows", min: 1 }]),
    compute: (raw) => {
      const query = raw.query.trim().toLowerCase();
      const maxRows = Math.round(Number(raw.maxRows));
      const filtered = ENGINEERING_CONSTANTS.filter((c) => {
        if (!query) return true;
        return `${c.name} ${c.symbol} ${c.note}`.toLowerCase().includes(query);
      }).slice(0, maxRows);
      return {
        outputs: [out("Rows returned", String(filtered.length))],
        checks: [],
        warnings: filtered.length === 0 ? [warn("input", "No constants matched query.")] : [],
        table: {
          columns: ["Name", "Symbol", "Value", "Units", "Note"],
          rows: filtered.map((c) => [c.name, c.symbol, c.value, c.units, c.note]),
        },
      };
    },
  },
  {
    slug: "quick-plot-tool",
    name: "Quick Plot Tool",
    summary: "Fast XY plotting for equations, datasets, and comparison curves.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...quickPlotInputs],
    sampleValid: asRecord([...quickPlotInputs]),
    sampleInvalid: { ...asRecord([...quickPlotInputs]), data: "1\n2\n3" },
    validate: (raw) => {
      const points = parseXYText(raw.data);
      if (points.length < 2) return ["Provide at least two valid x,y rows."];
      return [];
    },
    compute: (raw) => {
      const points = parseXYText(raw.data);
      const fitEnabled = raw.fit === "yes";
      const lr = linearRegression(points);

      const rows = points.map((p) => ({
        x: p.x,
        data: p.y,
        fit: fitEnabled ? lr.predict(p.x) : Number.NaN,
      }));

      return {
        outputs: [
          outNum("Data points", points.length, ""),
          out("Trendline", fitEnabled ? `y = ${fmt(lr.coefficients[0], 6)}x + ${fmt(lr.coefficients[1], 6)}` : "disabled"),
          outNum("Trendline R^2", fitEnabled ? lr.r2 : Number.NaN, ""),
        ],
        checks: [check("Fit overlay", fitEnabled ? "On" : "Off")],
        warnings: [],
        series: {
          title: "XY quick plot",
          xKey: "x",
          xLabel: "x",
          yLabel: "y",
          lines: fitEnabled
            ? [{ key: "data", label: "Data" }, { key: "fit", label: "Best fit" }]
            : [{ key: "data", label: "Data" }],
          points: rows,
        },
      };
    },
  },
  {
    slug: "data-table-csv-tool",
    name: "Data Table CSV Tool",
    summary: "Import CSV, compute derived columns, and push data into calculators.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...csvToolInputs],
    sampleValid: asRecord([...csvToolInputs]),
    sampleInvalid: { ...asRecord([...csvToolInputs]), csv: "" },
    validate: (raw) => {
      const table = parseCsvRows(raw.csv);
      if (table.columns.length === 0 || table.rows.length === 0) return ["Provide a non-empty CSV table."];
      if (raw.derived.trim() && !parseDerivedExpression(raw.derived)) {
        return ["Derived expression must look like new=colA*colB (supports + - * /)."];
      }
      return [];
    },
    compute: (raw) => {
      const table = parseCsvRows(raw.csv);
      const derivedExpr = parseDerivedExpression(raw.derived);
      const columns = [...table.columns];
      const rows = table.rows.map((row) => [...row]);
      const warnings: ToolWarning[] = [];

      if (derivedExpr) {
        const ia = columns.indexOf(derivedExpr.a);
        const ib = columns.indexOf(derivedExpr.b);
        if (ia < 0 || ib < 0) {
          warnings.push(warn("input", "Derived expression references missing columns."));
        } else {
          columns.push(derivedExpr.out);
          for (const row of rows) {
            const a = Number(row[ia]);
            const b = Number(row[ib]);
            const v = applyBinary(a, b, derivedExpr.op);
            row.push(Number.isFinite(v) ? fmt(v, 6) : "NaN");
          }
        }
      }

      const preview = rows.slice(0, 25);
      return {
        outputs: [
          out("Columns", String(columns.length)),
          out("Rows", String(rows.length)),
          out("Derived", derivedExpr ? `${derivedExpr.out}=${derivedExpr.a}${derivedExpr.op}${derivedExpr.b}` : "None"),
        ],
        checks: [check("CSV parse", "OK")],
        warnings: [warn("assumption", "CSV parser is MVP-grade and does not handle escaped quoted commas."), ...warnings],
        table: {
          columns,
          rows: preview,
        },
      };
    },
  },
  {
    slug: "equation-cheatsheet",
    name: "Equation Cheatsheet",
    summary: "Searchable equation index with symbols, units, and assumptions.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...equationInputs],
    sampleValid: asRecord([...equationInputs]),
    sampleInvalid: { ...asRecord([...equationInputs]), maxRows: "0" },
    validate: (raw) => validatePositiveFields(raw, [{ key: "maxRows", label: "maxRows", min: 1 }]),
    compute: (raw) => {
      const query = raw.query.trim().toLowerCase();
      const maxRows = Math.round(Number(raw.maxRows));
      const filtered = EQUATION_ROWS.filter((e) => {
        if (!query) return true;
        return `${e.topic} ${e.name} ${e.equation} ${e.symbols} ${e.assumptions}`.toLowerCase().includes(query);
      }).slice(0, maxRows);
      return {
        outputs: [out("Rows returned", String(filtered.length))],
        checks: [],
        warnings: filtered.length === 0 ? [warn("input", "No equations matched query.")] : [],
        table: {
          columns: ["Topic", "Name", "Equation", "Symbols", "Assumptions"],
          rows: filtered.map((e) => [e.topic, e.name, e.equation, e.symbols, e.assumptions]),
        },
      };
    },
  },
  {
    slug: "ac-circuit-analyzer",
    name: "AC Circuit Analyzer",
    summary: "Impedance, phasors, real/reactive power, and power factor calculations.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...acInputs],
    sampleValid: asRecord([...acInputs]),
    sampleInvalid: { ...asRecord([...acInputs]), R: "-1" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "R", label: "R", min: 0 },
      { key: "XL", label: "XL" },
      { key: "XC", label: "XC" },
      { key: "V", label: "V", min: 1e-12 },
    ]),
    compute: (raw) => {
      const R = Number(raw.R);
      const XL = Number(raw.XL);
      const XC = Number(raw.XC);
      const V = Number(raw.V);
      const X = XL - XC;
      const Z = Math.sqrt(R * R + X * X);
      const I = V / Math.max(Z, 1e-15);
      const phi = Math.atan2(X, Math.max(R, 1e-15));
      const pf = Math.cos(phi);
      const S = V * I;
      const P = S * pf;
      const Q = S * Math.sin(phi);

      return {
        outputs: [
          outNum("Net reactance X", X, "ohm"),
          outNum("Impedance |Z|", Z, "ohm"),
          outNum("Current I", I, "A"),
          outNum("Real power P", P, "W"),
          outNum("Reactive power Q", Q, "var"),
          outNum("Apparent power S", S, "VA"),
        ],
        checks: [
          check("Power factor", fmt(Math.abs(pf), 4)),
          check("Phase", X >= 0 ? "Lagging" : "Leading"),
        ],
        warnings: [warn("assumption", "Single-frequency steady-state RLC approximation.")],
      };
    },
  },
  {
    slug: "three-phase-power",
    name: "Three-Phase Power",
    summary: "Line/phase relations, balanced load calculations, and motor load checks.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...threePhaseInputs],
    sampleValid: asRecord([...threePhaseInputs]),
    sampleInvalid: { ...asRecord([...threePhaseInputs]), pf: "1.5" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "VL", label: "VL", min: 1e-12 },
      { key: "IL", label: "IL", min: 0 },
      { key: "pf", label: "pf", min: 0, max: 1 },
    ]),
    compute: (raw) => {
      const conn = raw.conn;
      const VL = Number(raw.VL);
      const IL = Number(raw.IL);
      const pf = Number(raw.pf);
      const S = Math.sqrt(3) * VL * IL;
      const P = S * pf;
      const Q = Math.sqrt(Math.max(0, S * S - P * P));
      const Vph = conn === "wye" ? VL / Math.sqrt(3) : VL;
      const Iph = conn === "wye" ? IL : IL / Math.sqrt(3);

      return {
        outputs: [
          outNum("Phase voltage", Vph, "V"),
          outNum("Phase current", Iph, "A"),
          outNum("Apparent power", S, "VA"),
          outNum("Real power", P, "W"),
          outNum("Reactive power", Q, "var"),
        ],
        checks: [check("Connection", conn === "wye" ? "Wye" : "Delta")],
        warnings: [warn("assumption", "Balanced 3-phase sinusoidal system assumed.")],
      };
    },
  },
  {
    slug: "cable-sizing-voltage-drop",
    name: "Cable Sizing & Voltage Drop",
    summary: "Conductor sizing from ampacity and allowable voltage drop constraints.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...cableInputs],
    sampleValid: asRecord([...cableInputs]),
    sampleInvalid: { ...asRecord([...cableInputs]), maxDropPct: "0" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "L", label: "L", min: 0 },
      { key: "I", label: "I", min: 0 },
      { key: "V", label: "V", min: 1e-9 },
      { key: "pf", label: "pf", min: 0, max: 1 },
      { key: "maxDropPct", label: "maxDropPct", min: 1e-9 },
    ]),
    compute: (raw) => {
      const phase = raw.phase;
      const material = raw.material;
      const L = Number(raw.L);
      const I = Number(raw.I);
      const V = Number(raw.V);
      const pf = Number(raw.pf);
      const maxDropPct = Number(raw.maxDropPct);

      const rho = material === "copper" ? 0.0175 : 0.0282;
      const sizes = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240];
      let chosen = sizes[sizes.length - 1];
      let chosenDropPct = Number.NaN;

      for (const size of sizes) {
        const rPerM = rho / size;
        const factor = phase === "single" ? 2 : Math.sqrt(3);
        const dV = factor * I * rPerM * L * pf;
        const dropPct = (dV / V) * 100;
        if (dropPct <= maxDropPct) {
          chosen = size;
          chosenDropPct = dropPct;
          break;
        }
      }

      if (!Number.isFinite(chosenDropPct)) {
        const rPerM = rho / chosen;
        const factor = phase === "single" ? 2 : Math.sqrt(3);
        const dV = factor * I * rPerM * L * pf;
        chosenDropPct = (dV / V) * 100;
      }

      return {
        outputs: [
          out("Recommended size", `${chosen} mm^2`),
          outNum("Estimated voltage drop", chosenDropPct, "%"),
        ],
        checks: [check("Drop limit check", chosenDropPct <= maxDropPct ? "PASS" : "FAIL", chosenDropPct <= maxDropPct)],
        warnings: [warn("assumption", "Resistive drop-only estimate; ignores reactance and thermal derating details.")],
      };
    },
  },
  {
    slug: "retaining-wall-check",
    name: "Retaining Wall Check",
    summary: "Sliding, overturning, and bearing checks for conceptual retaining wall sizing.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...retainingInputs],
    sampleValid: asRecord([...retainingInputs]),
    sampleInvalid: { ...asRecord([...retainingInputs]), B: "0" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "H", label: "H", min: 1e-9 },
      { key: "gamma", label: "gamma", min: 1e-9 },
      { key: "phi", label: "phi", min: 0, max: 89 },
      { key: "B", label: "B", min: 1e-9 },
      { key: "W", label: "W", min: 1e-9 },
      { key: "mu", label: "mu", min: 0 },
      { key: "qAllow", label: "qAllow", min: 1e-9 },
    ]),
    compute: (raw) => {
      const H = Number(raw.H);
      const gamma = Number(raw.gamma);
      const phi = Number(raw.phi);
      const B = Number(raw.B);
      const W = Number(raw.W);
      const mu = Number(raw.mu);
      const qAllow = Number(raw.qAllow);

      const Ka = Math.tan(toRad(45 - phi / 2)) ** 2;
      const Pa = 0.5 * Ka * gamma * H * H;
      const Mo = Pa * (H / 3);
      const Mr = W * (B / 2);
      const fsOT = Mr / Math.max(Mo, 1e-12);
      const fsSL = (mu * W) / Math.max(Pa, 1e-12);
      const xRes = (Mr - Mo) / Math.max(W, 1e-12);
      const e = B / 2 - xRes;
      const qAvg = W / B;
      const qMax = qAvg * (1 + (6 * e) / B);
      const qMin = qAvg * (1 - (6 * e) / B);

      return withAssumptionWarning(
        {
          outputs: [
            outNum("Active pressure coefficient Ka", Ka, ""),
            outNum("Resultant earth force Pa", Pa, "kN/m"),
            outNum("FS overturning", fsOT, ""),
            outNum("FS sliding", fsSL, ""),
            outNum("Bearing q_max", qMax, "kPa"),
            outNum("Bearing q_min", qMin, "kPa"),
          ],
          checks: [
            check("Overturning (>=2.0)", fsOT >= 2 ? "PASS" : "CHECK", fsOT >= 2),
            check("Sliding (>=1.5)", fsSL >= 1.5 ? "PASS" : "CHECK", fsSL >= 1.5),
            check("Bearing limit", qMax <= qAllow ? "PASS" : "CHECK", qMax <= qAllow),
          ],
          warnings: qMin < 0 ? [warn("range", "q_min < 0 indicates base tension/uplift in this simplified check.")] : [],
        },
        "Rankine active pressure, no surcharge/water/seismic effects in conceptual mode."
      );
    },
  },
  {
    slug: "concrete-mix-designer",
    name: "Concrete Mix Designer",
    summary: "Preliminary concrete mix proportions and workability/strength balancing.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...concreteInputs],
    sampleValid: asRecord([...concreteInputs]),
    sampleInvalid: { ...asRecord([...concreteInputs]), wc: "0" },
    validate: (raw) => validatePositiveFields(raw, [
      { key: "fck", label: "fck", min: 1e-9 },
      { key: "slump", label: "slump", min: 0 },
      { key: "wc", label: "w/c", min: 1e-9 },
      { key: "cement", label: "cement", min: 1e-9 },
      { key: "air", label: "air", min: 0, max: 20 },
    ]),
    compute: (raw) => {
      const fck = Number(raw.fck);
      const slump = Number(raw.slump);
      const wc = Number(raw.wc);
      const cement = Number(raw.cement);
      const airPct = Number(raw.air) / 100;

      const water = wc * cement;
      const cVol = cement / 3150;
      const wVol = water / 1000;
      const aVol = airPct;
      const aggVol = Math.max(0, 1 - cVol - wVol - aVol);
      const aggregate = aggVol * 2650;
      const estimatedStrength = 96 / Math.max(wc, 1e-12);

      const warnings: ToolWarning[] = [];
      if (Math.abs(estimatedStrength - fck) / fck > 0.35) {
        warnings.push(warn("range", "Estimated strength differs notably from target; refine trial mix and local standards."));
      }
      if (slump > 180) warnings.push(warn("assumption", "High slump may need admixture; water-only adjustment may mislead."));

      return {
        outputs: [
          outNum("Water content", water, "kg/m^3"),
          outNum("Aggregate content", aggregate, "kg/m^3"),
          out("Mass ratio C:W:Agg", `1 : ${fmt(water / cement, 3)} : ${fmt(aggregate / cement, 3)}`),
          outNum("Estimated compressive strength", estimatedStrength, "MPa"),
        ],
        checks: [check("Estimated >= target", estimatedStrength >= fck ? "Likely" : "Low", estimatedStrength >= fck)],
        warnings: [warn("assumption", "Preliminary proportioning only; validate with local concrete design method."), ...warnings],
      };
    },
  },
  {
    slug: "survey-traverse-adjustment",
    name: "Survey Traverse Adjustment",
    summary: "Traverse closure, Bowditch adjustment, and coordinate balancing.",
    disclaimer: APPROX_DISCLAIMER,
    inputs: [...surveyInputs],
    sampleValid: asRecord([...surveyInputs]),
    sampleInvalid: { ...asRecord([...surveyInputs]), legs: "120\ninvalid" },
    validate: (raw) => {
      const legs = parseTraverseInput(raw.legs);
      if (legs.length < 2) return ["Provide at least two valid legs (distance,bearing_deg)."];
      if (legs.some((l) => l.distance <= 0)) return ["All leg distances must be > 0."];
      return [];
    },
    compute: (raw) => {
      const legs = parseTraverseInput(raw.legs);
      const adjusted = computeBowditchAdjustment(legs);
      if (!adjusted) return emptyResult();

      return withAssumptionWarning(
        {
          outputs: [
            outNum("Closure north", adjusted.closureNorth, "m"),
            outNum("Closure east", adjusted.closureEast, "m"),
            outNum("Misclosure", adjusted.misclosure, "m"),
            outNum("Total traverse length", adjusted.totalLength, "m"),
            out("Closure ratio", adjusted.misclosure === 0 ? "Perfect" : `1 : ${fmt(adjusted.closureRatio, 1)}`),
          ],
          checks: [check("Closure quality", adjusted.closureRatio >= 2000 ? "Good" : "Review")],
          warnings: [],
          table: {
            columns: [
              "Leg",
              "Distance",
              "Bearing",
              "dN raw",
              "dE raw",
              "dN adj",
              "dE adj",
              "Easting",
              "Northing",
            ],
            rows: adjusted.adjusted.map((row) => [
              String(row.leg),
              fmt(row.distance, 3),
              fmt(row.bearingDeg, 3),
              fmt(row.northing, 4),
              fmt(row.easting, 4),
              fmt(row.adjNorthing, 4),
              fmt(row.adjEasting, 4),
              fmt(row.x, 4),
              fmt(row.y, 4),
            ]),
          },
        },
        "Bowditch assumes closure error distributes proportional to line lengths."
      );
    },
  },
];

function buildLookup(specList: ToolRuntimeSpec[]) {
  const map: Record<string, ToolRuntimeSpec> = {};
  for (const spec of specList) {
    map[spec.slug] = spec;
  }
  return map;
}

const EXPECTED_MVP_SLUGS = [
  "torsion-calculator",
  "stress-transformation-mohrs-circle",
  "column-buckling",
  "section-properties",
  "combined-stress-check",
  "reynolds-number",
  "pipe-pressure-drop",
  "pump-power-calculator",
  "open-channel-flow",
  "compressible-flow",
  "ideal-gas-law",
  "heat-transfer-conduction",
  "heat-exchanger-sizing",
  "steam-properties",
  "psychrometrics",
  "material-property-database",
  "safety-factor-calculator",
  "fatigue-life-estimator",
  "material-selection-matrix",
  "matrix-solver",
  "ode-solver",
  "curve-fitting-regression",
  "unit-converter",
  "unit-conversions",
  "engineering-constants",
  "quick-plot-tool",
  "data-table-csv-tool",
  "equation-cheatsheet",
  "ac-circuit-analyzer",
  "three-phase-power",
  "cable-sizing-voltage-drop",
  "retaining-wall-check",
  "concrete-mix-designer",
  "survey-traverse-adjustment",
] as const;

export const TOOL_RUNTIME_SPECS: ToolRuntimeSpec[] = [...specs];
export const TOOL_RUNTIME_SPEC_MAP: Record<string, ToolRuntimeSpec> = buildLookup(TOOL_RUNTIME_SPECS);

for (const slug of EXPECTED_MVP_SLUGS) {
  if (!TOOL_RUNTIME_SPEC_MAP[slug]) {
    throw new Error(`Missing MVP runtime spec for '${slug}'.`);
  }
}

export function getToolRuntimeSpec(slug: string): ToolRuntimeSpec | null {
  return TOOL_RUNTIME_SPEC_MAP[slug] ?? null;
}

export function getToolRuntimeSpecs(): ToolRuntimeSpec[] {
  return [...TOOL_RUNTIME_SPECS];
}
