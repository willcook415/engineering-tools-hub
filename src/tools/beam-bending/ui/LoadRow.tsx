import { useEffect, useMemo, useRef, useState } from "react";
import type { BeamDisplayUnits, Load } from "../model";
import { loadTypeLabel } from "../loadLabels";
import {
  formatEngineeringNumber,
  formatUnitValue,
  fromDisplayUnitValue,
  getDisplayUnits,
  parseEngineeringInput,
  quantityUnitSymbol,
  toDisplayUnitValue,
  type UnitQuantity,
} from "../units";

export function LoadRow({
  load,
  isSelected,
  isIsolated,
  canMoveUp,
  canMoveDown,
  caseOptions,
  categoryOptions,
  onSelect,
  onUpdate,
  onRemove,
  onDuplicate,
  onMirror,
  onMoveUp,
  onMoveDown,
  onToggleLock,
  onToggleVisibility,
  onToggleIsolate,
  L,
  displayUnits,
}: {
  load: Load;
  isSelected: boolean;
  isIsolated: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  caseOptions: Array<{ id: string; name: string; active?: boolean }>;
  categoryOptions: Array<{ id: string; name: string; active?: boolean }>;
  onSelect: () => void;
  onUpdate: (patch: Partial<Load>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMirror: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleLock: () => void;
  onToggleVisibility: () => void;
  onToggleIsolate: () => void;
  L: number;
  displayUnits?: Partial<BeamDisplayUnits>;
}) {
  const resolvedUnits = useMemo(() => getDisplayUnits(displayUnits), [displayUnits]);
  const generated = load.generatedBy === "self_weight";
  const tagsText = (load.tags ?? []).join(", ");

  const summary =
    load.type === "point_load"
      ? `x=${formatUnitValue(load.x, resolvedUnits, "length")}, P=${formatUnitValue(load.P, resolvedUnits, "force")}`
      : load.type === "udl"
        ? `${formatUnitValue(load.x1, resolvedUnits, "length")} → ${formatUnitValue(load.x2, resolvedUnits, "length")}, w=${formatUnitValue(load.w, resolvedUnits, "distributedLoad")}`
        : load.type === "linear_dist"
          ? `${formatUnitValue(load.x1, resolvedUnits, "length")} → ${formatUnitValue(load.x2, resolvedUnits, "length")}, w1=${formatUnitValue(load.w1, resolvedUnits, "distributedLoad")}, w2=${formatUnitValue(load.w2, resolvedUnits, "distributedLoad")}`
          : load.type === "moment"
            ? `x=${formatUnitValue(load.x, resolvedUnits, "length")}, M=${formatUnitValue(load.M, resolvedUnits, "moment")}`
            : load.type === "thermal"
              ? `${formatUnitValue(load.x1, resolvedUnits, "length")} → ${formatUnitValue(load.x2, resolvedUnits, "length")}, alpha=${formatSimpleNumber(load.alpha)} 1/K, dT=${formatSimpleNumber(load.dT)} K`
              : `${formatUnitValue(load.x1, resolvedUnits, "length")} → ${formatUnitValue(load.x2, resolvedUnits, "length")}, kappa0=${formatSimpleNumber(load.kappa0)} 1/m`;

  const direction =
    load.type === "point_load"
      ? load.P >= 0
        ? "Down"
        : "Up"
      : load.type === "udl"
        ? load.w >= 0
          ? "Down"
          : "Up"
        : load.type === "linear_dist"
          ? 0.5 * (load.w1 + load.w2) >= 0
            ? "Down"
            : "Up"
          : load.type === "moment"
            ? load.M >= 0
              ? "CW"
              : "CCW"
            : "Span";

  return (
    <div
      className={[
        "loadRow",
        isSelected ? "selected" : "",
        load.hidden ? "isHidden" : "",
        load.locked ? "isLocked" : "",
        isIsolated ? "isIsolated" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onSelect}
    >
      <div className="loadTop">
        <div className="loadTagWrap">
          <div className="loadTag">{loadTypeLabel(load.type)}</div>
          <div className="loadMetaChips">
            <span className="pill">{load.id}</span>
            <span className="pill">{direction}</span>
            {load.caseId ? <span className="pill">Case: {load.caseId}</span> : null}
            {load.category ? <span className="pill">{load.category}</span> : null}
            {generated ? <span className="pill">Generated</span> : null}
            {load.locked ? <span className="pill">Locked</span> : null}
            {load.hidden ? <span className="pill">Hidden</span> : null}
          </div>
        </div>
        <div className="loadActionRow" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <button className={isIsolated ? "btn btnSmall activePill" : "btn btnSmall btnGhost"} onClick={onToggleIsolate}>
            {isIsolated ? "Isolated" : "Isolate"}
          </button>
          <button className={load.hidden ? "btn btnSmall activePill" : "btn btnSmall btnGhost"} onClick={onToggleVisibility}>
            {load.hidden ? "Show" : "Hide"}
          </button>
          <button className={load.locked ? "btn btnSmall activePill" : "btn btnSmall btnGhost"} onClick={onToggleLock}>
            {load.locked ? "Unlock" : "Lock"}
          </button>
          <button className="btn btnSmall btnGhost" onClick={onDuplicate}>
            Duplicate
          </button>
          <button className="btn btnSmall btnGhost" onClick={onMirror}>
            Mirror
          </button>
          <button className="btn btnSmall btnGhost" onClick={onMoveUp} disabled={!canMoveUp}>
            ↑
          </button>
          <button className="btn btnSmall btnGhost" onClick={onMoveDown} disabled={!canMoveDown}>
            ↓
          </button>
          <button className="btn btnSmall btnGhost" onClick={onRemove}>
            Delete
          </button>
        </div>
      </div>

      <div className="loadSummaryRow">{summary}</div>

      {isSelected ? (
        <>
          <div className="loadDetailGrid">
            <label className="field" style={{ margin: 0 }}>
              <div className="fieldLabel">Load name</div>
              <input
                className="input"
                value={load.name ?? ""}
                placeholder={load.id}
                onChange={(e) => onUpdate({ name: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              />
            </label>
            <label className="field" style={{ margin: 0 }}>
              <div className="fieldLabel">Category</div>
              <input
                className="input"
                value={load.category ?? ""}
                list={`beam-load-category-options-${load.id}`}
                placeholder="dead / live / thermal"
                onChange={(e) => onUpdate({ category: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              />
            </label>
            <label className="field" style={{ margin: 0 }}>
              <div className="fieldLabel">Case membership</div>
              <select
                className="input"
                value={load.caseId ?? ""}
                onChange={(e) => onUpdate({ caseId: e.target.value || undefined })}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <option value="">None</option>
                {caseOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.id}){c.active === false ? " - inactive" : ""}
                  </option>
                ))}
              </select>
            </label>
            <NumberFieldSmall
              label="Uncertainty"
              value={load.uncertaintyPercent ?? 0}
              step={0.5}
              min={0}
              unitLabel="%"
              onChange={(v) => onUpdate({ uncertaintyPercent: v || undefined })}
            />
          </div>

          {load.type === "point_load" ? (
            <div className="loadGrid">
              <NumberFieldSmall
                label="x"
                value={load.x}
                quantity="length"
                units={displayUnits}
                step={0.01}
                onChange={(v) => onUpdate({ x: clamp(v, 0, L) })}
                disabled={load.locked}
              />
              <NumberFieldSmall
                label="P"
                value={load.P}
                quantity="force"
                units={displayUnits}
                step={50}
                onChange={(v) => onUpdate({ P: v })}
                disabled={generated}
                example="Supports e-notation (e.g. 1.2e3)"
              />
            </div>
          ) : load.type === "udl" ? (
            <div className="loadGrid">
              <NumberFieldSmall
                label="x1"
                value={load.x1}
                quantity="length"
                units={displayUnits}
                step={0.01}
                onChange={(v) => onUpdate({ x1: clamp(v, 0, L) })}
                disabled={generated}
              />
              <NumberFieldSmall
                label="x2"
                value={load.x2}
                quantity="length"
                units={displayUnits}
                step={0.01}
                onChange={(v) => onUpdate({ x2: clamp(v, 0, L) })}
                disabled={generated}
              />
              <NumberFieldSmall
                label="w"
                value={load.w}
                quantity="distributedLoad"
                units={displayUnits}
                step={10}
                onChange={(v) => onUpdate({ w: v })}
                disabled={generated}
              />
            </div>
          ) : load.type === "linear_dist" ? (
            <div className="loadGrid">
              <NumberFieldSmall
                label="x1"
                value={load.x1}
                quantity="length"
                units={displayUnits}
                step={0.01}
                onChange={(v) => onUpdate({ x1: clamp(v, 0, L) })}
                disabled={load.locked}
              />
              <NumberFieldSmall
                label="x2"
                value={load.x2}
                quantity="length"
                units={displayUnits}
                step={0.01}
                onChange={(v) => onUpdate({ x2: clamp(v, 0, L) })}
                disabled={load.locked}
              />
              <NumberFieldSmall
                label="w1"
                value={load.w1}
                quantity="distributedLoad"
                units={displayUnits}
                step={10}
                onChange={(v) => onUpdate({ w1: v })}
              />
              <NumberFieldSmall
                label="w2"
                value={load.w2}
                quantity="distributedLoad"
                units={displayUnits}
                step={10}
                onChange={(v) => onUpdate({ w2: v })}
              />
            </div>
          ) : load.type === "thermal" ? (
            <div className="loadGrid">
              <NumberFieldSmall
                label="x1"
                value={load.x1}
                quantity="length"
                units={displayUnits}
                step={0.01}
                onChange={(v) => onUpdate({ x1: clamp(v, 0, L) })}
                disabled={load.locked}
              />
              <NumberFieldSmall
                label="x2"
                value={load.x2}
                quantity="length"
                units={displayUnits}
                step={0.01}
                onChange={(v) => onUpdate({ x2: clamp(v, 0, L) })}
                disabled={load.locked}
              />
              <NumberFieldSmall label="alpha" value={load.alpha} step={1e-6} onChange={(v) => onUpdate({ alpha: v })} unitLabel="1/K" />
              <NumberFieldSmall label="dT" value={load.dT} step={1} onChange={(v) => onUpdate({ dT: v })} unitLabel="K" />
              <NumberFieldSmall
                label="depth"
                value={load.depth}
                quantity="length"
                units={displayUnits}
                step={0.001}
                onChange={(v) => onUpdate({ depth: Math.max(1e-6, v) })}
              />
            </div>
          ) : load.type === "prestrain" ? (
            <div className="loadGrid">
              <NumberFieldSmall
                label="x1"
                value={load.x1}
                quantity="length"
                units={displayUnits}
                step={0.01}
                onChange={(v) => onUpdate({ x1: clamp(v, 0, L) })}
                disabled={load.locked}
              />
              <NumberFieldSmall
                label="x2"
                value={load.x2}
                quantity="length"
                units={displayUnits}
                step={0.01}
                onChange={(v) => onUpdate({ x2: clamp(v, 0, L) })}
                disabled={load.locked}
              />
              <NumberFieldSmall label="kappa0" value={load.kappa0} step={1e-4} onChange={(v) => onUpdate({ kappa0: v })} unitLabel="1/m" />
            </div>
          ) : (
            <div className="loadGrid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <NumberFieldSmall
                label="x"
                value={load.x}
                quantity="length"
                units={displayUnits}
                step={0.01}
                onChange={(v) => onUpdate({ x: clamp(v, 0, L) })}
                disabled={load.locked}
              />
              <NumberFieldSmall
                label="M"
                value={load.M}
                quantity="moment"
                units={displayUnits}
                step={25}
                onChange={(v) => onUpdate({ M: v })}
              />
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, marginTop: 6 }}>
                <button
                  className={load.M >= 0 ? "btn btnSmall activePill" : "btn btnSmall"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate({ M: Math.abs(load.M) });
                  }}
                >
                  CW
                </button>
                <button
                  className={load.M < 0 ? "btn btnSmall activePill" : "btn btnSmall"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate({ M: -Math.abs(load.M) });
                  }}
                >
                  CCW
                </button>
              </div>
            </div>
          )}

          <label className="field" style={{ marginTop: 8 }}>
            <div className="fieldLabel">Tags (comma separated)</div>
            <input
              className="input"
              value={tagsText}
              placeholder="service, trial-2"
              onChange={(e) =>
                onUpdate({
                  tags: e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter((x, i, arr) => Boolean(x) && arr.indexOf(x) === i),
                })
              }
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </label>
          <label className="field" style={{ marginTop: 8 }}>
            <div className="fieldLabel">Notes</div>
            <textarea
              className="input"
              style={{ minHeight: 64, resize: "vertical" }}
              value={load.notes ?? ""}
              placeholder="Optional engineering note for this load."
              onChange={(e) => onUpdate({ notes: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </label>
          <div className="loadHint muted">
            {generated
              ? "Generated load: derived from section area and material density."
              : load.locked
                ? "Load is locked for drag interaction. Numeric edits remain available."
                : "Tip: drag this selected load directly on the beam for quick placement."}
          </div>
        </>
      ) : (
        <div className="loadHint muted">Click to edit this load.</div>
      )}

      <datalist id={`beam-load-category-options-${load.id}`}>
        {categoryOptions.map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.name}
          </option>
        ))}
      </datalist>
    </div>
  );
}

