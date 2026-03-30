import { useEffect, useMemo, useState } from "react";

type Props = {
  id: string;
  title: string;
  summary?: string;
  summaryChips?: string[];
  defaultOpen?: boolean;
  children: React.ReactNode;
};

function storageKey(id: string) {
  return `ui.collapsible.${id}`;
}

export default function CollapsibleSection({
  id,
  title,
  summary,
  summaryChips,
  defaultOpen = false,
  children,
}: Props) {
  const initial = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(storageKey(id));
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {
      // ignore storage read failures
    }
    return defaultOpen;
  }, [id, defaultOpen]);

  const [open, setOpen] = useState(initial);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(id), open ? "1" : "0");
    } catch {
      // ignore storage write failures
    }
  }, [id, open]);

  return (
    <section className={open ? "collapsible open" : "collapsible"}>
      <button
        type="button"
        className="collapsibleHead"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="collapsibleTitle">{title}</span>
        <span className="collapsibleState">{open ? "Hide" : "Show"}</span>
      </button>
      {!open ? (
        <div className="collapsibleSummary">
          {summary ? <span className="muted">{summary}</span> : null}
          {summaryChips?.length ? (
            <span className="collapsibleChips">
              {summaryChips.map((chip) => (
                <span key={chip} className="pill">
                  {chip}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
      {open ? <div className="collapsibleBody">{children}</div> : null}
    </section>
  );
}

