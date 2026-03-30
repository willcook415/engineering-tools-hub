import { useMemo, useState } from "react";
import ToolCard from "../components/ToolCard";
import { TOOLS } from "../tools/_registry/tools";
import { toolCategories } from "../tools/_registry/categories";

export default function Home() {
  const [query, setQuery] = useState("");
  const queryNorm = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!queryNorm) return TOOLS;
    return TOOLS.filter((t) => {
      const bag = `${t.name} ${t.description} ${t.tags.join(" ")} ${t.slug}`.toLowerCase();
      return bag.includes(queryNorm);
    });
  }, [queryNorm]);

  return (
    <div className="page">
      <div className="pageHeader">
        <h1>Tools</h1>
        <p>Structured by discipline with a consistent calculator workflow: inputs, checks, plots, and export-ready reports.</p>
      </div>

      <div className="catalogToolbar">
        <label className="field">
          <div className="fieldLabel">Search tools</div>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find by name, method, or tag"
            aria-label="Search tools"
          />
        </label>
        <div className="catalogStats">
          <span className="pill">Showing {filtered.length}</span>
          <span className="pill">Total {TOOLS.length}</span>
        </div>
      </div>

      <div className="catalogSections">
        {toolCategories.map((cat) => {
          const items = filtered.filter((t) => t.categoryId === cat.id);
          if (items.length === 0) return null;
          return (
            <section key={cat.id} className="catalogSection">
              <div className="catalogSectionHead">
                <h2>{cat.label}</h2>
                <span className="pill">{items.length} tools</span>
              </div>
              <div className="grid">
                {items.map((t) => (
                  <ToolCard key={t.slug} tool={t} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
