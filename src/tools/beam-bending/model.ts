// src/tools/beam-bending/model.ts

export type SupportType =
  | "simply_supported"
  | "cantilever"
  | "fixed_fixed"
  | "propped_cantilever";

export type SupportRestraintType = "pinned" | "fixed";

export type BeamTheory = "euler_bernoulli" | "timoshenko";

export type DisplayUnitSystem = "si_base" | "engineering_metric";

export type BeamDisplayUnits = {
  system: DisplayUnitSystem;
  force: "N" | "kN";
  length: "m" | "mm";
  moment: "N·m" | "kN·m";
  distributedLoad: "N/m" | "kN/m";
  stress: "Pa" | "MPa";
  modulus: "Pa" | "GPa";
  inertia: "m^4" | "mm^4" | "cm^4";
  rotation: "rad" | "mrad" | "deg";
  area: "m^2" | "cm^2" | "mm^2";
  sectionModulus: "m^3" | "cm^3" | "mm^3";
  springLinear: "N/m" | "kN/m";
  springRotational: "N·m/rad" | "kN·m/rad";
  deflection: "m" | "mm";
};

export type StandardLoadCategory =
  | "dead"
  | "live"
  | "variable"
  | "thermal"
  | "construction"
  | "custom";

export type LoadCategoryRef = StandardLoadCategory | string;

export type LoadCategoryDefinition = {
  id: string;
  name: string;
  active?: boolean;
  note?: string;
};

export type LoadMetadata = {
  name?: string;
  locked?: boolean;
  hidden?: boolean;
  notes?: string;
  tags?: string[];
  category?: LoadCategoryRef;
  caseId?: string;
  uncertaintyPercent?: number;
  generatedBy?: "self_weight";
};

export type PointLoad = LoadMetadata & {
  id: string;
  type: "point_load";
  x: number;
  P: number; // N (downward positive)
};

export type UDL = LoadMetadata & {
  id: string;
  type: "udl";
  x1: number;
  x2: number;
  w: number; // N/m
};

export type LinearDistributedLoad = LoadMetadata & {
  id: string;
  type: "linear_dist";
  x1: number;
  x2: number;
  w1: number; // N/m at x1
  w2: number; // N/m at x2
};

export type PointMoment = LoadMetadata & {
  id: string;
  type: "moment";
  x: number;
  M: number; // N*m
};

export type ThermalGradientLoad = LoadMetadata & {
  id: string;
  type: "thermal";
  x1: number;
  x2: number;
  alpha: number; // 1/K
  dT: number; // K (top-bottom gradient proxy)
  depth: number; // m
};

export type PrestrainCurvatureLoad = LoadMetadata & {
  id: string;
  type: "prestrain";
  x1: number;
  x2: number;
  kappa0: number; // 1/m
};

export type Load =
  | PointLoad
  | UDL
  | LinearDistributedLoad
  | PointMoment
  | ThermalGradientLoad
  | PrestrainCurvatureLoad;

export type StiffnessSegment = {
  id: string;
  x1: number;
  x2: number;
  label?: string;
  note?: string;
  materialPresetId?: MaterialPresetId | "custom";
  material?: MaterialDefinition;
  section?: SectionDefinition;
  E?: number; // Pa
  I?: number; // m^4
  A?: number; // m^2
  G?: number; // Pa
  kappaShear?: number; // shear correction factor
};

export type SupportStation = {
  id: string;
  x: number; // m from beam left end
  restraint: SupportRestraintType;
  active?: boolean;
  label?: string;
  note?: string;
  settlement?: number; // m
  imposedRotation?: number; // rad
  verticalSpring?: number; // N/m
  rotationalSpring?: number; // N*m/rad
};

export type SupportLayout = {
  stations: SupportStation[];
  note?: string;
};

export type SupportConditions = {
  leftSettlement?: number; // m
  rightSettlement?: number; // m
  leftRotation?: number; // rad
  rightRotation?: number; // rad
  leftVerticalSpring?: number; // N/m
  rightVerticalSpring?: number; // N/m
  leftRotationalSpring?: number; // N*m/rad
  rightRotationalSpring?: number; // N*m/rad
};

export type InternalRelease = {
  id: string;
  x: number;
  type: "moment";
  active?: boolean;
  label?: string;
  note?: string;
};

