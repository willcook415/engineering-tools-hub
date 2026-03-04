import { useMemo } from "react";
import { useParams, Navigate } from "react-router-dom";
import { TOOLS } from "../tools/_registry/tools";
import BeamBendingTool from "../tools/beam-bending/ui/BeamBendingTool";

export default function ToolPage() {
  const { slug } = useParams();

  const tool = useMemo(() => TOOLS.find((t) => t.slug === slug), [slug]);
  if (!tool) return <Navigate to="/" replace />;

  // Simple switch now; later we can make a registry map {slug -> component}.
  if (tool.slug === "beam-bending") return <BeamBendingTool />;

  return (
    <div className="page">
      <h1>{tool.name}</h1>
      <p>Tool not wired yet.</p>
    </div>
  );
}