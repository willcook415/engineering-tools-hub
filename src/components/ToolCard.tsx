import { Link } from "react-router-dom";
import type { ToolMeta } from "../tools/_registry/tools";

type ToolCardProps = {
  tool: ToolMeta;
};

export default function ToolCard({ tool }: ToolCardProps) {
  const shownTags = tool.tags.slice(0, 3);
  const remainingTags = Math.max(0, tool.tags.length - shownTags.length);
  const status = tool.engineType === "rich" ? "Live" : "MVP";

  const content = (
    <>
      <div className="toolCardTop">
        <div className="toolCardTitleWrap">
          <div className="toolCardTitle">{tool.name}</div>
          <div className="toolCardSlug">/{tool.slug}</div>
        </div>
        <div className="statusBadge ready">{status}</div>
      </div>
      <div className="toolCardDesc">{tool.description}</div>
      <div className="toolCardTags">
        {shownTags.map((tag) => (
          <span key={tag} className="pill">
            {tag}
          </span>
        ))}
        {remainingTags > 0 ? <span className="pill">+{remainingTags}</span> : null}
      </div>
    </>
  );

  return (
    <Link to={`/tools/${tool.slug}`} className="toolCard">
      {content}
    </Link>
  );
}