type NumberFieldProps = {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  units?: Partial<BeamDisplayUnits>;
  quantity?: UnitQuantity;
  unitLabel?: string;
  example?: string;
  disabled?: boolean;
};

export function NumberField({
  label,
  value,
  step = 0.1,
  min,
  max,
  onChange,
  units,
  quantity,
  unitLabel,
  example,
  disabled,
}: NumberFieldProps) {
  const resolved = useMemo(() => getDisplayUnits(units), [units]);
  const suffix = quantity ? quantityUnitSymbol(resolved, quantity) : unitLabel;
  const displayValue = quantity ? toDisplayUnitValue(value, resolved, quantity) : value;
  const displayStep = quantity ? Math.max(1e-12, Math.abs(toDisplayUnitValue(step, resolved, quantity))) : step;
  const displayMin = min !== undefined ? (quantity ? toDisplayUnitValue(min, resolved, quantity) : min) : undefined;
  const displayMax = max !== undefined ? (quantity ? toDisplayUnitValue(max, resolved, quantity) : max) : undefined;

  return (
    <label className="field">
      <div className="fieldLabel">{label}</div>
      <NumberInput
        value={displayValue}
        step={displayStep}
        min={displayMin}
        max={displayMax}
        unitLabel={suffix}
        disabled={disabled}
        onChange={(displayNext) => {
          const next = quantity ? fromDisplayUnitValue(displayNext, resolved, quantity) : displayNext;
          onChange(next);
        }}
      />
      {example ? <div className="fieldHint">{example}</div> : null}
    </label>
  );
}

