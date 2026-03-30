export type UnitDimension =
  | "length"
  | "area"
  | "volume"
  | "mass"
  | "speed"
  | "pressure"
  | "temperature"
  | "force"
  | "energy"
  | "power"
  | "density";

const SCALAR_UNITS: Record<Exclude<UnitDimension, "temperature">, Record<string, number>> = {
  length: {
    m: 1,
    mm: 1e-3,
    cm: 1e-2,
    km: 1e3,
    in: 0.0254,
    ft: 0.3048,
    yd: 0.9144,
  },
  area: {
    "m^2": 1,
    "mm^2": 1e-6,
    "cm^2": 1e-4,
    "ft^2": 0.09290304,
    "in^2": 0.00064516,
  },
  volume: {
    "m^3": 1,
    L: 1e-3,
    mL: 1e-6,
    "ft^3": 0.0283168466,
    gal_us: 0.00378541178,
  },
  mass: {
    kg: 1,
    g: 1e-3,
    lb: 0.45359237,
    ton_metric: 1000,
  },
  speed: {
    "m/s": 1,
    "km/h": 1 / 3.6,
    mph: 0.44704,
    "ft/s": 0.3048,
  },
  pressure: {
    Pa: 1,
    kPa: 1e3,
    MPa: 1e6,
    bar: 1e5,
    psi: 6894.757293168,
    atm: 101325,
  },
  force: {
    N: 1,
    kN: 1e3,
    lbf: 4.4482216152605,
  },
  energy: {
    J: 1,
    kJ: 1e3,
    Wh: 3600,
    kWh: 3.6e6,
    BTU: 1055.05585262,
  },
  power: {
    W: 1,
    kW: 1e3,
    hp: 745.699871582,
  },
  density: {
    "kg/m^3": 1,
    "g/cm^3": 1000,
    "lb/ft^3": 16.01846337396,
  },
};

const TEMPERATURE_UNITS = ["C", "F", "K", "R"] as const;
type TemperatureUnit = (typeof TEMPERATURE_UNITS)[number];

export function listDimensions(): UnitDimension[] {
  return [
    "length",
    "area",
    "volume",
    "mass",
    "speed",
    "pressure",
    "temperature",
    "force",
    "energy",
    "power",
    "density",
  ];
}

export function listUnits(dimension: UnitDimension): string[] {
  if (dimension === "temperature") return [...TEMPERATURE_UNITS];
  return Object.keys(SCALAR_UNITS[dimension]);
}

function toKelvin(value: number, unit: TemperatureUnit) {
  if (unit === "K") return value;
  if (unit === "C") return value + 273.15;
  if (unit === "F") return ((value - 32) * 5) / 9 + 273.15;
  return (value * 5) / 9;
}

function fromKelvin(value: number, unit: TemperatureUnit) {
  if (unit === "K") return value;
  if (unit === "C") return value - 273.15;
  if (unit === "F") return ((value - 273.15) * 9) / 5 + 32;
  return (value * 9) / 5;
}

export function convertUnit(dimension: UnitDimension, value: number, fromUnit: string, toUnit: string): number {
  if (!Number.isFinite(value)) throw new Error("Value must be finite for conversion.");

  if (dimension === "temperature") {
    if (!TEMPERATURE_UNITS.includes(fromUnit as TemperatureUnit) || !TEMPERATURE_UNITS.includes(toUnit as TemperatureUnit)) {
      throw new Error("Invalid temperature units.");
    }
    const kelvin = toKelvin(value, fromUnit as TemperatureUnit);
    return fromKelvin(kelvin, toUnit as TemperatureUnit);
  }

  const map = SCALAR_UNITS[dimension];
  const from = map[fromUnit];
  const to = map[toUnit];
  if (!from || !to) throw new Error(`Invalid units for ${dimension}.`);
  return (value * from) / to;
}

export type QuickConversionPreset = {
  id: string;
  label: string;
  dimension: UnitDimension;
  fromUnit: string;
  toUnit: string;
};

export const QUICK_CONVERSION_PRESETS: QuickConversionPreset[] = [
  { id: "m_to_ft", label: "m -> ft", dimension: "length", fromUnit: "m", toUnit: "ft" },
  { id: "ft_to_m", label: "ft -> m", dimension: "length", fromUnit: "ft", toUnit: "m" },
  { id: "mm_to_in", label: "mm -> in", dimension: "length", fromUnit: "mm", toUnit: "in" },
  { id: "in_to_mm", label: "in -> mm", dimension: "length", fromUnit: "in", toUnit: "mm" },
  { id: "kpa_to_psi", label: "kPa -> psi", dimension: "pressure", fromUnit: "kPa", toUnit: "psi" },
  { id: "psi_to_kpa", label: "psi -> kPa", dimension: "pressure", fromUnit: "psi", toUnit: "kPa" },
  { id: "c_to_f", label: "C -> F", dimension: "temperature", fromUnit: "C", toUnit: "F" },
  { id: "f_to_c", label: "F -> C", dimension: "temperature", fromUnit: "F", toUnit: "C" },
  { id: "kw_to_hp", label: "kW -> hp", dimension: "power", fromUnit: "kW", toUnit: "hp" },
  { id: "hp_to_kw", label: "hp -> kW", dimension: "power", fromUnit: "hp", toUnit: "kW" },
];

export function runQuickPreset(presetId: string, value: number) {
  const preset = QUICK_CONVERSION_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error("Unknown quick conversion preset.");
  return {
    preset,
    result: convertUnit(preset.dimension, value, preset.fromUnit, preset.toUnit),
  };
}
