export type MaterialRow = {
  name: string;
  category: string;
  density: number;
  youngsModulusGPa: number;
  yieldStrengthMPa: number;
  thermalConductivity: number;
  relativeCost: number;
};

export const MATERIAL_ROWS: MaterialRow[] = [
  { name: "Carbon Steel", category: "Metal", density: 7850, youngsModulusGPa: 210, yieldStrengthMPa: 250, thermalConductivity: 50, relativeCost: 2.2 },
  { name: "Stainless Steel 304", category: "Metal", density: 8000, youngsModulusGPa: 193, yieldStrengthMPa: 215, thermalConductivity: 16, relativeCost: 4.0 },
  { name: "Aluminum 6061-T6", category: "Metal", density: 2700, youngsModulusGPa: 69, yieldStrengthMPa: 276, thermalConductivity: 167, relativeCost: 3.0 },
  { name: "Titanium Ti-6Al-4V", category: "Metal", density: 4430, youngsModulusGPa: 114, yieldStrengthMPa: 880, thermalConductivity: 7, relativeCost: 12.0 },
  { name: "Copper", category: "Metal", density: 8960, youngsModulusGPa: 110, yieldStrengthMPa: 70, thermalConductivity: 400, relativeCost: 5.0 },
  { name: "Brass", category: "Metal", density: 8500, youngsModulusGPa: 100, yieldStrengthMPa: 200, thermalConductivity: 120, relativeCost: 4.5 },
  { name: "Cast Iron", category: "Metal", density: 7200, youngsModulusGPa: 120, yieldStrengthMPa: 130, thermalConductivity: 55, relativeCost: 2.4 },
  { name: "Concrete (normal)", category: "Ceramic", density: 2400, youngsModulusGPa: 30, yieldStrengthMPa: 30, thermalConductivity: 1.7, relativeCost: 1.3 },
  { name: "Glulam Timber", category: "Composite", density: 500, youngsModulusGPa: 11, yieldStrengthMPa: 24, thermalConductivity: 0.13, relativeCost: 2.0 },
  { name: "GFRP", category: "Composite", density: 1900, youngsModulusGPa: 45, yieldStrengthMPa: 350, thermalConductivity: 0.3, relativeCost: 6.0 },
];

export type ConstantRow = {
  name: string;
  symbol: string;
  value: string;
  units: string;
  note: string;
};

export const ENGINEERING_CONSTANTS: ConstantRow[] = [
  { name: "Standard gravity", symbol: "g", value: "9.80665", units: "m/s^2", note: "Standard Earth gravity" },
  { name: "Universal gas constant", symbol: "R", value: "8.314462618", units: "J/(mol*K)", note: "Ideal gas law constant" },
  { name: "Stefan-Boltzmann constant", symbol: "sigma", value: "5.670374419e-8", units: "W/(m^2*K^4)", note: "Black-body radiation" },
  { name: "Boltzmann constant", symbol: "k_B", value: "1.380649e-23", units: "J/K", note: "Microscopic thermal scale" },
  { name: "Avogadro constant", symbol: "N_A", value: "6.02214076e23", units: "1/mol", note: "Particles per mole" },
  { name: "Vacuum permittivity", symbol: "epsilon_0", value: "8.8541878128e-12", units: "F/m", note: "Electromagnetics" },
  { name: "Vacuum permeability", symbol: "mu_0", value: "1.25663706212e-6", units: "N/A^2", note: "Electromagnetics" },
  { name: "Speed of light", symbol: "c", value: "299792458", units: "m/s", note: "Exact SI definition" },
  { name: "Planck constant", symbol: "h", value: "6.62607015e-34", units: "J*s", note: "Quantum mechanics" },
  { name: "Water density (20 C)", symbol: "rho_w", value: "998.2", units: "kg/m^3", note: "Fresh water reference" },
  { name: "Water dynamic viscosity (20 C)", symbol: "mu_w", value: "1.002e-3", units: "Pa*s", note: "Fresh water reference" },
  { name: "Air density (sea level)", symbol: "rho_air", value: "1.225", units: "kg/m^3", note: "ISA standard" },
  { name: "Air dynamic viscosity (15 C)", symbol: "mu_air", value: "1.81e-5", units: "Pa*s", note: "Approximate" },
  { name: "Earth atmospheric pressure", symbol: "p_atm", value: "101325", units: "Pa", note: "Standard atmosphere" },
];

export type EquationRow = {
  topic: string;
  name: string;
  equation: string;
  symbols: string;
  assumptions: string;
};

