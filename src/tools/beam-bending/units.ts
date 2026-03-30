import type { BeamDisplayUnits, DisplayUnitSystem } from "./model";

export type UnitQuantity =
  | "force"
  | "length"
  | "moment"
  | "distributedLoad"
  | "stress"
  | "modulus"
  | "inertia"
  | "rotation"
  | "area"
  | "sectionModulus"
  | "springLinear"
  | "springRotational"
  | "deflection";

const UNIT_FACTOR_FROM_BASE: Record<
  BeamDisplayUnits[keyof BeamDisplayUnits] & string,
  number
> = {
  si_base: 1,
  engineering_metric: 1,
  N: 1,
  kN: 1e-3,
  m: 1,
  mm: 1e3,
  "N·m": 1,
  "kN·m": 1e-3,
  "N/m": 1,
  "kN/m": 1e-3,
  Pa: 1,
  MPa: 1e-6,
  GPa: 1e-9,
  "m^4": 1,
  "cm^4": 1e8,
  "mm^4": 1e12,
  rad: 1,
  mrad: 1e3,
  deg: 180 / Math.PI,
  "m^2": 1,
  "cm^2": 1e4,
  "mm^2": 1e6,
  "m^3": 1,
  "cm^3": 1e6,
  "mm^3": 1e9,
  "N·m/rad": 1,
  "kN·m/rad": 1e-3,
};

export const BASE_SI_DISPLAY_UNITS: BeamDisplayUnits = {
  system: "si_base",
  force: "N",
  length: "m",
  moment: "N·m",
  distributedLoad: "N/m",
  stress: "Pa",
  modulus: "Pa",
  inertia: "m^4",
  rotation: "rad",
  area: "m^2",
  sectionModulus: "m^3",
  springLinear: "N/m",
  springRotational: "N·m/rad",
  deflection: "m",
};

export const ENGINEERING_METRIC_DISPLAY_UNITS: BeamDisplayUnits = {
  system: "engineering_metric",
  force: "kN",
  length: "m",
  moment: "kN·m",
  distributedLoad: "kN/m",
  stress: "MPa",
  modulus: "GPa",
  inertia: "mm^4",
  rotation: "mrad",
  area: "mm^2",
  sectionModulus: "mm^3",
  springLinear: "kN/m",
  springRotational: "kN·m/rad",
  deflection: "mm",
};

const ENUM_OPTIONS: {
  [K in keyof BeamDisplayUnits]: ReadonlyArray<BeamDisplayUnits[K]>;
} = {
  system: ["si_base", "engineering_metric"],
  force: ["N", "kN"],
  length: ["m", "mm"],
  moment: ["N·m", "kN·m"],
  distributedLoad: ["N/m", "kN/m"],
  stress: ["Pa", "MPa"],
  modulus: ["Pa", "GPa"],
  inertia: ["m^4", "mm^4", "cm^4"],
  rotation: ["rad", "mrad", "deg"],
  area: ["m^2", "cm^2", "mm^2"],
  sectionModulus: ["m^3", "cm^3", "mm^3"],
  springLinear: ["N/m", "kN/m"],
  springRotational: ["N·m/rad", "kN·m/rad"],
  deflection: ["m", "mm"],
};

function normalizeSymbol(s: string) {
  return s.replace(/\s+/g, "").replaceAll("*", "·").replaceAll("μ", "µ").toLowerCase();
}

function cleanUnitSymbolText(raw: string, unitSymbol: string) {
  const compactRaw = normalizeSymbol(raw);
  const compactUnit = normalizeSymbol(unitSymbol);
  if (!compactRaw.endsWith(compactUnit)) return raw;

  let remaining = raw.trim();
  const separators = [" ", "\t"];
  for (const sep of separators) {
    if (remaining.toLowerCase().endsWith(`${sep}${unitSymbol.toLowerCase()}`)) {
      remaining = remaining.slice(0, -(`${sep}${unitSymbol}`).length);
      return remaining.trim();
    }
  }

  if (remaining.endsWith(unitSymbol)) {
    remaining = remaining.slice(0, -unitSymbol.length);
    return remaining.trim();
  }

  return raw;
}

function toFinite(v: unknown) {
  return typeof v === "number" && Number.isFinite(v);
}

