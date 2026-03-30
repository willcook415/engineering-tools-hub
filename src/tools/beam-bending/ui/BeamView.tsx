import { useMemo, useRef, useState } from "react";
import { loadDisplayName } from "../loadLabels";
import type {
  BeamDisplayUnits,
  InternalRelease,
  Load,
  PointLoad,
  PointMoment,
  StiffnessSegment,
  SupportStation,
  SupportType,
  UDL,
} from "../model";
import { formatUnitValue, getDisplayUnits } from "../units";

type Props = {
  L: number;
  support: SupportType;
  supportStations?: SupportStation[];
  stiffnessSegments?: StiffnessSegment[];
  internalReleases?: InternalRelease[];
  loads: Load[];
  selectedId: string | null;
  isolatedId?: string | null;
  snapStep: number;
  displayUnits?: Partial<BeamDisplayUnits>;
  onSelect: (id: string | null) => void;
  onUpdateLoad: (id: string, patch: Partial<Load>) => void;
  onUpdateLoadLive?: (id: string, patch: Partial<Load>) => void;
  onBeginDrag?: (id: string) => void;
  onDragStateChange?: (state: { draggingId: string | null; snapStep: number }) => void;
};

const C = {
  point: "rgba(45,212,191,0.92)",
  udl: "rgba(96,165,250,0.90)",
  linear: "rgba(34,197,94,0.90)",
  moment: "rgba(251,146,60,0.92)",
  thermal: "rgba(250,204,21,0.9)",
  prestrain: "rgba(244,114,182,0.90)",
};