function NumberFieldSmall(props: NumberFieldProps) {
  return (
    <label className="field" style={{ margin: 0 }}>
      <div className="fieldLabel">{props.label}</div>
      <NumberFieldInput {...props} />
      {props.example ? <div className="fieldHint">{props.example}</div> : null}
    </label>
  );
}

function NumberFieldInput({
  value,
  step = 0.1,
  min,
  max,
  onChange,
  units,
  quantity,
  unitLabel,
  disabled,
}: Omit<NumberFieldProps, "label" | "example">) {
  const resolved = useMemo(() => getDisplayUnits(units), [units]);
  const suffix = quantity ? quantityUnitSymbol(resolved, quantity) : unitLabel;
  const displayValue = quantity ? toDisplayUnitValue(value, resolved, quantity) : value;
  const displayStep = quantity ? Math.max(1e-12, Math.abs(toDisplayUnitValue(step, resolved, quantity))) : step;
  const displayMin = min !== undefined ? (quantity ? toDisplayUnitValue(min, resolved, quantity) : min) : undefined;
  const displayMax = max !== undefined ? (quantity ? toDisplayUnitValue(max, resolved, quantity) : max) : undefined;

  return (
    <NumberInput
      value={displayValue}
      step={displayStep}
      min={displayMin}
      max={displayMax}
      unitLabel={suffix}
      disabled={disabled}
      onChange={(displayNext) => {
        const next = quantity ? fromDisplayUnitValue(displayNext, resolved, quantity) : displayNext;
        onChange(next);
      }}
    />
  );
}

