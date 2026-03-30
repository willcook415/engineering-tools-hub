import type { ReactElement } from "react";
import type { ToolMeta } from "./tools";
import BeamBendingTool from "../beam-bending/ui/BeamBendingTool";
import MvpToolPage from "../mvp/ui/MvpToolPage";
import PolynomialSolverTool from "../polynomial-solver/ui/PolynomialSolverTool";
import { getToolRuntimeSpec } from "../mvp/specs";

export type ResolvedToolView = {
  kind: "rich" | "mvp" | "custom";
  element: ReactElement;
};

const RICH_TOOL_RENDERERS: Record<string, () => ReactElement> = {
  "beam-bending": () => <BeamBendingTool />,
  "polynomial-solver": () => <PolynomialSolverTool />,
};

const CUSTOM_WORKSPACE_TOOL_RENDERERS: Partial<Record<string, (tool: ToolMeta) => ReactElement>> = {};

export function resolveToolView(tool: ToolMeta): ResolvedToolView | null {
  const customRenderer = CUSTOM_WORKSPACE_TOOL_RENDERERS[tool.slug];
  if (customRenderer) {
    return {
      kind: "custom",
      element: customRenderer(tool),
    };
  }

  if (tool.engineType === "rich") {
    const render = RICH_TOOL_RENDERERS[tool.slug];
    if (!render) return null;
    return {
      kind: "rich",
      element: render(),
    };
  }

  const runtimeSpec = getToolRuntimeSpec(tool.specId);
  if (!runtimeSpec) return null;

  return {
    kind: "mvp",
    element: <MvpToolPage slug={runtimeSpec.slug} />,
  };
}
