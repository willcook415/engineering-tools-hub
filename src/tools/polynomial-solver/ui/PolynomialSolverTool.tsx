import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import CollapsibleSection from "../../../components/CollapsibleSection";
import Latex from "../../../components/Latex";
import Panel from "../../../components/Panel";
import PlotFrame from "../../../features/plotting/PlotFrame";
import { fmtComplex, fmtNumber, polynomialLatex } from "../format";
import { parseBatchCoefficientLines, parseCoefficientText, parsePolynomialExpression } from "../parser";
import { solvePolynomial } from "../solve";
import { DEFAULT_DELTA_TOLERANCE, DEFAULT_MAX_ITERATIONS, DEFAULT_RESIDUAL_TOLERANCE, getPolynomialInputIssues } from "../validation";
import { toPolynomialInputs, usePolynomialHistory, type PolynomialEditorState } from "./usePolynomialHistory";

const PRESETS: Array<{ label: string; coefficients: number[] }> = [
  { label: "x - 5", coefficients: [1, -5] },
  { label: "x^2 - 5x + 6", coefficients: [1, -5, 6] },
  { label: "x^3 - 6x^2 + 11x - 6", coefficients: [1, -6, 11, -6] },
  { label: "x^4 + 1", coefficients: [1, 0, 0, 0, 1] },
  { label: "Ill-conditioned demo", coefficients: [1, -1e8, 1e4, -1] },
];

type InputMode = "coefficients" | "expression";
type BatchRow = { lineNo: number; line: string; ok: boolean; message: string; method?: string; converged?: boolean; maxResidual?: number };

function clampDegree(v: number) {
  return Math.max(1, Math.min(10, Math.round(v)));
}

function initCoefficients(degree: number) {
  const coeffs = Array.from({ length: degree + 1 }, () => 0);
  coeffs[0] = 1;
  return coeffs;
}

function resizeCoefficients(prev: number[], degree: number) {
  const next = initCoefficients(degree);
  const copy = Math.min(prev.length, next.length);
  for (let i = 0; i < copy; i += 1) next[next.length - 1 - i] = prev[prev.length - 1 - i];
  if (Math.abs(next[0]) < 1e-14) next[0] = 1;
  return next;
}

function parseFinite(raw: string) {
  const v = Number(raw.trim());
  return Number.isFinite(v) ? v : null;
}

function createDefaultState(): PolynomialEditorState {
  const coefficients = initCoefficients(3);
  coefficients[coefficients.length - 1] = -1;
  return {
    coefficients,
    degree: 3,
    tolerance: DEFAULT_DELTA_TOLERANCE,
    residualTolerance: DEFAULT_RESIDUAL_TOLERANCE,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    stepDetail: "brief",
    solveMode: "auto",
    numericMethod: "dk",
    sortMode: "real_first",
    lightweightPlots: false,
  };
}