export const EQUATION_ROWS: EquationRow[] = [
  { topic: "Mechanics", name: "Axial stress", equation: "sigma = P / A", symbols: "P: force, A: area", assumptions: "Uniform axial loading" },
  { topic: "Mechanics", name: "Bending stress", equation: "sigma = M*y / I", symbols: "M: moment, y: fiber distance", assumptions: "Linear elastic bending" },
  { topic: "Mechanics", name: "Torsion shear", equation: "tau = T*r / J", symbols: "T: torque, r: radius", assumptions: "Circular shaft" },
  { topic: "Mechanics", name: "Euler buckling", equation: "Pcr = pi^2 E I / (K L)^2", symbols: "K: effective length factor", assumptions: "Slender elastic column" },
  { topic: "Fluids", name: "Reynolds number", equation: "Re = rho v L / mu", symbols: "rho: density, mu: viscosity", assumptions: "Characteristic length defined" },
  { topic: "Fluids", name: "Darcy-Weisbach", equation: "dp = f (L/D) rho v^2 / 2", symbols: "f: friction factor", assumptions: "Fully developed internal flow" },
  { topic: "Fluids", name: "Bernoulli", equation: "p/rho g + v^2/2g + z = const", symbols: "z: elevation head", assumptions: "Steady incompressible inviscid" },
  { topic: "Thermo", name: "Ideal gas law", equation: "P V = n R T", symbols: "n: moles", assumptions: "Ideal gas behavior" },
  { topic: "Thermo", name: "Conduction (1D)", equation: "q = k A (Th - Tc) / L", symbols: "k: conductivity", assumptions: "Steady 1D" },
  { topic: "Thermo", name: "LMTD", equation: "Q = U A DeltaTlm", symbols: "DeltaTlm: log-mean dT", assumptions: "Steady exchanger" },
  { topic: "Electrical", name: "Ohm's law", equation: "V = I R", symbols: "V: voltage", assumptions: "Linear resistor" },
  { topic: "Electrical", name: "AC apparent power", equation: "S = V I", symbols: "S: VA", assumptions: "Single-phase rms values" },
  { topic: "Electrical", name: "3-phase real power", equation: "P = sqrt(3) V_L I_L pf", symbols: "pf: power factor", assumptions: "Balanced 3-phase" },
  { topic: "Math", name: "Linear regression slope", equation: "m = cov(x,y) / var(x)", symbols: "m: slope", assumptions: "Least-squares linear fit" },
];

export type SteamSaturationRow = {
  tC: number;
  pKPa: number;
  hf: number;
  hfg: number;
  sf: number;
  sfg: number;
  vf: number;
  vg: number;
};

export const STEAM_SATURATION_ROWS: SteamSaturationRow[] = [
  { tC: 0, pKPa: 0.611, hf: 0.0, hfg: 2500.9, sf: 0.0, sfg: 9.157, vf: 0.001000, vg: 206.0 },
  { tC: 20, pKPa: 2.339, hf: 83.9, hfg: 2454.0, sf: 0.296, sfg: 8.666, vf: 0.001002, vg: 57.8 },
  { tC: 40, pKPa: 7.385, hf: 167.5, hfg: 2407.0, sf: 0.572, sfg: 8.266, vf: 0.001008, vg: 19.5 },
  { tC: 60, pKPa: 19.946, hf: 251.1, hfg: 2358.0, sf: 0.831, sfg: 7.908, vf: 0.001017, vg: 7.67 },
  { tC: 80, pKPa: 47.416, hf: 334.9, hfg: 2308.0, sf: 1.075, sfg: 7.580, vf: 0.001029, vg: 3.44 },
  { tC: 100, pKPa: 101.325, hf: 419.1, hfg: 2257.0, sf: 1.307, sfg: 7.355, vf: 0.001043, vg: 1.694 },
  { tC: 120, pKPa: 198.67, hf: 504.7, hfg: 2201.0, sf: 1.531, sfg: 7.042, vf: 0.001060, vg: 0.891 },
  { tC: 140, pKPa: 361.53, hf: 591.8, hfg: 2133.0, sf: 1.745, sfg: 6.749, vf: 0.001080, vg: 0.506 },
  { tC: 160, pKPa: 618.23, hf: 681.0, hfg: 2058.0, sf: 1.952, sfg: 6.466, vf: 0.001102, vg: 0.315 },
  { tC: 180, pKPa: 1014.2, hf: 763.0, hfg: 2015.0, sf: 2.138, sfg: 6.283, vf: 0.001127, vg: 0.194 },
  { tC: 200, pKPa: 1554.9, hf: 852.0, hfg: 1947.0, sf: 2.307, sfg: 6.062, vf: 0.001157, vg: 0.127 },
];
