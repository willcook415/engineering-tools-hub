import { useMemo, useRef, useState } from "react";
import Panel from "../../../components/Panel";
import Latex from "../../../components/Latex";
import { exportPdfFromElement } from "../../../features/pdf/exportPdf";
import { solveBeamBending } from "../solve";
import type { BeamBendingInputs, Load, PointLoad, UDL, PointMoment } from "../model";
import PlotFrame from "../../../features/plotting/PlotFrame";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import BeamView from "./BeamView";
import { xTicks, yDomainPad } from "../../../features/plotting/ticks";
import { ReferenceLine } from "recharts";

export default function BeamBendingTool() {
  const [inputs, setInputs] = useState<BeamBendingInputs>({
    support: "simply_supported",
    L: 5,
    E: 200e9,
    I: 1e-6,
    loads: [
      { id: "P1", type: "point_load", x: 2, P: 1000 },
      { id: "U1", type: "udl", x1: 3, x2: 5, w: 200 },
    ],
  });

  const [selectedId, setSelectedId] = useState<string | null>(inputs.loads[0]?.id ?? null);

  const selectedLoad = inputs.loads.find(l => l.id === selectedId) ?? null;
  const selectedX =
    !selectedLoad ? null :
    selectedLoad.type === "udl" ? 0.5 * (selectedLoad.x1 + selectedLoad.x2) :
    selectedLoad.x;

  const xt = xTicks(inputs.L);
  const reportRef = useRef<HTMLDivElement | null>(null);

  const [showWorked, setShowWorked] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("All");

  const solved = useMemo(() => {
    try {
      return { ok: true as const, data: solveBeamBending(inputs) };
    } catch (e) {
      return { ok: false as const, err: (e as Error).message };
    }
  }, [inputs]);

  async function onExportPdf() {
    if (!reportRef.current) return;
    await exportPdfFromElement({ title: "Beam Bending Report", element: reportRef.current });
  }

  function updateLoad(id: string, patch: Partial<Load>) {
    setInputs((prev) => ({
      ...prev,
      loads: prev.loads.map((l) => (l.id === id ? ({ ...l, ...patch } as Load) : l)),
    }));
  }

  

  function removeLoad(id: string) {
    setInputs((prev) => {
      const next = prev.loads.filter((l) => l.id !== id);
      return { ...prev, loads: next };
    });
    setSelectedId((cur) => (cur === id ? null : cur));
  }

  function addPointLoad() {
    const n = inputs.loads.filter((l) => l.type === "point_load").length + 1;
    const id = `P${n}`;
    const x = Math.min(Math.max(inputs.L * 0.5, 0), inputs.L);
    const newLoad: PointLoad = { id, type: "point_load", x, P: 1000 };
    setInputs((prev) => ({ ...prev, loads: [...prev.loads, newLoad] }));
    setSelectedId(id);
  }

  function addUDL() {
    const n = inputs.loads.filter((l) => l.type === "udl").length + 1;
    const id = `U${n}`;
    const x1 = Math.min(inputs.L * 0.6, inputs.L);
    const x2 = Math.min(inputs.L * 0.9, inputs.L);
    const newLoad: UDL = { id, type: "udl", x1, x2, w: 200 };
    setInputs((prev) => ({ ...prev, loads: [...prev.loads, newLoad] }));
    setSelectedId(id);
  }

  function addMoment() {
    const n = inputs.loads.filter((l) => l.type === "moment").length + 1;
    const id = `M${n}`;
    const x = Math.min(Math.max(inputs.L * 0.5, 0), inputs.L);
    const newLoad: PointMoment = { id, type: "moment", x, M: 500 }; // N·m
    setInputs((prev) => ({ ...prev, loads: [...prev.loads, newLoad] }));
    setSelectedId(id);
    }

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>Beam Bending</h1>
        <p>Multi-load beam tool: point loads + UDLs (moments next).</p>
      </div>

      <div className="twoCol" ref={reportRef}>
        <Panel
          title="Inputs"
          right={
            <button className="btn" onClick={onExportPdf} disabled={!solved.ok}>
              Export PDF
            </button>
          }
        >
          <div className="form">
            <label className="field">
              <div className="fieldLabel">Support</div>
              <select
                className="input"
                value={inputs.support}
                onChange={(e) => setInputs({ ...inputs, support: e.target.value as any })}
              >
                <option value="simply_supported">Simply supported</option>
                <option value="cantilever" disabled>
                  Cantilever (next)
                </option>
              </select>
            </label>

            <NumberField
              label="Beam length L (m)"
              value={inputs.L}
              onChange={(v) => {
                const L = v;
                setInputs((prev) => ({
                  ...prev,
                  L,
                  loads: prev.loads.map((l) => clampLoadToBeam(l, L)),
                }));
              }}
            />

            <NumberField label="Young's modulus E (Pa)" value={inputs.E} onChange={(v) => setInputs({ ...inputs, E: v })} />
            <NumberField label="Second moment I (m^4)" value={inputs.I} onChange={(v) => setInputs({ ...inputs, I: v })} />
          </div>

          <div style={{ marginTop: 14 }} className="loadsHeader">
            <div className="loadsTitle">Loads</div>
            <div className="loadsActions">
                <button className="btn" onClick={addPointLoad}>+ Point load</button>
                <button className="btn" onClick={addUDL}>+ UDL</button>
                <button className="btn" onClick={addMoment}>+ Moment</button>
            </div>
          </div>

          <div className="loadsList">
            {inputs.loads.length === 0 ? (
              <div className="muted">No loads yet — add one.</div>
            ) : (
              inputs.loads.map((l) => (
                <LoadRow
                  key={l.id}
                  load={l}
                  isSelected={selectedId === l.id}
                  onSelect={() => setSelectedId(l.id)}
                  onUpdate={(patch) => updateLoad(l.id, patch)}
                  onRemove={() => removeLoad(l.id)}
                  L={inputs.L}
                />
              ))
            )}
          </div>

          {!solved.ok ? <div className="error">{solved.err}</div> : null}
        </Panel>

        {solved.ok ? (
          <Panel title="Results">
            <div className="kv">
              <KV k="R1 (N)" v={solved.data.outputs.reactions.R1} />
                <KV k="R2 (N)" v={solved.data.outputs.reactions.R2} />
              <KV k="Mmax (N·m)" v={solved.data.outputs.Mmax} />
              <KV k="x at Mmax (m)" v={solved.data.outputs.xMmax} />
              <KV k="y max down" v={solved.data.outputs.yMaxDown} fmt={(x) => fmtDeflection(x)} />
              <KV k="x at y max down (m)" v={solved.data.outputs.xAtYMaxDown} />
            </div>
          </Panel>
        ) : (
          <Panel title="Results">
            <div className="muted">Fix inputs to see results.</div>
          </Panel>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel
          title="Beam View (Interactive)"
          right={
            <div className="muted" style={{ fontSize: 12 }}>
              Selected: {selectedId ?? "none"}
            </div>
          }
        >
          <BeamView
            L={inputs.L}
            loads={inputs.loads}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            onUpdateLoad={(id, patch) => updateLoad(id, patch)}
          />
        </Panel>
      </div>

      {solved.ok ? (
        <div className="threeCol" style={{ marginTop: 14 }}>
          <Panel
            title="Worked Solution"
            right={
              <button className="btn" onClick={() => setShowWorked(true)}>
                Open
              </button>
            }
          >
            <div className="muted" style={{ lineHeight: 1.45 }}>
              Full step-by-step derivation with substituted values.
              <br />
              Opens in a focused viewer so it doesn’t wreck your layout.
            </div>
          </Panel>

          <Panel title="Shear Force Diagram">
            <PlotFrame title="V(x)">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={solved.data.plots.sfd}>
                    {selectedX != null ? <ReferenceLine x={selectedX} strokeDasharray="4 4" /> : null}
                  <CartesianGrid />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={[0, inputs.L]}
                    ticks={xt}
                    tickFormatter={(v) => (Number(v) % 1 === 0 ? Number(v).toFixed(0) : Number(v).toFixed(2))}
                  />
                  <YAxis
                  tickFormatter={fmtForce}
                    tickCount={6}
                    domain={(() => {
                      const ys = solved.data.plots.sfd.map((p) => p.V);
                      return yDomainPad(Math.min(...ys), Math.max(...ys));
                    })()}
                  />
                  <Tooltip />
                  <Line type="monotone" dataKey="V" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </PlotFrame>
          </Panel>

          <Panel title="Bending Moment Diagram">
            <PlotFrame title="M(x)">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={solved.data.plots.bmd}>
                    {selectedX != null ? <ReferenceLine x={selectedX} strokeDasharray="4 4" /> : null}
                  <CartesianGrid />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={[0, inputs.L]}
                    ticks={xt}
                    tickFormatter={(v) => (Number(v) % 1 === 0 ? Number(v).toFixed(0) : Number(v).toFixed(2))}
                  />
                  <YAxis
                  tickFormatter={fmtMoment}
                    tickCount={6}
                    domain={(() => {
                      const ys = solved.data.plots.bmd.map((p) => p.M);
                      return yDomainPad(Math.min(...ys), Math.max(...ys));
                    })()}
                  />
                  <Tooltip />
                  <Line type="monotone" dataKey="M" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </PlotFrame>
          </Panel>

          <Panel title="Deflection Curve">
            <PlotFrame title="y(x) (m)">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={solved.data.plots.deflection}>
                    {selectedX != null ? <ReferenceLine x={selectedX} strokeDasharray="4 4" /> : null}
                  <CartesianGrid />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={[0, inputs.L]}
                    ticks={xt}
                    tickFormatter={(v) => (Number(v) % 1 === 0 ? Number(v).toFixed(0) : Number(v).toFixed(2))}
                  />
                  <YAxis
                  tickFormatter={fmtDeflection}
                    tickCount={6}
                    domain={(() => {
                      const ys = solved.data.plots.deflection.map((p) => p.y);
                      return yDomainPad(Math.min(...ys), Math.max(...ys));
                    })()}
                  />
                  <Tooltip />
                  <Line type="monotone" dataKey="y" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </PlotFrame>
          </Panel>
        </div>
      ) : null}

      {solved.ok && showWorked ? (
        <WorkedSolutionModal
          title="Beam Bending — Worked Solution"
          steps={solved.data.steps}
          onClose={() => {
            setShowWorked(false);
            setActiveSection("All");
          }}
          activeSection={activeSection}
          setActiveSection={setActiveSection}
        />
      ) : null}
    </div>
  );
}

function clampLoadToBeam(l: Load, L: number): Load {
  const clamp = (v: number) => Math.max(0, Math.min(L, v));

  if (l.type === "point_load") return { ...l, x: clamp(l.x) };
  if (l.type === "udl") {
    const x1 = clamp(Math.min(l.x1, l.x2));
    const x2 = clamp(Math.max(l.x1, l.x2));
    return { ...l, x1, x2 };
  }
  if (l.type === "moment") return { ...l, x: clamp(l.x) };
  return l;
}

function LoadRow({
  load,
  isSelected,
  onSelect,
  onUpdate,
  onRemove,
  L,
}: {
  load: Load;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<Load>) => void;
  onRemove: () => void;
  L: number;
}) {
  return (
    <div className={isSelected ? "loadRow selected" : "loadRow"} onClick={onSelect}>
      <div className="loadTop">
        <div className="loadTag">
          {load.type === "point_load" ? "Point load" : load.type === "udl" ? "UDL" : "Moment"}
          <span className="muted" style={{ marginLeft: 8 }}>
            {load.id}
          </span>
        </div>
        <button className="btn btnGhost" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          Remove
        </button>
      </div>
      <label className="field" style={{ margin: "8px 0 10px" }}>
        <div className="fieldLabel">Name</div>
        <input
            className="input"
            value={load.name ?? ""}
            placeholder={load.id}
            onChange={(e) => onUpdate({ name: e.target.value } as any)}
            onClick={(e) => e.stopPropagation()}
        />
      </label>

      {load.type === "point_load" ? (
        <div className="loadGrid">
          <NumberFieldSmall label="x (m)" value={load.x} onChange={(v) => onUpdate({ x: clamp(v, 0, L) } as any)} />
          <NumberFieldSmall label="P (N)" value={load.P} onChange={(v) => onUpdate({ P: v } as any)} />
        </div>
      ) : load.type === "udl" ? (
        <div className="loadGrid">
          <NumberFieldSmall label="x1 (m)" value={load.x1} onChange={(v) => onUpdate({ x1: clamp(v, 0, L) } as any)} />
          <NumberFieldSmall label="x2 (m)" value={load.x2} onChange={(v) => onUpdate({ x2: clamp(v, 0, L) } as any)} />
          <NumberFieldSmall label="w (N/m)" value={load.w} onChange={(v) => onUpdate({ w: v } as any)} />
        </div>
      ) : load.type === "moment" ? (
        <div className="loadGrid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <NumberFieldSmall
            label="x (m)"
            value={load.x}
            onChange={(v) => onUpdate({ x: clamp(v, 0, L) } as any)}
            />
            <NumberFieldSmall
            label="M (N·m)"
            value={load.M}
            onChange={(v) => onUpdate({ M: v } as any)}
            />

            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, marginTop: 6 }}>
            <button
                className={load.M >= 0 ? "btn btnSmall activePill" : "btn btnSmall"}
                onClick={(e) => {
                e.stopPropagation();
                onUpdate({ M: Math.abs(load.M) } as any); // CW
                }}
            >
                CW
            </button>

            <button
                className={load.M < 0 ? "btn btnSmall activePill" : "btn btnSmall"}
                onClick={(e) => {
                e.stopPropagation();
                onUpdate({ M: -Math.abs(load.M) } as any); // CCW
                }}
            >
                CCW
            </button>

            <div className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
                Direction controls the arrow + internal jump.
            </div>
            </div>
        </div>
        ) : (
        <div className="muted">Unknown load type.</div>
        )}

      <div className="loadHint muted">Tip: select this load then drag it on the beam.</div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <div className="fieldLabel">{label}</div>
      <input className="input" type="number" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function NumberFieldSmall({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field" style={{ margin: 0 }}>
      <div className="fieldLabel">{label}</div>
      <input className="input" type="number" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function KV({ k, v, fmt }: { k: string; v: number; fmt?: (x: number) => string }) {
  return (
    <div className="kvRow">
      <div className="kvKey">{k}</div>
      <div className="kvVal">{Number.isFinite(v) ? (fmt ? fmt(v) : v.toFixed(4)) : "—"}</div>
    </div>
  );
}

function WorkedSolutionModal({
  title,
  steps,
  onClose,
  activeSection,
  setActiveSection,
}: {
  title: string;
  steps: { title?: string; latex?: string; note?: string }[];
  onClose: () => void;
  activeSection: string;
  setActiveSection: (s: string) => void;
}) {
  const sections: { name: string; items: typeof steps }[] = [];
  let currentName = "All";
  let currentItems: typeof steps = [];

  for (const s of steps) {
    if (s.title) {
      if (currentItems.length) sections.push({ name: currentName, items: currentItems });
      currentName = s.title;
      currentItems = [];
      continue;
    }
    currentItems.push(s);
  }
  if (currentItems.length) sections.push({ name: currentName, items: currentItems });

  const sectionNames = ["All", ...sections.map((s) => s.name)];
  const filtered = activeSection === "All" ? sections : sections.filter((s) => s.name === activeSection);

  return (
    <div className="modalOverlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <div className="modalTitle">{title}</div>
            <div className="modalSub">Formulae → substitution → result</div>
          </div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modalBody">
          <aside className="modalSidebar">
            {sectionNames.map((name) => (
              <button key={name} className={name === activeSection ? "modalNavItem active" : "modalNavItem"} onClick={() => setActiveSection(name)}>
                {name}
              </button>
            ))}
          </aside>

          <div className="modalContent">
            {filtered.map((sec) => (
              <div key={sec.name} className="workedSection">
                <div className="workedSectionTitle">{sec.name}</div>
                <div className="steps">
                  {sec.items.map((s, idx) => (
                    <div key={idx} className="step">
                      {s.note ? <div className="stepNote">{s.note}</div> : null}
                      {s.latex ? <Latex latex={s.latex} /> : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtForce(v: any) {
  const x = Number(v);
  if (!Number.isFinite(x)) return "";
  const ax = Math.abs(x);
  if (ax >= 1e6) return (x / 1e6).toFixed(2) + "M";
  if (ax >= 1e3) return (x / 1e3).toFixed(2) + "k";
  return x.toFixed(2);
}

function fmtMoment(v: any) {
  return fmtForce(v); // same scaling works fine for N·m
}

function fmtDeflection(v: any) {
  const x = Number(v);
  if (!Number.isFinite(x)) return "";

  const ax = Math.abs(x);
  // show in mm / µm / nm depending on magnitude
  if (ax >= 1e-3) return (x * 1e3).toFixed(3) + " mm";
  if (ax >= 1e-6) return (x * 1e6).toFixed(3) + " µm";
  if (ax >= 1e-9) return (x * 1e9).toFixed(3) + " nm";
  return x.toExponential(2) + " m";
}