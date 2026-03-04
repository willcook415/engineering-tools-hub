import { useMemo, useRef, useState } from "react";
import type { Load, PointLoad, UDL, PointMoment } from "../model";

type Props = {
  L: number;
  loads: Load[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdateLoad: (id: string, patch: Partial<Load>) => void;
};

export default function BeamView({ L, loads, selectedId, onSelect, onUpdateLoad }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const geom = useMemo(() => {
    const w = 720;
    const h = 180;
    const pad = 60;
    const beamY = 92;
    const x0 = pad;
    const x1 = w - pad;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    return { w, h, pad, beamY, x0, x1, clamp };
  }, []);

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
    const pt = new DOMPoint(clientX, clientY);
    return pt.matrixTransform(ctm.inverse()).x;
  }

  function snap(x: number, step: number) {
    return Math.round(x / step) * step;
  }
  function roundTo(x: number, dp: number) {
    const k = Math.pow(10, dp);
    return Math.round(x * k) / k;
  }

  function onPointerDownOnLoad(e: React.PointerEvent<SVGGElement>, id: string) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    setDraggingId(id);
    onSelect(id);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draggingId) return;
    const sx = clientToSvgX(e.clientX, e.clientY);
    if (sx == null) return;
    const rawX = svgToX(sx);
    const step = Math.max((L || 1) / 200, 0.01); // 200 divisions, min 1cm
    const newX = roundTo(snap(rawX, step), 3);

    const l = loads.find((l) => l.id === draggingId);
    if (!l) return;

    if (l.type === "point_load") {
      onUpdateLoad(draggingId, { ...l, x: newX } as any);
      return;
    }

    if (l.type === "moment") {
        onUpdateLoad(draggingId, { ...l, x: newX } as any);
        return;
    }

    if (l.type === "udl") {
      // drag whole segment without changing length
      const center = 0.5 * (l.x1 + l.x2);
      const dx = newX - center;
      let x1 = l.x1 + dx;
      let x2 = l.x2 + dx;

      // clamp segment inside beam
      if (x1 < 0) {
        x2 -= x1;
        x1 = 0;
      }
      if (x2 > L) {
        x1 -= x2 - L;
        x2 = L;
      }

      onUpdateLoad(draggingId, { ...l, x1, x2 } as any);
      return;
    }
  }

  function onPointerUp() {
    setDraggingId(null);
  }

  const pointLoads = loads.filter((l): l is PointLoad => l.type === "point_load");
  const udls = loads.filter((l): l is UDL => l.type === "udl");
  const moments = loads.filter((l): l is PointMoment => l.type === "moment");

  return (
    <div style={{ width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${geom.w} ${geom.h}`}
        width="100%"
        height="180"
        style={{ display: "block", touchAction: "none" }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerDown={() => onSelect(null)}
      >
        {/* Beam */}
        <line
          x1={geom.x0}
          y1={geom.beamY}
          x2={geom.x1}
          y2={geom.beamY}
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="6"
          strokeLinecap="round"
        />

        {/* Supports */}
        <Support x={geom.x0} y={geom.beamY} />
        <Support x={geom.x1} y={geom.beamY} />

        {/* UDL visuals */}
        {udls.map((u) => {
          const x1 = xToSvg(Math.min(u.x1, u.x2));
          const x2 = xToSvg(Math.max(u.x1, u.x2));
          const isSel = selectedId === u.id || draggingId === u.id;
          const yTop = geom.beamY - 54;
          const yArrow = geom.beamY - 10;

          const count = 6;
          const step = (x2 - x1) / count;

          return (
            <g
              key={u.id}
              onPointerDown={(e) => onPointerDownOnLoad(e, u.id)}
              style={{ cursor: isSel ? "grabbing" : "grab" }}
            >
              <rect
                x={x1}
                y={yTop}
                width={Math.max(2, x2 - x1)}
                height={yArrow - yTop}
                fill={isSel ? "rgba(96,165,250,0.14)" : "rgba(96,165,250,0.10)"}
                stroke={isSel ? "rgba(96,165,250,0.55)" : "rgba(255,255,255,0.10)"}
                rx="10"
              />
              {Array.from({ length: count + 1 }).map((_, i) => {
                const xx = x1 + i * step;
                return (
                  <g key={i}>
                    <line
                      x1={xx}
                      y1={yTop + 10}
                      x2={xx}
                      y2={yArrow}
                      stroke="rgba(96,165,250,0.85)"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <polygon
                      points={`${xx - 6},${yArrow - 2} ${xx + 6},${yArrow - 2} ${xx},${yArrow + 10}`}
                      fill="rgba(96,165,250,0.85)"
                    />
                  </g>
                );
              })}
              <text
                x={(x1 + x2) / 2}
                y={yTop - 8}
                textAnchor="middle"
                fill="rgba(255,255,255,0.72)"
                fontSize="12"
                fontFamily="Inter, system-ui"
              >
                UDL w={u.w} N/m
              </text>
            </g>
          );
        })}

        {/* Point load markers */}
        {pointLoads.map((p) => {
          const ax = xToSvg(p.x);
          const isSel = selectedId === p.id || draggingId === p.id;

          return (
            <g
              key={p.id}
              onPointerDown={(e) => onPointerDownOnLoad(e, p.id)}
              style={{ cursor: isSel ? "grabbing" : "grab" }}
            >
              <line
                x1={ax}
                y1={geom.beamY - 58}
                x2={ax}
                y2={geom.beamY - 10}
                stroke={isSel ? "rgba(79,209,197,0.98)" : "rgba(79,209,197,0.90)"}
                strokeWidth={isSel ? "5" : "4"}
                strokeLinecap="round"
              />
              <polygon
                points={`${ax - 9},${geom.beamY - 12} ${ax + 9},${geom.beamY - 12} ${ax},${geom.beamY + 2}`}
                fill={isSel ? "rgba(79,209,197,0.98)" : "rgba(79,209,197,0.90)"}
              />
              <circle
                cx={ax}
                cy={geom.beamY - 70}
                r={isSel ? 11 : 10}
                fill={isSel ? "rgba(79,209,197,0.22)" : "rgba(79,209,197,0.14)"}
                stroke={isSel ? "rgba(79,209,197,0.75)" : "rgba(79,209,197,0.55)"}
                strokeWidth="2"
              />
              <text
                x={ax}
                y={geom.beamY - 84}
                textAnchor="middle"
                fill="rgba(255,255,255,0.72)"
                fontSize="12"
                fontFamily="Inter, system-ui"
              >
                P={p.P} N
              </text>
            </g>
          );
        })}

        {/* Point moments */}
        {moments.map((m) => {
        const mx = xToSvg(m.x);
        const isSel = selectedId === m.id || draggingId === m.id;

        const cw = m.M >= 0;
        const stroke = isSel ? "rgba(245, 158, 11, 0.95)" : "rgba(245, 158, 11, 0.80)";
        const sw = isSel ? 4 : 3;

        const cy = geom.beamY;         // anchor on beam
        const r = 18;
        const xL = mx - r;
        const xR = mx + r;

        // CW above, CCW below
        const yArc = cw ? cy - 22 : cy + 22;

        const arc = cw
            ? `M ${xL} ${yArc} A ${r} ${r} 0 0 1 ${xR} ${yArc}`
            : `M ${xR} ${yArc} A ${r} ${r} 0 0 1 ${xL} ${yArc}`;

        const arrowX = cw ? xR : xL;
        const arrowDir = cw ? 1 : -1;

        const label = (m.name && m.name.trim()) ? m.name : m.id;

        return (
            <g
            key={m.id}
            onPointerDown={(e) => onPointerDownOnLoad(e, m.id)}
            style={{ cursor: isSel ? "grabbing" : "grab" }}
            >
            <title>{`${label} | M=${m.M} N·m @ x=${m.x.toFixed(3)} m`}</title>

            <circle
                cx={mx}
                cy={cy}
                r={isSel ? 7 : 6}
                fill={isSel ? "rgba(245, 158, 11, 0.22)" : "rgba(245, 158, 11, 0.14)"}
                stroke={isSel ? "rgba(245, 158, 11, 0.70)" : "rgba(245, 158, 11, 0.50)"}
                strokeWidth="2"
            />

            <path d={arc} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />

            <polygon
                points={`${arrowX + 7 * arrowDir},${yArc} ${arrowX - 2 * arrowDir},${yArc - 6} ${arrowX - 2 * arrowDir},${yArc + 6}`}
                fill={stroke}
            />

            <text
                x={mx}
                y={cw ? yArc - 12 : yArc + 18}
                textAnchor="middle"
                fill="rgba(255,255,255,0.75)"
                fontSize="12"
                fontFamily="Inter, system-ui"
            >
                {label} • M={m.M} N·m
            </text>
            </g>
        );
        })}

        {/* Dimension */}
        <line
          x1={geom.x0}
          y1={geom.beamY + 52}
          x2={geom.x1}
          y2={geom.beamY + 52}
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="2"
        />
        <text
          x={(geom.x0 + geom.x1) / 2}
          y={geom.beamY + 72}
          textAnchor="middle"
          fill="rgba(255,255,255,0.62)"
          fontSize="12"
          fontFamily="Inter, system-ui"
        >
          L = {Number.isFinite(L) ? L.toFixed(3) : "—"} m
        </text>
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        <div className="muted" style={{ fontSize: 12 }}>
            Click a load to select. Drag selected loads on the beam.
        </div>

        <div className="muted" style={{ fontSize: 12, display: "flex", gap: 14, alignItems: "center" }}>
            <LegendDot color="rgba(79,209,197,0.9)" label="Point load" />
            <LegendDot color="rgba(96,165,250,0.9)" label="UDL" />
            <LegendDot color="rgba(245,158,11,0.9)" label="Moment" />
        </div>
        </div>
    </div>
  );
}

function Support({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <polygon
        points={`${x},${y + 6} ${x - 20},${y + 42} ${x + 20},${y + 42}`}
        fill="rgba(255,255,255,0.06)"
        stroke="rgba(255,255,255,0.18)"
      />
      <line
        x1={x - 30}
        y1={y + 42}
        x2={x + 30}
        y2={y + 42}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="2"
      />
    </g>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: color,
          display: "inline-block",
        }}
      />
      <span>{label}</span>
    </span>
  );
}