export type LoadCase = {
  id: string;
  name: string;
  category?: LoadCategoryRef;
  active?: boolean;
  note?: string;
  loads: Load[];
};

export type LoadCombination = {
  id: string;
  name: string;
  category?: "ULS" | "SLS" | "custom";
  active?: boolean;
  note?: string;
  terms: Array<{
    caseId: string;
    factor: number;
    active?: boolean;
    note?: string;
  }>;
};

export type EnvelopeDefinition = {
  id: string;
  name: string;
  combinationIds: string[];
  active?: boolean;
  note?: string;
};

export type SensitivityInputs = {
  EPercent?: number;
  IPercent?: number;
  loadPercent?: number;
};

export type MaterialPresetId = "steel_s275" | "steel_s355" | "aluminium_6061_t6" | "timber_glulam_gl24";

export type MaterialDefinition = {
  id: MaterialPresetId | "custom";
  name?: string;
  E: number;
  nu?: number;
  density?: number;
  yieldStress?: number;
};

export type MovingLoadTrain = {
  enabled: boolean;
  name?: string;
  templateId?: string;
  templateType?: "vehicle" | "train" | "custom";
  axleLoads: number[]; // N
  axleSpacings: number[]; // m, length = axleLoads.length - 1
  step?: number; // m
  playbackSpeed?: number; // lead-position units per second (UI animation hint)
};

export type MovingLoadTemplate = {
  id: string;
  name: string;
  type?: "vehicle" | "train" | "custom";
  axleLoads: number[]; // N
  axleSpacings: number[]; // m
  note?: string;
};

export type AnalysisOptions = {
  meshDensity?: "coarse" | "normal" | "fine";
  adaptiveRefinement?: boolean;
  debounceMs?: number;
};

export type DesignCriteria = {
  allowableBendingStress?: number; // Pa
  allowableShearStress?: number; // Pa
  deflectionLimitRatio?: number;
};

export type SectionLibraryId =
  | "rectangular"
  | "circular_solid"
  | "circular_hollow"
  | "i_beam"
  | "channel";

export type SectionDefinition = {
  id: SectionLibraryId;
  unit: "m" | "mm";
  dims: Record<string, number>;
};

export type BeamBendingInputs = {
  support: SupportType;
  theory?: BeamTheory;
  displayUnits?: BeamDisplayUnits;
  L: number;
  E: number;
  I: number;
  A?: number;
  G?: number;
  nu?: number;
  kappaShear?: number;
  serviceabilityLimitRatio?: number;
  material?: MaterialDefinition;

  section?: SectionDefinition;
  stiffnessSegments?: StiffnessSegment[];
  supportConditions?: SupportConditions;
  movingLoad?: MovingLoadTrain;
  movingLoadTemplates?: MovingLoadTemplate[];
  analysisOptions?: AnalysisOptions;
  designCriteria?: DesignCriteria;

  loads: Load[];
  supportLayout?: SupportLayout;
  internalReleases?: InternalRelease[];
  loadCategories?: LoadCategoryDefinition[];
  loadCases?: LoadCase[];
  loadCombinations?: LoadCombination[];
  envelopeDefinitions?: EnvelopeDefinition[];

  uncertainty?: SensitivityInputs;
};

export type CriticalPoint = {
  x: number;
  label: string;
  V: number;
  M: number;
  y: number;
  sigma?: number;
  tau?: number;
};

export type EnvelopePoint = {
  x: number;
  Vmax: number;
  Vmin: number;
  Mmax: number;
  Mmin: number;
  ymax: number;
  ymin: number;
};

export type CombinationSummary = {
  id: string;
  name: string;
  category?: string;
  MabsMax: number;
  xAtMabsMax: number;
  yAbsMax: number;
  xAtYAbsMax: number;
  VabsMax: number;
  xAtVabsMax: number;
  utilization?: number;
  pass?: boolean;
  governingMode?: "bending" | "shear" | "deflection";
  governingX?: number;
};

export type InfluenceLinePoint = {
  xLoad: number;
  R1?: number;
  R2?: number;
  MxRef: number;
  VxRef: number;
};

export type StressOutputs = {
  sigmaMax: number; // Pa
  tauAvgMax: number; // Pa
  tauMaxEstimate: number; // Pa
  sectionModulus: number; // m^3
};

export type DesignCheckOutputs = {
  bendingUtilization?: number;
  shearUtilization?: number;
  deflectionUtilization: number;
  pass: boolean;
  governingMode: "bending" | "shear" | "deflection";
};

