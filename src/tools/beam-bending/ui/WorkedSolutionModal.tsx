import Latex from "../../../components/Latex";
import type { Step } from "../../_shared/steps/stepTypes";

export default function WorkedSolutionModal({
  title,
  mode,
  steps,
  onClose,
  activeSection,
  setActiveSection,
}: {
  title: string;
  mode: "brief" | "detailed";
  steps: Step[];
  onClose: () => void;
  activeSection: string;
  setActiveSection: (s: string) => void;
}) {
  const sections: { name: string; items: Step[] }[] = [];
  let currentName = "All";
  let currentItems: Step[] = [];

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
            <div className="modalSub">
              {mode === "detailed"
                ? "Detailed derivation with physical interpretation and design intent."
                : "Concise engineering check: equations, substitutions, and key results."}
            </div>
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
                      <div className="stepIndex">Step {idx + 1}</div>
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
