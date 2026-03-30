export type ToolCategoryId = "solid" | "fluids" | "thermo" | "materials" | "math" | "utils" | "electrical" | "civil";
export type ToolEngineType = "rich" | "mvp";

export type ToolMeta = {
  slug: string;
  name: string;
  description: string;
  categoryId: ToolCategoryId;
  tags: string[];
  available: boolean;
  engineType: ToolEngineType;
  specId: string;
};

type RawToolMeta = {
  slug: string;
  name: string;
  description: string;
  categoryId: ToolCategoryId;
  tags: string[];
  specId?: string;
};

const RAW_TOOLS: RawToolMeta[] = [
  {
    slug: "beam-bending",
    name: "Beam Bending",
    description: "Reactions, SFD/BMD, deflection curve, and worked steps.",
    categoryId: "solid",
    tags: ["Euler-Bernoulli", "SFD", "BMD", "Deflection"],
  },
  {
    slug: "torsion-calculator",
    name: "Torsion Calculator",
    description: "Shaft shear stress, angle of twist, and torsional rigidity.",
    categoryId: "solid",
    tags: ["Shafts", "Shear Stress", "Twist", "Polar Moment"],
  },
  {
    slug: "stress-transformation-mohrs-circle",
    name: "Stress Transformation (Mohr's Circle)",
    description: "Principal stresses, principal planes, and max shear via Mohr's circle.",
    categoryId: "solid",
    tags: ["Mohr's Circle", "Principal Stress", "Shear", "Plane Stress"],
  },
  {
    slug: "column-buckling",
    name: "Column Buckling",
    description: "Euler buckling load, slenderness, and end-condition effects.",
    categoryId: "solid",
    tags: ["Euler", "Slenderness", "Critical Load", "Columns"],
  },
  {
    slug: "reynolds-number",
    name: "Reynolds Number",
    description: "Flow regime classification from velocity, length scale, and viscosity.",
    categoryId: "fluids",
    tags: ["Laminar", "Turbulent", "Dimensionless", "Flow Regime"],
  },
  {
    slug: "pipe-pressure-drop",
    name: "Pipe Pressure Drop",
    description: "Major/minor losses, friction factor, and total pressure drop.",
    categoryId: "fluids",
    tags: ["Darcy-Weisbach", "Head Loss", "Friction Factor", "Pipes"],
  },
  {
    slug: "pump-power-calculator",
    name: "Pump Power Calculator",
    description: "Hydraulic power, shaft power, and efficiency-based sizing.",
    categoryId: "fluids",
    tags: ["Hydraulic Power", "Efficiency", "Head", "Flow Rate"],
  },
  {
    slug: "ideal-gas-law",
    name: "Ideal Gas Law",
    description: "Solve PV = nRT for pressure, volume, moles, or temperature.",
    categoryId: "thermo",
    tags: ["PV=nRT", "State Variables", "Gas Constant", "Thermo Basics"],
  },
  {
    slug: "heat-transfer-conduction",
    name: "Heat Transfer (Conduction)",
    description: "Steady 1D conduction through plane walls and composite layers.",
    categoryId: "thermo",
    tags: ["Fourier's Law", "Thermal Resistance", "k-Value", "Heat Flux"],
  },
  {
    slug: "heat-exchanger-sizing",
    name: "Heat Exchanger Sizing",
    description: "LMTD/epsilon-NTU based preliminary exchanger sizing.",
    categoryId: "thermo",
    tags: ["LMTD", "NTU", "UA", "Effectiveness"],
  },
  {
    slug: "material-property-database",
    name: "Material Property Database",
    description: "Searchable reference for key mechanical and thermal properties.",
    categoryId: "materials",
    tags: ["E", "Yield Strength", "Density", "Thermal Conductivity"],
  },
  {
    slug: "safety-factor-calculator",
    name: "Safety Factor Calculator",
    description: "Factor of safety and margin calculations from stress/strength inputs.",
    categoryId: "materials",
    tags: ["FoS", "Allowable Stress", "Margin", "Design Check"],
  },
  {
    slug: "matrix-solver",
    name: "Matrix Solver",
    description: "Solve linear systems, determinant, inverse, and decomposition outputs.",
    categoryId: "math",
    tags: ["Linear Algebra", "Gaussian Elimination", "Determinant", "Inverse"],
  },
  {
    slug: "polynomial-solver",
    name: "Polynomial Solver",
    description: "Roots of polynomial equations with real/complex root reporting.",
    categoryId: "math",
    tags: ["Roots", "Algebra", "Complex Numbers", "Equation Solver"],
  },
  {
    slug: "unit-converter",
    name: "Unit Converter",
    description: "Engineering unit conversions across SI and imperial systems.",
    categoryId: "math",
    tags: ["SI", "Imperial", "Conversion", "Dimensions"],
  },
  {
    slug: "engineering-constants",
    name: "Engineering Constants",
    description: "Reference constants and standard values used in calculations.",
    categoryId: "utils",
    tags: ["Constants", "Reference", "Gravity", "Universal Values"],
  },
  {
    slug: "unit-conversions",
    name: "Unit Conversions",
    description: "Quick conversion shortcuts for the most common engineering quantities.",
    categoryId: "utils",
    tags: ["Quick Convert", "Length", "Pressure", "Temperature"],
  },
  {
    slug: "quick-plot-tool",
    name: "Quick Plot Tool",
    description: "Fast XY plotting for equations, datasets, and comparison curves.",
    categoryId: "utils",
    tags: ["Plot", "Curve", "Data Visualization", "XY"],
  },
  {
    slug: "section-properties",
    name: "Section Properties",
    description: "Area, centroid, second moment, section modulus, and radii of gyration.",
    categoryId: "solid",
    tags: ["Ixx", "Iyy", "Section Modulus", "Centroid"],
  },
  {
    slug: "combined-stress-check",
    name: "Combined Stress Check",
    description: "Evaluate von Mises, Tresca, and principal stress utilization in one pass.",
    categoryId: "solid",
    tags: ["von Mises", "Tresca", "Utilization", "Stress"],
  },
  {
    slug: "open-channel-flow",
    name: "Open Channel Flow",
    description: "Uniform flow depth/velocity using Manning and geometric section inputs.",
    categoryId: "fluids",
    tags: ["Manning", "Hydraulics", "Channel Flow", "Critical Depth"],
  },
  {
    slug: "compressible-flow",
    name: "Compressible Flow",
    description: "Isentropic relations, Mach conversions, and nozzle flow quantities.",
    categoryId: "fluids",
    tags: ["Mach", "Nozzles", "Isentropic", "Gas Dynamics"],
  },
  {
    slug: "steam-properties",
    name: "Steam Properties",
    description: "Saturated/superheated lookup helper with interpolated property outputs.",
    categoryId: "thermo",
    tags: ["Enthalpy", "Entropy", "Steam Tables", "Interpolation"],
  },
  {
    slug: "psychrometrics",
    name: "Psychrometrics",
    description: "Humidity ratio, dew point, enthalpy, and moist-air process plotting.",
    categoryId: "thermo",
    tags: ["HVAC", "Dew Point", "Humidity Ratio", "Moist Air"],
  },
  {
    slug: "fatigue-life-estimator",
    name: "Fatigue Life Estimator",
    description: "S-N based fatigue check with mean stress corrections and safety margins.",
    categoryId: "materials",
    tags: ["S-N Curve", "Goodman", "Endurance", "Cycles"],
  },
  {
    slug: "material-selection-matrix",
    name: "Material Selection Matrix",
    description: "Rank materials by weighted criteria across strength, cost, density, and thermal traits.",
    categoryId: "materials",
    tags: ["Trade Study", "Weighted Score", "Cost", "Performance"],
  },
  {
    slug: "ode-solver",
    name: "ODE Solver",
    description: "Numerical initial-value solver with RK methods and error controls.",
    categoryId: "math",
    tags: ["Runge-Kutta", "Differential Equations", "IVP", "Numerical Methods"],
  },
  {
    slug: "curve-fitting-regression",
    name: "Curve Fitting & Regression",
    description: "Linear/nonlinear regression with residual diagnostics and fit quality metrics.",
    categoryId: "math",
    tags: ["Regression", "Least Squares", "R2", "Residuals"],
  },
  {
    slug: "data-table-csv-tool",
    name: "Data Table CSV Tool",
    description: "Import CSV, compute derived columns, and push data into calculators.",
    categoryId: "utils",
    tags: ["CSV", "Data Prep", "Tabular", "Derived Fields"],
  },
  {
    slug: "equation-cheatsheet",
    name: "Equation Cheatsheet",
    description: "Searchable equation index with symbols, units, and assumptions.",
    categoryId: "utils",
    tags: ["Reference", "Formulas", "Units", "Assumptions"],
  },
  {
    slug: "ac-circuit-analyzer",
    name: "AC Circuit Analyzer",
    description: "Impedance, phasors, real/reactive power, and power factor calculations.",
    categoryId: "electrical",
    tags: ["Impedance", "Phasor", "Power Factor", "AC"],
  },
  {
    slug: "three-phase-power",
    name: "Three-Phase Power",
    description: "Line/phase relations, balanced load calculations, and motor load checks.",
    categoryId: "electrical",
    tags: ["3-Phase", "Line Voltage", "Power", "Motors"],
  },
  {
    slug: "cable-sizing-voltage-drop",
    name: "Cable Sizing & Voltage Drop",
    description: "Conductor sizing from ampacity and allowable voltage drop constraints.",
    categoryId: "electrical",
    tags: ["Ampacity", "Voltage Drop", "Conductors", "Sizing"],
  },
  {
    slug: "retaining-wall-check",
    name: "Retaining Wall Check",
    description: "Sliding, overturning, and bearing checks for conceptual retaining wall sizing.",
    categoryId: "civil",
    tags: ["Geotech", "Overturning", "Sliding", "Bearing"],
  },
  {
    slug: "concrete-mix-designer",
    name: "Concrete Mix Designer",
    description: "Preliminary concrete mix proportions and workability/strength balancing.",
    categoryId: "civil",
    tags: ["Concrete", "Mix Design", "Water-Cement Ratio", "Workability"],
  },
  {
    slug: "survey-traverse-adjustment",
    name: "Survey Traverse Adjustment",
    description: "Traverse closure, Bowditch adjustment, and coordinate balancing.",
    categoryId: "civil",
    tags: ["Surveying", "Traverse", "Coordinates", "Closure"],
  },
];

export const TOOLS: ToolMeta[] = RAW_TOOLS.map((tool) => ({
  ...tool,
  available: true,
  engineType: tool.slug === "beam-bending" || tool.slug === "polynomial-solver" ? "rich" : "mvp",
  specId: tool.specId ?? tool.slug,
}));