export function KV({ k, v, fmt }: { k: string; v: number; fmt?: (x: number) => string }) {
  return (
    <div className="kvRow">
      <div className="kvKey">{k}</div>
      <div className="kvVal">{Number.isFinite(v) ? (fmt ? fmt(v) : v.toFixed(4)) : "-"}</div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function decimalPlaces(step: number) {
  if (!Number.isFinite(step) || step <= 0) return 2;
  const text = step.toString().toLowerCase();
  if (text.includes("e-")) {
    const n = Number(text.split("e-")[1]);
    return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 2;
  }
  const idx = text.indexOf(".");
  return idx >= 0 ? Math.max(0, Math.min(10, text.length - idx - 1)) : 0;
}

function roundToStep(value: number, step: number) {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(step) || step <= 0) return Number(value.toPrecision(12));
  const snapped = Math.round(value / step) * step;
  const dp = Math.max(0, decimalPlaces(step));
  return Number(snapped.toFixed(dp));
}

function isPartialToken(text: string) {
  const t = text.trim();
  if (!t) return true;
  return /^[-+]?((\d+\.?|\.\d*)?([eE][-+]?)?)$/.test(t);
}

function formatForInput(value: number, step: number) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1e6 || abs < 1e-4) return value.toExponential(4).replace("e+", "e");
  const stepDp = decimalPlaces(step);
  const adaptiveDp = abs < 0.01 ? 6 : abs < 1 ? 4 : abs < 100 ? 3 : 2;
  const dp = Math.max(stepDp, adaptiveDp);
  return Number(value.toFixed(Math.min(10, dp))).toString();
}

