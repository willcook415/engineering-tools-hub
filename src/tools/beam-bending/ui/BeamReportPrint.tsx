import { useMemo } from "react";
import type { Step } from "../../_shared/steps/stepTypes";
import { loadDisplayName, loadTypeLabel } from "../loadLabels";
import type { BeamBendingInputs, BeamBendingOutputs, BeamBendingPlots, BeamDisplayUnits, Load, WarningDetail } from "../model";
import { formatEngineeringNumber, formatUnitNumber, formatUnitValue, getDisplayUnits, quantityUnitSymbol } from "../units";

type Props = {
  title: string;
  timestamp: string;
  inputs: BeamBendingInputs;
  outputs: BeamBendingOutputs;
  plots: BeamBendingPlots;
  workedMode: "brief" | "detailed";
  template: "calc_note" | "submission" | "teaching";
  steps: Step[];
  displayUnits?: Partial<BeamDisplayUnits>;
  onSectionRef: (name: string, el: HTMLDivElement | null) => void;
};

export default function BeamReportPrint(props: Props) {
  const { title, timestamp, inputs, outputs, plots, workedMode, template, steps, displayUnits, onSectionRef } = props;
  const units = useMemo(() => getDisplayUnits(displayUnits), [displayUnits]);
  const fmtPlain = (v: number, sig = 4) => formatEngineeringNumber(v, sig);
  const fmtForce = (v: number, sig = 4) => formatUnitValue(v, units, "force", sig);
  const fmtForceN = (v: number, sig = 4) => formatUnitNumber(v, units, "force", sig);
  const fmtLength = (v: number, sig = 4) => formatUnitValue(v, units, "length", sig);
  const fmtMoment = (v: number, sig = 4) => formatUnitValue(v, units, "moment", sig);
  const fmtMomentN = (v: number, sig = 4) => formatUnitNumber(v, units, "moment", sig);
  const fmtDeflection = (v: number, sig = 4) => formatUnitValue(v, units, "deflection", sig);
  const fmtDeflectionN = (v: number, sig = 4) => formatUnitNumber(v, units, "deflection", sig);
  const fmtStress = (v: number, sig = 4) => formatUnitValue(v, units, "stress", sig);
  const fmtModulus = (v: number, sig = 4) => formatUnitValue(v, units, "modulus", sig);
  const fmtInertia = (v: number, sig = 4) => formatUnitValue(v, units, "inertia", sig);
  const fmtArea = (v: number, sig = 4) => formatUnitValue(v, units, "area", sig);
  const loadSummary = useMemo(() => summarizeLoads(inputs), [inputs]);
  const loadNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of inputs.loads) map.set(l.id, loadDisplayName(l));
    return map;
  }, [inputs.loads]);
  const workedSections = useMemo(() => splitWorkedSections(steps), [steps]);
  const warningRows = useMemo(() => {
    if (outputs.warningDetails?.length) return outputs.warningDetails;
    return outputs.validityWarnings.map((raw, idx) => parseLegacyWarning(raw, `legacy_${idx + 1}`));
  }, [outputs.warningDetails, outputs.validityWarnings]);
  const assumptionsView = useMemo(() => outputs.assumptions ?? buildAssumptionsFromInputs(inputs), [outputs.assumptions, inputs]);

  return (
    <div className="printReportRoot" aria-hidden="true">
      <div className="printSection" ref={(el) => onSectionRef("header", el)}>
        <h1>{title}</h1>
        <div className="printSubtle">
          {template === "submission"
            ? "Formal submission template with governing checks and traceable assumptions."
            : template === "teaching"
              ? "Teaching template with extra derivation context and explainability."
              : "Calculation-note template for design iteration and internal review."}
        </div>
        <div className="printMeta">
          <span>{timestamp}</span>
          <span>Support: {inputs.support.replaceAll("_", " ")}</span>
          <span>Theory: {inputs.theory ?? "euler_bernoulli"}</span>
          <span>Units: {units.system === "engineering_metric" ? "Engineering Metric" : "SI Base"}</span>
          <span>Worked mode: {workedMode}</span>
          <span>Template: {template.replace("_", " ")}</span>
        </div>
        <div className="printAudit">
          <div>Mesh: {outputs.quality?.meshPoints ?? "-"} points</div>
          <div>Theory: {(inputs.theory ?? "euler_bernoulli").replace("_", " ")}</div>
          <div>Material: {inputs.material?.name ?? inputs.material?.id ?? "custom/default"}</div>
          <div>Warnings: {warningRows.length}</div>
          <div>Confidence: {(outputs.quality?.confidenceBadge ?? "n/a").toString().toUpperCase()}</div>
        </div>
      </div>

      <div className="printSection" ref={(el) => onSectionRef("inputs", el)}>
        <h2>Input Summary</h2>
        <table className="printTable">
          <tbody>
            <tr><th>Span L</th><td>{fmtLength(inputs.L)}</td><th>E</th><td>{fmtModulus(inputs.E)}</td></tr>
            <tr><th>I</th><td>{fmtInertia(inputs.I)}</td><th>A</th><td>{fmtArea(inputs.A ?? 0)}</td></tr>
            <tr><th>nu</th><td>{fmtPlain(inputs.nu ?? 0.3, 3)}</td><th>kappa</th><td>{fmtPlain(inputs.kappaShear ?? 5 / 6, 3)}</td></tr>
            <tr><th>Section</th><td>{inputs.section?.id ?? "none"}</td><th>Dims unit</th><td>{inputs.section?.unit ?? "-"}</td></tr>
          </tbody>
        </table>
        <div className="printSubtle">{loadSummary}</div>
      </div>

      <div className="printSection" ref={(el) => onSectionRef("assumptions", el)}>
        <h2>Assumptions and Applicability</h2>
        <ul className="printList">
          <li>{assumptionsView.linearElastic}</li>
          <li>{assumptionsView.smallDeflection}</li>
          <li>{assumptionsView.idealization}</li>
          <li>{assumptionsView.beamTheory}</li>
          <li>{assumptionsView.shearDeformation}</li>
          <li>{assumptionsView.supportIdealization}</li>
          <li>{assumptionsView.propertyVariation}</li>
          <li>{assumptionsView.thermalPrestrainModel}</li>
        </ul>
        <div className="printSubtle" style={{ marginTop: 8 }}>Exclusions</div>
        <ul className="printList">
          {assumptionsView.exclusions.map((exclusion) => (
            <li key={exclusion}>{exclusion}</li>
          ))}
        </ul>
      </div>

      <div className="printSection" ref={(el) => onSectionRef("results", el)}>
        <h2>Governing Results</h2>
        <table className="printTable">
          <tbody>
            {Object.entries(outputs.reactions).map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{k.toLowerCase().includes("m") ? fmtMoment(v) : fmtForce(v)}</td>
                <th></th>
                <td></td>
              </tr>
            ))}
            <tr><th>|V|max</th><td>{fmtForce(outputs.VabsMax)}</td><th>x at |V|max</th><td>{fmtLength(outputs.xAtVabsMax)}</td></tr>
            <tr><th>|M|max</th><td>{fmtMoment(outputs.MabsMax)}</td><th>x at |M|max</th><td>{fmtLength(outputs.xAtMabsMax)}</td></tr>
            <tr><th>|y|max</th><td>{fmtDeflection(outputs.yAbsMax)}</td><th>x at |y|max</th><td>{fmtLength(outputs.xAtYAbsMax)}</td></tr>
            {outputs.thetaAbsMax !== undefined ? (
              <tr><th>|theta|max</th><td>{formatUnitValue(outputs.thetaAbsMax, units, "rotation")}</td><th>x at |theta|max</th><td>{fmtLength(outputs.xAtThetaAbsMax ?? 0)}</td></tr>
            ) : null}
            <tr><th>Serviceability</th><td>{outputs.serviceability.passes ? "PASS" : "FAIL"}</td><th>L/d</th><td>{fmtPlain(outputs.serviceability.actualRatio, 4)}</td></tr>
            {outputs.stress ? (
              <>
                <tr><th>sigma max</th><td>{fmtStress(outputs.stress.sigmaMax)}</td><th>tau avg</th><td>{fmtStress(outputs.stress.tauAvgMax)}</td></tr>
                <tr><th>tau max est.</th><td>{fmtStress(outputs.stress.tauMaxEstimate)}</td><th>Section modulus used</th><td>{formatUnitValue(outputs.stress.sectionModulus, units, "sectionModulus")}</td></tr>
              </>
            ) : null}
            {outputs.designChecks ? (
              <tr><th>Design utilization</th><td>{fmtPlain(Math.max(outputs.designChecks.deflectionUtilization, outputs.designChecks.bendingUtilization ?? 0, outputs.designChecks.shearUtilization ?? 0), 4)}</td><th>Governing</th><td>{outputs.designChecks.governingMode}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {warningRows.length > 0 ? (
        <div className="printSection" ref={(el) => onSectionRef("warnings", el)}>
          <h2>Warnings and Cautions</h2>
          <table className="printTable">
            <thead>
              <tr>
                <th>Id</th>
                <th>Severity</th>
                <th>Trigger</th>
                <th>Consequence</th>
                <th>Mitigation</th>
              </tr>
            </thead>
            <tbody>
              {warningRows.map((w) => (
                <tr key={w.id}>
                  <td>{w.id}</td>
                  <td>{w.severity}</td>
                  <td>{w.trigger}</td>
                  <td>{w.consequence}</td>
                  <td>{w.mitigation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {outputs.solveAudit ? (
        <div className="printSection" ref={(el) => onSectionRef("audit", el)}>
          <h2>Solve Audit</h2>
          <table className="printTable">
            <tbody>
              <tr><th>Timestamp (UTC)</th><td>{outputs.solveAudit.timestamp}</td><th>Input hash</th><td>{outputs.solveAudit.inputHash}</td></tr>
              <tr><th>Model version</th><td>{outputs.solveAudit.modelVersion}</td><th>Solver version</th><td>{outputs.solveAudit.solverVersion}</td></tr>
              <tr><th>Beam theory</th><td>{outputs.solveAudit.beamTheory.replaceAll("_", " ")}</td><th>Unit system</th><td>{outputs.solveAudit.unitSystem}</td></tr>
              <tr><th>Mesh policy</th><td>{outputs.solveAudit.meshPolicy}</td><th>Adaptive refinement</th><td>{outputs.solveAudit.adaptiveRefinement ? "on" : "off"}</td></tr>
              <tr><th>Warning set</th><td colSpan={3}>{outputs.solveAudit.warningSet.join(", ") || "none"}</td></tr>
              <tr>
                <th>Confidence subscores</th>
                <td colSpan={3}>
                  Eq {fmtPlain(outputs.solveAudit.confidenceSubscores.equilibrium * 100, 4)}% | Mesh {fmtPlain(outputs.solveAudit.confidenceSubscores.mesh * 100, 4)}% |
                  Applicability {fmtPlain(outputs.solveAudit.confidenceSubscores.applicability * 100, 4)}% | Completeness {fmtPlain(outputs.solveAudit.confidenceSubscores.modelCompleteness * 100, 4)}% |
                  Warning burden {fmtPlain(outputs.solveAudit.confidenceSubscores.warningBurden * 100, 4)}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="printSection" ref={(el) => onSectionRef("plots", el)}>
        <h2>Key Plots</h2>
        <PlotMini title={`Shear Force V(x) [${quantityUnitSymbol(units, "force")}]`} data={plots.sfd.map((p) => ({ x: p.x, y: p.V }))} />
        <PlotMini title={`Bending Moment M(x) [${quantityUnitSymbol(units, "moment")}]`} data={plots.bmd.map((p) => ({ x: p.x, y: p.M }))} />
        <PlotMini title={`Deflection y(x) [${quantityUnitSymbol(units, "deflection")}]`} data={plots.deflection.map((p) => ({ x: p.x, y: p.y }))} />
        <PlotMini title={`Rotation theta(x) [${quantityUnitSymbol(units, "rotation")}]`} data={plots.rotation.map((p) => ({ x: p.x, y: p.theta }))} />
      </div>

      <div className="printSection" ref={(el) => onSectionRef("beam", el)}>
        <h2>Beam and Loading Schematic</h2>
        <BeamSchematic
          L={inputs.L}
          support={inputs.support}
          supportLayout={inputs.supportLayout}
          stiffnessSegments={inputs.stiffnessSegments}
          internalReleases={inputs.internalReleases}
          loads={inputs.loads}
          lengthLabel={fmtLength(inputs.L)}
        />
      </div>

      {outputs.combinations?.length ? (
        <div className="printSection" ref={(el) => onSectionRef("combos", el)}>
          <h2>Load Combinations</h2>
          {outputs.envelopeMeta ? (
            <div className="printSubtle" style={{ marginBottom: 8 }}>
              Envelope: {outputs.envelopeMeta.name ?? outputs.envelopeMeta.id ?? "Active"} | Combinations:{" "}
              {outputs.envelopeMeta.combinationIds.join(", ")} | Critical: {outputs.envelopeMeta.criticalCombinationName ?? "-"}
            </div>
          ) : null}
          <table className="printTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Pass/Fail</th>
                <th>Utilization</th>
                <th>Governing</th>
                <th>x governing ({quantityUnitSymbol(units, "length")})</th>
                <th>|M|max ({quantityUnitSymbol(units, "moment")})</th>
                <th>|V|max ({quantityUnitSymbol(units, "force")})</th>
                <th>|y|max ({quantityUnitSymbol(units, "deflection")})</th>
              </tr>
            </thead>
            <tbody>
              {outputs.combinations.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.pass === undefined ? "N/A" : c.pass ? "PASS" : "FAIL"}</td>
                  <td>{c.utilization === undefined ? "-" : fmtPlain(c.utilization, 4)}</td>
                  <td>{c.governingMode ?? "-"}</td>
                  <td>{c.governingX === undefined ? "-" : fmtLength(c.governingX)}</td>
                  <td>{fmtMomentN(c.MabsMax)}</td>
                  <td>{fmtForceN(c.VabsMax)}</td>
                  <td>{fmtDeflectionN(c.yAbsMax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {outputs.envelope?.length ? (
            <div style={{ marginTop: 10 }}>
              <PlotMini title={`Moment Envelope M(x) [${quantityUnitSymbol(units, "moment")}]`} data={outputs.envelope.map((p) => ({ x: p.x, y: p.Mmax }))} />
              <PlotMini title={`Deflection Envelope y(x) [${quantityUnitSymbol(units, "deflection")}]`} data={outputs.envelope.map((p) => ({ x: p.x, y: p.ymax }))} />
            </div>
          ) : null}
        </div>
      ) : null}

      {outputs.influenceLine?.length ? (
        <div className="printSection" ref={(el) => onSectionRef("influence", el)}>
          <h2>Influence Line at x=L/2</h2>
          <PlotMini title="MxRef due to moving unit load" data={outputs.influenceLine.map((p) => ({ x: p.xLoad, y: p.MxRef }))} />
        </div>
      ) : null}

      {outputs.explainability?.length ? (
        <div className="printSection" ref={(el) => onSectionRef("explain", el)}>
          <h2>Explainability at Governing x</h2>
          <table className="printTable">
            <thead>
              <tr><th>Load</th><th>dM</th><th>dV</th><th>Contribution %</th></tr>
            </thead>
            <tbody>
              {outputs.explainability.slice(0, 12).map((e) => (
                <tr key={e.loadId}>
                  <td>{loadNameMap.get(e.loadId) ?? e.loadId} ({loadTypeLabel(e.loadType)})</td>
                  <td>{fmtMomentN(e.dMAtGoverningX)}</td>
                  <td>{fmtForceN(e.dVAtGoverningX)}</td>
                  <td>{fmtPlain(e.contributionPctOfM, 3)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="printSection" ref={(el) => onSectionRef("worked", el)}>
        <h2>Worked Solution Appendix ({workedMode})</h2>
        {workedSections.map((sec) => (
          <div key={sec.name} className="printWorkedSection">
            <h3>{sec.name}</h3>
            {sec.items.map((s, i) => (
              <p key={`${sec.name}-${i}`}>{s.note ?? s.latex ?? ""}</p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function parseLegacyWarning(raw: string, id: string): WarningDetail {
  const triggerMatch = raw.match(/Trigger:\s*(.*?)\s*Consequence:/i);
  const consequenceMatch = raw.match(/Consequence:\s*(.*?)\s*Mitigation:/i);
  const mitigationMatch = raw.match(/Mitigation:\s*(.*)$/i);
  const trigger = triggerMatch?.[1]?.trim() || raw;
  const consequence = consequenceMatch?.[1]?.trim() || "Review model applicability and engineering assumptions.";
  const mitigation = mitigationMatch?.[1]?.trim() || "Run sensitivity checks before design sign-off.";
  const lower = `${trigger} ${consequence} ${mitigation}`.toLowerCase();
  const severity: WarningDetail["severity"] =
    lower.includes("critical") || lower.includes("yield") || lower.includes("nonlinear")
      ? "critical"
      : lower.includes("warning") || lower.includes("sensitivity")
        ? "warning"
        : "info";
  return { id, severity, trigger, consequence, mitigation };
}

function buildAssumptionsFromInputs(inputs: BeamBendingInputs) {
  const theory = inputs.theory ?? "euler_bernoulli";
  const hasThermalOrPrestrain = inputs.loads.some((load) => load.type === "thermal" || load.type === "prestrain");
  const stations = (inputs.supportLayout?.stations ?? []).filter((station) => station.active !== false);
  const supportIdealization =
    stations.length > 0
      ? `${inputs.support.replaceAll("_", " ")} support idealization with ${stations.length} station(s) at x=${stations
          .map((station) => station.x.toFixed(3))
          .join(", ")} m${(inputs.internalReleases ?? []).filter((release) => release.active !== false).length > 0 ? ` and ${(inputs.internalReleases ?? []).filter((release) => release.active !== false).length} internal release(s).` : "."}`
      : `${inputs.support.replaceAll("_", " ")} support idealization with optional spring/settlement modifiers.`;
  return {
    linearElastic: "Linear elastic constitutive behavior is assumed.",
    smallDeflection: "Small-deflection kinematics are assumed for global response.",
    idealization: "Member is modeled as a 1D beam centerline idealization.",
    beamTheory: theory === "timoshenko" ? "Timoshenko beam theory is used." : "Euler-Bernoulli beam theory is used.",
    shearDeformation:
      theory === "timoshenko"
        ? "Shear deformation is included via Timoshenko formulation."
        : "Shear deformation is neglected (Euler-Bernoulli assumption).",
    supportIdealization,
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

function summarizeLoads(inputs: BeamBendingInputs) {
  const counts: Record<string, number> = {};
  for (const l of inputs.loads) {
    counts[l.type] = (counts[l.type] ?? 0) + 1;
  }
  const summary = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ");
  return summary ? `Active loads: ${summary}` : "Active loads: none";
}

function splitWorkedSections(steps: Step[]) {
  const sections: { name: string; items: Step[] }[] = [];
  let name = "Worked Steps";
  let items: Step[] = [];
  for (const s of steps) {
    if (s.title) {
      if (items.length) sections.push({ name, items });
      name = s.title;
      items = [];
      continue;
    }
    items.push(s);
  }
  if (items.length) sections.push({ name, items });
  return sections;
}

function PlotMini({ title, data }: { title: string; data: Array<{ x: number; y: number }> }) {
  const w = 820;
  const h = 220;
  const pad = 36;
  const xs = data.map((p) => p.x);
  const ys = data.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1e-9, maxX - minX);
  const spanY = Math.max(1e-9, maxY - minY);
  const path = data
    .map((p, i) => {
      const x = pad + ((p.x - minX) / spanX) * (w - 2 * pad);
      const y = h - pad - ((p.y - minY) / spanY) * (h - 2 * pad);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <div className="printPlot">
      <div className="printPlotTitle">{title}</div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <rect x={0} y={0} width={w} height={h} fill="#fff" />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#666" strokeWidth={1} />
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#666" strokeWidth={1} />
        <path d={path} fill="none" stroke="#1155cc" strokeWidth={2} />
      </svg>
    </div>
  );
}

function BeamSchematic({
  L,
  support,
  supportLayout,
  stiffnessSegments,
  internalReleases,
  loads,
  lengthLabel,
}: {
  L: number;
  support: BeamBendingInputs["support"];
  supportLayout?: BeamBendingInputs["supportLayout"];
  stiffnessSegments?: BeamBendingInputs["stiffnessSegments"];
  internalReleases?: BeamBendingInputs["internalReleases"];
  loads: Load[];
  lengthLabel: string;
}) {
  const w = 820;
  const y = 95;
  const x0 = 40;
  const x1 = w - 40;
  const xAt = (x: number) => x0 + ((x || 0) / (L || 1)) * (x1 - x0);
  const supportStations = (() => {
    const explicit = (supportLayout?.stations ?? []).filter((station) => station.active !== false);
    if (explicit.length > 0) return explicit;
    if (support === "cantilever") return [{ id: "S1", x: 0, restraint: "fixed" as const }];
    if (support === "fixed_fixed") {
      return [
        { id: "S1", x: 0, restraint: "fixed" as const },
        { id: "S2", x: L, restraint: "fixed" as const },
      ];
    }
    if (support === "propped_cantilever") {
      return [
        { id: "S1", x: 0, restraint: "fixed" as const },
        { id: "S2", x: L, restraint: "pinned" as const },
      ];
    }
    return [
      { id: "S1", x: 0, restraint: "pinned" as const },
      { id: "S2", x: L, restraint: "pinned" as const },
    ];
  })();
  const segmentBoundaries = Array.from(
    new Set(
      (stiffnessSegments ?? [])
        .flatMap((segment) => [segment.x1, segment.x2])
        .map((x) => Math.max(0, Math.min(L, x)))
        .map((x) => Number(x.toFixed(6)))
        .filter((x) => x > 1e-6 && x < L - 1e-6)
    )
  ).sort((a, b) => a - b);
  const releases = (internalReleases ?? [])
    .filter((release) => release.active !== false && release.type === "moment")
    .map((release) => Math.max(0, Math.min(L, release.x)));

  return (
    <svg width={w} height={180} viewBox={`0 0 ${w} 180`}>
      <rect x={0} y={0} width={w} height={180} fill="#fff" />
      {(stiffnessSegments ?? [])
        .filter((segment) => segment.x2 > segment.x1)
        .map((segment, idx) => {
          const xa = xAt(Math.max(0, Math.min(L, segment.x1)));
          const xb = xAt(Math.max(0, Math.min(L, segment.x2)));
          const fill = idx % 2 === 0 ? "#e0f2fe" : "#dcfce7";
          return (
            <rect
              key={`seg-${segment.id}`}
              x={Math.min(xa, xb)}
              y={y - 14}
              width={Math.max(2, Math.abs(xb - xa))}
              height={28}
              fill={fill}
              stroke="#cbd5e1"
            />
          );
        })}
      {segmentBoundaries.map((x, idx) => (
        <line key={`seg-b-${idx}`} x1={xAt(x)} y1={y - 22} x2={xAt(x)} y2={y + 22} stroke="#94a3b8" strokeDasharray="4 3" />
      ))}
      <line x1={x0} y1={y} x2={x1} y2={y} stroke="#222" strokeWidth={5} strokeLinecap="round" />
      {supportStations.map((station) => {
        const x = xAt(station.x);
        return station.restraint === "fixed" ? (
          <g key={station.id}>
            <line x1={x} y1={y - 22} x2={x} y2={y + 22} stroke="#334155" strokeWidth={4} />
            <text x={x} y={y + 36} textAnchor="middle" fill="#334155" fontSize={10}>
              {station.id}
            </text>
          </g>
        ) : (
          <g key={station.id}>
            <polygon points={`${x},${y + 5} ${x - 12},${y + 26} ${x + 12},${y + 26}`} fill="#dbeafe" stroke="#1d4ed8" />
            <text x={x} y={y + 40} textAnchor="middle" fill="#1d4ed8" fontSize={10}>
              {station.id}
            </text>
          </g>
        );
      })}
      {releases.map((x, idx) => (
        <g key={`release-${idx}`}>
          <circle cx={xAt(x)} cy={y} r={5} fill="#fff7ed" stroke="#ea580c" strokeWidth={2} />
          <line x1={xAt(x)} y1={y - 12} x2={xAt(x)} y2={y + 12} stroke="#ea580c" strokeWidth={1.5} />
        </g>
      ))}
      {loads.map((l) => {
        if (l.type === "point_load") {
          const x = xAt(l.x);
          return (
            <g key={l.id}>
              <line x1={x} y1={34} x2={x} y2={y - 8} stroke="#00796b" strokeWidth={2} />
              <polygon points={`${x - 6},${y - 10} ${x + 6},${y - 10} ${x},${y + 2}`} fill="#00796b" />
            </g>
          );
        }
        if (l.type === "moment") {
          const x = xAt(l.x);
          return (
            <g key={l.id}>
              <circle cx={x} cy={y - 22} r={12} fill="none" stroke="#d97706" strokeWidth={2} />
              <text x={x + 14} y={y - 20} fill="#d97706" fontSize={10}>M</text>
            </g>
          );
        }
        const xa = xAt(Math.min(l.x1, l.x2));
        const xb = xAt(Math.max(l.x1, l.x2));
        if (l.type === "udl" || l.type === "linear_dist") {
          return <rect key={l.id} x={xa} y={46} width={Math.max(2, xb - xa)} height={12} fill={l.type === "udl" ? "#60a5fa99" : "#16a34a99"} />;
        }
        if (l.type === "thermal") {
          return <rect key={l.id} x={xa} y={y - 6} width={Math.max(2, xb - xa)} height={12} fill="#f59e0b66" stroke="#f59e0b" />;
        }
        return <line key={l.id} x1={xa} y1={y + 28} x2={xb} y2={y + 28} stroke="#ec4899" strokeWidth={3} strokeDasharray="5 4" />;
      })}
      <text x={w / 2} y={140} textAnchor="middle" fill="#333" fontSize={14}>
        Span L = {lengthLabel}
      </text>
    </svg>
  );
}
