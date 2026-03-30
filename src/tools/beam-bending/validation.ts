import type {
  BeamBendingInputs,
  EnvelopeDefinition,
  Load,
  LoadCategoryDefinition,
  LoadCase,
  LoadCombination,
  SupportStation,
  StiffnessSegment,
} from "./model";
import { getSectionDimensionIssues } from "./sections";
import { getDisplayUnitsIssues } from "./units";

function finitePositive(v: number) {
  return Number.isFinite(v) && v > 0;
}

function finite(v: number) {
  return Number.isFinite(v);
}

const BUILT_IN_LOAD_CATEGORIES = ["dead", "live", "variable", "thermal", "construction", "custom"] as const;

function normalizeCategoryId(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function validateSpanRange(id: string, x1: number, x2: number, L: number, issues: string[]) {
  if (!finite(x1) || !finite(x2)) {
    issues.push(`${id}: x1 and x2 must be finite numbers.`);
    return;
  }
  if (x1 < 0 || x2 < 0 || x1 > L || x2 > L) {
    issues.push(`${id}: x1 and x2 must be within [0, L].`);
  }
  if (x2 <= x1) {
    issues.push(`${id}: x2 must be greater than x1.`);
  }
}

function validateStiffnessSegments(segments: StiffnessSegment[], L: number, issues: string[]) {
  const seen = new Set<string>();
  for (const s of segments) {
    if (!s.id.trim()) issues.push("Stiffness segment id cannot be empty.");
    if (seen.has(s.id)) issues.push(`Duplicate stiffness segment id: ${s.id}.`);
    seen.add(s.id);
    validateSpanRange(`Stiffness ${s.id}`, s.x1, s.x2, L, issues);
    if (s.E !== undefined && !finitePositive(s.E)) issues.push(`Stiffness ${s.id}: E must be > 0.`);
    if (s.I !== undefined && !finitePositive(s.I)) issues.push(`Stiffness ${s.id}: I must be > 0.`);
    if (s.A !== undefined && !finitePositive(s.A)) issues.push(`Stiffness ${s.id}: A must be > 0.`);
    if (s.G !== undefined && !finitePositive(s.G)) issues.push(`Stiffness ${s.id}: G must be > 0.`);
    if (s.kappaShear !== undefined && !finitePositive(s.kappaShear)) {
      issues.push(`Stiffness ${s.id}: shear correction factor must be > 0.`);
    }
    if (s.section) {
      for (const sectionIssue of getSectionDimensionIssues(s.section)) {
        issues.push(`Stiffness ${s.id}: ${sectionIssue}`);
      }
    }
    if (s.material) {
      if (!finitePositive(s.material.E)) issues.push(`Stiffness ${s.id}: material E must be > 0.`);
      if (s.material.nu !== undefined && (!finite(s.material.nu) || s.material.nu <= -0.49 || s.material.nu >= 0.49)) {
        issues.push(`Stiffness ${s.id}: material nu must be between -0.49 and 0.49.`);
      }
      if (s.material.yieldStress !== undefined && !finitePositive(s.material.yieldStress)) {
        issues.push(`Stiffness ${s.id}: material yield stress must be > 0.`);
      }
    }
  }

  const sorted = [...segments].sort((a, b) => a.x1 - b.x1);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const current = sorted[i];
    if (current.x1 < prev.x2 - 1e-9) {
      issues.push(`Stiffness segments overlap: ${prev.id} and ${current.id}.`);
    }
  }
}

function activeStations(inp: BeamBendingInputs): SupportStation[] {
  return (inp.supportLayout?.stations ?? [])
    .filter((s) => s.active !== false)
    .slice()
    .sort((a, b) => a.x - b.x);
}