function NumberInput({
  value,
  step,
  min,
  max,
  unitLabel,
  onChange,
  disabled,
}: {
  value: number;
  step: number;
  min?: number;
  max?: number;
  unitLabel?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const holdStartRef = useRef<number | null>(null);
  const holdTickRef = useRef<number | null>(null);
  const [text, setText] = useState<string>(() => formatForInput(safeValue, step));
  const [isInvalid, setIsInvalid] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  function clearHold() {
    if (holdStartRef.current !== null) {
      window.clearTimeout(holdStartRef.current);
      holdStartRef.current = null;
    }
    if (holdTickRef.current !== null) {
      window.clearInterval(holdTickRef.current);
      holdTickRef.current = null;
    }
  }

  useEffect(() => {
    if (isFocused) return;
    setText(formatForInput(safeValue, step));
    setIsInvalid(false);
  }, [safeValue, step, unitLabel, isFocused]);

  useEffect(() => {
    return () => clearHold();
  }, []);

  const parseText = (raw: string) => parseEngineeringInput(raw, unitLabel);

  const applyDelta = (delta: number, mult = 1) => {
    const parsedCurrent = parseText(text);
    let next = parsedCurrent !== null ? parsedCurrent : safeValue;
    next += delta * mult;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    next = roundToStep(next, step);
    onChange(next);
    setText(formatForInput(next, step));
    setIsInvalid(false);
  };

  function startHold(delta: number) {
    if (disabled) return;
    applyDelta(delta);
    clearHold();
    holdStartRef.current = window.setTimeout(() => {
      let ticks = 0;
      holdTickRef.current = window.setInterval(() => {
        ticks += 1;
        const gain = ticks > 14 ? 5 : ticks > 6 ? 2 : 1;
        applyDelta(delta, gain);
      }, 65);
    }, 280);
  }

  const unitText = unitLabel ? ` ${unitLabel}` : "";

  return (
    <div className={unitLabel ? "numInputWrap hasUnit" : "numInputWrap"}>
      <input
        className={isInvalid ? "input invalidInput" : "input"}
        type="text"
        value={text}
        inputMode="decimal"
        disabled={disabled}
        onChange={(e) => {
          const nextText = e.target.value;
          setText(nextText);

          const parsed = parseText(nextText);
          if (parsed !== null) {
            let next = parsed;
            if (min !== undefined) next = Math.max(min, next);
            if (max !== undefined) next = Math.min(max, next);
            onChange(next);
            setIsInvalid(false);
            return;
          }

          setIsInvalid(nextText.trim().length > 0 && !isPartialToken(nextText));
        }}
        onBlur={(e) => {
          const parsed = parseText(e.target.value);
          setIsFocused(false);
          if (parsed === null) {
            setText(formatForInput(safeValue, step));
            setIsInvalid(false);
            return;
          }
          let clamped = parsed;
          if (min !== undefined) clamped = Math.max(min, clamped);
          if (max !== undefined) clamped = Math.min(max, clamped);
          const rounded = roundToStep(clamped, step);
          onChange(rounded);
          setText(formatForInput(rounded, step));
          setIsInvalid(false);
        }}
        onFocus={(e) => {
          e.stopPropagation();
          setIsFocused(true);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          const upMult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
          if (e.key === "ArrowUp") {
            e.preventDefault();
            applyDelta(step, upMult);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            applyDelta(-step, upMult);
          } else if (e.key === "PageUp") {
            e.preventDefault();
            applyDelta(step * 5, upMult);
          } else if (e.key === "PageDown") {
            e.preventDefault();
            applyDelta(-step * 5, upMult);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const parsed = parseText(text);
            if (parsed === null) {
              setText(formatForInput(safeValue, step));
              setIsInvalid(false);
              return;
            }
            let clamped = parsed;
            if (min !== undefined) clamped = Math.max(min, clamped);
            if (max !== undefined) clamped = Math.min(max, clamped);
            const rounded = roundToStep(clamped, step);
            onChange(rounded);
            setText(formatForInput(rounded, step));
            setIsInvalid(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        aria-invalid={isInvalid ? "true" : "false"}
        title={isInvalid ? `Invalid value${unitText}. Try scientific form like 1.25e3.` : undefined}
      />
      {unitLabel ? <div className="numSuffix">{unitLabel}</div> : null}
      <div className="numStepper">
        <button
          type="button"
          className="numStepBtn"
          disabled={disabled}
          onPointerDown={(e) => {
            e.stopPropagation();
            startHold(step);
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            clearHold();
          }}
          onPointerLeave={clearHold}
          onPointerCancel={clearHold}
          onClick={(e) => {
            e.preventDefault();
          }}
          aria-label="Increase value"
        >
          +
        </button>
        <button
          type="button"
          className="numStepBtn"
          disabled={disabled}
          onPointerDown={(e) => {
            e.stopPropagation();
            startHold(-step);
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            clearHold();
          }}
          onPointerLeave={clearHold}
          onPointerCancel={clearHold}
          onClick={(e) => {
            e.preventDefault();
          }}
          aria-label="Decrease value"
        >
          -
        </button>
      </div>
      {isInvalid ? <div className="fieldHint errorText">Invalid input. Use numeric or scientific notation.</div> : null}
    </div>
  );
}

export function formatSimpleNumber(v: number) {
  return formatEngineeringNumber(v, 4);
}
