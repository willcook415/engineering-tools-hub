import { describe, expect, test } from "vitest";
import { getToolRuntimeSpec } from "../mvp/specs";
import { resolveToolView } from "./resolver";
import { TOOLS } from "./tools";

function collectResultText(slug: string): string {
  const spec = getToolRuntimeSpec(slug);
  if (!spec) return "";
  const result = spec.compute(spec.sampleValid);
  const tableRows = result.table?.rows.flat().join(" ") ?? "";
  return [
    result.outputs.map((o) => `${o.label} ${o.value}`).join(" "),
    result.checks.map((c) => `${c.label} ${c.value}`).join(" "),
    result.warnings.map((w) => w.message).join(" "),
    result.steps?.join(" ") ?? "",
    tableRows,
  ]
    .join(" ")
    .toLowerCase();
}

describe("tool resolver", () => {
  test("every registered slug resolves to a concrete tool view", () => {
    for (const tool of TOOLS) {
      const resolved = resolveToolView(tool);
      expect(resolved).toBeTruthy();
      if (!resolved) continue;
      if (tool.engineType === "rich") {
        expect(resolved.kind).toBe("rich");
      } else {
        expect(["mvp", "custom"]).toContain(resolved.kind);
      }
    }
  });

  test("all mvp tool spec ids resolve to a runtime spec", () => {
    for (const tool of TOOLS.filter((candidate) => candidate.engineType === "mvp")) {
      expect(getToolRuntimeSpec(tool.specId)).toBeTruthy();
    }
  });

  test("mvp compute payloads no longer include placeholder copy", () => {
    for (const tool of TOOLS.filter((candidate) => candidate.engineType === "mvp")) {
      const text = collectResultText(tool.specId);
      expect(text).not.toContain("tool not wired yet");
      expect(text).not.toContain("mvp placeholder");
    }
  });
});
