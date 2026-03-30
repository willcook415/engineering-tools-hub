import { useEffect, useMemo, useRef, useState } from "react";
import CollapsibleSection from "../../../components/CollapsibleSection";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Panel from "../../../components/Panel";
import { exportReportPdfFromSections } from "../../../features/pdf/exportPdf";
import PlotFrame from "../../../features/plotting/PlotFrame";
import { xTicks, yDomainPad } from "../../../features/plotting/ticks";
import type {
  AssumptionsProfile,
  BeamBendingInputs,
  BeamDisplayUnits,
  EnvelopeDefinition,
  InternalRelease,
  Load,
  LoadCategoryDefinition,
  LoadCase,
  LoadCombination,
  MovingLoadTemplate,
  PointLoad,
  PointMoment,
  SectionDefinition,
  StiffnessSegment,
  SupportStation,
  UDL,
  WarningDetail,
} from "../model";
import { MATERIAL_PRESETS } from "../materials";
import { loadDisplayName, loadTypeLabel } from "../loadLabels";
import { SECTION_FIELD_MAP } from "../sectionFields";
import { getSectionDimensionIssues, resolveSectionProperties } from "../sections";
import { solveBeamBending } from "../solve";
import {
  displayPreset,
  formatEngineeringNumber,
  formatUnitNumber,
  formatUnitValue,
  getDisplayUnits,
  parseEngineeringInput,
  quantityUnitSymbol,
  type UnitQuantity,
} from "../units";
import { getBeamInputIssues } from "../validation";
import { runVerificationSuite } from "../verification";
import BeamReportPrint from "./BeamReportPrint";
import BeamView from "./BeamView";
import { KV, LoadRow, NumberField } from "./LoadRow";
import { useBeamHistory } from "./useBeamHistory";
import WorkedSolutionModal from "./WorkedSolutionModal";

const DEFAULT_INPUTS: BeamBendingInputs = {
  support: "simply_supported",
  theory: "euler_bernoulli",
  displayUnits: displayPreset("si_base"),
  L: 5,
  E: 200e9,
  I: 1e-6,
  A: 0.002,
  nu: 0.3,
  kappaShear: 5 / 6,
  serviceabilityLimitRatio: 360,
  supportConditions: {
    leftSettlement: 0,
    rightSettlement: 0,
    leftRotation: 0,
    rightRotation: 0,
  },
  uncertainty: {
    EPercent: 5,
    IPercent: 5,
    loadPercent: 5,
  },
  analysisOptions: {
    meshDensity: "normal",
    adaptiveRefinement: true,
    debounceMs: 120,
  },
  designCriteria: {
    allowableBendingStress: 250e6,
    allowableShearStress: 145e6,
    deflectionLimitRatio: 360,
  },
  movingLoad: {
    enabled: false,
    name: "Default Train",
    templateType: "train",
    axleLoads: [80e3, 120e3, 120e3],
    axleSpacings: [3.6, 1.3],
    step: 0.2,
    playbackSpeed: 0.6,
  },
  movingLoadTemplates: [
    {
      id: "std_train_3axle",
      name: "3-Axle Train",
      type: "train",
      axleLoads: [80e3, 120e3, 120e3],
      axleSpacings: [3.6, 1.3],
      note: "Generic heavy train template.",
    },
    {
      id: "std_vehicle_2axle",
      name: "2-Axle Vehicle",
      type: "vehicle",
      axleLoads: [60e3, 90e3],
      axleSpacings: [4.0],
      note: "Generic road-vehicle template.",
    },
  ],
  loads: [
    { id: "P1", type: "point_load", x: 2, P: 1000 },
    { id: "U1", type: "udl", x1: 3, x2: 5, w: 200 },
  ],
  loadCategories: [
    { id: "dead", name: "Dead Load", active: true, note: "Permanent actions and self-weight." },
    { id: "live", name: "Live Load", active: true, note: "Occupancy and transient operational actions." },
    { id: "variable", name: "Variable Load", active: true, note: "General variable actions." },
    { id: "thermal", name: "Thermal Load", active: true, note: "Temperature and prestrain effects." },
    { id: "construction", name: "Construction Load", active: true, note: "Temporary erection and staging actions." },
    { id: "custom", name: "Custom", active: true, note: "User-defined category." },
  ],
  loadCases: [
    {
      id: "DL",
      name: "Dead Load",
      category: "dead",
      active: true,
      note: "Permanent actions.",
      loads: [{ id: "DL1", type: "udl", x1: 0, x2: 5, w: 120 }],
    },
    {
      id: "LL",
      name: "Live Load",
      category: "live",
      active: true,
      note: "Variable occupancy actions.",
      loads: [{ id: "LL1", type: "point_load", x: 2.5, P: 800 }],
    },
  ],
  loadCombinations: [
    {
      id: "ULS",
      name: "ULS 1.35DL + 1.5LL",
      category: "ULS",
      active: true,
      note: "Generic ultimate limit state template.",
      terms: [
        { caseId: "DL", factor: 1.35, active: true },
        { caseId: "LL", factor: 1.5, active: true },
      ],
    },
    {
      id: "SLS",
      name: "SLS 1.0DL + 1.0LL",
      category: "SLS",
      active: true,
      note: "Generic serviceability limit state template.",
      terms: [
        { caseId: "DL", factor: 1.0, active: true },
        { caseId: "LL", factor: 1.0, active: true },
      ],
    },
  ],
  envelopeDefinitions: [
    {
      id: "ENV1",
      name: "All Active Combinations",
      active: true,
      combinationIds: ["ULS", "SLS"],
      note: "Default full-combination envelope.",
    },
  ],
};

const SNAP_OPTIONS = [
  { label: "Auto", value: 0 },
  { label: "0.01 m", value: 0.01 },
  { label: "0.05 m", value: 0.05 },
  { label: "0.10 m", value: 0.1 },
];

const SELF_WEIGHT_LOAD_ID = "SW_GEN";
const LOAD_TYPE_ORDER: Load["type"][] = ["point_load", "udl", "linear_dist", "moment", "thermal", "prestrain"];
const CASE_CATEGORY_OPTIONS = ["dead", "live", "variable", "thermal", "construction", "custom"] as const;
const DEFAULT_LOAD_CATEGORY_DEFINITIONS: LoadCategoryDefinition[] = [
  { id: "dead", name: "Dead Load", active: true, note: "Permanent actions and self-weight." },
  { id: "live", name: "Live Load", active: true, note: "Occupancy and transient operational actions." },
  { id: "variable", name: "Variable Load", active: true, note: "General variable actions." },
  { id: "thermal", name: "Thermal Load", active: true, note: "Temperature and prestrain effects." },
  { id: "construction", name: "Construction Load", active: true, note: "Temporary erection and staging actions." },
  { id: "custom", name: "Custom", active: true, note: "User-defined category." },
];