function encodeShareState(state: PolynomialEditorState) {
  return btoa(encodeURIComponent(JSON.stringify(state))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeShareState(encoded: string): Partial<PolynomialEditorState> | null {
  try {
    const padded = encoded + "===".slice((encoded.length + 3) % 4);
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(atob(base64))) as Partial<PolynomialEditorState>;
  } catch {
    return null;
  }
}

function createInitialStateFromUrl(): PolynomialEditorState {
  const fallback = createDefaultState();
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get("poly");
  if (!encoded) return fallback;
  const parsed = decodeShareState(encoded);
  if (!parsed || !Array.isArray(parsed.coefficients) || parsed.coefficients.length < 2) return fallback;
  const degree = clampDegree(parsed.degree ?? parsed.coefficients.length - 1);
  return {
    coefficients: resizeCoefficients(parsed.coefficients.map((x) => (Number.isFinite(x) ? Number(x) : 0)), degree),
    degree,
    tolerance: Number.isFinite(parsed.tolerance) ? Number(parsed.tolerance) : fallback.tolerance,
    residualTolerance: Number.isFinite(parsed.residualTolerance) ? Number(parsed.residualTolerance) : fallback.residualTolerance,
    maxIterations: Number.isFinite(parsed.maxIterations) ? Math.round(Number(parsed.maxIterations)) : fallback.maxIterations,
    stepDetail: parsed.stepDetail === "detailed" ? "detailed" : "brief",
    solveMode: parsed.solveMode === "exact" || parsed.solveMode === "numeric" ? parsed.solveMode : "auto",
    numericMethod: parsed.numericMethod === "aberth" ? "aberth" : "dk",
    sortMode: parsed.sortMode === "by_magnitude" ? "by_magnitude" : "real_first",
    lightweightPlots: Boolean(parsed.lightweightPlots),
  };
}

export default function PolynomialSolverTool() {
  const [initial] = useState(() => createInitialStateFromUrl());
  const { state, history, future, commit, undo, redo, reset } = usePolynomialHistory(initial);
  const [inputMode, setInputMode] = useState<InputMode>("coefficients");
  const [pasteText, setPasteText] = useState("");
  const [expressionText, setExpressionText] = useState("");
  const [batchText, setBatchText] = useState("");
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [pasteIssues, setPasteIssues] = useState<string[]>([]);
  const [statusMsg, setStatusMsg] = useState("");
  const [activeInputs, setActiveInputs] = useState(toPolynomialInputs(state));

  const solverInputs = toPolynomialInputs(state);
  useEffect(() => {
    const t = window.setTimeout(() => setActiveInputs(solverInputs), 120);
    return () => window.clearTimeout(t);
  }, [solverInputs]);

  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const isUndo = (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !ev.shiftKey;
      const isRedo = (ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === "y" || (ev.key.toLowerCase() === "z" && ev.shiftKey));
      if (isUndo) {
        ev.preventDefault();
        undo();
      } else if (isRedo) {
        ev.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const issues = getPolynomialInputIssues(solverInputs);
  const solved = useMemo(() => {
    try {
      return { ok: true as const, data: solvePolynomial(activeInputs) };
    } catch (e) {
      return { ok: false as const, err: (e as Error).message };
    }
  }, [activeInputs]);

  const sortedRoots = solved.ok
    ? [...solved.data.outputs.roots].sort((a, b) => {
        if (state.sortMode === "by_magnitude") return a.magnitude - b.magnitude;
        const ar = a.classification === "real" ? 0 : 1;
        const br = b.classification === "real" ? 0 : 1;
        return ar - br || a.value.re - b.value.re || a.value.im - b.value.im;
      })
    : [];

  const sampledRealAxis = solved.ok && solved.data.plots.realAxisSample ? (state.lightweightPlots ? solved.data.plots.realAxisSample.filter((_, i) => i % 2 === 0) : solved.data.plots.realAxisSample) : undefined;

  function onCommitDegree(raw: string, input: HTMLInputElement) {
    const parsed = parseFinite(raw);
    if (parsed === null) {
      input.value = String(state.degree);
      return;
    }
    const degree = clampDegree(parsed);
    commit((prev) => ({ ...prev, degree, coefficients: resizeCoefficients(prev.coefficients, degree) }));
  }

  function onCommitCoefficient(idx: number, raw: string, input: HTMLInputElement) {
    const parsed = parseFinite(raw);
    if (parsed === null) {
      input.value = String(state.coefficients[idx]);
      return;
    }
    commit((prev) => ({ ...prev, coefficients: prev.coefficients.map((v, i) => (i === idx ? parsed : v)) }));
  }

  function onCommitDelta(raw: string, input: HTMLInputElement) {
    const parsed = parseFinite(raw);
    if (parsed === null) {
      input.value = String(state.tolerance);
      return;
    }
    commit((prev) => ({ ...prev, tolerance: parsed }));
  }

  function onCommitResidual(raw: string, input: HTMLInputElement) {
    const parsed = parseFinite(raw);
    if (parsed === null) {
      input.value = String(state.residualTolerance);
      return;
    }
    commit((prev) => ({ ...prev, residualTolerance: parsed }));
  }

  function onCommitIter(raw: string, input: HTMLInputElement) {
    const parsed = parseFinite(raw);
    if (parsed === null) {
      input.value = String(state.maxIterations);
      return;
    }
    commit((prev) => ({ ...prev, maxIterations: Math.round(parsed) }));
  }

  function applyCoefficients(coefficients: number[]) {
    const degree = clampDegree(coefficients.length - 1);
    commit((prev) => ({ ...prev, degree, coefficients: resizeCoefficients(coefficients, degree) }));
  }

  function applyPaste() {
    const parsed = parseCoefficientText(pasteText);
    if (!parsed.ok) return setPasteIssues(parsed.issues.map((x) => x.message));
    setPasteIssues([]);
    applyCoefficients(parsed.coefficients);
    setStatusMsg("Coefficients applied");
    window.setTimeout(() => setStatusMsg(""), 1500);
  }

  function applyExpression() {
    const parsed = parsePolynomialExpression(expressionText);
    if (!parsed.ok) return setPasteIssues(parsed.issues.map((x) => x.message));
    setPasteIssues([]);
    applyCoefficients(parsed.coefficients);
    setStatusMsg("Expression parsed");
    window.setTimeout(() => setStatusMsg(""), 1500);
  }

  function runBatch() {
    const lines = parseBatchCoefficientLines(batchText);
    const rows: BatchRow[] = lines.map((x) => {
      if (!x.parsed.ok) return { lineNo: x.lineNo, line: x.line, ok: false, message: x.parsed.issues.map((i) => i.message).join("; ") };
      try {
        const out = solvePolynomial({ ...toPolynomialInputs(state), coefficients: x.parsed.coefficients });
        return { lineNo: x.lineNo, line: x.line, ok: true, message: `roots=${out.outputs.roots.length}`, method: out.outputs.methodUsed, converged: out.outputs.converged, maxResidual: out.outputs.maxResidual };
      } catch (e) {
        return { lineNo: x.lineNo, line: x.line, ok: false, message: (e as Error).message };
      }
    });
    setBatchRows(rows);
  }

  async function copyShareUrl() {
    const url = `${window.location.origin}${window.location.pathname}?poly=${encodeShareState(state)}`;
    await navigator.clipboard.writeText(url);
    setStatusMsg("Share URL copied");
    window.setTimeout(() => setStatusMsg(""), 1500);
  }

  function resetAll() {
    const next = createDefaultState();
    reset(next);
    setPasteIssues([]);
    setPasteText("");
    setExpressionText("");
    setBatchText("");
    setBatchRows([]);
    setActiveInputs(toPolynomialInputs(next));
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>Polynomial Solver</h1>
        <p>Production-ready root solver with exact+numeric hybrid methods, robust input handling, and diagnostics.</p>
      </div>
      <div className="workflowStatus"><div className="workflowStatusRow">
        <span className="pill">Degree: {state.degree}</span>
        <span className="pill">Mode: {state.solveMode}</span>
        <span className="pill">Numeric: {state.numericMethod.toUpperCase()}</span>
        {solved.ok ? <span className={`pill polyConfidenceInline ${solved.data.outputs.confidenceBadge}`}>Confidence {solved.data.outputs.confidenceScore.toFixed(0)}</span> : null}
        {statusMsg ? <span className="pill">{statusMsg}</span> : null}
      </div></div>
      <div className="twoCol">
        <Panel title="Inputs and Workflow">
          <div className="form">
            <div className="segmented"><button className={inputMode === "coefficients" ? "segBtn active" : "segBtn"} onClick={() => setInputMode("coefficients")}>Coefficients</button><button className={inputMode === "expression" ? "segBtn active" : "segBtn"} onClick={() => setInputMode("expression")}>Expression</button></div>
            {inputMode === "coefficients" ? (
              <>
                <label className="field">
                  <div className="fieldLabel">Degree (1..10)</div>
                  <input
                    key={`degree-${state.degree}`}
                    className="input"
                    type="text"
                    defaultValue={state.degree}
                    onBlur={(e) => onCommitDegree(e.currentTarget.value, e.currentTarget)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </label>
                <div className="field"><div className="fieldLabel">Equation</div><Latex latex={polynomialLatex(state.coefficients)} /></div>
                <div className="coeffGrid">
                  {state.coefficients.map((coef, idx) => (
                    <label className="field" key={`coef-${idx}-${coef}`}>
                      <div className="fieldLabel">a{state.coefficients.length - 1 - idx}</div>
                      <input
                        className="input"
                        type="text"
                        defaultValue={coef}
                        onBlur={(e) => onCommitCoefficient(idx, e.currentTarget.value, e.currentTarget)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                    </label>
                  ))}
                </div>
                <CollapsibleSection id="poly-paste" title="Paste Coefficients"><textarea className="input polyPasteInput" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="1, -5, 6" /><button className="btn" onClick={applyPaste}>Apply</button></CollapsibleSection>
              </>
            ) : (
              <CollapsibleSection id="poly-expression" title="Expression Parser"><textarea className="input polyPasteInput" value={expressionText} onChange={(e) => setExpressionText(e.target.value)} placeholder="x^3 - 6x^2 + 11x - 6 = 0" /><button className="btn" onClick={applyExpression}>Parse</button></CollapsibleSection>
            )}
            <div className="segmented"><button className={state.solveMode === "auto" ? "segBtn active" : "segBtn"} onClick={() => commit((p) => ({ ...p, solveMode: "auto" }))}>Auto</button><button className={state.solveMode === "exact" ? "segBtn active" : "segBtn"} onClick={() => commit((p) => ({ ...p, solveMode: "exact" }))}>Exact</button><button className={state.solveMode === "numeric" ? "segBtn active" : "segBtn"} onClick={() => commit((p) => ({ ...p, solveMode: "numeric" }))}>Numeric</button></div>
            <div className="segmented"><button className={state.numericMethod === "dk" ? "segBtn active" : "segBtn"} onClick={() => commit((p) => ({ ...p, numericMethod: "dk" }))}>Durand-Kerner</button><button className={state.numericMethod === "aberth" ? "segBtn active" : "segBtn"} onClick={() => commit((p) => ({ ...p, numericMethod: "aberth" }))}>Aberth</button></div>
            <CollapsibleSection id="poly-advanced" title="Advanced">
              <label className="field">
                <div className="fieldLabel">Delta tolerance</div>
                <input
                  key={`delta-${state.tolerance}`}
                  className="input"
                  type="text"
                  defaultValue={state.tolerance}
                  onBlur={(e) => onCommitDelta(e.currentTarget.value, e.currentTarget)}
                />
              </label>
              <label className="field">
                <div className="fieldLabel">Residual tolerance</div>
                <input
                  key={`residual-${state.residualTolerance}`}
                  className="input"
                  type="text"
                  defaultValue={state.residualTolerance}
                  onBlur={(e) => onCommitResidual(e.currentTarget.value, e.currentTarget)}
                />
              </label>
              <label className="field">
                <div className="fieldLabel">Max iterations</div>
                <input
                  key={`iters-${state.maxIterations}`}
                  className="input"
                  type="text"
                  defaultValue={state.maxIterations}
                  onBlur={(e) => onCommitIter(e.currentTarget.value, e.currentTarget)}
                />
              </label>
            </CollapsibleSection>
            <CollapsibleSection id="poly-presets" title="Presets"><div className="polyPresetRow">{PRESETS.map((preset) => <button key={preset.label} className="btn btnSmall" onClick={() => applyCoefficients(preset.coefficients)}>{preset.label}</button>)}</div></CollapsibleSection>
            <CollapsibleSection id="poly-batch" title="Batch Solve"><textarea className="input polyPasteInput" value={batchText} onChange={(e) => setBatchText(e.target.value)} placeholder={"1,-5,6\nx^2+1=0"} /><button className="btn" onClick={runBatch}>Run</button>{batchRows.length > 0 ? <div className="polyTableWrap"><table className="polyTable"><thead><tr><th>Line</th><th>Status</th><th>Method</th><th>Converged</th><th>Residual</th><th>Message</th></tr></thead><tbody>{batchRows.map((r) => <tr key={`${r.lineNo}-${r.line}`}><td>{r.lineNo}</td><td>{r.ok ? "OK" : "Error"}</td><td>{r.method ?? "-"}</td><td>{r.converged === undefined ? "-" : r.converged ? "Yes" : "No"}</td><td>{r.maxResidual === undefined ? "-" : fmtNumber(r.maxResidual, 6)}</td><td>{r.message}</td></tr>)}</tbody></table></div> : null}</CollapsibleSection>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="btn" onClick={() => setActiveInputs(solverInputs)} disabled={issues.length > 0}>Solve</button><button className="btn btnGhost" onClick={copyShareUrl}>Share</button><button className="btn" onClick={undo} disabled={history.length === 0}>Undo</button><button className="btn" onClick={redo} disabled={future.length === 0}>Redo</button><button className="btn btnGhost" onClick={resetAll}>Reset</button></div>
            {pasteIssues.length > 0 ? <div className="error">{pasteIssues.map((x) => <div key={x}>{x}</div>)}</div> : null}
            {issues.length > 0 ? <div className="error">{issues.map((x) => <div key={x}>{x}</div>)}</div> : null}
          </div>
        </Panel>
        <Panel title="Roots and Diagnostics">
          {!solved.ok ? <div className="error">{solved.err}</div> : <div className="form"><div className="kv"><div className="kvRow"><span className="kvKey">Method</span><span className="kvVal">{solved.data.outputs.methodUsed}</span></div><div className="kvRow"><span className="kvKey">Converged</span><span className="kvVal">{solved.data.outputs.converged ? "Yes" : "No"}</span></div><div className="kvRow"><span className="kvKey">Max residual</span><span className="kvVal">{fmtNumber(solved.data.outputs.maxResidual, 6)}</span></div><div className="kvRow"><span className="kvKey">Sensitivity</span><span className="kvVal">{solved.data.outputs.sensitivity ? `max ${fmtNumber(solved.data.outputs.sensitivity.maxRootShift, 6)}` : "-"}</span></div></div>
          <div className="polyTableWrap"><table className="polyTable"><thead><tr><th>Root</th><th>Type</th><th>|z|</th><th>Mult</th><th>Method</th><th>Residual</th><th>Pre-polish</th><th>Quality</th></tr></thead><tbody>{sortedRoots.map((r, i) => <tr key={`root-${i}`}><td>{fmtComplex(r.value, 8)}</td><td>{r.classification}</td><td>{fmtNumber(r.magnitude, 6)}</td><td>{r.multiplicity}</td><td>{r.method}</td><td>{fmtNumber(r.residual, 6)}</td><td>{r.residualBeforePolish === undefined ? "-" : fmtNumber(r.residualBeforePolish, 6)}</td><td>{r.qualityBadge ?? "-"}</td></tr>)}</tbody></table></div>
          {solved.data.outputs.diagnostics.length > 0 ? <div className="steps">{solved.data.outputs.diagnostics.map((d) => <div key={`${d.code}-${d.message}`} className="step"><div className="stepTitle">{d.code}</div><div className="stepNote">{d.message}</div></div>)}</div> : null}</div>}
        </Panel>
      </div>
      {solved.ok ? <div className="twoCol"><Panel title="Complex Plane"><PlotFrame title="Root locations"><ResponsiveContainer width="100%" height={280}><ScatterChart><CartesianGrid /><XAxis type="number" dataKey="re" /><YAxis type="number" dataKey="im" /><Tooltip formatter={(v) => fmtNumber(Number(v), 6)} /><ReferenceLine x={0} stroke="rgba(255,255,255,0.35)" /><ReferenceLine y={0} stroke="rgba(255,255,255,0.35)" /><Scatter data={solved.data.plots.complexPlane} fill="#60a5fa" /></ScatterChart></ResponsiveContainer></PlotFrame></Panel><Panel title="Real Axis"><PlotFrame title="p(x) sample">{!sampledRealAxis ? <div className="muted">No real-axis sample (no real roots).</div> : <ResponsiveContainer width="100%" height={280}><LineChart data={sampledRealAxis}><CartesianGrid /><XAxis type="number" dataKey="x" /><YAxis /><Tooltip formatter={(v) => fmtNumber(Number(v), 6)} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.35)" /><Line dataKey="y" dot={false} stroke="#34d399" /></LineChart></ResponsiveContainer>}</PlotFrame></Panel></div> : null}
      {solved.ok ? <CollapsibleSection id="poly-steps" title="Worked Steps" defaultOpen><div className="steps">{solved.data.steps.map((step, idx) => <div className="step" key={`${step.title ?? "step"}-${idx}`}><div className="stepIndex">Step {idx + 1}</div>{step.title ? <div className="stepTitle">{step.title}</div> : null}{step.latex ? <Latex latex={step.latex} /> : null}{step.note ? <div className="stepNote">{step.note}</div> : null}</div>)}</div></CollapsibleSection> : null}
    </div>
  );
}