export type SensitivityOutputs = {
  dMabsFromEPercent: number;
  dYabsFromEPercent: number;
  dMabsFromIPercent: number;
  dYabsFromIPercent: number;
  dMabsFromLoadPercent: number;
  dYabsFromLoadPercent: number;
};

export type ExplainabilityEntry = {
  loadId: string;
  loadType: Load["type"];
  dMAtGoverningX: number;
  dVAtGoverningX: number;
  contributionPctOfM: number;
};

export type MovingLoadCritical = {
  leadPosition: number;
  MabsMax: number;
  VabsMax: number;
  scanStep?: number;
  templateName?: string;
};

export type RotationExtremum = {
  x: number;
  theta: number;
  kind: "max" | "min" | "absmax";
};

export type SupportRotation = {
  supportId: string;
  x: number;
  restraint: SupportRestraintType;
  theta: number;
};

export type QualityMetrics = {
  meshPoints: number;
  adaptiveRefinementActive: boolean;
  estimatedComputeClass: "light" | "medium" | "heavy";
  meshSensitivityRatio?: number;
  equilibriumScore?: number;
  warningPenalty?: number;
  confidenceSubscores?: {
    equilibrium: number;
    mesh: number;
    applicability: number;
    modelCompleteness: number;
    warningBurden: number;
  };
  confidenceDrivers?: string[];
  confidenceScore?: number;
  confidenceBadge?: "high" | "medium" | "low";
};

export type WarningSeverity = "info" | "warning" | "critical";

export type WarningDetail = {
  id: string;
  severity: WarningSeverity;
  trigger: string;
  consequence: string;
  mitigation: string;
};

export type AssumptionsProfile = {
  linearElastic: string;
  smallDeflection: string;
  idealization: string;
  beamTheory: string;
  shearDeformation: string;
  supportIdealization: string;
  propertyVariation: string;
  thermalPrestrainModel: string;
  exclusions: string[];
};

export type SolveAuditRecord = {
  timestamp: string;
  inputHash: string;
  modelVersion: string;
  solverVersion: string;
  beamTheory: BeamTheory;
  unitSystem: DisplayUnitSystem;
  meshPolicy: "coarse" | "normal" | "fine";
  adaptiveRefinement: boolean;
  warningSet: string[];
  confidenceSubscores: {
    equilibrium: number;
    mesh: number;
    applicability: number;
    modelCompleteness: number;
    warningBurden: number;
  };
};

export type BeamBendingOutputs = {
  reactions: Record<string, number>;

  Mmax: number;
  xMmax: number;
  Mmin: number;
  xMmin: number;
  MabsMax: number;
  xAtMabsMax: number;

  yMaxDown: number;
  xAtYMaxDown: number;
  yMaxUp: number;
  xAtYMaxUp: number;
  yAbsMax: number;
  xAtYAbsMax: number;

  VabsMax: number;
  xAtVabsMax: number;
  thetaAbsMax?: number;
  xAtThetaAbsMax?: number;
  rotationExtrema?: RotationExtremum[];
  supportRotations?: SupportRotation[];

  serviceability: {
    limitRatio: number;
    actualRatio: number;
    passes: boolean;
  };

  equilibriumResiduals: {
    force: number;
    momentAboutLeft: number;
  };

  stress?: StressOutputs;
  designChecks?: DesignCheckOutputs;
  sensitivity?: SensitivityOutputs;
  validityWarnings: string[];
  warningDetails?: WarningDetail[];
  assumptions?: AssumptionsProfile;
  explainability?: ExplainabilityEntry[];

  combinations?: CombinationSummary[];
  envelope?: EnvelopePoint[];
  envelopeMeta?: {
    id?: string;
    name?: string;
    combinationIds: string[];
    criticalCombinationId?: string;
    criticalCombinationName?: string;
  };
  influenceLine?: InfluenceLinePoint[];
  movingLoadCritical?: MovingLoadCritical;
  quality?: QualityMetrics;
  solveAudit?: SolveAuditRecord;

  criticalPoints: CriticalPoint[];
};

export type BeamBendingPlots = {
  sfd: { x: number; V: number }[];
  bmd: { x: number; M: number }[];
  deflection: { x: number; y: number }[];
  rotation: { x: number; theta: number }[];
};