function validateSupportLayout(inp: BeamBendingInputs, issues: string[]) {
  const stations = activeStations(inp);
  if (stations.length === 0) return;
  if (
    inp.supportConditions?.leftVerticalSpring !== undefined ||
    inp.supportConditions?.rightVerticalSpring !== undefined ||
    inp.supportConditions?.leftRotationalSpring !== undefined ||
    inp.supportConditions?.rightRotationalSpring !== undefined
  ) {
    issues.push("End support spring controls are not supported while explicit support stations are active.");
  }

  const seenIds = new Set<string>();
  const seenX = new Set<string>();
  for (const station of stations) {
    if (!station.id.trim()) issues.push("Support station id cannot be empty.");
    if (seenIds.has(station.id)) issues.push(`Duplicate support station id: ${station.id}.`);
    seenIds.add(station.id);
    if (!finite(station.x) || station.x < 0 || station.x > inp.L) {
      issues.push(`Support station ${station.id}: x must be within [0, L].`);
    }
    const xKey = station.x.toFixed(9);
    if (seenX.has(xKey)) issues.push(`Support station ${station.id}: duplicate support position at x=${station.x}.`);
    seenX.add(xKey);
    if (station.settlement !== undefined && !finite(station.settlement)) {
      issues.push(`Support station ${station.id}: settlement must be finite.`);
    }
    if (station.imposedRotation !== undefined && !finite(station.imposedRotation)) {
      issues.push(`Support station ${station.id}: imposed rotation must be finite.`);
    }
    if (station.verticalSpring !== undefined) {
      issues.push(
        `Support station ${station.id}: station-level vertical springs are not yet supported for arbitrary support layouts. Use end support spring controls instead.`
      );
    }
    if (station.rotationalSpring !== undefined) {
      issues.push(
        `Support station ${station.id}: station-level rotational springs are not yet supported for arbitrary support layouts. Use end support spring controls instead.`
      );
    }
  }

  if (inp.support !== "simply_supported") {
    issues.push(
      `${inp.support.replaceAll(
        "_",
        " "
      )}: explicit support-station layouts are not yet supported. Use default end supports for this support model.`
    );
    return;
  }

  if (stations.length !== 2) {
    issues.push(`${inp.support.replaceAll("_", " ")} support layout requires exactly two active support stations.`);
    return;
  }

  if (stations[1].x <= stations[0].x) {
    issues.push("Support station positions must increase from left to right.");
  }

  if (inp.support === "simply_supported") {
    if (stations.some((s) => s.restraint !== "pinned")) {
      issues.push("Simply supported layout requires pinned restraints at both stations.");
    }
  }
}

function validateInternalReleases(inp: BeamBendingInputs, issues: string[]) {
  const releases = (inp.internalReleases ?? []).filter((r) => r.active !== false);
  if (releases.length === 0) return;

  if ((inp.supportLayout?.stations ?? []).some((s) => s.active !== false)) {
    issues.push("Internal moment releases are not yet supported with explicit support-station layouts.");
  }
  if (inp.support === "simply_supported" || inp.support === "cantilever") {
    issues.push("Internal moment releases are currently supported only for fixed-fixed and propped cantilever models.");
  }
  if (releases.length > 2) {
    issues.push("At most two internal moment releases are currently supported.");
  }

  const seenIds = new Set<string>();
  const seenX = new Set<string>();
  const supportXs = new Set(activeStations(inp).map((s) => s.x.toFixed(9)));
  for (const release of releases) {
    if (!release.id.trim()) issues.push("Internal release id cannot be empty.");
    if (seenIds.has(release.id)) issues.push(`Duplicate internal release id: ${release.id}.`);
    seenIds.add(release.id);
    if (release.type !== "moment") {
      issues.push(`Internal release ${release.id}: only moment releases are supported.`);
    }
    if (!finite(release.x) || release.x <= 0 || release.x >= inp.L) {
      issues.push(`Internal release ${release.id}: x must satisfy 0 < x < L.`);
    }
    const xKey = release.x.toFixed(9);
    if (seenX.has(xKey)) issues.push(`Internal release ${release.id}: duplicate release position x=${release.x}.`);
    seenX.add(xKey);
    if (supportXs.has(xKey)) {
      issues.push(`Internal release ${release.id}: release position cannot coincide with a support station.`);
    }
  }
}