export function getDisplayUnits(input?: Partial<BeamDisplayUnits> | undefined): BeamDisplayUnits {
  const fallback = input?.system === "engineering_metric" ? ENGINEERING_METRIC_DISPLAY_UNITS : BASE_SI_DISPLAY_UNITS;
  const merged: BeamDisplayUnits = {
    ...fallback,
    ...(input ?? {}),
  };
  for (const key of Object.keys(ENUM_OPTIONS) as Array<keyof BeamDisplayUnits>) {
    const options = ENUM_OPTIONS[key];
    if (!(options as readonly string[]).includes(String(merged[key]))) {
      merged[key] = fallback[key];
    }
  }
  return merged;
}

export function displayPreset(system: DisplayUnitSystem): BeamDisplayUnits {
  return system === "engineering_metric" ? ENGINEERING_METRIC_DISPLAY_UNITS : BASE_SI_DISPLAY_UNITS;
}

export function getDisplayUnitsIssues(display?: Partial<BeamDisplayUnits>): string[] {
  if (!display) return [];
  const issues: string[] = [];
  for (const key of Object.keys(display) as Array<keyof BeamDisplayUnits>) {
    const value = display[key];
    if (value === undefined) continue;
    const options = ENUM_OPTIONS[key];
    if (!(options as readonly string[]).includes(String(value))) {
      issues.push(`Display unit selection for "${key}" is invalid.`);
    }
  }
  return issues;
}

export function quantityUnitSymbol(units: BeamDisplayUnits, quantity: UnitQuantity): string {
  if (quantity === "force") return units.force;
  if (quantity === "length") return units.length;
  if (quantity === "moment") return units.moment;
  if (quantity === "distributedLoad") return units.distributedLoad;
  if (quantity === "stress") return units.stress;
  if (quantity === "modulus") return units.modulus;
  if (quantity === "inertia") return units.inertia;
  if (quantity === "rotation") return units.rotation;
  if (quantity === "area") return units.area;
  if (quantity === "sectionModulus") return units.sectionModulus;
  if (quantity === "springLinear") return units.springLinear;
  if (quantity === "springRotational") return units.springRotational;
  return units.deflection;
}

export function toDisplayUnitValue(
  baseValue: number,
  units: BeamDisplayUnits,
  quantity: UnitQuantity
): number {
  const symbol = quantityUnitSymbol(units, quantity);
  const factor = UNIT_FACTOR_FROM_BASE[symbol] ?? 1;
  return baseValue * factor;
}

export function fromDisplayUnitValue(
  displayValue: number,
  units: BeamDisplayUnits,
  quantity: UnitQuantity
): number {
  const symbol = quantityUnitSymbol(units, quantity);
  const factor = UNIT_FACTOR_FROM_BASE[symbol] ?? 1;
  if (factor === 0) return displayValue;
  return displayValue / factor;
}

export function formatEngineeringNumber(value: number, sig = 4) {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-3) return value.toExponential(3).replace("e+", "e");
  return Number(value.toPrecision(sig)).toString();
}

export function formatUnitNumber(
  baseValue: number,
  units: BeamDisplayUnits,
  quantity: UnitQuantity,
  sig = 4
) {
  const displayValue = toDisplayUnitValue(baseValue, units, quantity);
  return formatEngineeringNumber(displayValue, sig);
}

export function formatUnitValue(
  baseValue: number,
  units: BeamDisplayUnits,
  quantity: UnitQuantity,
  sig = 4
) {
  const symbol = quantityUnitSymbol(units, quantity);
  return `${formatUnitNumber(baseValue, units, quantity, sig)} ${symbol}`;
}

export function formatUnitLabelForLatex(symbol: string) {
  return symbol
    .replaceAll("·", "\\cdot ")
    .replaceAll("^", "^{")
    .replace(/(\^\{)([0-9])$/g, "$1$2}")
    .replaceAll("/", "/");
}

export function parseEngineeringInput(raw: string, unitSymbol?: string): number | null {
  const trimmed = raw.trim().replaceAll(",", "");
  if (!trimmed) return null;
  const withoutUnit = unitSymbol ? cleanUnitSymbolText(trimmed, unitSymbol) : trimmed;
  const cleaned = withoutUnit.trim().replaceAll("−", "-").replaceAll("μ", "µ");
  if (!cleaned) return null;

  const num = Number(cleaned);
  if (Number.isFinite(num)) return num;

  const match = cleaned.match(
    /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*([kKmMgGuUnNpPµ])$/
  );
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = match[2];
  const factorMap: Record<string, number> = {
    k: 1e3,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    m: 1e-3,
    u: 1e-6,
    U: 1e-6,
    µ: 1e-6,
    n: 1e-9,
    N: 1e-9,
    p: 1e-12,
    P: 1e-12,
    g: 1e9,
  };
  const factor = factorMap[suffix];
  if (!toFinite(factor)) return null;
  return base * factor;
}
