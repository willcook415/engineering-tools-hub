import { useEffect, useMemo } from "react";
import type { ToolCategoryId, ToolMeta } from "../tools/_registry/tools";

type PlannedToolModalProps = {
  tool: ToolMeta;
  onClose: () => void;
};

type PreviewTemplate = {
  outputs: string[];
  equations: string[];
  phase: string[];
};

const PREVIEW_BY_CATEGORY: Record<ToolCategoryId, PreviewTemplate> = {
  solid: {
    outputs: ["Primary stress/force metrics", "Critical value locations", "Governing design check summary"],
    equations: ["Equilibrium relationships", "Constitutive + compatibility equations", "Code-check utilization expressions"],
    phase: ["MVP solver + validated examples", "Interactive charts and annotations", "Report export and scenario compare"],
  },
  fluids: {
    outputs: ["Regime or loss classification", "Pressure/head/energy balance values", "Sensitivity to key flow parameters"],
    equations: ["Continuity + Bernoulli baseline", "Empirical loss correlations", "Pump/system energy equations"],
    phase: ["Single-case deterministic solve", "Minor losses + fittings library", "Uncertainty and design envelope mode"],
  },
  thermo: {
    outputs: ["State/heat duty values", "Thermal resistance breakdown", "Sizing recommendations"],
    equations: ["First-law control-volume forms", "Heat transfer rate equations", "LMTD or effectiveness relationships"],
    phase: ["Core solver and unit-safe inputs", "Plotting and parametric sweep", "Exportable calculation notes"],
  },
  materials: {
    outputs: ["Material property lookup values", "Safety factor and margin", "Pass/fail guidance"],
    equations: ["Strength vs demand expressions", "Safety factor relationships", "Allowable stress formulations"],
    phase: ["Curated starter dataset", "Filter/search + comparison mode", "Linked checks from mechanics tools"],
  },
  math: {
    outputs: ["Computed roots/solutions", "Conditioning and residual checks", "Step-by-step derivation traces"],
    equations: ["Linear algebra solve forms", "Polynomial root-finding methods", "Unit-consistent transforms"],
    phase: ["High-reliability baseline solver", "Explainability and step mode", "Batch and copy/export tools"],
  },
  utils: {
    outputs: ["Reference constants/conversions", "Quick engineering lookups", "Reusable scratch outputs"],
    equations: ["Dimensional conversion relationships", "Reference equation snippets", "Formatting + rounding rules"],
    phase: ["Fast utility MVP set", "Pinned favorites and recents", "Cross-tool insertion helpers"],
  },
  electrical: {
    outputs: ["Circuit/load key values", "Power quality indicators", "Protection sizing checks"],
    equations: ["Ohm/Kirchhoff relationships", "AC power triangle equations", "Fault and cable sizing formulae"],
    phase: ["Core calculators", "Component libraries", "Single-line report outputs"],
  },
  civil: {
    outputs: ["Section/geometric capacities", "Design demand ratios", "Construction-ready summaries"],
    equations: ["Load-path and capacity equations", "Geotech/roadway design checks", "Code-based serviceability limits"],
    phase: ["Core structural utilities", "Geotech/site modules", "Integrated package checks"],
  },
};

export default function PlannedToolModal({ tool, onClose }: PlannedToolModalProps) {
  const preview = useMemo(() => PREVIEW_BY_CATEGORY[tool.categoryId], [tool.categoryId]);
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="roadmapOverlay" role="dialog" aria-modal="true" aria-label={`${tool.name} preview`} onClick={onClose}>
      <div className="roadmapModal" onClick={(e) => e.stopPropagation()}>
        <div className="roadmapHead">
          <div>
            <div className="roadmapTitle">{tool.name}</div>
            <div className="roadmapSub">Planned module preview</div>
          </div>
          <button type="button" className="btn btnGhost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="roadmapBody">
          <p className="roadmapDesc">{tool.description}</p>

          <div className="roadmapTags">
            {tool.tags.map((tag) => (
              <span className="pill" key={tag}>
                {tag}
              </span>
            ))}
          </div>

          <div className="roadmapGrid">
            <div className="roadmapBlock">
              <h3>Planned Outputs</h3>
              <ul>
                {preview.outputs.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>

            <div className="roadmapBlock">
              <h3>Core Equations</h3>
              <ul>
                {preview.equations.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>

            <div className="roadmapBlock">
              <h3>Build Phases</h3>
              <ul>
                {preview.phase.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
