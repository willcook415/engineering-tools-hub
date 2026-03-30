import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Panel from "../../../components/Panel";
import type { ToolRuntimeSpec } from "../runtime";
import { getToolRuntimeSpec } from "../specs";

function cloneInputState(defaults: Record<string, string>) {
  return { ...defaults };
}

function buildDefaultState(inputs: ReadonlyArray<{ key: string; defaultValue: string }>) {
  const state: Record<string, string> = {};
  for (const field of inputs) state[field.key] = field.defaultValue;
  return state;
}

export default function MvpToolPage({ slug }: { slug: string }) {
  const spec = useMemo(() => getToolRuntimeSpec(slug), [slug]);

  if (!spec) {
    return (
      <div className="page">
        <div className="pageHeader">
          <h1>Unknown Tool</h1>
          <p>No runtime spec exists for slug: {slug}</p>
        </div>
      </div>
    );
  }

  return <MvpRuntimePage key={spec.slug} spec={spec} />;
}

function MvpRuntimePage({ spec }: { spec: ToolRuntimeSpec }) {
  const [raw, setRaw] = useState<Record<string, string>>(() => cloneInputState(buildDefaultState(spec.inputs)));
  const [statusMsg, setStatusMsg] = useState("");

  const issues = spec.validate(raw);
  const result = issues.length === 0 ? spec.compute(raw) : null;

  function updateValue(key: string, value: string) {
    setRaw((prev) => ({ ...prev, [key]: value }));
  }

  function reset() {
    setRaw(cloneInputState(buildDefaultState(spec.inputs)));
    setStatusMsg("Reset to defaults");
    window.setTimeout(() => setStatusMsg(""), 1400);
  }

  async function copyState() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(raw, null, 2));
      setStatusMsg("Input state copied");
    } catch {
      setStatusMsg("Copy failed");
    }
    window.setTimeout(() => setStatusMsg(""), 1400);
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>{spec.name}</h1>
        <p>{spec.summary}</p>
      </div>

      <div className="workflowStatus">
        <div className="workflowStatusRow">
          <span className="pill">Slug: {spec.slug}</span>
          <span className="pill">Validation: {issues.length === 0 ? "Valid" : "Needs input fixes"}</span>
          {statusMsg ? <span className="pill">{statusMsg}</span> : null}
        </div>
      </div>

      <div className="twoCol" style={{ marginTop: 14 }}>
        <Panel
          title="Inputs"
          right={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btnGhost" onClick={copyState}>Copy State</button>
              <button className="btn" onClick={reset}>Reset</button>
            </div>
          }
        >
          <div className="form">
            {spec.inputs.map((field) => {
              const value = raw[field.key] ?? "";
              return (
                <label className="field" key={field.key}>
                  <div className="fieldLabel">
                    {field.label}
                    {field.unit ? ` (${field.unit})` : ""}
                  </div>

                  {field.type === "select" ? (
                    <select className="input" value={value} onChange={(e) => updateValue(field.key, e.target.value)}>
                      {(field.options ?? []).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      className="input"
                      rows={field.rows ?? 4}
                      value={value}
                      placeholder={field.placeholder}
                      onChange={(e) => updateValue(field.key, e.target.value)}
                      style={{ fontFamily: "ui-monospace, Consolas, monospace" }}
                    />
                  ) : (
                    <input
                      className="input"
                      type={field.type === "number" ? "number" : "text"}
                      value={value}
                      step={field.step}
                      min={field.min}
                      max={field.max}
                      placeholder={field.placeholder}
                      onChange={(e) => updateValue(field.key, e.target.value)}
                    />
                  )}

                  {field.helpText ? <div className="muted">{field.helpText}</div> : null}
                </label>
              );
            })}

            {issues.length > 0 ? (
              <div className="error">
                {issues.map((issue) => (
                  <div key={issue}>{issue}</div>
                ))}
              </div>
            ) : null}

            {spec.disclaimer ? (
              <div className="step">
                <div className="stepTitle">Assumption note</div>
                <div className="stepNote">{spec.disclaimer}</div>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Results">
          {!result ? (
            <div className="muted">Resolve validation issues to compute outputs.</div>
          ) : (
            <div className="form">
              {result.outputs.length > 0 ? (
                <div className="kv">
                  {result.outputs.map((item) => (
                    <div className="kvRow" key={`${item.label}-${item.value}`}>
                      <span className="kvKey">{item.label}</span>
                      <span className="kvVal">{item.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted">No outputs returned.</div>
              )}

              {result.checks.length > 0 ? (
                <div className="steps">
                  {result.checks.map((item) => (
                    <div className="step" key={`${item.label}-${item.value}`}>
                      <div className="stepTitle">{item.label}</div>
                      <div className="stepNote">
                        {item.value}
                        {item.pass === undefined ? "" : item.pass ? " (pass)" : " (check)"}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {result.warnings.length > 0 ? (
                <div className="error">
                  {result.warnings.map((item, idx) => (
                    <div key={`${item.code}-${idx}`}>[{item.code}] {item.message}</div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      </div>

      {result?.series ? (
        <div style={{ marginTop: 14 }}>
          <Panel title={result.series.title}>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={result.series.points}>
                  <CartesianGrid />
                  <XAxis type="number" dataKey={result.series.xKey} name={result.series.xLabel} />
                  <YAxis />
                  <Tooltip />
                  {result.series.lines.map((line, idx) => (
                    <Line
                      key={line.key}
                      type="monotone"
                      dataKey={line.key}
                      name={line.label}
                      dot={false}
                      connectNulls
                      stroke={idx % 2 === 0 ? "#34d399" : "#60a5fa"}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      ) : null}

      {result?.table ? (
        <div style={{ marginTop: 14 }}>
          <Panel title="Table Output">
            <div className="polyTableWrap">
              <table className="polyTable">
                <thead>
                  <tr>
                    {result.table.columns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.table.rows.map((row, idx) => (
                    <tr key={`row-${idx}`}>
                      {row.map((cell, i) => (
                        <td key={`${idx}-${i}`}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      ) : null}

      {result?.steps?.length ? (
        <div style={{ marginTop: 14 }}>
          <Panel title="Computation Steps">
            <div className="steps">
              {result.steps.map((line) => (
                <div className="step" key={line}>
                  <div className="stepNote">{line}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