export default function BeamBendingTool() {
  const { inputs, commit, commitTransient, history, future, undo, redo, reset } = useBeamHistory(DEFAULT_INPUTS);
  const [selectedId, setSelectedId] = useState<string | null>(inputs.loads[0]?.id ?? null);
  const [cursorX, setCursorX] = useState<number>(inputs.L * 0.5);
  const [snapStep, setSnapStep] = useState<number>(0.01);
  const [chartMode, setChartMode] = useState<"all" | "sfd" | "bmd" | "deflection" | "rotation">("all");
  const [showWorked, setShowWorked] = useState(false);
  const [workedMode, setWorkedMode] = useState<"brief" | "detailed">("brief");
  const [reportTemplate, setReportTemplate] = useState<"calc_note" | "submission" | "teaching">("calc_note");
  const [activeSection, setActiveSection] = useState<string>("All");
  const [exportStage, setExportStage] = useState<"idle" | "preparing" | "capturing" | "paginating" | "saving" | "error">("idle");
  const [isExporting, setIsExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string>("");
  const [isCompact, setIsCompact] = useState(false);
  const [inputStep, setInputStep] = useState<"beam" | "advanced">("beam");
  const [workflowMode, setWorkflowMode] = useState<"learning" | "design" | "advanced">("design");
  const reportRef = useRef<HTMLDivElement | null>(null);
  const printRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [printTimestamp, setPrintTimestamp] = useState<string>(new Date().toLocaleString());
  const [debouncedInputs, setDebouncedInputs] = useState<BeamBendingInputs>(inputs);
  const [scenarioName, setScenarioName] = useState<string>("Checkpoint 1");
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string; at: string; inputs: BeamBendingInputs }>>([]);
  const [compareScenarioId, setCompareScenarioId] = useState<string>("");
  const [importDraft, setImportDraft] = useState<string>("");
  const [importError, setImportError] = useState<string>("");
  const [dragState, setDragState] = useState<{ id: string | null; snap: number }>({ id: null, snap: snapStep });
  const [showAllExplainability, setShowAllExplainability] = useState(false);
  const [isolatedLoadId, setIsolatedLoadId] = useState<string | null>(null);
  const [savedComboTemplates, setSavedComboTemplates] = useState<
    Array<{
      id: string;
      name: string;
      category: "ULS" | "SLS" | "custom";
      note?: string;
      terms: Array<{ caseId: string; factor: number }>;
    }>
  >([]);
  const [movingLeadPlaybackX, setMovingLeadPlaybackX] = useState<number>(0);
  const [movingPlaybackOn, setMovingPlaybackOn] = useState<boolean>(false);
  const [movingTemplateDraftName, setMovingTemplateDraftName] = useState<string>("Custom Template");

  const selectedLoad = inputs.loads.find((l) => l.id === selectedId) ?? null;
  const selectedX =
    !selectedLoad || selectedLoad.hidden ? null : "x" in selectedLoad ? selectedLoad.x : 0.5 * (selectedLoad.x1 + selectedLoad.x2);
  const activeCursorX = selectedX ?? cursorX;
  const issues = useMemo(() => getBeamInputIssues(debouncedInputs), [debouncedInputs]);

  const solved = useMemo(() => {
    if (issues.length > 0) return { ok: false as const, err: issues.join(" ") };
    try {
      return { ok: true as const, data: solveBeamBending(debouncedInputs, { detailLevel: workedMode }) };
    } catch (e) {
      return { ok: false as const, err: (e as Error).message };
    }
  }, [debouncedInputs, issues, workedMode]);

  const verification = useMemo(() => runVerificationSuite(), []);
  const sectionDimIssues = useMemo(() => (inputs.section ? getSectionDimensionIssues(inputs.section) : []), [inputs.section]);
  const sectionPreview = useMemo(() => resolveSectionProperties(inputs.section), [inputs.section]);
  const xt = xTicks(inputs.L);
  const chartHeight = isCompact ? 220 : 260;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 980px)");
    const onChange = () => setIsCompact(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (workflowMode === "learning") {
      setWorkedMode("detailed");
      setInputStep("beam");
    }
    if (workflowMode === "design") {
      setWorkedMode("brief");
      setInputStep("beam");
    }
    if (workflowMode === "advanced") {
      setInputStep("advanced");
    }
  }, [workflowMode]);

  useEffect(() => {
    const ms = Math.max(0, inputs.analysisOptions?.debounceMs ?? 120);
    const t = window.setTimeout(() => setDebouncedInputs(inputs), ms);
    return () => window.clearTimeout(t);
  }, [inputs]);

  useEffect(() => {
    if (!solved.ok || !solved.data.outputs.movingLoadCritical) return;
    setMovingLeadPlaybackX(solved.data.outputs.movingLoadCritical.leadPosition);
  }, [solved]);

  useEffect(() => {
    if (!movingPlaybackOn) return;
    if (!inputs.movingLoad?.enabled) return;
    const span =
      inputs.L +
      (inputs.movingLoad.axleSpacings ?? []).reduce((acc, spacing) => acc + Math.max(0, spacing), 0);
    if (!Number.isFinite(span) || span <= 0) return;
    const speed = Math.max(0.05, inputs.movingLoad.playbackSpeed ?? 0.6);
    const tickMs = 80;
    const timer = window.setInterval(() => {
      setMovingLeadPlaybackX((x) => {
        const next = x + speed * (tickMs / 1000);
        return next > span ? 0 : next;
      });
    }, tickMs);
    return () => window.clearInterval(timer);
  }, [movingPlaybackOn, inputs.movingLoad, inputs.L]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("beam.scenarios.v1");
      if (raw) {
        const parsed = JSON.parse(raw) as Array<{ id: string; name: string; at: string; inputs: BeamBendingInputs }>;
        setScenarios(parsed.sort((a, b) => b.id.localeCompare(a.id)));
      }
    } catch {
      // ignore local storage parse issues
    }
    try {
      const params = new URLSearchParams(window.location.search);
      const encoded = params.get("beam");
      if (encoded) {
        const decoded = decodeURIComponent(atob(encoded));
        const parsed = JSON.parse(decoded) as BeamBendingInputs;
        commit(parsed);
        setIsolatedLoadId(null);
        setSelectedId(parsed.loads.find((l) => !l.hidden)?.id ?? null);
      }
    } catch {
      // ignore malformed shared URL state
    }
    try {
      const rawTemplates = localStorage.getItem("beam.comboTemplates.v1");
      if (rawTemplates) {
        const parsed = JSON.parse(rawTemplates) as Array<{
          id: string;
          name: string;
          category: "ULS" | "SLS" | "custom";
          note?: string;
          terms: Array<{ caseId: string; factor: number }>;
        }>;
        setSavedComboTemplates(parsed);
      }
    } catch {
      // ignore malformed template storage
    }
  }, [commit]);

  useEffect(() => {
    try {
      localStorage.setItem("beam.scenarios.v1", JSON.stringify(scenarios.slice(0, 25)));
    } catch {
      // ignore storage failures
    }
  }, [scenarios]);

  useEffect(() => {
    try {
      localStorage.setItem("beam.comboTemplates.v1", JSON.stringify(savedComboTemplates.slice(0, 30)));
    } catch {
      // ignore template storage failures
    }
  }, [savedComboTemplates]);

  useEffect(() => {
    if (selectedId && !inputs.loads.some((l) => l.id === selectedId)) {
      setSelectedId(null);
    }
  }, [inputs.loads, selectedId]);

  useEffect(() => {
    if (isolatedLoadId && !inputs.loads.some((l) => l.id === isolatedLoadId && !l.hidden)) {
      setIsolatedLoadId(null);
    }
  }, [inputs.loads, isolatedLoadId]);

  useEffect(() => {
    const selfWeight = inputs.loads.find((l) => l.id === SELF_WEIGHT_LOAD_ID && l.type === "udl");
    if (!selfWeight || selfWeight.type !== "udl") return;
    const intensity = selfWeightIntensityFor(inputs);
    if (!intensity) {
      commitTransient((prev) => ({
        ...prev,
        loads: prev.loads.filter((l) => l.id !== SELF_WEIGHT_LOAD_ID),
      }));
      setSelectedId((cur) => (cur === SELF_WEIGHT_LOAD_ID ? null : cur));
      return;
    }
    const nextX1 = 0;
    const nextX2 = inputs.L;
    const needsUpdate =
      Math.abs(selfWeight.w - intensity) > 1e-9 ||
      Math.abs(selfWeight.x1 - nextX1) > 1e-9 ||
      Math.abs(selfWeight.x2 - nextX2) > 1e-9 ||
      selfWeight.generatedBy !== "self_weight";
    if (!needsUpdate) return;
    commitTransient((prev) => ({
      ...prev,
      loads: prev.loads.map((l) =>
        l.id === SELF_WEIGHT_LOAD_ID && l.type === "udl"
          ? {
              ...l,
              x1: nextX1,
              x2: nextX2,
              w: intensity,
              locked: true,
              category: "dead",
              caseId: l.caseId ?? "DL",
              generatedBy: "self_weight",
            }
          : l
      ),
    }));
  }, [inputs, commitTransient]);

  function resetExample() {
    reset(DEFAULT_INPUTS);
    setSelectedId(DEFAULT_INPUTS.loads[0]?.id ?? null);
    setCursorX(DEFAULT_INPUTS.L * 0.5);
    setIsolatedLoadId(null);
  }

  function updateLoad(id: string, patch: Partial<Load>, transient = false) {
    const apply = transient ? commitTransient : commit;
    apply((prev) => ({
      ...prev,
      loads: prev.loads.map((l) => (l.id === id ? ({ ...l, ...patch } as Load) : l)),
    }));
  }

  function removeLoad(id: string) {
    commit((prev) => ({ ...prev, loads: prev.loads.filter((l) => l.id !== id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
    setIsolatedLoadId((cur) => (cur === id ? null : cur));
  }

  function nextLoadId(prefix: "P" | "U" | "M" | "T" | "TH" | "K", loads: Load[]) {
    let max = 0;
    for (const l of loads) {
      if (!l.id.startsWith(prefix)) continue;
      const n = Number(l.id.slice(1));
      if (Number.isFinite(n) && n > max) max = n;
    }
    let id = `${prefix}${max + 1}`;
    while (loads.some((l) => l.id === id)) {
      max += 1;
      id = `${prefix}${max + 1}`;
    }
    return id;
  }

  function loadPrefix(load: Load): "P" | "U" | "M" | "T" | "TH" | "K" {
    if (load.type === "point_load") return "P";
    if (load.type === "udl") return "U";
    if (load.type === "moment") return "M";
    if (load.type === "linear_dist") return "T";
    if (load.type === "thermal") return "TH";
    return "K";
  }

  function duplicateLoad(id: string) {
    const src = inputs.loads.find((l) => l.id === id);
    if (!src) return;
    const prefix = loadPrefix(src);
    const nextId = nextLoadId(prefix, inputs.loads);
    const clone = {
      ...src,
      id: nextId,
      name: src.name ? `${src.name} copy` : undefined,
      hidden: false,
      generatedBy: undefined,
    } as Load;
    commit((prev) => ({ ...prev, loads: [...prev.loads, clone] }));
    setSelectedId(nextId);
  }

  function mirrorLoad(id: string) {
    commit((prev) => {
      const nextLoads = prev.loads.map((l) => {
        if (l.id !== id) return l;
        if (l.type === "point_load" || l.type === "moment") {
          return { ...l, x: clamp(prev.L - l.x, 0, prev.L) };
        }
        const lo = Math.min(l.x1, l.x2);
        const hi = Math.max(l.x1, l.x2);
        return { ...l, x1: clamp(prev.L - hi, 0, prev.L), x2: clamp(prev.L - lo, 0, prev.L) };
      });
      return { ...prev, loads: nextLoads };
    });
  }

  function moveLoad(id: string, direction: -1 | 1) {
    commit((prev) => {
      const idx = prev.loads.findIndex((l) => l.id === id);
      if (idx < 0) return prev;
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= prev.loads.length) return prev;
      const nextLoads = prev.loads.slice();
      const [item] = nextLoads.splice(idx, 1);
      nextLoads.splice(nextIdx, 0, item);
      return { ...prev, loads: nextLoads };
    });
  }

  function toggleLoadLock(id: string) {
    updateLoad(id, { locked: !(inputs.loads.find((l) => l.id === id)?.locked ?? false) });
  }

  function toggleLoadVisibility(id: string) {
    const load = inputs.loads.find((l) => l.id === id);
    if (!load) return;
    const nextHidden = !load.hidden;
    updateLoad(id, { hidden: nextHidden });
    if (nextHidden && isolatedLoadId === id) setIsolatedLoadId(null);
  }

  function toggleLoadIsolation(id: string) {
    setIsolatedLoadId((cur) => (cur === id ? null : id));
  }

  function addPointLoad() {
    const id = nextLoadId("P", inputs.loads);
    const x = clamp(inputs.L * 0.5, 0, inputs.L);
    const newLoad: PointLoad = { id, type: "point_load", x, P: 1000, category: "live", caseId: "LL" };
    commit((prev) => ({ ...prev, loads: [...prev.loads, newLoad] }));
    setSelectedId(id);
  }

  function addUDL() {
    const id = nextLoadId("U", inputs.loads);
    const x1 = clamp(inputs.L * 0.6, 0, inputs.L);
    const x2 = clamp(inputs.L * 0.9, 0, inputs.L);
    const newLoad: UDL = { id, type: "udl", x1, x2, w: 200, category: "dead", caseId: "DL" };
    commit((prev) => ({ ...prev, loads: [...prev.loads, newLoad] }));
    setSelectedId(id);
  }

  function addMoment() {
    const id = nextLoadId("M", inputs.loads);
    const x = clamp(inputs.L * 0.5, 0, inputs.L);
    const newLoad: PointMoment = { id, type: "moment", x, M: 500, category: "variable" };
    commit((prev) => ({ ...prev, loads: [...prev.loads, newLoad] }));
    setSelectedId(id);
  }

  function addLinearDist() {
    const id = nextLoadId("T", inputs.loads);
    const x1 = clamp(inputs.L * 0.25, 0, inputs.L);
    const x2 = clamp(inputs.L * 0.65, 0, inputs.L);
    const newLoad: Load = { id, type: "linear_dist", x1, x2, w1: 50, w2: 250, category: "variable" };
    commit((prev) => ({ ...prev, loads: [...prev.loads, newLoad] }));
    setSelectedId(id);
  }

  function addThermal() {
    const id = nextLoadId("TH", inputs.loads);
    const newLoad: Load = {
      id,
      type: "thermal",
      x1: 0,
      x2: inputs.L,
      alpha: 12e-6,
      dT: 12,
      depth: 0.25,
      category: "thermal",
    };
    commit((prev) => ({ ...prev, loads: [...prev.loads, newLoad] }));
    setSelectedId(id);
  }

  function addPrestrain() {
    const id = nextLoadId("K", inputs.loads);
    const newLoad: Load = { id, type: "prestrain", x1: 0, x2: inputs.L, kappa0: 0.0005, category: "construction" };
    commit((prev) => ({ ...prev, loads: [...prev.loads, newLoad] }));
    setSelectedId(id);
  }

  function setSupportStationPair(
    updater: (stations: [SupportStation, SupportStation]) => [SupportStation, SupportStation]
  ) {
    const current = resolveSupportStationsForView(inputs);
    const basePair: [SupportStation, SupportStation] = [
      current[0] ?? { id: "S1", x: 0, restraint: "pinned", settlement: 0 },
      current[1] ?? { id: "S2", x: inputs.L, restraint: "pinned", settlement: 0 },
    ];
    const nextPair = updater(basePair);
    const nextStations = nextPair
      .map((station, idx) => ({
        ...station,
        id: station.id.trim() || `S${idx + 1}`,
        restraint: "pinned" as const,
      }))
      .sort((a, b) => a.x - b.x) as [SupportStation, SupportStation];
    commit((prev) => ({
      ...prev,
      supportLayout: { stations: nextStations },
    }));
  }

  function clearSupportStationLayout() {
    commit((prev) => ({
      ...prev,
      supportLayout: undefined,
    }));
  }

  function addStiffnessSegment() {
    const id = nextSequentialId("SEG", (inputs.stiffnessSegments ?? []).map((segment) => segment.id));
    const x1 = 0;
    const x2 = inputs.L;
    const next: StiffnessSegment = {
      id,
      label: `Segment ${((inputs.stiffnessSegments ?? []).length ?? 0) + 1}`,
      x1,
      x2,
      materialPresetId: "custom",
    };
    commit((prev) => ({
      ...prev,
      stiffnessSegments: [...(prev.stiffnessSegments ?? []), next],
    }));
  }

  function updateStiffnessSegment(segmentId: string, patch: Partial<StiffnessSegment>) {
    commit((prev) => ({
      ...prev,
      stiffnessSegments: (prev.stiffnessSegments ?? []).map((segment) =>
        segment.id === segmentId ? { ...segment, ...patch } : segment
      ),
    }));
  }

  function removeStiffnessSegment(segmentId: string) {
    commit((prev) => ({
      ...prev,
      stiffnessSegments: (prev.stiffnessSegments ?? []).filter((segment) => segment.id !== segmentId),
    }));
  }

  function setSegmentMaterialPreset(segmentId: string, presetId: string) {
    if (presetId === "inherit") {
      updateStiffnessSegment(segmentId, {
        materialPresetId: undefined,
        material: undefined,
      });
      return;
    }
    if (presetId === "custom") {
      commit((prev) => ({
        ...prev,
        stiffnessSegments: (prev.stiffnessSegments ?? []).map((segment) => {
          if (segment.id !== segmentId) return segment;
          return {
            ...segment,
            materialPresetId: "custom",
            material: {
              id: "custom",
              name: segment.material?.name ?? segment.label ?? "Custom segment material",
              E: segment.material?.E ?? prev.E,
              nu: segment.material?.nu ?? prev.nu,
              density: segment.material?.density,
              yieldStress: segment.material?.yieldStress,
            },
          };
        }),
      }));
      return;
    }
    updateStiffnessSegment(segmentId, {
      materialPresetId: presetId as StiffnessSegment["materialPresetId"],
      material: undefined,
    });
  }

  function updateSegmentMaterial(
    segmentId: string,
    patch: Partial<{
      name?: string;
      E?: number;
      nu?: number;
      density?: number;
      yieldStress?: number;
    }>
  ) {
    commit((prev) => ({
      ...prev,
      stiffnessSegments: (prev.stiffnessSegments ?? []).map((segment) => {
        if (segment.id !== segmentId) return segment;
        const baseMaterial = segment.material ?? {
          id: "custom" as const,
          name: segment.label ?? "Custom segment material",
          E: prev.E,
          nu: prev.nu,
          density: undefined,
          yieldStress: undefined,
        };
        return {
          ...segment,
          materialPresetId: "custom",
          material: { ...baseMaterial, ...patch, id: "custom" },
        };
      }),
    }));
  }

  function setSegmentSectionType(segmentId: string, sectionId: string) {
    if (sectionId === "inherit") {
      updateStiffnessSegment(segmentId, { section: undefined });
      return;
    }
    const sectionUnit = inputs.section?.unit ?? "mm";
    const nextSection: SectionDefinition = {
      id: sectionId as NonNullable<BeamBendingInputs["section"]>["id"],
      unit: sectionUnit,
      dims: defaultSectionDims(
        sectionId as NonNullable<BeamBendingInputs["section"]>["id"],
        sectionUnit
      ),
    };
    updateStiffnessSegment(segmentId, { section: nextSection });
  }

  function updateSegmentSectionDim(segmentId: string, dimKey: string, value: number) {
    commit((prev) => ({
      ...prev,
      stiffnessSegments: (prev.stiffnessSegments ?? []).map((segment) => {
        if (segment.id !== segmentId || !segment.section) return segment;
        return {
          ...segment,
          section: {
            ...segment.section,
            dims: { ...segment.section.dims, [dimKey]: value },
          },
        };
      }),
    }));
  }

  function addInternalRelease() {
    const id = nextSequentialId("H", (inputs.internalReleases ?? []).map((release) => release.id));
    const next: InternalRelease = {
      id,
      x: inputs.L * 0.5,
      type: "moment",
      active: true,
      label: `Hinge ${((inputs.internalReleases ?? []).length ?? 0) + 1}`,
    };
    commit((prev) => ({
      ...prev,
      internalReleases: [...(prev.internalReleases ?? []), next],
    }));
  }

  function updateInternalRelease(releaseId: string, patch: Partial<InternalRelease>) {
    commit((prev) => ({
      ...prev,
      internalReleases: (prev.internalReleases ?? []).map((release) =>
        release.id === releaseId ? { ...release, ...patch } : release
      ),
    }));
  }

  function removeInternalRelease(releaseId: string) {
    commit((prev) => ({
      ...prev,
      internalReleases: (prev.internalReleases ?? []).filter((release) => release.id !== releaseId),
    }));
  }

  function applyMovingTemplate(templateId: string) {
    const template = (inputs.movingLoadTemplates ?? []).find((t) => t.id === templateId);
    if (!template) return;
    commit((prev) => ({
      ...prev,
      movingLoad: {
        ...(prev.movingLoad ?? { enabled: false, axleLoads: [80e3], axleSpacings: [2.5], step: 0.2 }),
        templateId: template.id,
        templateType: template.type ?? "custom",
        name: template.name,
        axleLoads: template.axleLoads.slice(),
        axleSpacings: template.axleSpacings.slice(),
      },
    }));
  }

  function saveCurrentMovingTemplate() {
    const moving = inputs.movingLoad;
    if (!moving || moving.axleLoads.length === 0) return;
    const id = nextSequentialId("MLT", (inputs.movingLoadTemplates ?? []).map((template) => template.id));
    const template: MovingLoadTemplate = {
      id,
      name: movingTemplateDraftName.trim() || `Template ${((inputs.movingLoadTemplates ?? []).length ?? 0) + 1}`,
      type: moving.templateType ?? "custom",
      axleLoads: moving.axleLoads.slice(),
      axleSpacings: moving.axleSpacings.slice(),
      note: "Saved from current moving-load editor.",
    };
    commit((prev) => ({
      ...prev,
      movingLoadTemplates: [template, ...(prev.movingLoadTemplates ?? [])].slice(0, 30),
      movingLoad: {
        ...(prev.movingLoad ?? moving),
        templateId: template.id,
        name: template.name,
      },
    }));
  }

  function removeMovingTemplate(templateId: string) {
    commit((prev) => ({
      ...prev,
      movingLoadTemplates: (prev.movingLoadTemplates ?? []).filter((template) => template.id !== templateId),
      movingLoad:
        prev.movingLoad?.templateId === templateId
          ? { ...prev.movingLoad, templateId: undefined, templateType: "custom" }
          : prev.movingLoad,
    }));
  }

  function selfWeightIntensityFor(model: BeamBendingInputs) {
    const sectionProps = resolveSectionProperties(model.section);
    const area = sectionProps?.A ?? model.A;
    const density = model.material?.density;
    if (!area || area <= 0 || !density || density <= 0) return null;
    return area * density * 9.80665;
  }

  function toggleSelfWeightLoad() {
    commit((prev) => {
      const existing = prev.loads.find((l) => l.id === SELF_WEIGHT_LOAD_ID && l.type === "udl");
      if (existing) {
        return { ...prev, loads: prev.loads.filter((l) => l.id !== SELF_WEIGHT_LOAD_ID) };
      }
      const intensity = selfWeightIntensityFor(prev);
      if (!intensity) return prev;
      const generated: UDL = {
        id: SELF_WEIGHT_LOAD_ID,
        name: "Self-weight",
        type: "udl",
        x1: 0,
        x2: prev.L,
        w: intensity,
        category: "dead",
        caseId: "DL",
        locked: true,
        generatedBy: "self_weight",
      };
      return { ...prev, loads: [...prev.loads, generated] };
    });
    if (selfWeightEnabled) {
      setSelectedId((cur) => (cur === SELF_WEIGHT_LOAD_ID ? null : cur));
    } else {
      setSelectedId(SELF_WEIGHT_LOAD_ID);
    }
  }

  function nextSequentialId(prefix: string, ids: string[]) {
    let idx = 1;
    let next = `${prefix}${idx}`;
    const used = new Set(ids);
    while (used.has(next)) {
      idx += 1;
      next = `${prefix}${idx}`;
    }
    return next;
  }

  function addLoadCase(category: (typeof CASE_CATEGORY_OPTIONS)[number] = "custom") {
    const existing = inputs.loadCases ?? [];
    const id = nextSequentialId("CASE", existing.map((c) => c.id));
    const nextCase = {
      id,
      name: category === "custom" ? `Custom Case ${existing.length + 1}` : `${humanizeToken(category)} Case`,
      category,
      active: true,
      note: "",
      loads: [],
    };
    commit((prev) => ({ ...prev, loadCases: [...(prev.loadCases ?? []), nextCase] }));
  }

  function updateLoadCaseMeta(id: string, patch: Partial<LoadCase>) {
    commit((prev) => ({
      ...prev,
      loadCases: (prev.loadCases ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }

  function renameLoadCaseId(oldId: string, nextIdRaw: string) {
    const nextId = nextIdRaw.trim();
    if (!nextId || nextId === oldId) return;
    const existing = new Set((inputs.loadCases ?? []).map((c) => c.id));
    if (existing.has(nextId)) return;
    commit((prev) => ({
      ...prev,
      loadCases: (prev.loadCases ?? []).map((c) => (c.id === oldId ? { ...c, id: nextId } : c)),
      loads: prev.loads.map((l) => (l.caseId === oldId ? { ...l, caseId: nextId } : l)),
      loadCombinations: (prev.loadCombinations ?? []).map((combo) => ({
        ...combo,
        terms: combo.terms.map((t) => (t.caseId === oldId ? { ...t, caseId: nextId } : t)),
      })),
    }));
  }

  function removeLoadCase(caseId: string) {
    commit((prev) => ({
      ...prev,
      loadCases: (prev.loadCases ?? []).filter((c) => c.id !== caseId),
      loads: prev.loads.map((l) => (l.caseId === caseId ? { ...l, caseId: undefined } : l)),
      loadCombinations: (prev.loadCombinations ?? []).map((combo) => ({
        ...combo,
        terms: combo.terms.filter((t) => t.caseId !== caseId),
      })),
    }));
  }

  function assignSelectedLoadToCase(caseId: string) {
    if (!selectedId) return;
    const load = inputs.loads.find((l) => l.id === selectedId);
    if (!load) return;
    updateLoad(selectedId, { caseId });
  }

  function setLoadCategories(next: LoadCategoryDefinition[]) {
    commit((prev) => ({ ...prev, loadCategories: next }));
  }

  function addLoadCategory() {
    const existing = loadCategories.map((c) => c.id);
    const id = nextSequentialId("CAT", existing);
    const category: LoadCategoryDefinition = {
      id,
      name: `Custom Category ${existing.length + 1}`,
      active: true,
      note: "",
    };
    setLoadCategories([...loadCategories, category]);
  }

  function updateLoadCategoryMeta(id: string, patch: Partial<LoadCategoryDefinition>) {
    setLoadCategories(loadCategories.map((cat) => (cat.id === id ? { ...cat, ...patch } : cat)));
  }

  function renameLoadCategoryId(oldId: string, nextIdRaw: string) {
    const nextId = nextIdRaw.trim();
    if (!nextId || nextId === oldId) return;
    const knownCategoryIds = new Set(loadCategories.map((c) => c.id));
    if (knownCategoryIds.has(nextId)) return;
    commit((prev) => ({
      ...prev,
      loadCategories: mergeLoadCategories(prev.loadCategories, prev.loadCases ?? [], prev.loads).map((cat) =>
        cat.id === oldId ? { ...cat, id: nextId } : cat
      ),
      loads: prev.loads.map((load) => (normalizeCategoryId(load.category ?? "") === oldId ? { ...load, category: nextId } : load)),
      loadCases: (prev.loadCases ?? []).map((c) => (normalizeCategoryId(c.category ?? "") === oldId ? { ...c, category: nextId } : c)),
    }));
  }

  function removeLoadCategory(id: string) {
    if (CASE_CATEGORY_OPTIONS.includes(id as (typeof CASE_CATEGORY_OPTIONS)[number])) return;
    commit((prev) => ({
      ...prev,
      loadCategories: mergeLoadCategories(prev.loadCategories, prev.loadCases ?? [], prev.loads).filter((cat) => cat.id !== id),
      loads: prev.loads.map((load) => (normalizeCategoryId(load.category ?? "") === id ? { ...load, category: "custom" } : load)),
      loadCases: (prev.loadCases ?? []).map((c) => (normalizeCategoryId(c.category ?? "") === id ? { ...c, category: "custom" } : c)),
    }));
  }

  function assignSelectedLoadToCategory(categoryId: string) {
    if (!selectedId) return;
    updateLoad(selectedId, { category: categoryId });
  }

  function addLoadCombination(category: "ULS" | "SLS" | "custom" = "custom") {
    const existing = inputs.loadCombinations ?? [];
    const id = nextSequentialId("COMBO", existing.map((c) => c.id));
    const defaultCaseId = (inputs.loadCases ?? [])[0]?.id ?? "BASE";
    const nextCombo: LoadCombination = {
      id,
      name: category === "custom" ? `Combination ${existing.length + 1}` : `${category} Combination`,
      category,
      active: true,
      note: "",
      terms: [{ caseId: defaultCaseId, factor: 1, active: true }],
    };
    commit((prev) => ({ ...prev, loadCombinations: [...(prev.loadCombinations ?? []), nextCombo] }));
  }

  function updateLoadCombination(comboId: string, patch: Partial<LoadCombination>) {
    commit((prev) => ({
      ...prev,
      loadCombinations: (prev.loadCombinations ?? []).map((combo) => (combo.id === comboId ? { ...combo, ...patch } : combo)),
    }));
  }

  function removeLoadCombination(comboId: string) {
    commit((prev) => ({
      ...prev,
      loadCombinations: (prev.loadCombinations ?? []).filter((combo) => combo.id !== comboId),
      envelopeDefinitions: (prev.envelopeDefinitions ?? []).map((env) => ({
        ...env,
        combinationIds: env.combinationIds.filter((id) => id !== comboId),
      })),
    }));
  }

  function addCombinationTerm(comboId: string) {
    const defaultCaseId = (inputs.loadCases ?? [])[0]?.id ?? "BASE";
    commit((prev) => ({
      ...prev,
      loadCombinations: (prev.loadCombinations ?? []).map((combo) =>
        combo.id === comboId
          ? {
              ...combo,
              terms: [...combo.terms, { caseId: defaultCaseId, factor: 1, active: true }],
            }
          : combo
      ),
    }));
  }

  function updateCombinationTerm(
    comboId: string,
    termIndex: number,
    patch: Partial<{ caseId: string; factor: number; active?: boolean; note?: string }>
  ) {
    commit((prev) => ({
      ...prev,
      loadCombinations: (prev.loadCombinations ?? []).map((combo) =>
        combo.id === comboId
          ? {
              ...combo,
              terms: combo.terms.map((term, idx) => (idx === termIndex ? { ...term, ...patch } : term)),
            }
          : combo
      ),
    }));
  }

  function removeCombinationTerm(comboId: string, termIndex: number) {
    commit((prev) => ({
      ...prev,
      loadCombinations: (prev.loadCombinations ?? []).map((combo) =>
        combo.id === comboId
          ? {
              ...combo,
              terms: combo.terms.filter((_, idx) => idx !== termIndex),
            }
          : combo
      ),
    }));
  }

  function applyGenericCombinationTemplate(kind: "ULS" | "SLS") {
    const activeCases = (inputs.loadCases ?? []).filter((c) => c.active !== false);
    const idsByCategory = (cat: (typeof CASE_CATEGORY_OPTIONS)[number]) =>
      activeCases.filter((c) => normalizeCategoryId(c.category ?? "custom") === cat).map((c) => c.id);
    const deadIds = idsByCategory("dead");
    const liveIds = [...idsByCategory("live"), ...idsByCategory("variable")];
    const thermalIds = idsByCategory("thermal");
    const constructionIds = idsByCategory("construction");
    const fallbackIds = activeCases.length > 0 ? activeCases.map((c) => c.id) : ["BASE"];

    const terms =
      kind === "ULS"
        ? [
            ...deadIds.map((caseId) => ({ caseId, factor: 1.35, active: true })),
            ...liveIds.map((caseId) => ({ caseId, factor: 1.5, active: true })),
            ...thermalIds.map((caseId) => ({ caseId, factor: 1.2, active: true })),
            ...constructionIds.map((caseId) => ({ caseId, factor: 1.2, active: true })),
          ]
        : [
            ...deadIds.map((caseId) => ({ caseId, factor: 1.0, active: true })),
            ...liveIds.map((caseId) => ({ caseId, factor: 1.0, active: true })),
            ...thermalIds.map((caseId) => ({ caseId, factor: 1.0, active: true })),
            ...constructionIds.map((caseId) => ({ caseId, factor: 1.0, active: true })),
          ];

    const normalizedTerms = (terms.length > 0 ? terms : fallbackIds.map((caseId) => ({ caseId, factor: 1, active: true }))).filter(
      (term, idx, arr) => arr.findIndex((x) => x.caseId === term.caseId) === idx
    );

    const id = kind === "ULS" ? "ULS_GEN" : "SLS_GEN";
    const name = kind === "ULS" ? "ULS Generic Template" : "SLS Generic Template";
    commit((prev) => {
      const existing = (prev.loadCombinations ?? []).some((combo) => combo.id === id);
      const combo: LoadCombination = {
        id,
        name,
        category: kind,
        active: true,
        note: "Auto-generated generic template. Fully editable.",
        terms: normalizedTerms,
      };
      return {
        ...prev,
        loadCombinations: existing
          ? (prev.loadCombinations ?? []).map((c) => (c.id === id ? combo : c))
          : [...(prev.loadCombinations ?? []), combo],
      };
    });
  }

  function saveCombinationTemplate(comboId: string) {
    const combo = (inputs.loadCombinations ?? []).find((c) => c.id === comboId);
    if (!combo) return;
    const templateId = `${Date.now()}-${combo.id}`;
    setSavedComboTemplates((prev) => [
      {
        id: templateId,
        name: combo.name,
        category: combo.category ?? "custom",
        note: combo.note,
        terms: combo.terms.map((t) => ({ caseId: t.caseId, factor: t.factor })),
      },
      ...prev,
    ]);
  }

  function applySavedTemplate(templateId: string) {
    const template = savedComboTemplates.find((t) => t.id === templateId);
    if (!template) return;
    const existingIds = (inputs.loadCombinations ?? []).map((c) => c.id);
    const comboId = nextSequentialId("COMBO", existingIds);
    const knownCaseIds = new Set(["BASE", ...(inputs.loadCases ?? []).map((c) => c.id)]);
    const fallbackCaseId = (inputs.loadCases ?? [])[0]?.id ?? "BASE";
    const unknownTerms = template.terms.filter((t) => !knownCaseIds.has(t.caseId)).map((t) => t.caseId);
    const normalizedTerms = template.terms.map((t) => ({
      caseId: knownCaseIds.has(t.caseId) ? t.caseId : fallbackCaseId,
      factor: t.factor,
      active: true,
    }));
    const combo: LoadCombination = {
      id: comboId,
      name: `${template.name} (from template)`,
      category: template.category,
      active: true,
      note:
        unknownTerms.length > 0
          ? `${template.note ?? "Applied from saved template."} Case remap: ${unknownTerms.join(", ")} -> ${fallbackCaseId}.`
          : template.note ?? "Applied from saved template.",
      terms: normalizedTerms,
    };
    commit((prev) => ({
      ...prev,
      loadCombinations: [...(prev.loadCombinations ?? []), combo],
    }));
  }

  function removeSavedTemplate(templateId: string) {
    setSavedComboTemplates((prev) => prev.filter((t) => t.id !== templateId));
  }

  function addEnvelopeDefinition() {
    const existing = inputs.envelopeDefinitions ?? [];
    const id = nextSequentialId("ENV", existing.map((env) => env.id));
    const comboIds = (inputs.loadCombinations ?? []).map((combo) => combo.id);
    const env: EnvelopeDefinition = {
      id,
      name: `Envelope ${existing.length + 1}`,
      active: existing.length === 0,
      combinationIds: comboIds,
      note: "",
    };
    commit((prev) => ({
      ...prev,
      envelopeDefinitions: [...(prev.envelopeDefinitions ?? []), env],
    }));
  }

  function updateEnvelopeDefinition(id: string, patch: Partial<EnvelopeDefinition>) {
    commit((prev) => ({
      ...prev,
      envelopeDefinitions: (prev.envelopeDefinitions ?? []).map((env) => (env.id === id ? { ...env, ...patch } : env)),
    }));
  }

  function toggleEnvelopeDefinitionActive(id: string) {
    commit((prev) => ({
      ...prev,
      envelopeDefinitions: (prev.envelopeDefinitions ?? []).map((env) => ({
        ...env,
        active: env.id === id,
      })),
    }));
  }

  function toggleEnvelopeCombination(envelopeId: string, comboId: string) {
    commit((prev) => ({
      ...prev,
      envelopeDefinitions: (prev.envelopeDefinitions ?? []).map((env) => {
        if (env.id !== envelopeId) return env;
        const has = env.combinationIds.includes(comboId);
        return {
          ...env,
          combinationIds: has ? env.combinationIds.filter((id) => id !== comboId) : [...env.combinationIds, comboId],
        };
      }),
    }));
  }

  function removeEnvelopeDefinition(id: string) {
    commit((prev) => {
      const remaining = (prev.envelopeDefinitions ?? []).filter((env) => env.id !== id);
      const normalized =
        remaining.length > 0 && remaining.every((env) => env.active === false)
          ? remaining.map((env, idx) => ({ ...env, active: idx === 0 }))
          : remaining;
      return {
        ...prev,
        envelopeDefinitions: normalized,
      };
    });
  }

  function saveScenario() {
    const trimmed = scenarioName.trim() || `Checkpoint ${scenarios.length + 1}`;
    setScenarios((prev) => [
      {
        id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        name: trimmed,
        at: new Date().toLocaleString(),
        inputs: JSON.parse(JSON.stringify(inputs)) as BeamBendingInputs,
      },
      ...prev,
    ]);
  }

  function loadScenario(id: string) {
    const found = scenarios.find((s) => s.id === id);
    if (!found) return;
    commit(found.inputs);
    setIsolatedLoadId(null);
    setSelectedId(found.inputs.loads.find((l) => !l.hidden)?.id ?? null);
  }

  function removeScenario(id: string) {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
    if (compareScenarioId === id) setCompareScenarioId("");
  }

  function exportInputsJson() {
    const txt = JSON.stringify(inputs, null, 2);
    setImportDraft(txt);
    try {
      navigator.clipboard.writeText(txt);
      setExportMsg("Inputs JSON copied to clipboard");
    } catch {
      setExportMsg("Inputs JSON ready in import box");
    }
    window.setTimeout(() => setExportMsg(""), 1800);
  }

  function importInputsJson() {
    try {
      const parsed = JSON.parse(importDraft) as BeamBendingInputs;
      commit(parsed);
      setIsolatedLoadId(null);
      setSelectedId(parsed.loads.find((l) => !l.hidden)?.id ?? null);
      setImportError("");
      setExportMsg("Imported JSON scenario");
    } catch {
      setImportError("Import parse error: ensure JSON matches BeamBendingInputs schema.");
      setExportMsg("Import failed: invalid JSON");
    }
    window.setTimeout(() => setExportMsg(""), 1800);
  }

  async function copyShareUrl() {
    const payload = btoa(encodeURIComponent(JSON.stringify(inputs)));
    const url = `${window.location.origin}${window.location.pathname}?beam=${payload}`;
    try {
      await navigator.clipboard.writeText(url);
      setExportMsg("Share URL copied");
    } catch {
      setExportMsg("Share URL copy failed");
    }
    window.setTimeout(() => setExportMsg(""), 1800);
  }

  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const isUndo = (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !ev.shiftKey;
      const isRedo =
        (ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === "y" || (ev.key.toLowerCase() === "z" && ev.shiftKey));
      if (isUndo) {
        ev.preventDefault();
        undo();
        return;
      }
      if (isRedo) {
        ev.preventDefault();
        redo();
        return;
      }
      if (!selectedId) return;
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      const active = document.activeElement as HTMLElement | null;
      const blocked = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
      if (blocked) return;
      const sign = ev.key === "ArrowRight" ? 1 : -1;
      const base = snapStep > 0 ? snapStep : Math.max(inputs.L / 200, 0.01);
      const step = ev.shiftKey ? base * 10 : base;
      ev.preventDefault();
      nudgeSelectedLoad(selectedId, sign * step);
    };

    function nudgeSelectedLoad(id: string, dx: number) {
      commit((prev) => {
        const load = prev.loads.find((l) => l.id === id);
        if (!load) return prev;
        if (load.locked) return prev;
        if (load.hidden) return prev;
        const nextLoads = prev.loads.map((l) => {
          if (l.id !== id) return l;
          if (l.type === "point_load" || l.type === "moment") {
            return { ...l, x: clamp(l.x + dx, 0, prev.L) };
          }
          const len = l.x2 - l.x1;
          let x1 = l.x1 + dx;
          let x2 = x1 + len;
          if (x1 < 0) {
            x1 = 0;
            x2 = len;
          }
          if (x2 > prev.L) {
            x2 = prev.L;
            x1 = x2 - len;
          }
          return { ...l, x1: clamp(x1, 0, prev.L), x2: clamp(x2, 0, prev.L) };
        });
        return { ...prev, loads: nextLoads };
      });
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [inputs, selectedId, snapStep, commit, undo, redo]);

  async function onExportPdf() {
    if (!reportRef.current || !solved.ok) return;
    try {
      setIsExporting(true);
      setExportStage("preparing");
      setExportMsg("Preparing report...");
      setPrintTimestamp(new Date().toLocaleString());
      await new Promise((resolve) => window.setTimeout(resolve, 10));
      const orderedNames = ["header", "inputs", "assumptions", "results", "warnings", "audit", "plots", "beam", "combos", "influence", "explain", "worked"];
      const sections = orderedNames
        .map((name) => printRefs.current[name])
        .filter((v): v is HTMLDivElement => Boolean(v));
      await exportReportPdfFromSections({
        title: `Beam Bending Report (${reportTemplate.replace("_", " ")})`,
        sections,
        marginMm: 10,
        pageFormat: "a4",
        orientation: "p",
        qualityPreset: "balanced",
        onStage: (stage) => {
          setExportStage(stage);
          if (stage === "capturing") setExportMsg("Capturing report sections...");
          if (stage === "paginating") setExportMsg("Paginating report...");
          if (stage === "saving") setExportMsg("Saving PDF...");
        },
      });
      setExportStage("idle");
      setExportMsg("PDF exported");
    } catch (e) {
      setExportStage("error");
      const msg = e instanceof Error ? e.message : "Unknown export error";
      const friendly =
        msg.includes("EMPTY_SECTIONS")
          ? "Report has no exportable sections. Re-run analysis and retry."
          : msg.includes("PREFLIGHT")
            ? "Report preflight failed. Ensure solve is valid and report sections are visible."
            : msg.includes("TIMEOUT")
              ? "Export timed out during capture. Check fonts/images and retry."
              : msg.includes("CANVAS")
                ? "Canvas rendering failed. Retry with fewer open sections."
                : "Capture failed. Retry export and check browser asset permissions.";
      setExportMsg(`Export failed: ${friendly}`);
    } finally {
      setIsExporting(false);
      window.setTimeout(() => setExportMsg(""), 2200);
    }
  }

  const compareScenario = scenarios.find((s) => s.id === compareScenarioId);
  const compareSolved = useMemo(() => {
    if (!compareScenario) return null;
    const compareIssues = getBeamInputIssues(compareScenario.inputs);
    if (compareIssues.length) return null;
    try {
      return solveBeamBending(compareScenario.inputs, { detailLevel: workedMode });
    } catch {
      return null;
    }
  }, [compareScenario, workedMode]);
  const warningCount = solved.ok ? (solved.data.outputs.warningDetails?.length ?? solved.data.outputs.validityWarnings.length) : 0;
  const quickSolveStatus = solved.ok ? "valid" : "invalid";
  const confidenceText = solved.ok ? solved.data.outputs.quality?.confidenceBadge?.toUpperCase() ?? "N/A" : "N/A";
  const loadNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of inputs.loads) map.set(l.id, loadDisplayName(l));
    return map;
  }, [inputs.loads]);
  const sortedScenarios = useMemo(
    () => [...scenarios].sort((a, b) => b.id.localeCompare(a.id)).map((s) => ({ ...s, atLabel: formatCheckpointStamp(s.at) })),
    [scenarios]
  );
  const governingExplainability = useMemo(() => {
    if (!solved.ok || !solved.data.outputs.explainability?.length) return null;
    return solved.data.outputs.explainability
      .slice()
      .sort((a, b) => b.contributionPctOfM - a.contributionPctOfM)[0] ?? null;
  }, [solved]);
  const displayUnits = useMemo(() => getDisplayUnits(inputs.displayUnits), [inputs.displayUnits]);
  const supportStations = useMemo(() => resolveSupportStationsForView(inputs), [inputs]);
  const hasCustomSupportStations = (inputs.supportLayout?.stations ?? []).some((station) => station.active !== false);
  const stiffnessSegments = useMemo(() => inputs.stiffnessSegments ?? [], [inputs.stiffnessSegments]);
  const internalReleases = useMemo(
    () => (inputs.internalReleases ?? []).filter((release) => release.active !== false),
    [inputs.internalReleases]
  );
  const movingLoadTemplates = useMemo(() => inputs.movingLoadTemplates ?? [], [inputs.movingLoadTemplates]);
  const supportChartMarkers = useMemo(
    () =>
      supportStations
        .map((station) => station.x)
        .filter((x) => Number.isFinite(x))
        .sort((a, b) => a - b),
    [supportStations]
  );
  const segmentChartMarkers = useMemo(
    () =>
      Array.from(
        new Set(
          stiffnessSegments
            .flatMap((segment) => [segment.x1, segment.x2])
            .map((x) => clamp(x, 0, inputs.L))
            .map((x) => Number(x.toFixed(9)))
            .filter((x) => x > 1e-9 && x < inputs.L - 1e-9)
        )
      ).sort((a, b) => a - b),
    [stiffnessSegments, inputs.L]
  );
  const releaseChartMarkers = useMemo(
    () =>
      internalReleases
        .map((release) => clamp(release.x, 0, inputs.L))
        .filter((x) => Number.isFinite(x) && x > 1e-9 && x < inputs.L - 1e-9)
        .sort((a, b) => a - b),
    [internalReleases, inputs.L]
  );
  const supportLabel = hasCustomSupportStations
    ? `${humanizeToken(inputs.support)} @ ${supportStations
        .map((s) => formatUnitNumber(s.x, displayUnits, "length", 4))
        .join(", ")}`
    : humanizeToken(inputs.support);
  const theoryLabel = humanizeToken(inputs.theory ?? "euler_bernoulli");
  const reportTemplateLabel = humanizeToken(reportTemplate);
  const displayUnitLabel = displayUnits.system === "engineering_metric" ? "Engineering Metric" : "SI Base";
  const fmtUnit = (value: number, quantity: UnitQuantity, sig = 4) =>
    formatUnitValue(value, displayUnits, quantity, sig);
  const fmtUnitNumber = (value: number, quantity: UnitQuantity, sig = 4) =>
    formatUnitNumber(value, displayUnits, quantity, sig);
  const fmtForce = (value: number, sig = 4) => fmtUnit(value, "force", sig);
  const fmtForceN = (value: number, sig = 4) => fmtUnitNumber(value, "force", sig);
  const fmtLength = (value: number, sig = 4) => fmtUnit(value, "length", sig);
  const fmtLengthN = (value: number, sig = 4) => fmtUnitNumber(value, "length", sig);
  const fmtMoment = (value: number, sig = 4) => fmtUnit(value, "moment", sig);
  const fmtMomentN = (value: number, sig = 4) => fmtUnitNumber(value, "moment", sig);
  const fmtDistributed = (value: number, sig = 4) => fmtUnit(value, "distributedLoad", sig);
  const fmtDeflection = (value: number, sig = 4) => fmtUnit(value, "deflection", sig);
  const fmtDeflectionN = (value: number, sig = 4) => fmtUnitNumber(value, "deflection", sig);
  const fmtStressN = (value: number, sig = 4) => fmtUnitNumber(value, "stress", sig);
  const fmtInertia = (value: number, sig = 4) => fmtUnit(value, "inertia", sig);
  const fmtRotation = (value: number, sig = 4) => fmtUnit(value, "rotation", sig);
  const fmtArea = (value: number, sig = 4) => fmtUnit(value, "area", sig);
  const fmtSectionModulus = (value: number, sig = 4) => fmtUnit(value, "sectionModulus", sig);
  const fmtPlain = (value: number, sig = 4) => formatEngineeringNumber(value, sig);
  const modeLabel = workflowMode === "learning" ? "Learning" : workflowMode === "advanced" ? "Advanced" : "Design";
  const modeSummary =
    workflowMode === "learning"
      ? "Learning mode emphasizes worked logic and interpretation."
      : workflowMode === "advanced"
        ? "Advanced mode emphasizes diagnostics and solver controls."
        : "Design mode emphasizes governing utilization and pass/fail.";
  const modeZoneHint =
    workflowMode === "learning"
      ? { setup: "Learn assumptions", loads: "Learn load behavior", analysis: "Learn response", compare: "Learn revisions" }
      : workflowMode === "advanced"
        ? { setup: "Tune model fidelity", loads: "Control precision", analysis: "Inspect diagnostics", compare: "Trace audit history" }
        : { setup: "Build design-ready model", loads: "Define load intent", analysis: "Review governing checks", compare: "Report and compare" };
  const showAdvancedSetup = inputStep === "advanced" || workflowMode === "advanced";
  const effectiveArea = sectionPreview?.A ?? inputs.A;
  const selfWeightEstimate =
    effectiveArea !== undefined && inputs.material?.density
      ? effectiveArea * inputs.material.density * 9.80665
      : undefined;
  const selfWeightGeneratedLoad = inputs.loads.find((l) => l.id === SELF_WEIGHT_LOAD_ID && l.type === "udl");
  const selfWeightEnabled = Boolean(selfWeightGeneratedLoad);
  const canGenerateSelfWeight = typeof selfWeightEstimate === "number" && Number.isFinite(selfWeightEstimate) && selfWeightEstimate > 0;
  const visibleLoadCount = inputs.loads.filter((l) => !l.hidden).length;
  const hiddenLoadCount = inputs.loads.length - visibleLoadCount;
  const loadCases = useMemo(() => inputs.loadCases ?? [], [inputs.loadCases]);
  const loadCombinations = useMemo(() => inputs.loadCombinations ?? [], [inputs.loadCombinations]);
  const envelopeDefinitions = useMemo(() => inputs.envelopeDefinitions ?? [], [inputs.envelopeDefinitions]);
  const loadCategories = useMemo(
    () => mergeLoadCategories(inputs.loadCategories, loadCases, inputs.loads),
    [inputs.loadCategories, loadCases, inputs.loads]
  );
  const loadCaseOptions = useMemo(
    () => loadCases.map((c) => ({ id: c.id, name: c.name, active: c.active !== false })),
    [loadCases]
  );
  const loadCategoryOptions = useMemo(
    () => loadCategories.map((c) => ({ id: c.id, name: c.name, active: c.active !== false })),
    [loadCategories]
  );
  const groupedLoads = useMemo(
    () =>
      LOAD_TYPE_ORDER.map((type) => ({
        type,
        loads: inputs.loads.filter((l) => l.type === type),
      })).filter((group) => group.loads.length > 0),
    [inputs.loads]
  );
  const activeCaseCount = loadCases.filter((c) => c.active !== false).length;
  const activeCombinationCount = loadCombinations.filter((combo) => combo.active !== false).length;
  const activeLoadCategoryCount = loadCategories.filter((c) => c.active !== false).length;
  const activeEnvelopeDefinition = envelopeDefinitions.find((env) => env.active !== false) ?? envelopeDefinitions[0] ?? null;
  const caseAssignmentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of loadCases) map.set(c.id, 0);
    for (const l of inputs.loads) {
      if (!l.caseId) continue;
      map.set(l.caseId, (map.get(l.caseId) ?? 0) + 1);
    }
    return map;
  }, [loadCases, inputs.loads]);
  const caseCombinationRefCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of loadCases) map.set(c.id, 0);
    for (const combo of loadCombinations) {
      for (const term of combo.terms) {
        map.set(term.caseId, (map.get(term.caseId) ?? 0) + 1);
      }
    }
    return map;
  }, [loadCases, loadCombinations]);
  const unassignedLoadCount = useMemo(() => inputs.loads.filter((l) => !l.caseId).length, [inputs.loads]);
  const combinationHealth = useMemo(() => {
    const activeCaseIds = new Set(loadCases.filter((c) => c.active !== false).map((c) => c.id));
    const knownCaseIds = new Set(["BASE", ...loadCases.map((c) => c.id)]);
    const referencedInactiveCases = new Set<string>();
    const referencedUnknownCases = new Set<string>();
    const emptyActiveCombos: string[] = [];
    for (const combo of loadCombinations) {
      if (combo.active === false) continue;
      const activeTerms = combo.terms.filter((term) => term.active !== false);
      if (activeTerms.length === 0) {
        emptyActiveCombos.push(combo.id);
      }
      for (const term of activeTerms) {
        if (!knownCaseIds.has(term.caseId)) {
          referencedUnknownCases.add(term.caseId);
          continue;
        }
        if (term.caseId !== "BASE" && !activeCaseIds.has(term.caseId)) {
          referencedInactiveCases.add(term.caseId);
        }
      }
    }
    return {
      referencedInactiveCases: Array.from(referencedInactiveCases),
      referencedUnknownCases: Array.from(referencedUnknownCases),
      emptyActiveCombos,
    };
  }, [loadCases, loadCombinations]);
  const categoryUsage = useMemo(() => {
    return loadCategories.map((categoryDef) => {
      const category = categoryDef.id;
      const caseCount = loadCases.filter((c) => normalizeCategoryId(c.category ?? "custom") === category).length;
      const loadCount = inputs.loads.filter((l) => normalizeCategoryId(l.category ?? "custom") === category).length;
      return { category, name: categoryDef.name, active: categoryDef.active !== false, caseCount, loadCount, note: categoryDef.note ?? "" };
    });
  }, [loadCategories, loadCases, inputs.loads]);
  const unknownCategoryUsage = useMemo(() => {
    const known = new Set(loadCategories.map((c) => c.id));
    const unknown = new Set<string>();
    for (const c of loadCases) {
      if (c.category && !known.has(normalizeCategoryId(c.category))) unknown.add(c.category);
    }
    for (const l of inputs.loads) {
      if (l.category && !known.has(normalizeCategoryId(l.category))) unknown.add(l.category);
    }
    return Array.from(unknown);
  }, [loadCategories, loadCases, inputs.loads]);
  const governingUtilization = !solved.ok
    ? null
    : solved.data.outputs.designChecks
      ? Math.max(
          solved.data.outputs.designChecks.deflectionUtilization,
          solved.data.outputs.designChecks.bendingUtilization ?? 0,
          solved.data.outputs.designChecks.shearUtilization ?? 0
        )
      : null;
  const governingMode = solved.ok ? solved.data.outputs.designChecks?.governingMode ?? "serviceability" : "n/a";
  const governingX = !solved.ok
    ? null
    : solved.data.outputs.designChecks?.governingMode === "shear"
      ? solved.data.outputs.xAtVabsMax
      : solved.data.outputs.designChecks?.governingMode === "deflection"
        ? solved.data.outputs.xAtYAbsMax
        : solved.data.outputs.xAtMabsMax;
  const overallPass = solved.ok ? solved.data.outputs.designChecks?.pass ?? solved.data.outputs.serviceability.passes : null;
  const worstWarning = !solved.ok
    ? "Input issues block solve."
    : (() => {
        const details =
          solved.data.outputs.warningDetails ??
          solved.data.outputs.validityWarnings.map((w, idx) => parseWarningText(w, `warn_${idx + 1}`));
        if (details.length === 0) return "No active warnings.";
        const severityRank = (severity: WarningDetail["severity"]) =>
          severity === "critical" ? 3 : severity === "warning" ? 2 : 1;
        const top = details.slice().sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
        return `${top.trigger} ${top.consequence}`;
      })();
  const maxRotation = solved.ok ? solved.data.outputs.thetaAbsMax : undefined;
  const maxRotationX = solved.ok ? solved.data.outputs.xAtThetaAbsMax : undefined;
  const axisTickStyle = { fill: "rgba(226, 232, 240, 0.78)", fontSize: 11 };
  const axisLineStyle = { stroke: "rgba(148, 163, 184, 0.36)" };
  const tickFmtLength = (v: number | string) => fmtLengthN(Number(v), 4);
  const tickFmtForce = (v: number | string) => fmtForceN(Number(v), 4);
  const tickFmtMoment = (v: number | string) => fmtMomentN(Number(v), 4);
  const tickFmtDeflection = (v: number | string) => fmtDeflectionN(Number(v), 4);
  const tickFmtRotation = (v: number | string) => fmtUnitNumber(Number(v), "rotation", 4);
  const chartTooltipStyle = {
    backgroundColor: "rgba(7, 18, 30, 0.94)",
    border: "1px solid rgba(148, 163, 184, 0.38)",
    borderRadius: 10,
  };
  const envelopeStats = useMemo(() => {
    if (!solved.ok) return null;
    const env = solved.data.outputs.envelope ?? [];
    if (env.length === 0) return null;
    const maxMoment = env.reduce((best, p) => (Math.abs(p.Mmax) > Math.abs(best.value) ? { x: p.x, value: p.Mmax } : best), {
      x: env[0].x,
      value: env[0].Mmax,
    });
    const minMoment = env.reduce((best, p) => (p.Mmin < best.value ? { x: p.x, value: p.Mmin } : best), {
      x: env[0].x,
      value: env[0].Mmin,
    });
    const maxShear = env.reduce((best, p) => (Math.abs(p.Vmax) > Math.abs(best.value) ? { x: p.x, value: p.Vmax } : best), {
      x: env[0].x,
      value: env[0].Vmax,
    });
    const minShear = env.reduce((best, p) => (p.Vmin < best.value ? { x: p.x, value: p.Vmin } : best), {
      x: env[0].x,
      value: env[0].Vmin,
    });
    const maxDeflection = env.reduce((best, p) => (Math.abs(p.ymax) > Math.abs(best.value) ? { x: p.x, value: p.ymax } : best), {
      x: env[0].x,
      value: env[0].ymax,
    });
    const minDeflection = env.reduce((best, p) => (p.ymin < best.value ? { x: p.x, value: p.ymin } : best), {
      x: env[0].x,
      value: env[0].ymin,
    });
    return {
      maxMoment,
      minMoment,
      maxShear,
      minShear,
      maxDeflection,
      minDeflection,
    };
  }, [solved]);
  const warningCards = useMemo(() => {
    if (!solved.ok) return [];
    const fromSolver = solved.data.outputs.warningDetails ?? [];
    if (fromSolver.length > 0) return fromSolver;
    return solved.data.outputs.validityWarnings.map((w, idx) => parseWarningText(w, `warn_${idx + 1}`));
  }, [solved]);
  const confidenceSubscores = solved.ok ? solved.data.outputs.quality?.confidenceSubscores : undefined;
  const confidenceDrivers = solved.ok ? solved.data.outputs.quality?.confidenceDrivers ?? [] : [];
  const assumptionsProfile = solved.ok ? solved.data.outputs.assumptions : undefined;
  const assumptionsView = useMemo(() => assumptionsProfile ?? buildAssumptionsPreview(inputs), [assumptionsProfile, inputs]);
  const solveAudit = solved.ok ? solved.data.outputs.solveAudit : undefined;
  const cursorResponse = useMemo(() => {
    if (!solved.ok) return null;
    return {
      V: interpolatePlotValue(solved.data.plots.sfd, "V", activeCursorX),
      M: interpolatePlotValue(solved.data.plots.bmd, "M", activeCursorX),
      y: interpolatePlotValue(solved.data.plots.deflection, "y", activeCursorX),
      theta: interpolatePlotValue(solved.data.plots.rotation, "theta", activeCursorX),
    };
  }, [solved, activeCursorX]);

  return (
    <div className={`page beamTool beamMode-${workflowMode}`}>
      <div className="pageHeader beamHeaderCompact">
        <div className="beamHeaderMain">
          <div className="beamHeaderKicker">Engineering Tools Hub / 1D Elastic Beam</div>
          <h1>Beam Bending</h1>
          <p>Trusted beam response, governing checks, and report-ready output in a compact engineering workflow.</p>
        </div>
        <div className="beamHeaderModes">
          <div className="field">
            <div className="fieldLabel">Workflow Mode</div>
            <div className="segmented" role="tablist" aria-label="Workflow Mode">
              <button className={workflowMode === "learning" ? "segBtn active" : "segBtn"} onClick={() => setWorkflowMode("learning")} aria-pressed={workflowMode === "learning"}>
                Learning
              </button>
              <button className={workflowMode === "design" ? "segBtn active" : "segBtn"} onClick={() => setWorkflowMode("design")} aria-pressed={workflowMode === "design"}>
                Design
              </button>
              <button className={workflowMode === "advanced" ? "segBtn active" : "segBtn"} onClick={() => setWorkflowMode("advanced")} aria-pressed={workflowMode === "advanced"}>
                Advanced
              </button>
            </div>
          </div>
          <label className="field">
            <div className="fieldLabel">Report Template</div>
            <select className="input" value={reportTemplate} onChange={(e) => setReportTemplate(e.target.value as "calc_note" | "submission" | "teaching")}>
              <option value="calc_note">Calculation Note</option>
              <option value="submission">Submission</option>
              <option value="teaching">Teaching</option>
            </select>
          </label>
          <div className="muted beamModeSummary">{modeSummary}</div>
        </div>
      </div>

      <div className="workflowStatus beamStatusBar">
        <div className="workflowStatusRow beamStatusRow">
          <span className="pill">Support: {supportLabel}</span>
          <span className={quickSolveStatus === "valid" ? "pill statusGood" : "pill statusWarn"}>Solve: {quickSolveStatus}</span>
          <span className="pill">Confidence: {confidenceText}</span>
          <span className="pill">Governing: {humanizeToken(governingMode)}</span>
          <span className={overallPass === true ? "pill statusGood" : overallPass === false ? "pill statusBad" : "pill"}>
            Overall: {overallPass === null ? "N/A" : overallPass ? "PASS" : "FAIL"}
          </span>
          <span className="pill">Warnings: {warningCount}</span>
          <span className="pill">Template: {reportTemplateLabel}</span>
          <span className="pill">Theory: {theoryLabel}</span>
          <span className="pill">Units: {displayUnitLabel}</span>
          {isExporting ? <span className="pill">Export stage: {exportStage}</span> : null}
          {exportMsg ? <span className="pill">{exportMsg}</span> : null}
        </div>
      </div>

      <div className="beamWorkflowLinks">
        <a href="#beam-zone-setup" className="pill">1. Setup</a>
        <a href="#beam-zone-loads" className="pill">2. Loads</a>
        <a href="#beam-zone-analysis" className="pill">3. Analysis</a>
        <a href="#beam-zone-compare" className="pill">4. Compare & Report</a>
      </div>

      <section className="workflowZone beamWorkflowZone" id="beam-zone-setup">
        <div className="workflowZoneHead beamWorkflowZoneHead">
          <h2>1. Model Setup</h2>
          <p>Define beam/support fundamentals and core model settings. {modeZoneHint.setup}</p>
        </div>
      <div className="twoCol" ref={reportRef}>
        <Panel
          title="Inputs"
          right={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn" onClick={undo} disabled={history.length === 0}>
                Undo
              </button>
              <button className="btn" onClick={redo} disabled={future.length === 0}>
                Redo
              </button>
              <button className="btn" onClick={resetExample}>
                Reset Example
              </button>
              <button className="btn" onClick={onExportPdf} disabled={!solved.ok || isExporting}>
                {isExporting ? "Exporting..." : "Export PDF"}
              </button>
            </div>
          }
        >
          <div className="segmented" style={{ marginBottom: 10 }}>
            <button className={inputStep === "beam" ? "segBtn active" : "segBtn"} onClick={() => setInputStep("beam")}>
              Essentials
            </button>
            <button className={inputStep === "advanced" ? "segBtn active" : "segBtn"} onClick={() => setInputStep("advanced")}>
              Advanced Setup
            </button>
          </div>
          <div className="form beamSetupForm">
            <CollapsibleSection
              id="setup-beam"
              title="Beam"
              summary="Primary geometry and interaction defaults."
              summaryChips={[`L ${fmtLength(inputs.L)}`, `snap ${snapStep === 0 ? "auto" : fmtLength(snapStep)}`]}
              defaultOpen
            >
              <NumberField
                label="Beam length L"
                value={inputs.L}
                quantity="length"
                units={displayUnits}
                step={0.1}
                min={0.1}
                onChange={(v) => commit({ ...inputs, L: v })}
                example="Use scientific form when needed, e.g. 2.5e1"
              />
              <label className="field">
                <div className="fieldLabel">Drag snap step</div>
                <select className="input" value={snapStep} onChange={(e) => setSnapStep(Number(e.target.value))}>
                  {SNAP_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value}>
                      {o.value === 0 ? "Auto" : fmtLength(o.value)}
                    </option>
                  ))}
                </select>
              </label>
            </CollapsibleSection>

            <CollapsibleSection
              id="setup-supports"
              title="Supports"
              summary="Boundary condition type and optional imposed support behavior."
              summaryChips={[humanizeToken(inputs.support)]}
              defaultOpen
            >
              <label className="field">
                <div className="fieldLabel">Support type</div>
                <select
                  className="input"
                  value={inputs.support}
                  onChange={(e) => {
                    const nextSupport = e.target.value as BeamBendingInputs["support"];
                    commit({
                      ...inputs,
                      support: nextSupport,
                      supportLayout: nextSupport === "simply_supported" ? inputs.supportLayout : undefined,
                    });
                  }}
                >
                  <option value="simply_supported">Simply supported</option>
                  <option value="cantilever">Cantilever</option>
                  <option value="fixed_fixed">Fixed-fixed</option>
                  <option value="propped_cantilever">Propped cantilever</option>
                </select>
              </label>
              {showAdvancedSetup && inputs.support === "simply_supported" ? (
                <div className="step">
                  <div className="loadCaseMetaRow">
                    <div className="stepTitle">Support stations and overhangs</div>
                    <button className={hasCustomSupportStations ? "btn btnSmall activePill" : "btn btnSmall btnGhost"} onClick={hasCustomSupportStations ? clearSupportStationLayout : () => setSupportStationPair((pair) => pair)}>
                      {hasCustomSupportStations ? "Using custom stations" : "Use custom stations"}
                    </button>
                  </div>
                  <div className="stepNote">
                    Custom stations enable non-end supports, left/right overhangs, and explicit support locations for simply-supported models.
                  </div>
                  {hasCustomSupportStations ? (
                    <div className="loadGrid">
                      <NumberField
                        label="Support S1 x"
                        value={supportStations[0]?.x ?? 0}
                        quantity="length"
                        units={displayUnits}
                        step={0.01}
                        min={0}
                        max={inputs.L}
                        onChange={(v) => setSupportStationPair(([s1, s2]) => [{ ...s1, x: clamp(v, 0, inputs.L) }, s2])}
                      />
                      <NumberField
                        label="Support S2 x"
                        value={supportStations[1]?.x ?? inputs.L}
                        quantity="length"
                        units={displayUnits}
                        step={0.01}
                        min={0}
                        max={inputs.L}
                        onChange={(v) => setSupportStationPair(([s1, s2]) => [s1, { ...s2, x: clamp(v, 0, inputs.L) }])}
                      />
                      <NumberField
                        label="Support S1 settlement"
                        value={supportStations[0]?.settlement ?? 0}
                        quantity="deflection"
                        units={displayUnits}
                        step={0.0005}
                        onChange={(v) => setSupportStationPair(([s1, s2]) => [{ ...s1, settlement: v }, s2])}
                      />
                      <NumberField
                        label="Support S2 settlement"
                        value={supportStations[1]?.settlement ?? 0}
                        quantity="deflection"
                        units={displayUnits}
                        step={0.0005}
                        onChange={(v) => setSupportStationPair(([s1, s2]) => [s1, { ...s2, settlement: v }])}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {showAdvancedSetup && !hasCustomSupportStations ? (
                <>
                  <NumberField
                    label="Left support settlement"
                    value={inputs.supportConditions?.leftSettlement ?? 0}
                    quantity="deflection"
                    units={displayUnits}
                    step={0.0005}
                    onChange={(v) => commit({ ...inputs, supportConditions: { ...inputs.supportConditions, leftSettlement: v } })}
                  />
                  <NumberField
                    label="Right support settlement"
                    value={inputs.supportConditions?.rightSettlement ?? 0}
                    quantity="deflection"
                    units={displayUnits}
                    step={0.0005}
                    onChange={(v) => commit({ ...inputs, supportConditions: { ...inputs.supportConditions, rightSettlement: v } })}
                  />
                  <NumberField
                    label="Left imposed rotation"
                    value={inputs.supportConditions?.leftRotation ?? 0}
                    quantity="rotation"
                    units={displayUnits}
                    step={0.0001}
                    onChange={(v) => commit({ ...inputs, supportConditions: { ...inputs.supportConditions, leftRotation: v } })}
                  />
                  <NumberField
                    label="Right imposed rotation"
                    value={inputs.supportConditions?.rightRotation ?? 0}
                    quantity="rotation"
                    units={displayUnits}
                    step={0.0001}
                    onChange={(v) => commit({ ...inputs, supportConditions: { ...inputs.supportConditions, rightRotation: v } })}
                  />
                  <NumberField
                    label="Left vertical spring k"
                    value={inputs.supportConditions?.leftVerticalSpring ?? 0}
                    quantity="springLinear"
                    units={displayUnits}
                    step={1000}
                    min={0}
                    onChange={(v) => commit({ ...inputs, supportConditions: { ...inputs.supportConditions, leftVerticalSpring: v || undefined } })}
                  />
                  <NumberField
                    label="Right vertical spring k"
                    value={inputs.supportConditions?.rightVerticalSpring ?? 0}
                    quantity="springLinear"
                    units={displayUnits}
                    step={1000}
                    min={0}
                    onChange={(v) => commit({ ...inputs, supportConditions: { ...inputs.supportConditions, rightVerticalSpring: v || undefined } })}
                  />
                  <NumberField
                    label="Left rotational spring k"
                    value={inputs.supportConditions?.leftRotationalSpring ?? 0}
                    quantity="springRotational"
                    units={displayUnits}
                    step={1000}
                    min={0}
                    onChange={(v) => commit({ ...inputs, supportConditions: { ...inputs.supportConditions, leftRotationalSpring: v || undefined } })}
                  />
                  <NumberField
                    label="Right rotational spring k"
                    value={inputs.supportConditions?.rightRotationalSpring ?? 0}
                    quantity="springRotational"
                    units={displayUnits}
                    step={1000}
                    min={0}
                    onChange={(v) => commit({ ...inputs, supportConditions: { ...inputs.supportConditions, rightRotationalSpring: v || undefined } })}
                  />
                </>
              ) : (
                <div className="fieldHint">
                  {hasCustomSupportStations
                    ? "Custom support stations are active. End spring controls are disabled for this configuration."
                    : "Switch to Advanced Setup to edit settlements, imposed rotations, and springs."}
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              id="setup-material-section"
              title="Material and Section"
              summary="Preset-driven material/section with editable engineering overrides."
              summaryChips={[inputs.material?.name ?? "custom material", inputs.section?.id ?? "manual section"]}
              defaultOpen
            >
              <label className="field">
                <div className="fieldLabel">Material preset</div>
                <select
                  className="input"
                  value={inputs.material?.id ?? "custom"}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === "custom") {
                      commit({
                        ...inputs,
                        material: {
                          id: "custom",
                          name: inputs.material?.name ?? "Custom",
                          E: inputs.E,
                          nu: inputs.nu,
                          density: inputs.material?.density,
                          yieldStress: inputs.material?.yieldStress,
                        },
                      });
                      return;
                    }
                    const preset = MATERIAL_PRESETS.find((m) => m.id === next);
                    if (!preset) return;
                    commit({
                      ...inputs,
                      material: { ...preset },
                      E: preset.E,
                      nu: preset.nu ?? inputs.nu,
                    });
                  }}
                >
                  <option value="custom">Custom</option>
                  {MATERIAL_PRESETS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <div className="fieldLabel">Material label</div>
                <input
                  className="input"
                  value={inputs.material?.name ?? ""}
                  placeholder="Optional label"
                  onChange={(e) =>
                    commit({
                      ...inputs,
                      material: inputs.material
                        ? { ...inputs.material, name: e.target.value }
                        : { id: "custom", name: e.target.value, E: inputs.E, nu: inputs.nu, density: undefined, yieldStress: undefined },
                    })
                  }
                />
              </label>
              <NumberField
                label="Young's modulus E"
                value={inputs.E}
                quantity="modulus"
                units={displayUnits}
                step={1e9}
                min={1}
                onChange={(v) =>
                  commit({
                    ...inputs,
                    E: v,
                    material: inputs.material ? { ...inputs.material, E: v } : inputs.material,
                  })
                }
              />
              <NumberField
                label="Poisson ratio nu"
                value={inputs.nu ?? 0.3}
                step={0.01}
                onChange={(v) =>
                  commit({
                    ...inputs,
                    nu: v,
                    material: inputs.material ? { ...inputs.material, nu: v } : inputs.material,
                  })
                }
              />
              <NumberField
                label="Material density"
                value={inputs.material?.density ?? 0}
                unitLabel="kg/m^3"
                step={25}
                min={0}
                onChange={(v) =>
                  commit({
                    ...inputs,
                    material: inputs.material
                      ? { ...inputs.material, density: v || undefined }
                      : { id: "custom", name: "Custom", E: inputs.E, nu: inputs.nu, density: v || undefined, yieldStress: undefined },
                  })
                }
              />
              <NumberField
                label="Yield stress"
                value={inputs.material?.yieldStress ?? 0}
                quantity="stress"
                units={displayUnits}
                step={5e6}
                min={0}
                onChange={(v) =>
                  commit({
                    ...inputs,
                    material: inputs.material
                      ? { ...inputs.material, yieldStress: v || undefined }
                      : { id: "custom", name: "Custom", E: inputs.E, nu: inputs.nu, density: undefined, yieldStress: v || undefined },
                  })
                }
              />
              <NumberField
                label="Second moment I"
                value={inputs.I}
                quantity="inertia"
                units={displayUnits}
                step={1e-7}
                min={1e-12}
                onChange={(v) => commit({ ...inputs, I: v })}
              />
              <NumberField
                label="Area A"
                value={inputs.A ?? 0.001}
                quantity="area"
                units={displayUnits}
                step={1e-4}
                min={1e-8}
                onChange={(v) => commit({ ...inputs, A: v })}
              />

              <label className="field">
                <div className="fieldLabel">Section preset</div>
                <select
                  className="input"
                  value={inputs.section?.id ?? "none"}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id === "none") {
                      commit({ ...inputs, section: undefined });
                      return;
                    }
                    commit({
                      ...inputs,
                      section: {
                        id: id as NonNullable<BeamBendingInputs["section"]>["id"],
                        unit: inputs.section?.unit ?? "mm",
                        dims: inputs.section?.dims ?? {},
                      },
                    });
                  }}
                >
                  <option value="none">None (manual A/I)</option>
                  <option value="rectangular">Rectangular</option>
                  <option value="circular_solid">Circular solid</option>
                  <option value="circular_hollow">Circular hollow</option>
                  <option value="i_beam">I-beam</option>
                  <option value="channel">Channel</option>
                </select>
              </label>

              {inputs.section ? (
                <>
                  <label className="field">
                    <div className="fieldLabel">Section dimension unit</div>
                    <select
                      className="input"
                      value={inputs.section.unit}
                      onChange={(e) =>
                        commit({
                          ...inputs,
                          section: { ...inputs.section!, unit: e.target.value as "m" | "mm" },
                        })
                      }
                    >
                      <option value="mm">mm</option>
                      <option value="m">m</option>
                    </select>
                  </label>
                  <div className="loadGrid">
                    {SECTION_FIELD_MAP[inputs.section.id].map((f) => (
                      <NumberField
                        key={f.key}
                        label={f.label}
                        value={inputs.section?.dims[f.key] ?? 0}
                        unitLabel={inputs.section?.unit}
                        step={inputs.section?.unit === "mm" ? 1 : 0.001}
                        min={0}
                        onChange={(v) =>
                          commit({
                            ...inputs,
                            section: {
                              ...inputs.section!,
                              dims: {
                                ...inputs.section!.dims,
                                [f.key]: v,
                              },
                            },
                          })
                        }
                      />
                    ))}
                  </div>
                </>
              ) : null}

              {sectionDimIssues.length > 0 ? (
                <div className="error">
                  {sectionDimIssues.map((w) => (
                    <div key={w}>{w}</div>
                  ))}
                </div>
              ) : null}
              {sectionPreview ? (
                <div className="step">
                  <div className="stepTitle">Derived property preview</div>
                  <div className="stepNote">A = {fmtArea(sectionPreview.A ?? 0)}</div>
                  <div className="stepNote">I = {fmtInertia(sectionPreview.I)}</div>
                  <div className="stepNote">Z = {fmtSectionModulus(sectionPreview.Z ?? 0)}</div>
                  <div className="stepNote">depth = {fmtLength(sectionPreview.depth ?? 0)}</div>
                  {selfWeightEstimate !== undefined ? <div className="stepNote">self-weight estimate = {fmtDistributed(selfWeightEstimate)}</div> : null}
                </div>
              ) : null}
            </CollapsibleSection>

            <CollapsibleSection
              id="setup-design-criteria"
              title="Design Criteria"
              summary="Serviceability and allowable design checks."
              summaryChips={[
                `L/d ${fmtPlain(inputs.serviceabilityLimitRatio ?? 360)}`,
                `defl ${fmtPlain(inputs.designCriteria?.deflectionLimitRatio ?? 360)}`,
              ]}
            >
              <NumberField
                label="Serviceability limit ratio (L/d)"
                value={inputs.serviceabilityLimitRatio ?? 360}
                step={5}
                min={1}
                onChange={(v) => commit({ ...inputs, serviceabilityLimitRatio: v })}
              />
              <NumberField
                label="Allowable bending stress"
                value={inputs.designCriteria?.allowableBendingStress ?? 250e6}
                quantity="stress"
                units={displayUnits}
                step={1e6}
                min={1}
                onChange={(v) => commit({ ...inputs, designCriteria: { ...inputs.designCriteria, allowableBendingStress: v } })}
              />
              <NumberField
                label="Allowable shear stress"
                value={inputs.designCriteria?.allowableShearStress ?? 145e6}
                quantity="stress"
                units={displayUnits}
                step={1e6}
                min={1}
                onChange={(v) => commit({ ...inputs, designCriteria: { ...inputs.designCriteria, allowableShearStress: v } })}
              />
              <NumberField
                label="Design deflection limit ratio (L/d)"
                value={inputs.designCriteria?.deflectionLimitRatio ?? 360}
                step={5}
                min={1}
                onChange={(v) => commit({ ...inputs, designCriteria: { ...inputs.designCriteria, deflectionLimitRatio: v } })}
              />
            </CollapsibleSection>

            <CollapsibleSection
              id="setup-units-display"
              title="Units and Display"
              summary="Display units only. Internal solver storage remains base SI."
              summaryChips={[displayUnitLabel, `${quantityUnitSymbol(displayUnits, "force")} / ${quantityUnitSymbol(displayUnits, "length")}`]}
              defaultOpen
            >
              <label className="field">
                <div className="fieldLabel">Display unit system</div>
                <select
                  className="input"
                  value={displayUnits.system}
                  onChange={(e) => {
                    const system = e.target.value as BeamDisplayUnits["system"];
                    commit({
                      ...inputs,
                      displayUnits: displayPreset(system),
                    });
                  }}
                >
                  <option value="si_base">Base SI</option>
                  <option value="engineering_metric">Engineering Metric</option>
                </select>
              </label>
              <div className="loadGrid">
                <label className="field">
                  <div className="fieldLabel">Force</div>
                  <select
                    className="input"
                    value={displayUnits.force}
                    onChange={(e) => commit({ ...inputs, displayUnits: { ...displayUnits, force: e.target.value as BeamDisplayUnits["force"] } })}
                  >
                    <option value="N">N</option>
                    <option value="kN">kN</option>
                  </select>
                </label>
                <label className="field">
                  <div className="fieldLabel">Length</div>
                  <select
                    className="input"
                    value={displayUnits.length}
                    onChange={(e) => commit({ ...inputs, displayUnits: { ...displayUnits, length: e.target.value as BeamDisplayUnits["length"] } })}
                  >
                    <option value="m">m</option>
                    <option value="mm">mm</option>
                  </select>
                </label>
                <label className="field">
                  <div className="fieldLabel">Moment</div>
                  <select
                    className="input"
                    value={displayUnits.moment}
                    onChange={(e) => commit({ ...inputs, displayUnits: { ...displayUnits, moment: e.target.value as BeamDisplayUnits["moment"] } })}
                  >
                    <option value="N·m">N·m</option>
                    <option value="kN·m">kN·m</option>
                  </select>
                </label>
                <label className="field">
                  <div className="fieldLabel">Distributed load</div>
                  <select
                    className="input"
                    value={displayUnits.distributedLoad}
                    onChange={(e) =>
                      commit({ ...inputs, displayUnits: { ...displayUnits, distributedLoad: e.target.value as BeamDisplayUnits["distributedLoad"] } })
                    }
                  >
                    <option value="N/m">N/m</option>
                    <option value="kN/m">kN/m</option>
                  </select>
                </label>
                <label className="field">
                  <div className="fieldLabel">Stress</div>
                  <select
                    className="input"
                    value={displayUnits.stress}
                    onChange={(e) => commit({ ...inputs, displayUnits: { ...displayUnits, stress: e.target.value as BeamDisplayUnits["stress"] } })}
                  >
                    <option value="Pa">Pa</option>
                    <option value="MPa">MPa</option>
                  </select>
                </label>
                <label className="field">
                  <div className="fieldLabel">Modulus</div>
                  <select
                    className="input"
                    value={displayUnits.modulus}
                    onChange={(e) => commit({ ...inputs, displayUnits: { ...displayUnits, modulus: e.target.value as BeamDisplayUnits["modulus"] } })}
                  >
                    <option value="Pa">Pa</option>
                    <option value="GPa">GPa</option>
                  </select>
                </label>
                <label className="field">
                  <div className="fieldLabel">Inertia</div>
                  <select
                    className="input"
                    value={displayUnits.inertia}
                    onChange={(e) => commit({ ...inputs, displayUnits: { ...displayUnits, inertia: e.target.value as BeamDisplayUnits["inertia"] } })}
                  >
                    <option value="m^4">m^4</option>
                    <option value="cm^4">cm^4</option>
                    <option value="mm^4">mm^4</option>
                  </select>
                </label>
                <label className="field">
                  <div className="fieldLabel">Rotation</div>
                  <select
                    className="input"
                    value={displayUnits.rotation}
                    onChange={(e) => commit({ ...inputs, displayUnits: { ...displayUnits, rotation: e.target.value as BeamDisplayUnits["rotation"] } })}
                  >
                    <option value="rad">rad</option>
                    <option value="mrad">mrad</option>
                    <option value="deg">deg</option>
                  </select>
                </label>
                <label className="field">
                  <div className="fieldLabel">Deflection</div>
                  <select
                    className="input"
                    value={displayUnits.deflection}
                    onChange={(e) => commit({ ...inputs, displayUnits: { ...displayUnits, deflection: e.target.value as BeamDisplayUnits["deflection"] } })}
                  >
                    <option value="m">m</option>
                    <option value="mm">mm</option>
                  </select>
                </label>
              </div>
              <div className="fieldHint">Unit labels are explicit across cards, plots, tooltips, worked steps, and report export.</div>
            </CollapsibleSection>

            {showAdvancedSetup ? (
              <>
                <CollapsibleSection
                  id="setup-theory-advanced"
                  title="Theory and Advanced Solver"
                  summary="Beam theory, shear model controls, and solve fidelity."
                  summaryChips={[
                    humanizeToken(inputs.theory ?? "euler_bernoulli"),
                    `mesh ${inputs.analysisOptions?.meshDensity ?? "normal"}`,
                  ]}
                  defaultOpen
                >
                  <label className="field">
                    <div className="fieldLabel">Beam theory</div>
                    <select
                      className="input"
                      value={inputs.theory ?? "euler_bernoulli"}
                      onChange={(e) =>
                        commit({
                          ...inputs,
                          theory: e.target.value as BeamBendingInputs["theory"],
                        })
                      }
                    >
                      <option value="euler_bernoulli">Euler-Bernoulli</option>
                      <option value="timoshenko">Timoshenko</option>
                    </select>
                  </label>
                  <NumberField
                    label="Shear correction kappa"
                    value={inputs.kappaShear ?? 5 / 6}
                    step={0.01}
                    min={0.01}
                    onChange={(v) => commit({ ...inputs, kappaShear: v })}
                  />
                  <label className="field">
                    <div className="fieldLabel">Mesh density</div>
                    <select
                      className="input"
                      value={inputs.analysisOptions?.meshDensity ?? "normal"}
                      onChange={(e) =>
                        commit({
                          ...inputs,
                          analysisOptions: {
                            ...inputs.analysisOptions,
                            meshDensity: e.target.value as "coarse" | "normal" | "fine",
                          },
                        })
                      }
                    >
                      <option value="coarse">Coarse</option>
                      <option value="normal">Normal</option>
                      <option value="fine">Fine</option>
                    </select>
                  </label>
                  <label className="field">
                    <div className="fieldLabel">Adaptive refinement</div>
                    <select
                      className="input"
                      value={(inputs.analysisOptions?.adaptiveRefinement ?? true) ? "on" : "off"}
                      onChange={(e) =>
                        commit({
                          ...inputs,
                          analysisOptions: {
                            ...inputs.analysisOptions,
                            adaptiveRefinement: e.target.value === "on",
                          },
                        })
                      }
                    >
                      <option value="on">On</option>
                      <option value="off">Off</option>
                    </select>
                  </label>
                  <NumberField
                    label="Solve debounce"
                    value={inputs.analysisOptions?.debounceMs ?? 120}
                    unitLabel="ms"
                    step={10}
                    min={0}
                    onChange={(v) => commit({ ...inputs, analysisOptions: { ...inputs.analysisOptions, debounceMs: v } })}
                  />
                </CollapsibleSection>

                <CollapsibleSection
                  id="setup-uncertainty"
                  title="Uncertainty"
                  summary="Sensitivity assumptions for E, I, and load magnitude."
                  summaryChips={[
                    `E±${fmtPlain(inputs.uncertainty?.EPercent ?? 0)}%`,
                    `I±${fmtPlain(inputs.uncertainty?.IPercent ?? 0)}%`,
                    `Load±${fmtPlain(inputs.uncertainty?.loadPercent ?? 0)}%`,
                  ]}
                  defaultOpen
                >
                  <NumberField
                    label="Uncertainty E"
                    value={inputs.uncertainty?.EPercent ?? 0}
                    unitLabel="%"
                    step={1}
                    min={0}
                    onChange={(v) => commit({ ...inputs, uncertainty: { ...inputs.uncertainty, EPercent: v } })}
                  />
                  <NumberField
                    label="Uncertainty I"
                    value={inputs.uncertainty?.IPercent ?? 0}
                    unitLabel="%"
                    step={1}
                    min={0}
                    onChange={(v) => commit({ ...inputs, uncertainty: { ...inputs.uncertainty, IPercent: v } })}
                  />
                  <NumberField
                    label="Uncertainty loads"
                    value={inputs.uncertainty?.loadPercent ?? 0}
                    unitLabel="%"
                    step={1}
                    min={0}
                    onChange={(v) => commit({ ...inputs, uncertainty: { ...inputs.uncertainty, loadPercent: v } })}
                  />
                </CollapsibleSection>

                <CollapsibleSection
                  id="setup-piecewise-segments"
                  title="Piecewise Beam Segments"
                  summary="Segment-wise E/I/A/G, section, and material override controls."
                  summaryChips={[`${stiffnessSegments.length} segment${stiffnessSegments.length === 1 ? "" : "s"}`]}
                >
                  <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <button className="btn btnSmall" onClick={addStiffnessSegment}>+ Add segment</button>
                    {stiffnessSegments.length > 0 ? (
                      <button className="btn btnSmall btnGhost" onClick={() => commit({ ...inputs, stiffnessSegments: [] })}>
                        Clear segments
                      </button>
                    ) : null}
                  </div>
                  {stiffnessSegments.length === 0 ? (
                    <div className="muted">No segment overrides active. Global properties are used along full span.</div>
                  ) : (
                    <div className="steps">
                      {stiffnessSegments.map((segment) => {
                        const customMaterialActive =
                          segment.materialPresetId === "custom" || segment.material?.id === "custom";
                        return (
                        <div className="step" key={segment.id}>
                          <div className="loadCaseMetaRow">
                            <div className="stepTitle">{segment.label?.trim() || segment.id}</div>
                            <button className="btn btnSmall btnGhost" onClick={() => removeStiffnessSegment(segment.id)}>Delete</button>
                          </div>
                          <div className="loadGrid">
                            <label className="field" style={{ margin: 0 }}>
                              <div className="fieldLabel">Label</div>
                              <input
                                className="input"
                                value={segment.label ?? ""}
                                placeholder={segment.id}
                                onChange={(e) => updateStiffnessSegment(segment.id, { label: e.target.value })}
                              />
                            </label>
                            <NumberField
                              label="x1"
                              value={segment.x1}
                              quantity="length"
                              units={displayUnits}
                              step={0.01}
                              min={0}
                              max={inputs.L}
                              onChange={(v) => updateStiffnessSegment(segment.id, { x1: clamp(v, 0, inputs.L) })}
                            />
                            <NumberField
                              label="x2"
                              value={segment.x2}
                              quantity="length"
                              units={displayUnits}
                              step={0.01}
                              min={0}
                              max={inputs.L}
                              onChange={(v) => updateStiffnessSegment(segment.id, { x2: clamp(v, 0, inputs.L) })}
                            />
                            <label className="field" style={{ margin: 0 }}>
                              <div className="fieldLabel">Material preset</div>
                              <select
                                className="input"
                                value={segment.materialPresetId ?? "inherit"}
                                onChange={(e) => setSegmentMaterialPreset(segment.id, e.target.value)}
                              >
                                <option value="inherit">Inherit global</option>
                                <option value="custom">Custom material</option>
                                {MATERIAL_PRESETS.map((preset) => (
                                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="field" style={{ margin: 0 }}>
                              <div className="fieldLabel">Section override</div>
                              <select
                                className="input"
                                value={segment.section?.id ?? "inherit"}
                                onChange={(e) => setSegmentSectionType(segment.id, e.target.value)}
                              >
                                <option value="inherit">Inherit global</option>
                                <option value="rectangular">Rectangular</option>
                                <option value="circular_solid">Circular solid</option>
                                <option value="circular_hollow">Circular hollow</option>
                                <option value="i_beam">I-beam</option>
                                <option value="channel">Channel</option>
                              </select>
                            </label>
                            <NumberField
                              label="E override"
                              value={segment.E ?? 0}
                              quantity="modulus"
                              units={displayUnits}
                              step={1e9}
                              min={0}
                              onChange={(v) => updateStiffnessSegment(segment.id, { E: v || undefined })}
                            />
                            <NumberField
                              label="I override"
                              value={segment.I ?? 0}
                              quantity="inertia"
                              units={displayUnits}
                              step={1e-7}
                              min={0}
                              onChange={(v) => updateStiffnessSegment(segment.id, { I: v || undefined })}
                            />
                            <NumberField
                              label="A override"
                              value={segment.A ?? 0}
                              quantity="area"
                              units={displayUnits}
                              step={1e-5}
                              min={0}
                              onChange={(v) => updateStiffnessSegment(segment.id, { A: v || undefined })}
                            />
                            <NumberField
                              label="G override"
                              value={segment.G ?? 0}
                              quantity="modulus"
                              units={displayUnits}
                              step={1e9}
                              min={0}
                              onChange={(v) => updateStiffnessSegment(segment.id, { G: v || undefined })}
                            />
                          </div>
                          {segment.section ? (
                            <div className="loadGrid" style={{ marginTop: 8 }}>
                              <label className="field" style={{ margin: 0 }}>
                                <div className="fieldLabel">Section dim unit</div>
                                <select
                                  className="input"
                                  value={segment.section.unit}
                                  onChange={(e) =>
                                    updateStiffnessSegment(segment.id, {
                                      section: { ...segment.section!, unit: e.target.value as "m" | "mm" },
                                    })
                                  }
                                >
                                  <option value="m">m</option>
                                  <option value="mm">mm</option>
                                </select>
                              </label>
                              {SECTION_FIELD_MAP[segment.section.id].map((field) => (
                                <NumberField
                                  key={`${segment.id}-${field.key}`}
                                  label={field.label}
                                  value={segment.section?.dims[field.key] ?? 0}
                                  unitLabel={segment.section?.unit}
                                  step={segment.section?.unit === "mm" ? 1 : 0.001}
                                  min={0}
                                  onChange={(v) => updateSegmentSectionDim(segment.id, field.key, Math.max(0, v))}
                                />
                              ))}
                            </div>
                          ) : null}
                          <label className="field" style={{ marginTop: 8 }}>
                            <div className="fieldLabel">Notes</div>
                            <input
                              className="input"
                              value={segment.note ?? ""}
                              placeholder="Optional segment note"
                              onChange={(e) => updateStiffnessSegment(segment.id, { note: e.target.value })}
                            />
                          </label>
                          {customMaterialActive ? (
                            <div className="loadGrid" style={{ marginTop: 8 }}>
                              <label className="field" style={{ margin: 0 }}>
                                <div className="fieldLabel">Segment material label</div>
                                <input
                                  className="input"
                                  value={segment.material?.name ?? ""}
                                  placeholder="Custom segment material"
                                  onChange={(e) => updateSegmentMaterial(segment.id, { name: e.target.value })}
                                />
                              </label>
                              <NumberField
                                label="Segment material E"
                                value={segment.material?.E ?? inputs.E}
                                quantity="modulus"
                                units={displayUnits}
                                step={1e9}
                                min={1}
                                onChange={(v) => updateSegmentMaterial(segment.id, { E: v })}
                              />
                              <NumberField
                                label="Segment material nu"
                                value={segment.material?.nu ?? (inputs.nu ?? 0.3)}
                                step={0.01}
                                min={-0.49}
                                max={0.49}
                                onChange={(v) => updateSegmentMaterial(segment.id, { nu: v })}
                              />
                            </div>
                          ) : null}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </CollapsibleSection>

                <CollapsibleSection
                  id="setup-internal-releases"
                  title="Internal Releases"
                  summary="Moment releases / internal hinges."
                  summaryChips={[`${internalReleases.length} release${internalReleases.length === 1 ? "" : "s"}`]}
                >
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <button className="btn btnSmall" onClick={addInternalRelease}>+ Add moment release</button>
                  </div>
                  {internalReleases.length === 0 ? (
                    <div className="muted">No internal releases defined.</div>
                  ) : (
                    <div className="steps">
                      {internalReleases.map((release) => (
                        <div className="step" key={release.id}>
                          <div className="loadCaseMetaRow">
                            <div className="stepTitle">{release.label?.trim() || release.id}</div>
                            <button className="btn btnSmall btnGhost" onClick={() => removeInternalRelease(release.id)}>Delete</button>
                          </div>
                          <div className="loadGrid">
                            <NumberField
                              label="Release x"
                              value={release.x}
                              quantity="length"
                              units={displayUnits}
                              step={0.01}
                              min={0}
                              max={inputs.L}
                              onChange={(v) => updateInternalRelease(release.id, { x: clamp(v, 0, inputs.L) })}
                            />
                            <label className="field" style={{ margin: 0 }}>
                              <div className="fieldLabel">Label</div>
                              <input
                                className="input"
                                value={release.label ?? ""}
                                placeholder={release.id}
                                onChange={(e) => updateInternalRelease(release.id, { label: e.target.value })}
                              />
                            </label>
                            <label className="field" style={{ margin: 0 }}>
                              <div className="fieldLabel">Active</div>
                              <select
                                className="input"
                                value={release.active === false ? "off" : "on"}
                                onChange={(e) => updateInternalRelease(release.id, { active: e.target.value === "on" })}
                              >
                                <option value="on">On</option>
                                <option value="off">Off</option>
                              </select>
                            </label>
                          </div>
                          <label className="field" style={{ marginTop: 8 }}>
                            <div className="fieldLabel">Notes</div>
                            <input
                              className="input"
                              value={release.note ?? ""}
                              placeholder="Optional release notes"
                              onChange={(e) => updateInternalRelease(release.id, { note: e.target.value })}
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="fieldHint">
                    Scope: internal moment releases are currently solved for fixed-fixed and propped cantilever end-support models.
                  </div>
                </CollapsibleSection>
              </>
            ) : (
              <div className="fieldHint">Advanced controls are available in Advanced Setup mode.</div>
            )}
          </div>

          {issues.length > 0 ? (
            <div className="error">
              {issues.map((i) => (
                <div key={i}>{i}</div>
              ))}
            </div>
          ) : null}
        </Panel>

        {solved.ok ? (
          <Panel title="Governing Summary">
            <div className="governingSummary">
              <div className={overallPass ? "governingOutcome statusGood" : "governingOutcome statusBad"}>
                <div className="governingOutcomeLabel">Overall</div>
                <div className="governingOutcomeValue">{overallPass ? "PASS" : "FAIL"}</div>
                <div className="governingOutcomeSub">
                  Utilization: {governingUtilization === null ? "N/A" : fmtPlain(governingUtilization)}
                </div>
              </div>
              <div className="governingMetaGrid">
                <div className="governingMetaItem">
                  <span>Governing mode</span>
                  <strong>{humanizeToken(governingMode)}</strong>
                </div>
                <div className="governingMetaItem">
                  <span>Governing x</span>
                  <strong>{governingX === null ? "N/A" : fmtLength(governingX)}</strong>
                </div>
                <div className="governingMetaItem">
                  <span>Max |M|</span>
                  <strong>{fmtMoment(solved.data.outputs.MabsMax)}</strong>
                </div>
                <div className="governingMetaItem">
                  <span>Max |V|</span>
                  <strong>{fmtForce(solved.data.outputs.VabsMax)}</strong>
                </div>
                <div className="governingMetaItem">
                  <span>Max |y|</span>
                  <strong>{fmtDeflection(solved.data.outputs.yAbsMax)}</strong>
                </div>
                <div className="governingMetaItem">
                  <span>Max rotation</span>
                  <strong>
                    {maxRotation === undefined ? "Not exposed" : `${fmtRotation(maxRotation)} @ x=${fmtLength(maxRotationX ?? 0)}`}
                  </strong>
                </div>
                <div className="governingMetaItem">
                  <span>Confidence</span>
                  <strong>{confidenceText}</strong>
                </div>
                <div className="governingMetaItem">
                  <span>Theory</span>
                  <strong>{theoryLabel}</strong>
                </div>
                <div className="governingMetaItem">
                  <span>Display units</span>
                  <strong>{displayUnitLabel}</strong>
                </div>
              </div>
            </div>
            <div className="governingWarning">
              <strong>Worst warning:</strong> {worstWarning}
            </div>

            <div className="resultSecondary">
              <CollapsibleSection
                id="beam-results-reactions"
                title="Reactions + Equilibrium"
                summary="Support reactions and residual checks."
                summaryChips={[
                  `dF ${fmtForce(solved.data.outputs.equilibriumResiduals.force)}`,
                  `dM ${fmtMoment(solved.data.outputs.equilibriumResiduals.momentAboutLeft)}`,
                ]}
              >
                <div className="kv">
                  {Object.entries(solved.data.outputs.reactions).map(([k, v]) => (
                    <KV
                      key={k}
                      k={`${k} (${quantityUnitSymbol(displayUnits, "force")} or ${quantityUnitSymbol(displayUnits, "moment")})`}
                      v={v}
                      fmt={k.toLowerCase().includes("m") ? fmtMomentN : fmtForceN}
                    />
                  ))}
                  {(solved.data.outputs.supportRotations ?? []).map((rotation) => (
                    <KV
                      key={`rot-${rotation.supportId}`}
                      k={`${rotation.supportId} rotation (${quantityUnitSymbol(displayUnits, "rotation")})`}
                      v={rotation.theta}
                      fmt={fmtRotation}
                    />
                  ))}
                  <KV k={`Equilibrium dF (${quantityUnitSymbol(displayUnits, "force")})`} v={solved.data.outputs.equilibriumResiduals.force} fmt={fmtForceN} />
                  <KV k={`Equilibrium dM (${quantityUnitSymbol(displayUnits, "moment")})`} v={solved.data.outputs.equilibriumResiduals.momentAboutLeft} fmt={fmtMomentN} />
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                id="beam-results-extrema"
                title="Extrema + Serviceability"
                summary="Key global maxima and serviceability."
                summaryChips={[`|M|max ${fmtMoment(solved.data.outputs.MabsMax)}`, `L/d ${fmtPlain(solved.data.outputs.serviceability.actualRatio)}`]}
              >
                <div className="kv">
                  <KV k={`|V|max (${quantityUnitSymbol(displayUnits, "force")})`} v={solved.data.outputs.VabsMax} fmt={fmtForceN} />
                  <KV k={`x at |V|max (${quantityUnitSymbol(displayUnits, "length")})`} v={solved.data.outputs.xAtVabsMax} fmt={fmtLengthN} />
                  <KV k={`|M|max (${quantityUnitSymbol(displayUnits, "moment")})`} v={solved.data.outputs.MabsMax} fmt={fmtMomentN} />
                  <KV k={`x at |M|max (${quantityUnitSymbol(displayUnits, "length")})`} v={solved.data.outputs.xAtMabsMax} fmt={fmtLengthN} />
                  <KV k="|y|max" v={solved.data.outputs.yAbsMax} fmt={fmtDeflection} />
                  <KV k={`x at |y|max (${quantityUnitSymbol(displayUnits, "length")})`} v={solved.data.outputs.xAtYAbsMax} fmt={fmtLengthN} />
                  <KV
                    k="Serviceability (L/d)"
                    v={solved.data.outputs.serviceability.actualRatio}
                    fmt={(x) =>
                      `${fmtPlain(x)} vs ${fmtPlain(solved.data.outputs.serviceability.limitRatio)} (${
                        solved.data.outputs.serviceability.passes ? "PASS" : "FAIL"
                      })`
                    }
                  />
                  {solved.data.outputs.thetaAbsMax !== undefined ? (
                    <KV
                      k={`|theta|max (${quantityUnitSymbol(displayUnits, "rotation")})`}
                      v={solved.data.outputs.thetaAbsMax}
                      fmt={fmtRotation}
                    />
                  ) : null}
                  {solved.data.outputs.xAtThetaAbsMax !== undefined ? (
                    <KV
                      k={`x at |theta|max (${quantityUnitSymbol(displayUnits, "length")})`}
                      v={solved.data.outputs.xAtThetaAbsMax}
                      fmt={fmtLengthN}
                    />
                  ) : null}
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                id="beam-results-design"
                title="Stress + Design + Sensitivity"
                summary="Stress estimates, utilization, and quality metrics."
                summaryChips={[solved.data.outputs.designChecks?.governingMode ?? "n/a", `mesh ${solved.data.outputs.quality?.meshPoints ?? "-"}`]}
              >
                <div className="kv">
                  {solved.data.outputs.stress ? (
                    <>
                      <KV k={`sigma max (${quantityUnitSymbol(displayUnits, "stress")})`} v={solved.data.outputs.stress.sigmaMax} fmt={fmtStressN} />
                      <KV k={`tau avg (${quantityUnitSymbol(displayUnits, "stress")})`} v={solved.data.outputs.stress.tauAvgMax} fmt={fmtStressN} />
                      <KV k={`tau max est. (${quantityUnitSymbol(displayUnits, "stress")})`} v={solved.data.outputs.stress.tauMaxEstimate} fmt={fmtStressN} />
                      <KV
                        k={`Section modulus used (${quantityUnitSymbol(displayUnits, "sectionModulus")})`}
                        v={solved.data.outputs.stress.sectionModulus}
                        fmt={fmtSectionModulus}
                      />
                    </>
                  ) : null}
                  {solved.data.outputs.designChecks ? (
                    <>
                      <KV k="Bending utilization" v={solved.data.outputs.designChecks.bendingUtilization ?? 0} fmt={fmtPlain} />
                      <KV k="Shear utilization" v={solved.data.outputs.designChecks.shearUtilization ?? 0} fmt={fmtPlain} />
                      <KV k="Deflection utilization" v={solved.data.outputs.designChecks.deflectionUtilization} fmt={fmtPlain} />
                      <KV k="Governing mode" v={0} fmt={() => solved.data.outputs.designChecks!.governingMode} />
                      <KV k="Design pass" v={0} fmt={() => (solved.data.outputs.designChecks!.pass ? "PASS" : "FAIL")} />
                    </>
                  ) : null}
                  {solved.data.outputs.sensitivity ? (
                    <>
                      <KV k="d|M| from E uncertainty (%)" v={solved.data.outputs.sensitivity.dMabsFromEPercent} fmt={fmtPlain} />
                      <KV k="d|y| from E uncertainty (%)" v={solved.data.outputs.sensitivity.dYabsFromEPercent} fmt={fmtPlain} />
                      <KV k="d|M| from load uncertainty (%)" v={solved.data.outputs.sensitivity.dMabsFromLoadPercent} fmt={fmtPlain} />
                      <KV k="d|y| from load uncertainty (%)" v={solved.data.outputs.sensitivity.dYabsFromLoadPercent} fmt={fmtPlain} />
                    </>
                  ) : null}
                  {solved.data.outputs.movingLoadCritical ? (
                    <>
                      {solved.data.outputs.movingLoadCritical.templateName ? (
                        <KV k="Moving load template" v={0} fmt={() => solved.data.outputs.movingLoadCritical!.templateName ?? ""} />
                      ) : null}
                      <KV
                        k={`Moving load lead position (${quantityUnitSymbol(displayUnits, "length")})`}
                        v={solved.data.outputs.movingLoadCritical.leadPosition}
                        fmt={fmtLengthN}
                      />
                      <KV
                        k={`Moving load |M|max (${quantityUnitSymbol(displayUnits, "moment")})`}
                        v={solved.data.outputs.movingLoadCritical.MabsMax}
                        fmt={fmtMomentN}
                      />
                      <KV
                        k={`Moving load |V|max (${quantityUnitSymbol(displayUnits, "force")})`}
                        v={solved.data.outputs.movingLoadCritical.VabsMax}
                        fmt={fmtForceN}
                      />
                      {solved.data.outputs.movingLoadCritical.scanStep ? (
                        <KV
                          k={`Moving load scan step (${quantityUnitSymbol(displayUnits, "length")})`}
                          v={solved.data.outputs.movingLoadCritical.scanStep}
                          fmt={fmtLengthN}
                        />
                      ) : null}
                    </>
                  ) : null}
                  {solved.data.outputs.quality ? (
                    <>
                      <KV k="Mesh points" v={solved.data.outputs.quality.meshPoints} fmt={(v) => String(Math.round(v))} />
                      <KV k="Solve class" v={0} fmt={() => solved.data.outputs.quality!.estimatedComputeClass} />
                    </>
                  ) : null}
                </div>
                {solved.data.outputs.stress ? (
                  <div className="fieldHint" style={{ marginTop: 8 }}>
                    Stress outputs are beam-theory section estimates (global bending/shear), not local FE stress-concentration results.
                  </div>
                ) : null}
              </CollapsibleSection>
            </div>
          </Panel>
        ) : (
          <Panel title="Governing Summary">
            <div className="muted">Fix input issues to view results.</div>
          </Panel>
        )}
      </div>
      </section>

      <section className="workflowZone beamWorkflowZone" id="beam-zone-loads">
        <div className="workflowZoneHead beamWorkflowZoneHead">
          <h2>2. Loads and Cases</h2>
          <p>Place and edit loads with direct beam interaction. {modeZoneHint.loads}</p>
        </div>
      <div className="twoCol beamLoadsTwoCol" style={{ marginTop: 12 }}>
        <Panel title="Beam View (Interactive)" right={<div className="muted">Selected: {selectedId ?? "none"}</div>}>
          <BeamView
            L={inputs.L}
            support={inputs.support}
            supportStations={supportStations}
            stiffnessSegments={stiffnessSegments}
            internalReleases={internalReleases}
            loads={inputs.loads}
            selectedId={selectedId}
            isolatedId={isolatedLoadId}
            snapStep={snapStep}
            displayUnits={displayUnits}
            onSelect={(id) => setSelectedId(id)}
            onUpdateLoad={(id, patch) => updateLoad(id, patch)}
            onUpdateLoadLive={(id, patch) => updateLoad(id, patch, true)}
            onBeginDrag={() => commit((prev) => prev)}
            onDragStateChange={(s) => setDragState({ id: s.draggingId, snap: s.snapStep })}
          />
          <div className="beamDragStatusRow">
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              {dragState.id ? `Active drag: ${dragState.id} (${dragState.snap > 0 ? `${fmtLength(dragState.snap)} snap` : "auto snap"})` : "No active drag."}
            </div>
            {isolatedLoadId ? (
              <button className="btn btnSmall btnGhost" onClick={() => setIsolatedLoadId(null)}>
                Clear isolate
              </button>
            ) : null}
          </div>
        </Panel>

        <Panel title="Load Manager">
          <div className="muted" style={{ marginBottom: 8 }}>
            Linear distributed load is not equivalent to UDL unless `w1 = w2`. Hidden loads are excluded from beam display but remain active in solve.
          </div>
          <div className="loadsHeader">
            <div className="loadsTitle">Loads</div>
            <div className="loadsActions">
              <button className="btn" onClick={addPointLoad}>
                + Point load
              </button>
              <button className="btn" onClick={addUDL}>
                + UDL
              </button>
              <button className="btn" onClick={addLinearDist}>
                + Linear Dist
              </button>
              <button className="btn" onClick={addMoment}>
                + Moment
              </button>
              <button className="btn" onClick={addThermal}>
                + Thermal
              </button>
              <button className="btn" onClick={addPrestrain}>
                + Prestrain
              </button>
            </div>
          </div>
          <div className="loadsQuickStats">
            <span className="pill">Total: {inputs.loads.length}</span>
            <span className="pill">Visible: {visibleLoadCount}</span>
            <span className="pill">Hidden: {hiddenLoadCount}</span>
            <span className="pill">Unassigned case: {unassignedLoadCount}</span>
            <span className="pill">Active cases: {activeCaseCount}</span>
            <span className="pill">Isolated: {isolatedLoadId ?? "none"}</span>
          </div>
          <div className="selfWeightToggleRow">
            <button className={selfWeightEnabled ? "btn btnSmall activePill" : "btn btnSmall"} onClick={toggleSelfWeightLoad} disabled={!canGenerateSelfWeight && !selfWeightEnabled}>
              {selfWeightEnabled ? "Remove self-weight load" : "Include self-weight load"}
            </button>
            <div className="muted" style={{ fontSize: 12 }}>
              {canGenerateSelfWeight
                ? `Derived intensity: ${fmtDistributed(selfWeightEstimate ?? 0)} over full span.`
                : "Define section area and material density to enable generated self-weight."}
            </div>
          </div>

          <CollapsibleSection
            id="load-case-editor"
            title="Load Cases"
            summary="Define named cases with category and active state."
            summaryChips={[`cases ${loadCases.length}`, `active ${activeCaseCount}`]}
            defaultOpen
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button className="btn btnSmall" onClick={() => addLoadCase("dead")}>+ Dead case</button>
              <button className="btn btnSmall" onClick={() => addLoadCase("live")}>+ Live case</button>
              <button className="btn btnSmall" onClick={() => addLoadCase("custom")}>+ Custom case</button>
            </div>
            {loadCases.length === 0 ? (
              <div className="muted">No load cases defined. Add a case to use combinations.</div>
            ) : (
              <div className="steps">
                {loadCases.map((caseDef) => (
                  <div key={caseDef.id} className="step">
                    <div className="stepTitle">
                      {caseDef.name} ({caseDef.id})
                    </div>
                    <div className="loadCaseMetaRow">
                      <span className="pill">Assigned loads: {caseAssignmentCounts.get(caseDef.id) ?? 0}</span>
                      <span className="pill">Combo terms: {caseCombinationRefCounts.get(caseDef.id) ?? 0}</span>
                      <span className={caseDef.active !== false ? "pill statusGood" : "pill"}>{caseDef.active !== false ? "Active" : "Inactive"}</span>
                      <button className="btn btnSmall btnGhost" onClick={() => assignSelectedLoadToCase(caseDef.id)} disabled={!selectedId}>
                        Assign selected load
                      </button>
                    </div>
                    <div className="loadGrid">
                      <label className="field">
                        <div className="fieldLabel">Case name</div>
                        <input
                          className="input"
                          value={caseDef.name}
                          onChange={(e) => updateLoadCaseMeta(caseDef.id, { name: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <div className="fieldLabel">Case id</div>
                        <input
                          className="input"
                          value={caseDef.id}
                          onChange={(e) => renameLoadCaseId(caseDef.id, e.target.value.toUpperCase())}
                        />
                      </label>
                      <label className="field">
                        <div className="fieldLabel">Category</div>
                        <select
                          className="input"
                          value={normalizeCategoryId(caseDef.category ?? "custom")}
                          onChange={(e) =>
                            updateLoadCaseMeta(caseDef.id, {
                              category: e.target.value as LoadCase["category"],
                            })
                          }
                        >
                          {loadCategoryOptions.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name} ({cat.id})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <div className="fieldLabel">State</div>
                        <select
                          className="input"
                          value={caseDef.active !== false ? "active" : "inactive"}
                          onChange={(e) => updateLoadCaseMeta(caseDef.id, { active: e.target.value === "active" })}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </label>
                    </div>
                    <label className="field">
                      <div className="fieldLabel">Notes</div>
                      <textarea
                        className="input"
                        style={{ minHeight: 56, resize: "vertical" }}
                        value={caseDef.note ?? ""}
                        onChange={(e) => updateLoadCaseMeta(caseDef.id, { note: e.target.value })}
                      />
                    </label>
                    <button className="btn btnSmall btnGhost" onClick={() => removeLoadCase(caseDef.id)}>
                      Remove case
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            id="load-category-editor"
            title="Load Categories"
            summary="Manage category labels, state, and notes across loads and cases."
            summaryChips={[`categories ${categoryUsage.length}`, `active ${activeLoadCategoryCount}`]}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button className="btn btnSmall" onClick={addLoadCategory}>
                + Add category
              </button>
              <button
                className="btn btnSmall btnGhost"
                onClick={() => assignSelectedLoadToCategory("custom")}
                disabled={!selectedId}
              >
                Assign selected load to custom
              </button>
            </div>
            {unknownCategoryUsage.length > 0 ? (
              <div className="error" style={{ marginBottom: 10 }}>
                Category references not found in definitions: {unknownCategoryUsage.join(", ")}. Add or rename categories to clear this.
              </div>
            ) : null}
            {categoryUsage.length === 0 ? (
              <div className="muted">No category definitions available.</div>
            ) : (
              <div className="steps">
                {categoryUsage.map((entry) => {
                  const isBuiltIn = CASE_CATEGORY_OPTIONS.includes(entry.category as (typeof CASE_CATEGORY_OPTIONS)[number]);
                  return (
                    <div key={entry.category} className="step">
                      <div className="stepTitle">
                        {entry.name} ({entry.category})
                      </div>
                      <div className="loadCaseMetaRow">
                        <span className={entry.active ? "pill statusGood" : "pill"}>{entry.active ? "Active" : "Inactive"}</span>
                        <span className="pill">Cases: {entry.caseCount}</span>
                        <span className="pill">Loads: {entry.loadCount}</span>
                        <button className="btn btnSmall btnGhost" onClick={() => assignSelectedLoadToCategory(entry.category)} disabled={!selectedId}>
                          Assign selected load
                        </button>
                      </div>
                      <div className="loadGrid">
                        <label className="field">
                          <div className="fieldLabel">Category name</div>
                          <input
                            className="input"
                            value={entry.name}
                            onChange={(e) => updateLoadCategoryMeta(entry.category, { name: e.target.value })}
                          />
                        </label>
                        <label className="field">
                          <div className="fieldLabel">Category id</div>
                          <input
                            className="input"
                            value={entry.category}
                            disabled={isBuiltIn}
                            onChange={(e) => renameLoadCategoryId(entry.category, e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                          />
                        </label>
                        <label className="field">
                          <div className="fieldLabel">State</div>
                          <select
                            className="input"
                            value={entry.active ? "active" : "inactive"}
                            onChange={(e) => updateLoadCategoryMeta(entry.category, { active: e.target.value === "active" })}
                          >
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </label>
                      </div>
                      <label className="field">
                        <div className="fieldLabel">Notes</div>
                        <textarea
                          className="input"
                          style={{ minHeight: 52, resize: "vertical" }}
                          value={entry.note}
                          onChange={(e) => updateLoadCategoryMeta(entry.category, { note: e.target.value })}
                        />
                      </label>
                      {!isBuiltIn ? (
                        <button className="btn btnSmall btnGhost" onClick={() => removeLoadCategory(entry.category)}>
                          Remove category
                        </button>
                      ) : (
                        <div className="fieldHint">Built-in category: id is locked for consistency.</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            id="load-combination-editor"
            title="Load Combinations"
            summary="Define factors, activation, and editable templates."
            summaryChips={[`combos ${loadCombinations.length}`, `active ${activeCombinationCount}`]}
            defaultOpen
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button className="btn btnSmall" onClick={() => addLoadCombination("custom")}>+ Add combination</button>
              <button className="btn btnSmall" onClick={() => applyGenericCombinationTemplate("ULS")}>Apply generic ULS</button>
              <button className="btn btnSmall" onClick={() => applyGenericCombinationTemplate("SLS")}>Apply generic SLS</button>
            </div>
            {combinationHealth.emptyActiveCombos.length > 0 ||
            combinationHealth.referencedInactiveCases.length > 0 ||
            combinationHealth.referencedUnknownCases.length > 0 ? (
              <div className="error" style={{ marginBottom: 10 }}>
                {combinationHealth.emptyActiveCombos.length > 0
                  ? `Active combinations with no active terms: ${combinationHealth.emptyActiveCombos.join(", ")}. `
                  : ""}
                {combinationHealth.referencedInactiveCases.length > 0
                  ? `Terms reference inactive cases: ${combinationHealth.referencedInactiveCases.join(", ")}. `
                  : ""}
                {combinationHealth.referencedUnknownCases.length > 0
                  ? `Terms reference undefined cases: ${combinationHealth.referencedUnknownCases.join(", ")}.`
                  : ""}
              </div>
            ) : null}
            {loadCombinations.length === 0 ? (
              <div className="muted">No combinations defined yet.</div>
            ) : (
              <div className="steps">
                {loadCombinations.map((combo) => (
                  <div key={combo.id} className="step">
                    <div className="stepTitle">
                      {combo.name} ({combo.id})
                    </div>
                    <div className="loadCaseMetaRow">
                      <span className={combo.active !== false ? "pill statusGood" : "pill"}>{combo.active !== false ? "Active" : "Inactive"}</span>
                      <span className="pill">{combo.category ?? "custom"}</span>
                      <button className="btn btnSmall btnGhost" onClick={() => saveCombinationTemplate(combo.id)}>
                        Save template
                      </button>
                      <button className="btn btnSmall btnGhost" onClick={() => removeLoadCombination(combo.id)}>
                        Remove
                      </button>
                    </div>
                    <div className="loadGrid">
                      <label className="field">
                        <div className="fieldLabel">Name</div>
                        <input className="input" value={combo.name} onChange={(e) => updateLoadCombination(combo.id, { name: e.target.value })} />
                      </label>
                      <label className="field">
                        <div className="fieldLabel">Category</div>
                        <select
                          className="input"
                          value={combo.category ?? "custom"}
                          onChange={(e) =>
                            updateLoadCombination(combo.id, {
                              category: e.target.value as LoadCombination["category"],
                            })
                          }
                        >
                          <option value="ULS">ULS</option>
                          <option value="SLS">SLS</option>
                          <option value="custom">custom</option>
                        </select>
                      </label>
                      <label className="field">
                        <div className="fieldLabel">State</div>
                        <select
                          className="input"
                          value={combo.active !== false ? "active" : "inactive"}
                          onChange={(e) => updateLoadCombination(combo.id, { active: e.target.value === "active" })}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </label>
                    </div>
                    <label className="field">
                      <div className="fieldLabel">Notes</div>
                      <textarea
                        className="input"
                        style={{ minHeight: 52, resize: "vertical" }}
                        value={combo.note ?? ""}
                        onChange={(e) => updateLoadCombination(combo.id, { note: e.target.value })}
                      />
                    </label>
                    <div className="steps">
                      {combo.terms.map((term, termIdx) => (
                        <div key={`${combo.id}-term-${termIdx}`} className="step">
                          <div className="loadGrid">
                            <label className="field">
                              <div className="fieldLabel">Case</div>
                              <select
                                className="input"
                                value={term.caseId}
                                onChange={(e) => updateCombinationTerm(combo.id, termIdx, { caseId: e.target.value })}
                              >
                                <option value="BASE">BASE</option>
                                {loadCases.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name} ({c.id})
                                  </option>
                                ))}
                              </select>
                            </label>
                            <NumberField
                              label="Factor"
                              value={term.factor}
                              step={0.05}
                              onChange={(v) => updateCombinationTerm(combo.id, termIdx, { factor: v })}
                            />
                            <label className="field">
                              <div className="fieldLabel">Term state</div>
                              <select
                                className="input"
                                value={term.active !== false ? "active" : "inactive"}
                                onChange={(e) => updateCombinationTerm(combo.id, termIdx, { active: e.target.value === "active" })}
                              >
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                              </select>
                            </label>
                          </div>
                          <label className="field">
                            <div className="fieldLabel">Term notes</div>
                            <input
                              className="input"
                              value={term.note ?? ""}
                              onChange={(e) => updateCombinationTerm(combo.id, termIdx, { note: e.target.value })}
                            />
                          </label>
                          <button className="btn btnSmall btnGhost" onClick={() => removeCombinationTerm(combo.id, termIdx)}>
                            Remove term
                          </button>
                        </div>
                      ))}
                    </div>
                    <button className="btn btnSmall" onClick={() => addCombinationTerm(combo.id)}>
                      + Add term
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <div className="fieldLabel" style={{ marginBottom: 6 }}>Saved templates</div>
              {savedComboTemplates.length === 0 ? (
                <div className="muted">No saved templates yet.</div>
              ) : (
                <div className="steps">
                  {savedComboTemplates.map((template) => (
                    <div key={template.id} className="step">
                      <div className="stepTitle">{template.name}</div>
                      <div className="stepNote">Category: {template.category}</div>
                      <div className="stepNote">Terms: {template.terms.length}</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btnSmall btnGhost" onClick={() => applySavedTemplate(template.id)}>
                          Apply
                        </button>
                        <button className="btn btnSmall btnGhost" onClick={() => removeSavedTemplate(template.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            id="envelope-editor"
            title="Envelope Definitions"
            summary="Select which combinations feed envelope generation."
            summaryChips={[`definitions ${envelopeDefinitions.length}`, `active ${activeEnvelopeDefinition?.name ?? "none"}`]}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button className="btn btnSmall" onClick={addEnvelopeDefinition}>
                + Add envelope definition
              </button>
            </div>
            {envelopeDefinitions.length === 0 ? (
              <div className="muted">No envelope definitions. Envelope uses all active combinations.</div>
            ) : (
              <div className="steps">
                {envelopeDefinitions.map((env) => (
                  <div key={env.id} className="step">
                    <div className="stepTitle">
                      {env.name} ({env.id})
                    </div>
                    <div className="loadCaseMetaRow">
                      <span className={env.active !== false ? "pill statusGood" : "pill"}>{env.active !== false ? "Active" : "Inactive"}</span>
                      <span className="pill">Combos: {env.combinationIds.length}</span>
                      <button className="btn btnSmall btnGhost" onClick={() => toggleEnvelopeDefinitionActive(env.id)}>
                        Set active
                      </button>
                      <button className="btn btnSmall btnGhost" onClick={() => removeEnvelopeDefinition(env.id)}>
                        Remove
                      </button>
                    </div>
                    <div className="loadGrid">
                      <label className="field">
                        <div className="fieldLabel">Name</div>
                        <input className="input" value={env.name} onChange={(e) => updateEnvelopeDefinition(env.id, { name: e.target.value })} />
                      </label>
                    </div>
                    <label className="field">
                      <div className="fieldLabel">Notes</div>
                      <textarea
                        className="input"
                        style={{ minHeight: 52, resize: "vertical" }}
                        value={env.note ?? ""}
                        onChange={(e) => updateEnvelopeDefinition(env.id, { note: e.target.value })}
                      />
                    </label>
                    <div className="field">
                      <div className="fieldLabel">Included combinations</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {loadCombinations.map((combo) => {
                          const checked = env.combinationIds.includes(combo.id);
                          return (
                            <button
                              key={`${env.id}-${combo.id}`}
                              className={checked ? "btn btnSmall activePill" : "btn btnSmall btnGhost"}
                              onClick={() => toggleEnvelopeCombination(env.id, combo.id)}
                            >
                              {checked ? "Included" : "Include"} {combo.id}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>

          <div className="loadsList">
            {inputs.loads.length === 0 ? (
              <div className="muted">No loads yet.</div>
            ) : (
              groupedLoads.map((group) => (
                <CollapsibleSection
                  key={group.type}
                  id={`load-group-${group.type}`}
                  title={`${loadTypeLabel(group.type)} (${group.loads.length})`}
                  summary={`Manage ${loadTypeLabel(group.type).toLowerCase()} entries`}
                  summaryChips={[`${group.loads.length} load${group.loads.length === 1 ? "" : "s"}`]}
                  defaultOpen={group.type === "point_load" || group.type === "udl"}
                >
                  <div className="loadGroupRows">
                    {group.loads.map((l) => {
                      const globalIndex = inputs.loads.findIndex((x) => x.id === l.id);
                      return (
                        <LoadRow
                          key={l.id}
                          load={l}
                          isSelected={selectedId === l.id}
                          isIsolated={isolatedLoadId === l.id}
                          canMoveUp={globalIndex > 0}
                          canMoveDown={globalIndex >= 0 && globalIndex < inputs.loads.length - 1}
                          caseOptions={loadCaseOptions}
                          categoryOptions={loadCategoryOptions}
                          onSelect={() => setSelectedId(l.id)}
                          onUpdate={(patch) => updateLoad(l.id, patch)}
                          onRemove={() => removeLoad(l.id)}
                          onDuplicate={() => duplicateLoad(l.id)}
                          onMirror={() => mirrorLoad(l.id)}
                          onMoveUp={() => moveLoad(l.id, -1)}
                          onMoveDown={() => moveLoad(l.id, 1)}
                          onToggleLock={() => toggleLoadLock(l.id)}
                          onToggleVisibility={() => toggleLoadVisibility(l.id)}
                          onToggleIsolate={() => toggleLoadIsolation(l.id)}
                          L={inputs.L}
                          displayUnits={displayUnits}
                        />
                      );
                    })}
                  </div>
                </CollapsibleSection>
              ))
            )}
          </div>
        </Panel>
      </div>
      </section>

      <section className="workflowZone beamWorkflowZone" id="beam-zone-analysis">
        <div className="workflowZoneHead beamWorkflowZoneHead">
          <h2>3. Analysis and Checks</h2>
          <p>Review governing response, charts, diagnostics, and verification outputs. {modeZoneHint.analysis}</p>
        </div>
      {solved.ok ? (
        <div style={{ marginTop: 14 }}>
          <Panel
            title="Cursor + Worked Solution"
            right={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div className="segmented" role="tablist" aria-label="Chart Mode">
                  <button className={chartMode === "all" ? "segBtn active" : "segBtn"} onClick={() => setChartMode("all")} aria-pressed={chartMode === "all"}>
                    All
                  </button>
                  <button className={chartMode === "sfd" ? "segBtn active" : "segBtn"} onClick={() => setChartMode("sfd")} aria-pressed={chartMode === "sfd"}>
                    Shear
                  </button>
                  <button className={chartMode === "bmd" ? "segBtn active" : "segBtn"} onClick={() => setChartMode("bmd")} aria-pressed={chartMode === "bmd"}>
                    Moment
                  </button>
                  <button
                    className={chartMode === "deflection" ? "segBtn active" : "segBtn"}
                    onClick={() => setChartMode("deflection")}
                    aria-pressed={chartMode === "deflection"}
                  >
                    Deflection
                  </button>
                  <button
                    className={chartMode === "rotation" ? "segBtn active" : "segBtn"}
                    onClick={() => setChartMode("rotation")}
                    aria-pressed={chartMode === "rotation"}
                  >
                    Rotation
                  </button>
                </div>
                <div className="segmented" role="tablist" aria-label="Worked Solution Detail">
                  <button
                    className={workedMode === "brief" ? "segBtn active" : "segBtn"}
                    onClick={() => setWorkedMode("brief")}
                    aria-pressed={workedMode === "brief"}
                  >
                    Brief
                  </button>
                  <button
                    className={workedMode === "detailed" ? "segBtn active" : "segBtn"}
                    onClick={() => setWorkedMode("detailed")}
                    aria-pressed={workedMode === "detailed"}
                  >
                    Detailed
                  </button>
                </div>
                <button className="btn" onClick={() => setShowWorked(true)}>
                  Open Worked
                </button>
              </div>
            }
          >
            <div className="field">
              <div className="fieldLabel">Shared chart cursor x ({quantityUnitSymbol(displayUnits, "length")})</div>
              <input
                className="input"
                type="range"
                min={0}
                max={inputs.L}
                step={snapStep > 0 ? snapStep : Math.max(inputs.L / 200, 0.01)}
                value={clamp(activeCursorX, 0, inputs.L)}
                onChange={(e) => setCursorX(Number(e.target.value))}
              />
              <div className="muted">x = {fmtLength(activeCursorX)}</div>
              {cursorResponse ? (
                <div className="kv" style={{ marginTop: 8 }}>
                  <KV k={`V(x) (${quantityUnitSymbol(displayUnits, "force")})`} v={cursorResponse.V} fmt={fmtForceN} />
                  <KV k={`M(x) (${quantityUnitSymbol(displayUnits, "moment")})`} v={cursorResponse.M} fmt={fmtMomentN} />
                  <KV k={`y(x) (${quantityUnitSymbol(displayUnits, "deflection")})`} v={cursorResponse.y} fmt={fmtDeflectionN} />
                  <KV k={`theta(x) (${quantityUnitSymbol(displayUnits, "rotation")})`} v={cursorResponse.theta} fmt={fmtRotation} />
                </div>
              ) : null}
            </div>

            <CollapsibleSection
              id="analysis-moving-train"
              title="Moving Load Train"
              summary="Define axle train and search increment."
              summaryChips={[
                `enabled ${inputs.movingLoad?.enabled ? "yes" : "no"}`,
                `axles ${(inputs.movingLoad?.axleLoads ?? []).length}`,
              ]}
            >
              <div className="loadGrid">
                <label className="field">
                  <div className="fieldLabel">Enable moving load</div>
                  <select
                    className="input"
                    value={inputs.movingLoad?.enabled ? "on" : "off"}
                    onChange={(e) =>
                      commit({
                        ...inputs,
                        movingLoad: {
                          ...(inputs.movingLoad ?? { axleLoads: [80e3], axleSpacings: [], step: 0.2 }),
                          enabled: e.target.value === "on",
                        },
                      })
                    }
                  >
                    <option value="off">Off</option>
                    <option value="on">On</option>
                  </select>
                </label>
                <NumberField
                  label="Step"
                  value={inputs.movingLoad?.step ?? 0.2}
                  quantity="length"
                  units={displayUnits}
                  step={0.05}
                  min={0.01}
                  onChange={(v) =>
                    commit({
                      ...inputs,
                      movingLoad: { ...(inputs.movingLoad ?? { enabled: false, axleLoads: [80e3], axleSpacings: [] }), step: v },
                    })
                  }
                />
                <NumberField
                  label="Playback speed"
                  value={inputs.movingLoad?.playbackSpeed ?? 0.6}
                  quantity="length"
                  units={displayUnits}
                  step={0.1}
                  min={0.05}
                  onChange={(v) =>
                    commit({
                      ...inputs,
                      movingLoad: { ...(inputs.movingLoad ?? { enabled: false, axleLoads: [80e3], axleSpacings: [] }), playbackSpeed: v },
                    })
                  }
                />
              </div>
              <div className="loadGrid">
                <label className="field">
                  <div className="fieldLabel">Vehicle/Train template</div>
                  <select
                    className="input"
                    value={inputs.movingLoad?.templateId ?? ""}
                    onChange={(e) => {
                      if (!e.target.value) {
                        commit({
                          ...inputs,
                          movingLoad: { ...(inputs.movingLoad ?? { enabled: false, axleLoads: [80e3], axleSpacings: [] }), templateId: undefined },
                        });
                        return;
                      }
                      applyMovingTemplate(e.target.value);
                    }}
                  >
                    <option value="">None (manual)</option>
                    {movingLoadTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} ({template.type ?? "custom"})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <div className="fieldLabel">Current template name</div>
                  <input
                    className="input"
                    value={movingTemplateDraftName}
                    onChange={(e) => setMovingTemplateDraftName(e.target.value)}
                    placeholder="Template name"
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <button className="btn btnSmall" onClick={saveCurrentMovingTemplate}>Save current as template</button>
                {inputs.movingLoad?.templateId ? (
                  <button className="btn btnSmall btnGhost" onClick={() => removeMovingTemplate(inputs.movingLoad!.templateId!)}>
                    Delete selected template
                  </button>
                ) : null}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Train definition: `axleSpacings.length` should equal `axleLoads.length - 1`.
              </div>
              <label className="field">
                <div className="fieldLabel">Axle loads ({quantityUnitSymbol(displayUnits, "force")}, comma separated)</div>
                <input
                  className="input"
                  value={(inputs.movingLoad?.axleLoads ?? [])
                    .map((v) => fmtForceN(v, 5))
                    .join(", ")}
                  onChange={(e) => {
                    const vals = e.target.value
                      .split(",")
                      .map((x) => parseEngineeringInput(x.trim(), quantityUnitSymbol(displayUnits, "force")))
                      .filter((x): x is number => x !== null && Number.isFinite(x));
                    commit({
                      ...inputs,
                      movingLoad: {
                        ...(inputs.movingLoad ?? { enabled: false, axleSpacings: [], step: 0.2 }),
                        axleLoads: vals.map((v) => {
                          const symbol = quantityUnitSymbol(displayUnits, "force");
                          if (symbol === "kN") return v * 1e3;
                          return v;
                        }),
                        axleSpacings: vals.length > 1 ? (inputs.movingLoad?.axleSpacings ?? new Array(vals.length - 1).fill(2)) : [],
                      },
                    });
                  }}
                />
              </label>
              {inputs.movingLoad?.enabled &&
              (inputs.movingLoad.axleSpacings.length !== Math.max(0, inputs.movingLoad.axleLoads.length - 1)) ? (
                <div className="error">Axle spacing count mismatch: expected {Math.max(0, (inputs.movingLoad?.axleLoads.length ?? 0) - 1)} values.</div>
              ) : null}
              <label className="field">
                <div className="fieldLabel">Axle spacings ({quantityUnitSymbol(displayUnits, "length")}, comma separated)</div>
                <input
                  className="input"
                  value={(inputs.movingLoad?.axleSpacings ?? [])
                    .map((v) => fmtLengthN(v, 5))
                    .join(", ")}
                  onChange={(e) => {
                    const vals = e.target.value
                      .split(",")
                      .map((x) => parseEngineeringInput(x.trim(), quantityUnitSymbol(displayUnits, "length")))
                      .filter((x): x is number => x !== null && Number.isFinite(x));
                    commit({
                      ...inputs,
                      movingLoad: {
                        ...(inputs.movingLoad ?? { enabled: false, axleLoads: [80e3], step: 0.2 }),
                        axleSpacings: vals.map((v) => {
                          const symbol = quantityUnitSymbol(displayUnits, "length");
                          if (symbol === "mm") return v * 1e-3;
                          return v;
                        }),
                      },
                    });
                  }}
                />
              </label>
              <div className="field">
                <div className="fieldLabel">Critical-position playback</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button className={movingPlaybackOn ? "btn btnSmall activePill" : "btn btnSmall"} onClick={() => setMovingPlaybackOn((v) => !v)}>
                    {movingPlaybackOn ? "Pause" : "Play"}
                  </button>
                  {solved.ok && solved.data.outputs.movingLoadCritical ? (
                    <button className="btn btnSmall btnGhost" onClick={() => setMovingLeadPlaybackX(solved.data.outputs.movingLoadCritical!.leadPosition)}>
                      Jump to critical
                    </button>
                  ) : null}
                  <span className="muted" style={{ fontSize: 12 }}>
                    Lead position = {fmtLength(movingLeadPlaybackX)}
                  </span>
                </div>
                <input
                  className="input"
                  type="range"
                  min={0}
                  max={Math.max(
                    inputs.L,
                    inputs.L + (inputs.movingLoad?.axleSpacings ?? []).reduce((acc, spacing) => acc + Math.max(0, spacing), 0)
                  )}
                  step={Math.max(0.01, inputs.movingLoad?.step ?? 0.1)}
                  value={movingLeadPlaybackX}
                  onChange={(e) => setMovingLeadPlaybackX(Number(e.target.value))}
                />
              </div>
            </CollapsibleSection>
          </Panel>
          <div
            className="chartGrid"
            style={{
              marginTop: 14,
              display: "grid",
              gap: 14,
              gridTemplateColumns: chartMode === "all" ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)",
            }}
          >
            {(chartMode === "all" || chartMode === "sfd") && (
              <Panel title="Shear Force Diagram">
                <PlotFrame title="V(x)">
                  <ResponsiveContainer width="100%" height={chartHeight}>
                    <LineChart data={solved.data.plots.sfd} margin={{ top: 8, right: 14, bottom: 4, left: 2 }}>
                      <ReferenceLine x={activeCursorX} strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.72)" />
                      {supportChartMarkers.map((x, idx) => (
                        <ReferenceLine key={`sfd-support-${idx}-${x}`} x={x} stroke="rgba(125, 211, 252, 0.65)" strokeDasharray="2 2" />
                      ))}
                      {segmentChartMarkers.map((x, idx) => (
                        <ReferenceLine key={`sfd-segment-${idx}-${x}`} x={x} stroke="rgba(56, 189, 248, 0.45)" strokeDasharray="5 3" />
                      ))}
                      {releaseChartMarkers.map((x, idx) => (
                        <ReferenceLine key={`sfd-release-${idx}-${x}`} x={x} stroke="rgba(251, 146, 60, 0.78)" strokeDasharray="3 2" />
                      ))}
                      <CartesianGrid stroke="rgba(148, 163, 184, 0.20)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="x"
                        type="number"
                        domain={[0, inputs.L]}
                        ticks={xt}
                        tickFormatter={tickFmtLength}
                        tick={axisTickStyle}
                        axisLine={axisLineStyle}
                        tickLine={axisLineStyle}
                      />
                      <YAxis
                        tickFormatter={tickFmtForce}
                        tickCount={6}
                        tick={axisTickStyle}
                        axisLine={axisLineStyle}
                        tickLine={axisLineStyle}
                        domain={(() => {
                          const ys = solved.data.plots.sfd.map((p) => p.V);
                          return yDomainPad(Math.min(...ys), Math.max(...ys));
                        })()}
                      />
                      <Tooltip
                        labelFormatter={(x) => `x = ${fmtLength(Number(x))}`}
                        formatter={(v) => fmtForce(Number(v))}
                        contentStyle={chartTooltipStyle}
                      />
                      <Line type="monotone" dataKey="V" dot={false} stroke="#38bdf8" strokeWidth={2.2} />
                    </LineChart>
                  </ResponsiveContainer>
                </PlotFrame>
              </Panel>
            )}
            {(chartMode === "all" || chartMode === "bmd") && (
              <Panel title="Bending Moment Diagram">
                <PlotFrame title="M(x)">
                  <ResponsiveContainer width="100%" height={chartHeight}>
                    <LineChart data={solved.data.plots.bmd} margin={{ top: 8, right: 14, bottom: 4, left: 2 }}>
                      <ReferenceLine x={activeCursorX} strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.72)" />
                      {supportChartMarkers.map((x, idx) => (
                        <ReferenceLine key={`bmd-support-${idx}-${x}`} x={x} stroke="rgba(125, 211, 252, 0.65)" strokeDasharray="2 2" />
                      ))}
                      {segmentChartMarkers.map((x, idx) => (
                        <ReferenceLine key={`bmd-segment-${idx}-${x}`} x={x} stroke="rgba(56, 189, 248, 0.45)" strokeDasharray="5 3" />
                      ))}
                      {releaseChartMarkers.map((x, idx) => (
                        <ReferenceLine key={`bmd-release-${idx}-${x}`} x={x} stroke="rgba(251, 146, 60, 0.78)" strokeDasharray="3 2" />
                      ))}
                      <CartesianGrid stroke="rgba(148, 163, 184, 0.20)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="x"
                        type="number"
                        domain={[0, inputs.L]}
                        ticks={xt}
                        tickFormatter={tickFmtLength}
                        tick={axisTickStyle}
                        axisLine={axisLineStyle}
                        tickLine={axisLineStyle}
                      />
                      <YAxis
                        tickFormatter={tickFmtMoment}
                        tickCount={6}
                        tick={axisTickStyle}
                        axisLine={axisLineStyle}
                        tickLine={axisLineStyle}
                        domain={(() => {
                          const ys = solved.data.plots.bmd.map((p) => p.M);
                          return yDomainPad(Math.min(...ys), Math.max(...ys));
                        })()}
                      />
                      <Tooltip
                        labelFormatter={(x) => `x = ${fmtLength(Number(x))}`}
                        formatter={(v) => fmtMoment(Number(v))}
                        contentStyle={chartTooltipStyle}
                      />
                      <Line type="monotone" dataKey="M" dot={false} stroke="#34d399" strokeWidth={2.2} />
                    </LineChart>
                  </ResponsiveContainer>
                </PlotFrame>
              </Panel>
            )}
            {(chartMode === "all" || chartMode === "deflection") && (
              <Panel title="Deflection Curve">
                <PlotFrame title="y(x)">
                  <ResponsiveContainer width="100%" height={chartHeight}>
                    <LineChart data={solved.data.plots.deflection} margin={{ top: 8, right: 14, bottom: 4, left: 2 }}>
                      <ReferenceLine x={activeCursorX} strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.72)" />
                      {supportChartMarkers.map((x, idx) => (
                        <ReferenceLine key={`defl-support-${idx}-${x}`} x={x} stroke="rgba(125, 211, 252, 0.65)" strokeDasharray="2 2" />
                      ))}
                      {segmentChartMarkers.map((x, idx) => (
                        <ReferenceLine key={`defl-segment-${idx}-${x}`} x={x} stroke="rgba(56, 189, 248, 0.45)" strokeDasharray="5 3" />
                      ))}
                      {releaseChartMarkers.map((x, idx) => (
                        <ReferenceLine key={`defl-release-${idx}-${x}`} x={x} stroke="rgba(251, 146, 60, 0.78)" strokeDasharray="3 2" />
                      ))}
                      <CartesianGrid stroke="rgba(148, 163, 184, 0.20)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="x"
                        type="number"
                        domain={[0, inputs.L]}
                        ticks={xt}
                        tickFormatter={tickFmtLength}
                        tick={axisTickStyle}
                        axisLine={axisLineStyle}
                        tickLine={axisLineStyle}
                      />
                      <YAxis
                        tickFormatter={tickFmtDeflection}
                        tickCount={6}
                        tick={axisTickStyle}
                        axisLine={axisLineStyle}
                        tickLine={axisLineStyle}
                        domain={(() => {
                          const ys = solved.data.plots.deflection.map((p) => p.y);
                          return yDomainPad(Math.min(...ys), Math.max(...ys));
                        })()}
                      />
                      <Tooltip labelFormatter={(x) => `x = ${fmtLength(Number(x))}`} formatter={(v) => fmtDeflection(Number(v))} contentStyle={chartTooltipStyle} />
                      <Line type="monotone" dataKey="y" dot={false} stroke="#fbbf24" strokeWidth={2.2} />
                    </LineChart>
                  </ResponsiveContainer>
                </PlotFrame>
              </Panel>
            )}
            {(chartMode === "all" || chartMode === "rotation") && (
              <Panel title="Rotation / Slope">
                <PlotFrame title="theta(x)">
                  <ResponsiveContainer width="100%" height={chartHeight}>
                    <LineChart data={solved.data.plots.rotation} margin={{ top: 8, right: 14, bottom: 4, left: 2 }}>
                      <ReferenceLine x={activeCursorX} strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.72)" />
                      {supportChartMarkers.map((x, idx) => (
                        <ReferenceLine key={`rot-support-${idx}-${x}`} x={x} stroke="rgba(125, 211, 252, 0.65)" strokeDasharray="2 2" />
                      ))}
                      {segmentChartMarkers.map((x, idx) => (
                        <ReferenceLine key={`rot-segment-${idx}-${x}`} x={x} stroke="rgba(56, 189, 248, 0.45)" strokeDasharray="5 3" />
                      ))}
                      {releaseChartMarkers.map((x, idx) => (
                        <ReferenceLine key={`rot-release-${idx}-${x}`} x={x} stroke="rgba(251, 146, 60, 0.78)" strokeDasharray="3 2" />
                      ))}
                      <CartesianGrid stroke="rgba(148, 163, 184, 0.20)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="x"
                        type="number"
                        domain={[0, inputs.L]}
                        ticks={xt}
                        tickFormatter={tickFmtLength}
                        tick={axisTickStyle}
                        axisLine={axisLineStyle}
                        tickLine={axisLineStyle}
                      />
                      <YAxis
                        tickFormatter={tickFmtRotation}
                        tickCount={6}
                        tick={axisTickStyle}
                        axisLine={axisLineStyle}
                        tickLine={axisLineStyle}
                        domain={(() => {
                          const ys = solved.data.plots.rotation.map((p) => p.theta);
                          return yDomainPad(Math.min(...ys), Math.max(...ys));
                        })()}
                      />
                      <Tooltip
                        labelFormatter={(x) => `x = ${fmtLength(Number(x))}`}
                        formatter={(v) => fmtRotation(Number(v))}
                        contentStyle={chartTooltipStyle}
                      />
                      <Line type="monotone" dataKey="theta" dot={false} stroke="#c084fc" strokeWidth={2.2} />
                    </LineChart>
                  </ResponsiveContainer>
                </PlotFrame>
              </Panel>
            )}
          </div>
          <div className="fieldHint" style={{ marginTop: 8 }}>
            Chart markers: supports (cyan dashed), segment boundaries (blue dashed), and internal releases (orange dashed).
          </div>
        </div>

      ) : null}

      <div style={{ marginTop: 14 }} className="twoCol">
        <Panel title="Assumptions + Applicability">
          <div className="steps">
            <div className="step">
              <div className="stepTitle">Core assumptions</div>
              <div className="stepNote">{assumptionsView.linearElastic}</div>
              <div className="stepNote">{assumptionsView.smallDeflection}</div>
              <div className="stepNote">{assumptionsView.idealization}</div>
              <div className="stepNote">{assumptionsView.beamTheory}</div>
              <div className="stepNote">{assumptionsView.shearDeformation}</div>
            </div>
            <div className="step">
              <div className="stepTitle">Model applicability</div>
              <div className="stepNote">{assumptionsView.supportIdealization}</div>
              <div className="stepNote">{assumptionsView.propertyVariation}</div>
              <div className="stepNote">{assumptionsView.thermalPrestrainModel}</div>
            </div>
            <div className="step">
              <div className="stepTitle">Not included in this solver scope</div>
              {assumptionsView.exclusions.map((exclusion) => (
                <div key={exclusion} className="stepNote">• {exclusion}</div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Confidence Transparency">
          {!solved.ok || !confidenceSubscores ? (
            <div className="muted">Confidence breakdown appears after a valid solve.</div>
          ) : (
            <div className="steps">
              <div className="step">
                <div className="stepTitle">Overall confidence: {confidenceText}</div>
                <div className="stepNote">Score: {fmtPlain(solved.data.outputs.quality?.confidenceScore ?? 0, 4)}</div>
                <div className="stepNote">
                  Weighted blend: equilibrium 32%, mesh 22%, applicability 22%, model completeness 14%, warning burden 10%.
                </div>
              </div>
              <div className="step">
                <div className="stepTitle">Sub-scores</div>
                <div className="stepNote">Equilibrium confidence: {fmtPlain(confidenceSubscores.equilibrium * 100, 4)}%</div>
                <div className="stepNote">Mesh confidence: {fmtPlain(confidenceSubscores.mesh * 100, 4)}%</div>
                <div className="stepNote">Applicability confidence: {fmtPlain(confidenceSubscores.applicability * 100, 4)}%</div>
                <div className="stepNote">Model completeness confidence: {fmtPlain(confidenceSubscores.modelCompleteness * 100, 4)}%</div>
                <div className="stepNote">Warning burden score: {fmtPlain(confidenceSubscores.warningBurden * 100, 4)}%</div>
              </div>
              {confidenceDrivers.length > 0 ? (
                <div className="step">
                  <div className="stepTitle">Primary confidence drivers</div>
                  {confidenceDrivers.map((driver) => (
                    <div key={driver} className="stepNote">• {driver}</div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel title="Warnings + Cautions">
          {!solved.ok ? (
            <div className="muted">Warnings appear after a valid solve.</div>
          ) : warningCards.length === 0 ? (
            <div className="muted">No active engineering warnings.</div>
          ) : (
            <div className="steps">
              {warningCards.map((warning) => (
                <div key={warning.id} className="step">
                  <div className="stepTitle">
                    {warning.id.replaceAll("_", " ")} ({warning.severity.toUpperCase()})
                  </div>
                  <div className="stepNote"><strong>Trigger:</strong> {warning.trigger}</div>
                  <div className="stepNote"><strong>Consequence:</strong> {warning.consequence}</div>
                  <div className="stepNote"><strong>Mitigation:</strong> {warning.mitigation}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div style={{ marginTop: 14 }} className="twoCol">
        <Panel title="Verification Suite">
          {verification.length === 0 ? (
            <div className="muted">Verification suite unavailable.</div>
          ) : (
            <div className="steps">
              {verification.map((v) => (
                <div key={v.id} className="step">
                  <div className="loadCaseMetaRow">
                    <div className="stepTitle">{v.label}</div>
                    <span className={v.pass ? "pill statusGood" : "pill statusBad"}>{v.pass ? "PASS" : "FAIL"}</span>
                  </div>
                  <div className="stepNote">{v.whyItMatters}</div>
                  <details>
                    <summary className="stepNote">Show benchmark detail</summary>
                    <div className="steps" style={{ marginTop: 8 }}>
                      {v.metrics.map((m) => (
                        <div key={`${v.id}-${m.label}`} className="step">
                          <div className="loadCaseMetaRow">
                            <div className="stepTitle">{m.label}</div>
                            <span className={Number.isFinite(m.relErr) && m.relErr <= m.tolerance ? "pill statusGood" : "pill statusBad"}>
                              {Number.isFinite(m.relErr) && m.relErr <= m.tolerance ? "PASS" : "FAIL"}
                            </span>
                          </div>
                          <div className="stepNote">Expected: {fmtPlain(m.expected)}</div>
                          <div className="stepNote">Actual: {fmtPlain(m.actual)}</div>
                          <div className="stepNote">Tolerance: {fmtPlain(m.tolerance * 100, 4)}%</div>
                          <div className="stepNote">Relative error: {fmtPlain(m.relErr * 100, 4)}%</div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Critical Points">
          {!solved.ok ? (
            <div className="muted">No critical points until inputs are valid.</div>
          ) : (
            <div className="steps">
              {solved.data.outputs.criticalPoints.map((p, i) => (
                <div key={`${p.x}-${i}`} className="step">
                  <div className="stepTitle">{p.label}</div>
                  <div className="stepNote">V={fmtForce(p.V)}</div>
                  <div className="stepNote">M={fmtMoment(p.M)}</div>
                  <div className="stepNote">y={fmtDeflection(p.y)}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {solved.ok ? (
        <div style={{ marginTop: 14 }}>
          <Panel title="Solve Audit / Traceability">
            {!solveAudit ? (
              <div className="muted">Audit record unavailable for current solve.</div>
            ) : (
              <div className="kv">
                <KV k="Timestamp (UTC)" v={0} fmt={() => solveAudit.timestamp} />
                <KV k="Input hash" v={0} fmt={() => solveAudit.inputHash} />
                <KV k="Model version" v={0} fmt={() => solveAudit.modelVersion} />
                <KV k="Solver version" v={0} fmt={() => solveAudit.solverVersion} />
                <KV k="Beam theory" v={0} fmt={() => solveAudit.beamTheory.replaceAll("_", " ")} />
                <KV k="Unit system" v={0} fmt={() => solveAudit.unitSystem} />
                <KV k="Mesh policy" v={0} fmt={() => solveAudit.meshPolicy} />
                <KV k="Adaptive refinement" v={0} fmt={() => (solveAudit.adaptiveRefinement ? "on" : "off")} />
                <KV k="Warning set" v={0} fmt={() => (solveAudit.warningSet.length ? solveAudit.warningSet.join(", ") : "none")} />
                <KV k="Equilibrium confidence" v={solveAudit.confidenceSubscores.equilibrium * 100} fmt={(x) => `${fmtPlain(x, 4)}%`} />
                <KV k="Mesh confidence" v={solveAudit.confidenceSubscores.mesh * 100} fmt={(x) => `${fmtPlain(x, 4)}%`} />
                <KV k="Applicability confidence" v={solveAudit.confidenceSubscores.applicability * 100} fmt={(x) => `${fmtPlain(x, 4)}%`} />
                <KV k="Model completeness confidence" v={solveAudit.confidenceSubscores.modelCompleteness * 100} fmt={(x) => `${fmtPlain(x, 4)}%`} />
                <KV k="Warning burden" v={solveAudit.confidenceSubscores.warningBurden * 100} fmt={(x) => `${fmtPlain(x, 4)}%`} />
              </div>
            )}
          </Panel>
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <Panel title="Explainability + Governing Drivers">
          {!solved.ok || !solved.data.outputs.explainability ? (
            <div className="muted">Explainability unavailable until solve is valid.</div>
          ) : (
            <div className="steps">
              {governingExplainability ? (
                <div className="step">
                  <div className="stepTitle">Governing load contributor</div>
                  <div className="stepNote">
                    {loadNameById.get(governingExplainability.loadId) ?? governingExplainability.loadId} ({loadTypeLabel(governingExplainability.loadType)})
                  </div>
                  <div className="stepNote">Contribution to governing moment: {fmtPlain(governingExplainability.contributionPctOfM)}%</div>
                </div>
              ) : null}
              {solved.data.outputs.explainability
                .slice()
                .sort((a, b) => b.contributionPctOfM - a.contributionPctOfM)
                .slice(0, showAllExplainability ? 24 : 8)
                .map((e) => (
                  <div className="step" key={e.loadId}>
                    <div className="stepTitle">
                      {loadNameById.get(e.loadId) ?? e.loadId} ({loadTypeLabel(e.loadType)})
                    </div>
                    <div className="stepNote">dM at governing x: {fmtMoment(e.dMAtGoverningX)}</div>
                    <div className="stepNote">dV at governing x: {fmtForce(e.dVAtGoverningX)}</div>
                    <div className="stepNote">Contribution: {fmtPlain(e.contributionPctOfM)}%</div>
                  </div>
                ))}
              {solved.data.outputs.explainability.length > 8 ? (
                <button className="btn btnSmall" onClick={() => setShowAllExplainability((v) => !v)}>
                  {showAllExplainability ? "Show fewer" : `Show more (${solved.data.outputs.explainability.length - 8} more)`}
                </button>
              ) : null}
            </div>
          )}
        </Panel>
      </div>

      {solved.ok && (solved.data.outputs.combinations || solved.data.outputs.envelope || solved.data.outputs.influenceLine) ? (
        <div style={{ marginTop: 14 }} className="twoCol">
          <Panel
            title="Load Combinations + Envelope"
            right={
              solved.data.outputs.envelopeMeta ? (
                <div className="muted">
                  Envelope: {solved.data.outputs.envelopeMeta.name} ({solved.data.outputs.envelopeMeta.combinationIds.length} combos)
                </div>
              ) : undefined
            }
          >
            {!solved.data.outputs.combinations ? (
              <div className="muted">No explicit load combinations defined.</div>
            ) : (
              <div className="steps">
                {solved.data.outputs.combinations.map((c) => (
                  <div key={c.id} className="step">
                    <div className="stepTitle">
                      {c.name} ({c.category ?? "custom"})
                    </div>
                    <div className="loadCaseMetaRow">
                      <span className={c.pass === undefined ? "pill" : c.pass ? "pill statusGood" : "pill statusBad"}>
                        {c.pass === undefined ? "N/A" : c.pass ? "PASS" : "FAIL"}
                      </span>
                      <span className="pill">Utilization: {c.utilization === undefined ? "N/A" : fmtPlain(c.utilization)}</span>
                      <span className="pill">Governing: {c.governingMode ? humanizeToken(c.governingMode) : "n/a"}</span>
                    </div>
                    <div className="stepNote">|M|max = {fmtMoment(c.MabsMax)} @ x={fmtLength(c.xAtMabsMax)}</div>
                    <div className="stepNote">|V|max = {fmtForce(c.VabsMax)} @ x={fmtLength(c.xAtVabsMax)}</div>
                    <div className="stepNote">|y|max = {fmtDeflection(c.yAbsMax)} @ x={fmtLength(c.xAtYAbsMax)}</div>
                    {c.governingX !== undefined ? <div className="stepNote">Governing location x = {fmtLength(c.governingX)}</div> : null}
                  </div>
                ))}
              </div>
            )}

            {solved.data.outputs.envelope && solved.data.outputs.envelope.length > 0 ? (
              <div style={{ marginTop: 12 }}>
                <div className="steps">
                  <div className="step">
                    <div className="stepTitle">Envelope Summary</div>
                    <div className="stepNote">
                      +M = {fmtMoment(envelopeStats?.maxMoment.value ?? 0)} at x={fmtLength(envelopeStats?.maxMoment.x ?? 0)}
                    </div>
                    <div className="stepNote">
                      -M = {fmtMoment(envelopeStats?.minMoment.value ?? 0)} at x={fmtLength(envelopeStats?.minMoment.x ?? 0)}
                    </div>
                    <div className="stepNote">
                      +V = {fmtForce(envelopeStats?.maxShear.value ?? 0)} at x={fmtLength(envelopeStats?.maxShear.x ?? 0)}
                    </div>
                    <div className="stepNote">
                      -V = {fmtForce(envelopeStats?.minShear.value ?? 0)} at x={fmtLength(envelopeStats?.minShear.x ?? 0)}
                    </div>
                    <div className="stepNote">
                      +y = {fmtDeflection(envelopeStats?.maxDeflection.value ?? 0)} at x={fmtLength(envelopeStats?.maxDeflection.x ?? 0)}
                    </div>
                    <div className="stepNote">
                      -y = {fmtDeflection(envelopeStats?.minDeflection.value ?? 0)} at x={fmtLength(envelopeStats?.minDeflection.x ?? 0)}
                    </div>
                    {solved.data.outputs.envelopeMeta?.criticalCombinationName ? (
                      <div className="stepNote">Critical combination: {solved.data.outputs.envelopeMeta.criticalCombinationName}</div>
                    ) : null}
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <PlotFrame title="Envelope M(x)">
                    <ResponsiveContainer width="100%" height={210}>
                      <LineChart data={solved.data.outputs.envelope} margin={{ top: 8, right: 14, bottom: 4, left: 2 }}>
                        <CartesianGrid stroke="rgba(148, 163, 184, 0.20)" strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="x"
                          type="number"
                          domain={[0, inputs.L]}
                          ticks={xt}
                          tickFormatter={tickFmtLength}
                          tick={axisTickStyle}
                          axisLine={axisLineStyle}
                          tickLine={axisLineStyle}
                        />
                        <YAxis tickFormatter={tickFmtMoment} tickCount={6} tick={axisTickStyle} axisLine={axisLineStyle} tickLine={axisLineStyle} />
                        <Tooltip
                          labelFormatter={(x) => `x = ${fmtLength(Number(x))}`}
                          formatter={(v) => fmtMoment(Number(v))}
                          contentStyle={chartTooltipStyle}
                        />
                        <Line type="monotone" dataKey="Mmax" dot={false} stroke="#34d399" strokeWidth={2.1} />
                        <Line type="monotone" dataKey="Mmin" dot={false} stroke="#ef4444" strokeWidth={2.1} />
                      </LineChart>
                    </ResponsiveContainer>
                  </PlotFrame>
                </div>
                <div style={{ marginTop: 10 }}>
                  <PlotFrame title="Envelope y(x)">
                    <ResponsiveContainer width="100%" height={210}>
                      <LineChart data={solved.data.outputs.envelope} margin={{ top: 8, right: 14, bottom: 4, left: 2 }}>
                        <CartesianGrid stroke="rgba(148, 163, 184, 0.20)" strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="x"
                          type="number"
                          domain={[0, inputs.L]}
                          ticks={xt}
                          tickFormatter={tickFmtLength}
                          tick={axisTickStyle}
                          axisLine={axisLineStyle}
                          tickLine={axisLineStyle}
                        />
                        <YAxis
                          tickFormatter={tickFmtDeflection}
                          tickCount={6}
                          tick={axisTickStyle}
                          axisLine={axisLineStyle}
                          tickLine={axisLineStyle}
                        />
                        <Tooltip
                          labelFormatter={(x) => `x = ${fmtLength(Number(x))}`}
                          formatter={(v) => fmtDeflection(Number(v))}
                          contentStyle={chartTooltipStyle}
                        />
                        <Line type="monotone" dataKey="ymax" dot={false} stroke="#fbbf24" strokeWidth={2.1} />
                        <Line type="monotone" dataKey="ymin" dot={false} stroke="#f97316" strokeWidth={2.1} />
                      </LineChart>
                    </ResponsiveContainer>
                  </PlotFrame>
                </div>
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 10 }}>
                No envelope data yet. Define active combinations and an envelope definition to generate envelope plots.
              </div>
            )}
          </Panel>

          <Panel title="Influence Line (Reference x=L/2)">
            {!solved.data.outputs.influenceLine ? (
              <div className="muted">Influence line unavailable.</div>
            ) : (
              <PlotFrame title="M(x=L/2) due to moving unit load">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={solved.data.outputs.influenceLine} margin={{ top: 8, right: 14, bottom: 4, left: 2 }}>
                    <CartesianGrid stroke="rgba(148, 163, 184, 0.20)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="xLoad"
                      type="number"
                      domain={[0, inputs.L]}
                      ticks={xt}
                      tickFormatter={tickFmtLength}
                      tick={axisTickStyle}
                      axisLine={axisLineStyle}
                      tickLine={axisLineStyle}
                    />
                    <YAxis tickFormatter={tickFmtMoment} tickCount={6} tick={axisTickStyle} axisLine={axisLineStyle} tickLine={axisLineStyle} />
                    <Tooltip labelFormatter={(x) => `x load = ${fmtLength(Number(x))}`} formatter={(v) => fmtMoment(Number(v))} contentStyle={chartTooltipStyle} />
                    <Line type="monotone" dataKey="MxRef" dot={false} stroke="#a78bfa" strokeWidth={2.2} />
                  </LineChart>
                </ResponsiveContainer>
              </PlotFrame>
            )}
          </Panel>
        </div>
      ) : null}
      </section>

      <section className="workflowZone beamWorkflowZone" id="beam-zone-compare">
        <div className="workflowZoneHead beamWorkflowZoneHead">
          <h2>4. Compare and Report</h2>
          <p>Track scenario changes and export reporting artifacts. {modeZoneHint.compare}</p>
        </div>
      <div style={{ marginTop: 14 }} className="twoCol">
        <Panel title="Report Context">
          <div className="steps">
            <div className="step">
              <div className="stepTitle">Template and mode</div>
              <div className="stepNote">Template: {reportTemplateLabel}</div>
              <div className="stepNote">Workflow mode: {modeLabel}</div>
              <div className="stepNote">Worked detail: {workedMode}</div>
            </div>
            <div className="step">
              <div className="stepTitle">Current solve snapshot</div>
              <div className="stepNote">Validation: {quickSolveStatus}</div>
              <div className="stepNote">Confidence: {confidenceText}</div>
              <div className="stepNote">Warnings: {warningCount}</div>
            </div>
            <button className="btn" onClick={onExportPdf} disabled={!solved.ok || isExporting}>
              {isExporting ? "Exporting..." : "Export PDF"}
            </button>
          </div>
        </Panel>

        <Panel title="Scenario Workspace">
          <div className="form">
            <div className="workflowQuickRow">
              <label className="field">
                <div className="fieldLabel">Checkpoint name</div>
                <input className="input" value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} />
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
                <button className="btn" onClick={saveScenario}>Save Checkpoint</button>
                <button className="btn" onClick={onExportPdf} disabled={!solved.ok || isExporting}>
                  {isExporting ? "Exporting..." : "Export PDF"}
                </button>
              </div>
            </div>
            <label className="field">
              <div className="fieldLabel">Compare with checkpoint</div>
              <select className="input" value={compareScenarioId} onChange={(e) => setCompareScenarioId(e.target.value)}>
                <option value="">None</option>
                {sortedScenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.atLabel})</option>
                ))}
              </select>
            </label>
            {scenarios.length === 0 ? (
              <div className="step">
                <div className="stepTitle">No checkpoints yet</div>
                <div className="stepNote">Save a checkpoint to enable comparison and quick rollback.</div>
              </div>
            ) : null}
            {compareScenarioId && (!compareScenario || !compareSolved) ? (
              <div className="step">
                <div className="stepTitle">Compare unavailable</div>
                <div className="stepNote">Selected scenario could not be solved with current validation settings.</div>
              </div>
            ) : null}
            {compareScenario && compareSolved && solved.ok ? (
              <div className="step">
                <div className="stepTitle">Diff vs {compareScenario.name}</div>
                <div className="stepNote">delta |M|max = {fmtMoment(solved.data.outputs.MabsMax - compareSolved.outputs.MabsMax)}</div>
                <div className="stepNote">delta |V|max = {fmtForce(solved.data.outputs.VabsMax - compareSolved.outputs.VabsMax)}</div>
                <div className="stepNote">delta |y|max = {fmtDeflection(solved.data.outputs.yAbsMax - compareSolved.outputs.yAbsMax)}</div>
              </div>
            ) : null}
            <CollapsibleSection
              id="scenario-manager"
              title="Scenario Manager"
              summary="Stored checkpoints and quick retrieval."
              summaryChips={[`saved ${scenarios.length}`, compareScenario ? `comparing ${compareScenario.name}` : "no comparison"]}
            >
              <div className="steps">
                {sortedScenarios.slice(0, 8).map((s) => (
                  <div className="step" key={s.id}>
                    <div className="stepTitle">{s.name}</div>
                    <div className="stepNote">{s.atLabel}</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btnSmall" onClick={() => loadScenario(s.id)}>Load</button>
                      <button className="btn btnSmall btnGhost" onClick={() => removeScenario(s.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              id="interop-manager"
              title="Interoperability (JSON / URL)"
              summary="Round-trip state import/export and share links."
              summaryChips={["json", "share-url"]}
            >
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <button className="btn" onClick={exportInputsJson}>Copy JSON</button>
                <button className="btn" onClick={importInputsJson}>Import JSON</button>
                <button className="btn" onClick={copyShareUrl}>Copy Share URL</button>
              </div>
              <label className="field">
                <div className="fieldLabel">Import / edit JSON</div>
                <textarea className="input" style={{ minHeight: 120, fontFamily: "ui-monospace,Consolas,monospace" }} value={importDraft} onChange={(e) => setImportDraft(e.target.value)} />
              </label>
              {importError ? <div className="error">{importError}</div> : null}
            </CollapsibleSection>

            <div className="step">
              <div className="stepTitle">Report Context + Checklist</div>
              <div className="stepNote">Template: {reportTemplate.replace("_", " ")}</div>
              <div className="stepNote">Worked mode: {workedMode}</div>
              <div className="stepNote">Validation: {quickSolveStatus}</div>
              <div className="stepNote">Warnings: {warningCount}</div>
              <div className="stepNote">Included sections: inputs, results, plots, beam, explainability, worked.</div>
            </div>
          </div>
        </Panel>
      </div>
      </section>

      {solved.ok && showWorked ? (
        <WorkedSolutionModal
          title="Beam Bending - Worked Solution"
          mode={workedMode}
          steps={solved.data.steps}
          onClose={() => {
            setShowWorked(false);
            setActiveSection("All");
          }}
          activeSection={activeSection}
          setActiveSection={setActiveSection}
        />
      ) : null}

      {solved.ok ? (
        <div className="printReportMount">
          <BeamReportPrint
            title="Beam Bending Report"
            timestamp={printTimestamp}
            inputs={inputs}
            outputs={solved.data.outputs}
            plots={solved.data.plots}
            workedMode={workedMode}
            template={reportTemplate}
            steps={solved.data.steps}
            displayUnits={displayUnits}
            onSectionRef={(name, el) => {
              printRefs.current[name] = el;
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function humanizeToken(v: string) {
  return v.replaceAll("_", " ");
}

function normalizeCategoryId(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function mergeLoadCategories(
  defs: LoadCategoryDefinition[] | undefined,
  loadCases: LoadCase[],
  loads: Load[]
) {
  const byId = new Map<string, LoadCategoryDefinition>();
  for (const builtIn of DEFAULT_LOAD_CATEGORY_DEFINITIONS) {
    byId.set(builtIn.id, { ...builtIn });
  }
  for (const def of defs ?? []) {
    const id = normalizeCategoryId(def.id);
    if (!id) continue;
    const merged: LoadCategoryDefinition = {
      id,
      name: def.name.trim() || humanizeToken(id),
      active: def.active !== false,
      note: def.note ?? "",
    };
    byId.set(id, merged);
  }
  const discovered = new Set<string>();
  for (const c of loadCases) {
    if (c.category) discovered.add(normalizeCategoryId(c.category));
  }
  for (const load of loads) {
    if (load.category) discovered.add(normalizeCategoryId(load.category));
  }
  for (const id of discovered) {
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      id,
      name: humanizeToken(id),
      active: true,
      note: "Discovered from existing model data.",
    });
  }

  const builtInOrder = new Map<string, number>(CASE_CATEGORY_OPTIONS.map((id, idx) => [id, idx]));
  return Array.from(byId.values()).sort((a, b) => {
    const ai = builtInOrder.has(a.id) ? (builtInOrder.get(a.id) ?? 0) : 999;
    const bi = builtInOrder.has(b.id) ? (builtInOrder.get(b.id) ?? 0) : 999;
    if (ai !== bi) return ai - bi;
    return a.id.localeCompare(b.id);
  });
}

function defaultSectionDims(
  sectionId: NonNullable<BeamBendingInputs["section"]>["id"],
  unit: "m" | "mm"
): Record<string, number> {
  const dimsInMeters: Record<string, number> =
    sectionId === "rectangular"
      ? { b: 0.3, h: 0.6 }
      : sectionId === "circular_solid"
        ? { D: 0.25 }
        : sectionId === "circular_hollow"
          ? { Do: 0.35, Di: 0.3 }
          : sectionId === "i_beam"
            ? { bf: 0.25, tf: 0.018, tw: 0.01, h: 0.45 }
            : { b: 0.15, tf: 0.016, tw: 0.009, h: 0.3 };
  if (unit === "m") return dimsInMeters;
  return Object.fromEntries(
    Object.entries(dimsInMeters).map(([key, value]) => [key, value * 1000])
  ) as Record<string, number>;
}

function resolveSupportStationsForView(inputs: BeamBendingInputs): SupportStation[] {
  const explicit = (inputs.supportLayout?.stations ?? [])
    .filter((station) => station.active !== false)
    .slice()
    .sort((a, b) => a.x - b.x);
  if (explicit.length > 0) return explicit;
  if (inputs.support === "cantilever") {
    return [
      {
        id: "S1",
        x: 0,
        restraint: "fixed",
        settlement: inputs.supportConditions?.leftSettlement ?? 0,
        imposedRotation: inputs.supportConditions?.leftRotation ?? 0,
      },
    ];
  }
  const leftRestraint = inputs.support === "fixed_fixed" || inputs.support === "propped_cantilever" ? "fixed" : "pinned";
  const rightRestraint = inputs.support === "fixed_fixed" ? "fixed" : "pinned";
  return [
    {
      id: "S1",
      x: 0,
      restraint: leftRestraint,
      settlement: inputs.supportConditions?.leftSettlement ?? 0,
      imposedRotation: inputs.supportConditions?.leftRotation ?? 0,
    },
    {
      id: "S2",
      x: inputs.L,
      restraint: rightRestraint,
      settlement: inputs.supportConditions?.rightSettlement ?? 0,
      imposedRotation: inputs.supportConditions?.rightRotation ?? 0,
    },
  ];
}

function interpolatePlotValue<
  T extends {
    x: number;
  },
>(series: T[], key: Exclude<keyof T, "x">, x: number) {
  if (series.length === 0) return 0;
  const sorted = series;
  if (x <= sorted[0].x) return Number(sorted[0][key] ?? 0);
  if (x >= sorted[sorted.length - 1].x) return Number(sorted[sorted.length - 1][key] ?? 0);
  let lo = 0;
  let hi = sorted.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const x1 = sorted[lo].x;
  const x2 = sorted[hi].x;
  const y1 = Number(sorted[lo][key] ?? 0);
  const y2 = Number(sorted[hi][key] ?? 0);
  const t = Math.abs(x2 - x1) < 1e-12 ? 0 : (x - x1) / (x2 - x1);
  return y1 + t * (y2 - y1);
}

function buildAssumptionsPreview(inputs: BeamBendingInputs): AssumptionsProfile {
  const theory = inputs.theory ?? "euler_bernoulli";
  const hasThermalOrPrestrain = inputs.loads.some((load) => load.type === "thermal" || load.type === "prestrain");
  const stations = resolveSupportStationsForView(inputs);
  const supportText =
    stations.length > 0
      ? `${humanizeToken(inputs.support)} support idealization with ${stations.length} station(s) at x=${stations
          .map((station) => station.x.toFixed(3))
          .join(", ")} m${(inputs.internalReleases ?? []).filter((r) => r.active !== false).length > 0 ? ` and ${(inputs.internalReleases ?? []).filter((r) => r.active !== false).length} internal release(s).` : "."}`
      : `${humanizeToken(inputs.support)} support idealization with optional spring/settlement modifiers.`;
  return {
    linearElastic: "Linear elastic constitutive behavior is assumed.",
    smallDeflection: "Small-deflection kinematics are assumed for global response.",
    idealization: "Member is modeled as a 1D beam centerline idealization.",
    beamTheory: theory === "timoshenko" ? "Timoshenko beam theory is used." : "Euler-Bernoulli beam theory is used.",
    shearDeformation:
      theory === "timoshenko"
        ? "Shear deformation is included via Timoshenko formulation."
        : "Shear deformation is neglected (Euler-Bernoulli assumption).",
    supportIdealization: supportText,
    propertyVariation:
      (inputs.stiffnessSegments ?? []).length > 0
        ? `Piecewise property variation is active using ${(inputs.stiffnessSegments ?? []).length} user-defined stiffness segment(s).`
        : "Section/material properties are treated as constant along the span.",
    thermalPrestrainModel: hasThermalOrPrestrain
      ? "Thermal/prestrain effects are represented as equivalent beam-theory actions."
      : "No thermal/prestrain actions are currently active.",
    exclusions: [
      "Plasticity and nonlinear material behavior.",
      "Cracking and post-cracking section redistribution.",
      "Buckling and lateral-torsional instability checks.",
      "Dynamic/time-history and modal effects.",
      "3D effects and out-of-plane behavior.",
      "Local contact/stress concentration effects unless separately modeled.",
    ],
  };
}

function parseWarningText(raw: string, id: string): WarningDetail {
  const triggerMatch = raw.match(/Trigger:\s*(.*?)\s*Consequence:/i);
  const consequenceMatch = raw.match(/Consequence:\s*(.*?)\s*Mitigation:/i);
  const mitigationMatch = raw.match(/Mitigation:\s*(.*)$/i);
  const trigger = triggerMatch?.[1]?.trim() || raw;
  const consequence = consequenceMatch?.[1]?.trim() || "Review solver assumptions and model suitability.";
  const mitigation = mitigationMatch?.[1]?.trim() || "Run sensitivity checks and use engineering judgement before sign-off.";
  const text = `${trigger} ${consequence} ${mitigation}`.toLowerCase();
  const severity: WarningDetail["severity"] =
    text.includes("critical") || text.includes("nonlinear") || text.includes("yield") ? "critical" : text.includes("sensitivity") ? "warning" : "info";
  return { id, severity, trigger, consequence, mitigation };
}

function formatCheckpointStamp(raw: string) {
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
