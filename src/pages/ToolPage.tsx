import { useMemo } from "react";
import { useParams, Navigate } from "react-router-dom";
import { TOOLS } from "../tools/_registry/tools";
import { resolveToolView } from "../tools/_registry/resolver";

export default function ToolPage() {
  const { slug } = useParams();

  const tool = useMemo(() => TOOLS.find((t) => t.slug === slug), [slug]);
  if (!tool) return <Navigate to="/" replace />;

  const resolved = resolveToolView(tool);
  if (!resolved) return <Navigate to="/" replace />;

  return resolved.element;
}
