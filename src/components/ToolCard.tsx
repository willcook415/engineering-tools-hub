import { Link } from "react-router-dom";
import type { ToolMeta } from "../tools/_registry/tools";

export default function ToolCard({ tool }: { tool: ToolMeta }) {
  return (
    <Link to={`/tools/${tool.slug}`} className="toolCard">
      <div className="toolCardTop">
        <div className="toolCardTitle">{tool.name}</div>
        <div className="toolCardSlug">/{tool.slug}</div>
      </div>
      <div className="toolCardDesc">{tool.description}</div>
      <div className="toolCardTags">
        {tool.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="pill">
            {tag}
          </span>
        ))}
      </div>
    </Link>
  );
}