export default function BeamView({
  L,
  support,
  supportStations,
  stiffnessSegments,
  internalReleases,
  loads,
  selectedId,
  isolatedId,
  snapStep,
  displayUnits,
  onSelect,
  onUpdateLoad,
  onUpdateLoadLive,
  onBeginDrag,
  onDragStateChange,
}: Props) {
  const resolvedUnits = useMemo(() => getDisplayUnits(displayUnits), [displayUnits]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [snapPreviewX, setSnapPreviewX] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ id: string; patch: Partial<Load> } | null>(null);
  const lastPatchRef = useRef<{ id: string; patch: Partial<Load> } | null>(null);

  const geom = useMemo(() => {
    const w = 760;
    const h = 212;
    const pad = 58;
    const beamY = 96;
    const x0 = pad;
    const x1 = w - pad;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    return { w, h, beamY, x0, x1, clamp };
  }, []);

  const visibleLoads = useMemo(() => loads.filter((l) => !l.hidden), [loads]);
  const displayedLoads = useMemo(() => {
    if (!isolatedId) return visibleLoads;
    return visibleLoads.filter((l) => l.id === isolatedId);
  }, [visibleLoads, isolatedId]);

  const selectedVisible = useMemo(() => displayedLoads.find((l) => l.id === selectedId) ?? null, [displayedLoads, selectedId]);

  const labelOffsets = useMemo(() => {
    const sorted = displayedLoads
      .map((l) => ({ id: l.id, x: centerOfLoad(l) }))
      .sort((a, b) => a.x - b.x);
    const map = new Map<string, number>();
    let prev = -Infinity;
    let lane = 0;
    const proximity = Math.max(L * 0.045, 0.14);
    for (const item of sorted) {
      if (Math.abs(item.x - prev) < proximity) {
        lane += 1;
      } else {
        lane = 0;
      }
      map.set(item.id, (lane % 4) * 12);
      prev = item.x;
    }
    return map;
  }, [displayedLoads, L]);

  const supportAnchors = useMemo(() => {
    const explicit = (supportStations ?? [])
      .filter((s) => s.active !== false)
      .map((s) => clamp(s.x, 0, L))
      .sort((a, b) => a - b);
    if (explicit.length > 0) return explicit;
    if (support === "cantilever") return [0];
    return [0, L];
  }, [supportStations, support, L]);

  const displayStations = useMemo(() => {
    const explicit = (supportStations ?? [])
      .filter((s) => s.active !== false)
      .slice()
      .sort((a, b) => a.x - b.x);
    if (explicit.length > 0) return explicit;
    if (support === "cantilever") {
      return [{ id: "S1", x: 0, restraint: "fixed" as const }];
    }
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
  }, [supportStations, support, L]);

  const segmentBoundaries = useMemo(() => {
    const raw = (stiffnessSegments ?? []).flatMap((seg) => [seg.x1, seg.x2]);
    return Array.from(new Set(raw.map((x) => Number(clamp(x, 0, L).toFixed(6)))))
      .filter((x) => x > 1e-6 && x < L - 1e-6)
      .sort((a, b) => a - b);
  }, [stiffnessSegments, L]);

  const activeReleases = useMemo(
    () =>
      (internalReleases ?? [])
        .filter((release) => release.active !== false && release.type === "moment")
        .slice()
        .sort((a, b) => a.x - b.x),
    [internalReleases]
  );

  const snapAnchors = useMemo(() => {
    const anchors: number[] = [
      0,
      L,
      L * 0.5,
      L * 0.25,
      L * 0.75,
      L / 3,
      (2 * L) / 3,
      ...supportAnchors,
      ...segmentBoundaries,
      ...activeReleases.map((r) => r.x),
    ];
    for (const l of displayedLoads) {
      if (l.id === draggingId) continue;
      if (l.type === "point_load" || l.type === "moment") {
        anchors.push(l.x);
      } else {
        anchors.push(l.x1, l.x2, 0.5 * (l.x1 + l.x2));
      }
    }
    const rounded = anchors
      .filter((x) => Number.isFinite(x))
      .map((x) => clamp(x, 0, L))
      .map((x) => Number(x.toFixed(6)));
    return Array.from(new Set(rounded)).sort((a, b) => a - b);
  }, [displayedLoads, draggingId, L, supportAnchors, segmentBoundaries, activeReleases]);

  function xToSvg(x: number) {
    const t = geom.clamp(x / (L || 1), 0, 1);
    return geom.x0 + t * (geom.x1 - geom.x0);
  }

  function svgToX(svgX: number) {
    const t = (svgX - geom.x0) / (geom.x1 - geom.x0);
    return geom.clamp(t, 0, 1) * (L || 1);
  }

  function clientToSvgX(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse()).x;
  }

  function snapTo(x: number, step: number) {
    return Math.round(x / step) * step;
  }

  function roundTo(x: number, dp: number) {
    const k = Math.pow(10, dp);
    return Math.round(x * k) / k;
  }

  function decimalPlaces(step: number) {
    if (!Number.isFinite(step) || step <= 0) return 2;
    const text = step.toString().toLowerCase();
    if (text.includes("e-")) {
      const n = Number(text.split("e-")[1]);
      return Number.isFinite(n) ? Math.min(8, Math.max(0, n)) : 2;
    }
    const idx = text.indexOf(".");
    return idx >= 0 ? Math.min(8, text.length - idx - 1) : 0;
  }

  function nearestAnchor(x: number, anchors: number[]) {
    let best: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const a of anchors) {
      const d = Math.abs(a - x);
      if (d < bestDist) {
        bestDist = d;
        best = a;
      }
    }
    return { anchor: best, distance: bestDist };
  }

  function snapWithAnchors(rawX: number, step: number, anchors: number[]) {
    const minStep = Math.max((L || 1) / 1200, 1e-4);
    const effectiveStep = step > 0 ? step : minStep;
    const stepSnapped = step > 0 ? snapTo(rawX, effectiveStep) : rawX;
    const { anchor, distance } = nearestAnchor(rawX, anchors);
    const threshold = Math.max(step > 0 ? effectiveStep * 1.4 : L / 90, L / 260);
    const snapped = anchor !== null && distance <= threshold ? anchor : stepSnapped;
    return { x: snapped, anchor: anchor !== null && distance <= threshold ? anchor : null, threshold };
  }

  function onPointerDownOnLoad(e: React.PointerEvent<SVGGElement>, id: string) {
    e.preventDefault();
    e.stopPropagation();
    onSelect(id);
    const load = displayedLoads.find((l) => l.id === id);
    if (!load || load.locked) {
      onDragStateChange?.({ draggingId: null, snapStep });
      return;
    }
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    setDraggingId(id);
    onBeginDrag?.(id);
    onDragStateChange?.({ draggingId: id, snapStep });
  }

  function dispatchPatch(id: string, patch: Partial<Load>) {
    const prev = lastPatchRef.current;
    if (prev && prev.id === id) {
      const keys = Object.keys(patch);
      const cur = patch as Record<string, unknown>;
      const prv = prev.patch as Record<string, unknown>;
      if (
        keys.length > 0 &&
        keys.every((k) => {
          const a = cur[k];
          const b = prv[k];
          return typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-12 : a === b;
        })
      ) {
        return;
      }
    }
    lastPatchRef.current = { id, patch };
    const fn = onUpdateLoadLive ?? onUpdateLoad;
    fn(id, patch);
  }

  function queuePatch(id: string, patch: Partial<Load>) {
    pendingRef.current = { id, patch };
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      rafRef.current = null;
      if (pending) dispatchPatch(pending.id, pending.patch);
    });
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draggingId) return;
    const sx = clientToSvgX(e.clientX, e.clientY);
    if (sx == null) return;
    const rawX = svgToX(sx);
    const step = snapStep > 0 ? snapStep : Math.max((L || 1) / 200, 0.01);
    const dp = Math.max(3, decimalPlaces(step));
    const l = displayedLoads.find((item) => item.id === draggingId);
    if (!l || l.locked) return;

    if (l.type === "point_load" || l.type === "moment") {
      const snapResult = snapWithAnchors(rawX, step, snapAnchors);
      const newX = roundTo(clamp(snapResult.x, 0, L), dp);
      setSnapPreviewX(snapResult.anchor);
      queuePatch(draggingId, { x: newX });
      return;
    }

    const lo = Math.min(l.x1, l.x2);
    const hi = Math.max(l.x1, l.x2);
    const span = hi - lo;
    const center = 0.5 * (lo + hi);
    const snapResult = snapWithAnchors(rawX, step, snapAnchors);
    let dx = snapResult.x - center;
    let x1 = lo + dx;
    let x2 = hi + dx;

    if (x1 < 0) {
      x2 -= x1;
      x1 = 0;
    }
    if (x2 > L) {
      x1 -= x2 - L;
      x2 = L;
    }

    const threshold = snapResult.threshold;
    const a1 = nearestAnchor(x1, snapAnchors);
    const a2 = nearestAnchor(x2, snapAnchors);
    let anchor: number | null = snapResult.anchor;

    let shift = 0;
    if (a1.anchor !== null && a1.distance <= threshold) {
      shift = a1.anchor - x1;
      anchor = a1.anchor;
    }
    if (a2.anchor !== null && a2.distance <= threshold) {
      const cand = a2.anchor - x2;
      if (Math.abs(cand) < Math.abs(shift) || shift === 0) {
        shift = cand;
        anchor = a2.anchor;
      }
    }

    if (shift !== 0) {
      x1 += shift;
      x2 += shift;
      if (x1 < 0) {
        x1 = 0;
        x2 = span;
      }
      if (x2 > L) {
        x2 = L;
        x1 = L - span;
      }
    }

    setSnapPreviewX(anchor);
    queuePatch(draggingId, { x1: roundTo(x1, dp), x2: roundTo(x2, dp) });
  }

  function onPointerUp() {
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) onUpdateLoad(pending.id, pending.patch);
    lastPatchRef.current = null;
    setDraggingId(null);
    setSnapPreviewX(null);
    onDragStateChange?.({ draggingId: null, snapStep });
  }

  const pointLoads = displayedLoads.filter((l): l is PointLoad => l.type === "point_load");
  const udls = displayedLoads.filter((l): l is UDL => l.type === "udl");
  const linears = displayedLoads.filter((l) => l.type === "linear_dist");
  const moments = displayedLoads.filter((l): l is PointMoment => l.type === "moment");
  const thermals = displayedLoads.filter((l) => l.type === "thermal");
  const prestrains = displayedLoads.filter((l) => l.type === "prestrain");

  return (
    <div className="beamViewRoot">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${geom.w} ${geom.h}`}
        width="100%"
        height={geom.h}
        className="beamViewSvg"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerDown={() => onSelect(null)}
      >
        <line x1={geom.x0} y1={geom.beamY} x2={geom.x1} y2={geom.beamY} stroke="rgba(255,255,255,0.88)" strokeWidth="6" strokeLinecap="round" />
        {(stiffnessSegments ?? [])
          .filter((seg) => seg.x2 > seg.x1)
          .map((seg, idx) => {
            const x1 = xToSvg(Math.max(0, Math.min(L, seg.x1)));
            const x2 = xToSvg(Math.max(0, Math.min(L, seg.x2)));
            const fill = idx % 2 === 0 ? "rgba(56, 189, 248, 0.10)" : "rgba(34, 197, 94, 0.10)";
            return (
              <g key={seg.id}>
                <rect x={Math.min(x1, x2)} y={geom.beamY - 14} width={Math.max(1, Math.abs(x2 - x1))} height={28} fill={fill} rx={8} />
                {seg.label ? (
                  <text x={(x1 + x2) * 0.5} y={geom.beamY - 20} textAnchor="middle" fill="rgba(226,232,240,0.82)" fontSize="10">
                    {seg.label}
                  </text>
                ) : null}
              </g>
            );
          })}

        {segmentBoundaries.map((x, idx) => (
          <line
            key={`seg-boundary-${idx}`}
            x1={xToSvg(x)}
            y1={geom.beamY - 24}
            x2={xToSvg(x)}
            y2={geom.beamY + 24}
            stroke="rgba(148, 163, 184, 0.50)"
            strokeDasharray="4 3"
            strokeWidth="1.2"
          />
        ))}

        {activeReleases.map((release) => {
          const x = xToSvg(clamp(release.x, 0, L));
          return (
            <g key={release.id}>
              <circle cx={x} cy={geom.beamY} r={7} fill="rgba(251,146,60,0.20)" stroke="rgba(251,146,60,0.95)" strokeWidth={2} />
              <line x1={x} y1={geom.beamY - 14} x2={x} y2={geom.beamY + 14} stroke="rgba(251,146,60,0.95)" strokeWidth={2} />
              <text x={x} y={geom.beamY - 20} textAnchor="middle" fill="rgba(251,146,60,0.95)" fontSize="10">
                {release.label ?? "H"}
              </text>
            </g>
          );
        })}

        {displayStations.map((station) => {
          const x = xToSvg(clamp(station.x, 0, L));
          const isLeft = station.x <= L * 0.5;
          return (
            <g key={station.id}>
              {station.restraint === "fixed" ? (
                isLeft ? <FixedSupportLeft x={x} y={geom.beamY} /> : <FixedSupportRight x={x} y={geom.beamY} />
              ) : (
                <PinnedSupport x={x} y={geom.beamY} />
              )}
              <text x={x} y={geom.beamY + 54} textAnchor="middle" fill="rgba(191,219,254,0.9)" fontSize="10">
                {station.label ?? station.id}
              </text>
            </g>
          );
        })}

        {!displayStations.some((station) => Math.abs(station.x) < 1e-9) ? <FreeEnd x={geom.x0} y={geom.beamY} /> : null}
        {!displayStations.some((station) => Math.abs(station.x - L) < 1e-9) ? <FreeEnd x={geom.x1} y={geom.beamY} /> : null}

        {snapPreviewX !== null ? (
          <g>
            <line
              x1={xToSvg(snapPreviewX)}
              y1={geom.beamY - 72}
              x2={xToSvg(snapPreviewX)}
              y2={geom.beamY + 48}
              stroke="rgba(56, 189, 248, 0.65)"
              strokeWidth="1.6"
              strokeDasharray="4 3"
            />
            <text x={xToSvg(snapPreviewX)} y={geom.beamY - 78} textAnchor="middle" fill="rgba(125, 211, 252, 0.92)" fontSize="11">
              snap {formatUnitValue(snapPreviewX, resolvedUnits, "length")}
            </text>
          </g>
        ) : null}

        {thermals.map((t) => {
          const x1 = xToSvg(t.x1);
          const x2 = xToSvg(t.x2);
          const isSel = selectedId === t.id || draggingId === t.id;
          const labelLift = labelOffsets.get(t.id) ?? 0;
          return (
            <g key={t.id} onPointerDown={(e) => onPointerDownOnLoad(e, t.id)} style={{ cursor: t.locked ? "not-allowed" : isSel ? "grabbing" : "grab" }}>
              <rect
                x={Math.min(x1, x2)}
                y={geom.beamY - 6}
                width={Math.abs(x2 - x1)}
                height={12}
                fill={isSel ? "rgba(250,204,21,0.30)" : "rgba(250,204,21,0.20)"}
                stroke={isSel ? "rgba(250,204,21,0.9)" : "rgba(250,204,21,0.6)"}
                strokeWidth={isSel ? 2.4 : 1.4}
                rx={6}
              />
              <text x={(x1 + x2) * 0.5} y={geom.beamY - 14 - labelLift} textAnchor="middle" fill={C.thermal} fontSize="11">
                {loadDisplayName(t)}
              </text>
            </g>
          );
        })}

        {prestrains.map((k) => {
          const x1 = xToSvg(k.x1);
          const x2 = xToSvg(k.x2);
          const isSel = selectedId === k.id || draggingId === k.id;
          const yArc = geom.beamY + 24;
          const labelDrop = labelOffsets.get(k.id) ?? 0;
          return (
            <g key={k.id} onPointerDown={(e) => onPointerDownOnLoad(e, k.id)} style={{ cursor: k.locked ? "not-allowed" : isSel ? "grabbing" : "grab" }}>
              <path
                d={`M ${x1} ${yArc} Q ${(x1 + x2) / 2} ${yArc + 14} ${x2} ${yArc}`}
                fill="none"
                stroke={isSel ? "rgba(244,114,182,0.95)" : C.prestrain}
                strokeWidth={isSel ? 4 : 3}
                strokeDasharray="5 4"
              />
              <text x={(x1 + x2) * 0.5} y={yArc + 26 + labelDrop} textAnchor="middle" fill={C.prestrain} fontSize="11">
                {loadDisplayName(k)}
              </text>
            </g>
          );
        })}

        {udls.map((u) => {
          const x1 = xToSvg(Math.min(u.x1, u.x2));
          const x2 = xToSvg(Math.max(u.x1, u.x2));
          const isSel = selectedId === u.id || draggingId === u.id;
          const yTop = geom.beamY - 56;
          const yArrow = geom.beamY - 10;
          const count = 6;
          const step = (x2 - x1) / count;
          const labelLift = labelOffsets.get(u.id) ?? 0;
          return (
            <g key={u.id} onPointerDown={(e) => onPointerDownOnLoad(e, u.id)} style={{ cursor: u.locked ? "not-allowed" : isSel ? "grabbing" : "grab" }}>
              <rect
                x={x1}
                y={yTop}
                width={Math.max(2, x2 - x1)}
                height={yArrow - yTop}
                fill={isSel ? "rgba(96,165,250,0.18)" : "rgba(96,165,250,0.11)"}
                stroke={isSel ? "rgba(96,165,250,0.68)" : "rgba(255,255,255,0.10)"}
                strokeWidth={isSel ? 2 : 1.2}
                rx="10"
              />
              {Array.from({ length: count + 1 }).map((_, i) => {
                const xx = x1 + i * step;
                return (
                  <g key={i}>
                    <line x1={xx} y1={yTop + 10} x2={xx} y2={yArrow} stroke={C.udl} strokeWidth="2.8" strokeLinecap="round" />
                    <polygon points={`${xx - 5},${yArrow - 2} ${xx + 5},${yArrow - 2} ${xx},${yArrow + 8}`} fill={C.udl} />
                  </g>
                );
              })}
              <text x={(x1 + x2) / 2} y={yTop - 8 - labelLift} textAnchor="middle" fill={C.udl} fontSize="11">
                {loadDisplayName(u)}
              </text>
            </g>
          );
        })}

        {linears.map((u) => {
          const x1 = xToSvg(Math.min(u.x1, u.x2));
          const x2 = xToSvg(Math.max(u.x1, u.x2));
          const isSel = selectedId === u.id || draggingId === u.id;
          const yBase = geom.beamY - 10;
          const h1 = 16 + 30 * (Math.abs(u.w1) / Math.max(Math.abs(u.w1), Math.abs(u.w2), 1));
          const h2 = 16 + 30 * (Math.abs(u.w2) / Math.max(Math.abs(u.w1), Math.abs(u.w2), 1));
          const y1 = yBase - h1;
          const y2 = yBase - h2;
          const labelLift = labelOffsets.get(u.id) ?? 0;
          return (
            <g key={u.id} onPointerDown={(e) => onPointerDownOnLoad(e, u.id)} style={{ cursor: u.locked ? "not-allowed" : isSel ? "grabbing" : "grab" }}>
              <polygon
                points={`${x1},${yBase} ${x2},${yBase} ${x2},${y2} ${x1},${y1}`}
                fill={isSel ? "rgba(34,197,94,0.18)" : "rgba(34,197,94,0.12)"}
                stroke={isSel ? "rgba(34,197,94,0.90)" : "rgba(34,197,94,0.55)"}
                strokeWidth={isSel ? 2.2 : 1.4}
              />
              <line x1={x1} y1={y1} x2={x1} y2={yBase} stroke={C.linear} strokeWidth="2.5" />
              <line x1={x2} y1={y2} x2={x2} y2={yBase} stroke={C.linear} strokeWidth="2.5" />
              <text x={(x1 + x2) / 2} y={Math.min(y1, y2) - 8 - labelLift} textAnchor="middle" fill={C.linear} fontSize="11">
                {loadDisplayName(u)}
              </text>
            </g>
          );
        })}

        {pointLoads.map((p) => {
          const ax = xToSvg(p.x);
          const isSel = selectedId === p.id || draggingId === p.id;
          const labelLift = labelOffsets.get(p.id) ?? 0;
          return (
            <g key={p.id} onPointerDown={(e) => onPointerDownOnLoad(e, p.id)} style={{ cursor: p.locked ? "not-allowed" : isSel ? "grabbing" : "grab" }}>
              {isSel ? <circle cx={ax} cy={geom.beamY - 38} r={22} fill="rgba(45,212,191,0.10)" /> : null}
              <line x1={ax} y1={geom.beamY - 58} x2={ax} y2={geom.beamY - 10} stroke={C.point} strokeWidth={isSel ? "5" : "4"} strokeLinecap="round" />
              <polygon points={`${ax - 9},${geom.beamY - 12} ${ax + 9},${geom.beamY - 12} ${ax},${geom.beamY + 2}`} fill={C.point} />
              <circle cx={ax} cy={geom.beamY - 70} r={isSel ? 11 : 10} fill="rgba(45,212,191,0.16)" stroke="rgba(45,212,191,0.70)" strokeWidth="2" />
              <text x={ax} y={geom.beamY - 84 - labelLift} textAnchor="middle" fill={C.point} fontSize="11">
                {loadDisplayName(p)}
              </text>
            </g>
          );
        })}

        {moments.map((m) => {
          const mx = xToSvg(m.x);
          const isSel = selectedId === m.id || draggingId === m.id;
          const cw = m.M >= 0;
          const stroke = isSel ? "rgba(251,146,60,0.98)" : C.moment;
          const sw = isSel ? 4 : 3;
          const cy = geom.beamY;
          const r = 20;
          const yArc = cy - 21;
          const arc = cw
            ? `M ${mx - r} ${yArc} A ${r} ${r} 0 1 1 ${mx + r - 0.001} ${yArc}`
            : `M ${mx + r} ${yArc} A ${r} ${r} 0 1 0 ${mx - r + 0.001} ${yArc}`;
          const tipX = cw ? mx + r : mx - r;
          const tipY = yArc;
          const tDirX = cw ? 0.82 : -0.82;
          const tDirY = cw ? 0.58 : 0.58;
          const nDirX = -tDirY;
          const nDirY = tDirX;
          const arrow = `${tipX},${tipY} ${tipX - 8 * tDirX + 4 * nDirX},${tipY - 8 * tDirY + 4 * nDirY} ${tipX - 8 * tDirX - 4 * nDirX},${tipY - 8 * tDirY - 4 * nDirY}`;
          const labelLift = labelOffsets.get(m.id) ?? 0;
          return (
            <g key={m.id} onPointerDown={(e) => onPointerDownOnLoad(e, m.id)} style={{ cursor: m.locked ? "not-allowed" : isSel ? "grabbing" : "grab" }}>
              {isSel ? <circle cx={mx} cy={cy} r={26} fill="rgba(251,146,60,0.10)" /> : null}
              <circle cx={mx} cy={cy} r={isSel ? 7 : 6} fill="rgba(251,146,60,0.15)" stroke={stroke} strokeWidth="2" />
              <path d={arc} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
              <polygon points={arrow} fill={stroke} />
              <text x={mx} y={yArc - 12 - labelLift} textAnchor="middle" fill={stroke} fontSize="11">
                {loadDisplayName(m)}
              </text>
            </g>
          );
        })}

        {selectedVisible ? (
          <SelectedDimensions load={selectedVisible} beamY={geom.beamY} x0={geom.x0} xToSvg={xToSvg} units={resolvedUnits} />
        ) : null}

        <line x1={geom.x0} y1={geom.beamY + 56} x2={geom.x1} y2={geom.beamY + 56} stroke="rgba(255,255,255,0.20)" strokeWidth="2" />
        <text x={(geom.x0 + geom.x1) / 2} y={geom.beamY + 76} textAnchor="middle" fill="rgba(255,255,255,0.65)" fontSize="12">
          L = {formatUnitValue(L, resolvedUnits, "length")}
        </text>
      </svg>

      <div className="beamViewFoot">
        <div className="muted" style={{ fontSize: 12 }}>
          {draggingId
            ? `Dragging ${draggingId}. Snapping to beam anchors and load boundaries.`
            : selectedVisible?.locked
              ? `${selectedVisible.id} is locked from drag. Use unlock in Load Manager to move on beam.`
              : "Click a load to select. Drag selected loads with snapping guidance."}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Support: {support.replace("_", " ")} | stations {displayStations.length} | releases {activeReleases.length}
        </div>
        <div className="muted beamLegendRow" style={{ fontSize: 12 }}>
          <LegendDot color={C.point} label="Point" />
          <LegendDot color={C.udl} label="UDL" />
          <LegendDot color={C.linear} label="Linear Dist." />
          <LegendDot color={C.moment} label="Moment" />
          <LegendDot color={C.thermal} label="Thermal" />
          <LegendDot color={C.prestrain} label="Prestrain" />
          <LegendDot color="rgba(56, 189, 248, 0.65)" label="Segment" />
          <LegendDot color="rgba(251,146,60,0.95)" label="Release" />
        </div>
      </div>
    </div>
  );
}

function SelectedDimensions({
  load,
  beamY,
  x0,
  xToSvg,
  units,
}: {
  load: Load;
  beamY: number;
  x0: number;
  xToSvg: (x: number) => number;
  units: ReturnType<typeof getDisplayUnits>;
}) {
  const y = beamY + 34;

  if (load.type === "point_load" || load.type === "moment") {
    const x = xToSvg(load.x);
    return (
      <g>
        <line x1={x0} y1={y} x2={x} y2={y} stroke="rgba(148,163,184,0.70)" strokeWidth="1.4" />
        <line x1={x0} y1={y - 6} x2={x0} y2={y + 6} stroke="rgba(148,163,184,0.75)" strokeWidth="1.4" />
        <line x1={x} y1={y - 6} x2={x} y2={y + 6} stroke="rgba(148,163,184,0.75)" strokeWidth="1.4" />
        <line x1={x} y1={beamY + 2} x2={x} y2={y - 4} stroke="rgba(148,163,184,0.45)" strokeWidth="1.2" strokeDasharray="3 3" />
        <text x={(x0 + x) / 2} y={y - 8} textAnchor="middle" fill="rgba(191,219,254,0.9)" fontSize="11">
          x = {formatUnitValue(load.x, units, "length")}
        </text>
      </g>
    );
  }

  const x1 = xToSvg(Math.min(load.x1, load.x2));
  const x2 = xToSvg(Math.max(load.x1, load.x2));
  const len = Math.abs(load.x2 - load.x1);

  return (
    <g>
      <line x1={x0} y1={y + 12} x2={x1} y2={y + 12} stroke="rgba(148,163,184,0.30)" strokeWidth="1.2" strokeDasharray="3 3" />
      <line x1={x1} y1={y} x2={x2} y2={y} stroke="rgba(148,163,184,0.75)" strokeWidth="1.4" />
      <line x1={x1} y1={y - 6} x2={x1} y2={y + 6} stroke="rgba(148,163,184,0.75)" strokeWidth="1.4" />
      <line x1={x2} y1={y - 6} x2={x2} y2={y + 6} stroke="rgba(148,163,184,0.75)" strokeWidth="1.4" />
      <line x1={x1} y1={beamY + 2} x2={x1} y2={y - 4} stroke="rgba(148,163,184,0.45)" strokeWidth="1.2" strokeDasharray="3 3" />
      <line x1={x2} y1={beamY + 2} x2={x2} y2={y - 4} stroke="rgba(148,163,184,0.45)" strokeWidth="1.2" strokeDasharray="3 3" />
      <text x={(x1 + x2) / 2} y={y - 8} textAnchor="middle" fill="rgba(191,219,254,0.9)" fontSize="11">
        x1 = {formatUnitValue(Math.min(load.x1, load.x2), units, "length")}, x2 = {formatUnitValue(Math.max(load.x1, load.x2), units, "length")}, span = {formatUnitValue(len, units, "length")}
      </text>
    </g>
  );
}

function centerOfLoad(load: Load) {
  if (load.type === "point_load" || load.type === "moment") return load.x;
  return 0.5 * (load.x1 + load.x2);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function PinnedSupport({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <polygon points={`${x},${y + 6} ${x - 20},${y + 42} ${x + 20},${y + 42}`} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" />
      <line x1={x - 30} y1={y + 42} x2={x + 30} y2={y + 42} stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
    </g>
  );
}

function FixedSupportLeft({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <line x1={x} y1={y - 34} x2={x} y2={y + 34} stroke="rgba(255,255,255,0.60)" strokeWidth="5" />
      {Array.from({ length: 6 }).map((_, i) => {
        const yy = y - 30 + i * 12;
        return <line key={i} x1={x - 16} y1={yy} x2={x} y2={yy + 6} stroke="rgba(255,255,255,0.22)" strokeWidth="2" />;
      })}
    </g>
  );
}

function FixedSupportRight({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <line x1={x} y1={y - 34} x2={x} y2={y + 34} stroke="rgba(255,255,255,0.60)" strokeWidth="5" />
      {Array.from({ length: 6 }).map((_, i) => {
        const yy = y - 30 + i * 12;
        return <line key={i} x1={x} y1={yy + 6} x2={x + 16} y2={yy} stroke="rgba(255,255,255,0.22)" strokeWidth="2" />;
      })}
    </g>
  );
}

function FreeEnd({ x, y }: { x: number; y: number }) {
  return <line x1={x} y1={y - 16} x2={x} y2={y + 16} stroke="rgba(255,255,255,0.30)" strokeWidth="2" strokeDasharray="4 4" />;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 10, height: 10, borderRadius: 999, background: color, display: "inline-block" }} />
      <span>{label}</span>
    </span>
  );
}