function validateLoad(load: Load, L: number): string[] {
  const issues: string[] = [];

  if (load.type === "point_load") {
    if (!finite(load.x) || load.x < 0 || load.x > L) issues.push(`${load.id}: x must be within [0, L].`);
    if (!finite(load.P)) issues.push(`${load.id}: P must be finite.`);
    return issues;
  }

  if (load.type === "moment") {
    if (!finite(load.x) || load.x < 0 || load.x > L) issues.push(`${load.id}: x must be within [0, L].`);
    if (!finite(load.M)) issues.push(`${load.id}: M must be finite.`);
    return issues;
  }

  if (load.type === "udl") {
    validateSpanRange(load.id, load.x1, load.x2, L, issues);
    if (!finite(load.w)) issues.push(`${load.id}: w must be finite.`);
    return issues;
  }

  if (load.type === "linear_dist") {
    validateSpanRange(load.id, load.x1, load.x2, L, issues);
    if (!finite(load.w1) || !finite(load.w2)) issues.push(`${load.id}: w1/w2 must be finite.`);
    return issues;
  }

  if (load.type === "thermal") {
    validateSpanRange(load.id, load.x1, load.x2, L, issues);
    if (!finite(load.alpha)) issues.push(`${load.id}: alpha must be finite.`);
    if (!finite(load.dT)) issues.push(`${load.id}: dT must be finite.`);
    if (!finitePositive(load.depth)) issues.push(`${load.id}: depth must be > 0.`);
    return issues;
  }

  validateSpanRange(load.id, load.x1, load.x2, L, issues);
  if (!finite(load.kappa0)) issues.push(`${load.id}: kappa0 must be finite.`);
  return issues;
}

function validateLoadCategories(defs: LoadCategoryDefinition[] | undefined, issues: string[]) {
  const ids = new Set<string>(BUILT_IN_LOAD_CATEGORIES);
  if (!defs) return ids;
  const seen = new Set<string>();
  for (const def of defs) {
    const id = normalizeCategoryId(def.id);
    const name = def.name.trim();
    if (!id) {
      issues.push("Load category id cannot be empty.");
      continue;
    }
    if (seen.has(id)) issues.push(`Duplicate load category id: ${id}.`);
    seen.add(id);
    if (!name) issues.push(`Load category ${id}: name cannot be empty.`);
    ids.add(id);
  }
  return ids;
}

function validateLoadCases(
  cases: LoadCase[],
  combos: LoadCombination[] | undefined,
  L: number,
  allowedCategoryIds: Set<string>,
  enforceCategoryDefinitions: boolean,
  issues: string[]
) {
  const caseIds = new Set<string>(["BASE"]);
  for (const c of cases) {
    if (!c.id.trim()) issues.push("Load case id cannot be empty.");
    if (caseIds.has(c.id)) issues.push(`Duplicate load case id: ${c.id}.`);
    caseIds.add(c.id);
    if (enforceCategoryDefinitions && c.category && !allowedCategoryIds.has(normalizeCategoryId(c.category))) {
      issues.push(`Load case ${c.id}: category "${c.category}" is not supported.`);
    }
    const ids = new Set<string>();
    for (const l of c.loads) {
      if (!l.id.trim()) issues.push(`Load case ${c.id}: load id cannot be empty.`);
      if (ids.has(l.id)) issues.push(`Load case ${c.id}: duplicate load id ${l.id}.`);
      ids.add(l.id);
      issues.push(...validateLoad(l, L));
    }
  }

  if (!combos) return;
  const comboIds = new Set<string>();
  for (const combo of combos) {
    if (!combo.id.trim()) issues.push("Load combination id cannot be empty.");
    if (comboIds.has(combo.id)) issues.push(`Duplicate load combination id: ${combo.id}.`);
    comboIds.add(combo.id);
    if (combo.terms.length === 0) issues.push(`Load combination ${combo.id} must include at least one term.`);
    for (const t of combo.terms) {
      if (t.active === false) continue;
      if (!caseIds.has(t.caseId)) issues.push(`Load combination ${combo.id}: unknown case "${t.caseId}".`);
      if (!finite(t.factor)) issues.push(`Load combination ${combo.id}: factor for ${t.caseId} must be finite.`);
    }
  }
}

function validateEnvelopeDefinitions(
  defs: EnvelopeDefinition[] | undefined,
  combos: LoadCombination[] | undefined,
  issues: string[]
) {
  if (!defs || defs.length === 0) return;
  const comboIds = new Set((combos ?? []).map((c) => c.id));
  const envIds = new Set<string>();
  for (const env of defs) {
    if (!env.id.trim()) issues.push("Envelope definition id cannot be empty.");
    if (envIds.has(env.id)) issues.push(`Duplicate envelope definition id: ${env.id}.`);
    envIds.add(env.id);
    if (!env.name.trim()) issues.push(`Envelope definition ${env.id}: name cannot be empty.`);
    if (env.combinationIds.length === 0) {
      issues.push(`Envelope definition ${env.id}: include at least one combination.`);
    }
    for (const comboId of env.combinationIds) {
      if (!comboIds.has(comboId)) {
        issues.push(`Envelope definition ${env.id}: unknown combination "${comboId}".`);
      }
    }
  }
  const activeCount = defs.filter((env) => env.active !== false).length;
  if (activeCount > 1) issues.push("Only one envelope definition can be active at a time.");
}

