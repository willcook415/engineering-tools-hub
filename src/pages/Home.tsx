import { TOOLS } from "../tools/_registry/tools";
import ToolCard from "../components/ToolCard";

export default function Home() {
  return (
    <div className="page">
      <div className="pageHeader">
        <h1>Tools</h1>
        <p>Pick a tool. You’ll see the formulae, substitutions, steps, plots, and a PDF export.</p>
      </div>

      <div className="grid">
        {TOOLS.map((t) => (
          <ToolCard key={t.slug} tool={t} />
        ))}
      </div>
    </div>
  );
}