export function getBeamInputIssues(inp: BeamBendingInputs): string[] {
  const issues: string[] = [];
  const allowedLoadCategories = validateLoadCategories(inp.loadCategories, issues);
  const enforceCategoryDefinitions = Boolean(inp.loadCategories && inp.loadCategories.length > 0);

  if (!finitePositive(inp.L)) issues.push("Beam length L must be > 0.");
  if (!finitePositive(inp.E)) issues.push("Young's modulus E must be > 0.");
  if (!finitePositive(inp.I)) issues.push("Second moment I must be > 0.");
  if (inp.A !== undefined && !finitePositive(inp.A)) issues.push("Area A must be > 0.");
  if (inp.G !== undefined && !finitePositive(inp.G)) issues.push("Shear modulus G must be > 0.");
  if (inp.nu !== undefined && (!finite(inp.nu) || inp.nu <= -0.49 || inp.nu >= 0.49)) {
    issues.push("Poisson ratio nu must be between -0.49 and 0.49.");
  }
  if (inp.kappaShear !== undefined && !finitePositive(inp.kappaShear)) {
    issues.push("Shear correction factor must be > 0.");
  }

  const ratio = inp.serviceabilityLimitRatio ?? 360;
  if (!finitePositive(ratio)) issues.push("Serviceability limit ratio must be > 0.");

  if (inp.section) issues.push(...getSectionDimensionIssues(inp.section));
  issues.push(...getDisplayUnitsIssues(inp.displayUnits));
  if (inp.stiffnessSegments) validateStiffnessSegments(inp.stiffnessSegments, inp.L, issues);
  validateSupportLayout(inp, issues);
  validateInternalReleases(inp, issues);

  if (inp.supportConditions) {
    const c = inp.supportConditions;
    if (c.leftSettlement !== undefined && !finite(c.leftSettlement)) issues.push("Left settlement must be finite.");
    if (c.rightSettlement !== undefined && !finite(c.rightSettlement)) issues.push("Right settlement must be finite.");
    if (c.leftRotation !== undefined && !finite(c.leftRotation)) issues.push("Left rotation must be finite.");
    if (c.rightRotation !== undefined && !finite(c.rightRotation)) issues.push("Right rotation must be finite.");
    if (c.leftVerticalSpring !== undefined && !finitePositive(c.leftVerticalSpring)) issues.push("Left vertical spring must be > 0.");
    if (c.rightVerticalSpring !== undefined && !finitePositive(c.rightVerticalSpring)) issues.push("Right vertical spring must be > 0.");
    if (c.leftRotationalSpring !== undefined && !finitePositive(c.leftRotationalSpring)) issues.push("Left rotational spring must be > 0.");
    if (c.rightRotationalSpring !== undefined && !finitePositive(c.rightRotationalSpring)) issues.push("Right rotational spring must be > 0.");
  }

  const ids = new Set<string>();
  for (const load of inp.loads) {
    if (!load.id.trim()) issues.push("Load id cannot be empty.");
    if (ids.has(load.id)) issues.push(`Duplicate load id: ${load.id}.`);
    ids.add(load.id);
    if (enforceCategoryDefinitions && load.category && !allowedLoadCategories.has(normalizeCategoryId(load.category))) {
      issues.push(`${load.id}: category "${load.category}" is not defined in Load Categories.`);
    }
    if (load.uncertaintyPercent !== undefined && (!finite(load.uncertaintyPercent) || load.uncertaintyPercent < 0)) {
      issues.push(`${load.id}: load uncertainty must be >= 0.`);
    }
  }

  if (!finitePositive(inp.L)) return issues;
  for (const load of inp.loads) issues.push(...validateLoad(load, inp.L));
  if (inp.loadCases) validateLoadCases(inp.loadCases, inp.loadCombinations, inp.L, allowedLoadCategories, enforceCategoryDefinitions, issues);
  validateEnvelopeDefinitions(inp.envelopeDefinitions, inp.loadCombinations, issues);

  if (inp.loadCases?.length) {
    const caseIds = new Set(inp.loadCases.map((c) => c.id));
    for (const load of inp.loads) {
      if (!load.caseId) continue;
      if (!caseIds.has(load.caseId)) {
        issues.push(`${load.id}: assigned case "${load.caseId}" is not defined in Load Cases.`);
      }
    }
  }

  if (inp.uncertainty) {
    const u = inp.uncertainty;
    if (u.EPercent !== undefined && (!finite(u.EPercent) || u.EPercent < 0)) issues.push("Uncertainty E% must be >= 0.");
    if (u.IPercent !== undefined && (!finite(u.IPercent) || u.IPercent < 0)) issues.push("Uncertainty I% must be >= 0.");
    if (u.loadPercent !== undefined && (!finite(u.loadPercent) || u.loadPercent < 0)) issues.push("Uncertainty load% must be >= 0.");
  }

  if (inp.material) {
    if (!finitePositive(inp.material.E)) issues.push("Material E must be > 0.");
    if (inp.material.nu !== undefined && (!finite(inp.material.nu) || inp.material.nu <= -0.49 || inp.material.nu >= 0.49)) {
      issues.push("Material nu must be between -0.49 and 0.49.");
    }
    if (inp.material.yieldStress !== undefined && !finitePositive(inp.material.yieldStress)) {
      issues.push("Material yield stress must be > 0.");
    }
  }

  if (inp.designCriteria) {
    if (inp.designCriteria.allowableBendingStress !== undefined && !finitePositive(inp.designCriteria.allowableBendingStress)) {
      issues.push("Allowable bending stress must be > 0.");
    }
    if (inp.designCriteria.allowableShearStress !== undefined && !finitePositive(inp.designCriteria.allowableShearStress)) {
      issues.push("Allowable shear stress must be > 0.");
    }
    if (inp.designCriteria.deflectionLimitRatio !== undefined && !finitePositive(inp.designCriteria.deflectionLimitRatio)) {
      issues.push("Design deflection limit ratio must be > 0.");
    }
  }

  if (inp.analysisOptions) {
    if (inp.analysisOptions.debounceMs !== undefined && (!finite(inp.analysisOptions.debounceMs) || inp.analysisOptions.debounceMs < 0)) {
      issues.push("Analysis debounce ms must be >= 0.");
    }
  }

  if (inp.movingLoad?.enabled) {
    const m = inp.movingLoad;
    if (m.axleLoads.length === 0) issues.push("Moving load train requires at least one axle load.");
    if (m.axleLoads.some((x) => !finite(x))) issues.push("Moving load axle loads must be finite.");
    if (m.axleSpacings.length !== Math.max(0, m.axleLoads.length - 1)) {
      issues.push("Moving load axle spacings count must equal axleLoads.length - 1.");
    }
    if (m.axleSpacings.some((x) => !finitePositive(x))) issues.push("Moving load axle spacings must be > 0.");
    if (m.step !== undefined && !finitePositive(m.step)) issues.push("Moving load step must be > 0.");
    if (m.playbackSpeed !== undefined && !finitePositive(m.playbackSpeed)) {
      issues.push("Moving load playback speed must be > 0.");
    }
  }

  if (inp.movingLoadTemplates) {
    const ids = new Set<string>();
    for (const template of inp.movingLoadTemplates) {
      if (!template.id.trim()) issues.push("Moving load template id cannot be empty.");
      if (ids.has(template.id)) issues.push(`Duplicate moving load template id: ${template.id}.`);
      ids.add(template.id);
      if (!template.name.trim()) issues.push(`Moving load template ${template.id}: name cannot be empty.`);
      if (template.axleLoads.length === 0) issues.push(`Moving load template ${template.id}: include at least one axle load.`);
      if (template.axleLoads.some((x) => !finite(x))) issues.push(`Moving load template ${template.id}: axle loads must be finite.`);
      if (template.axleSpacings.length !== Math.max(0, template.axleLoads.length - 1)) {
        issues.push(`Moving load template ${template.id}: axle spacings count must equal axleLoads.length - 1.`);
      }
      if (template.axleSpacings.some((x) => !finitePositive(x))) {
        issues.push(`Moving load template ${template.id}: axle spacings must be > 0.`);
      }
    }
  }

  return issues;
}

export function assertBeamInputs(inp: BeamBendingInputs) {
  const issues = getBeamInputIssues(inp);
  if (issues.length) throw new Error(issues.join(" "));
}
