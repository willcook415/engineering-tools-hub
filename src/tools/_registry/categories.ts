import { TOOLS } from "./tools";
import type { ToolCategoryId } from "./tools";

export const toolCategories: { id: ToolCategoryId; label: string }[] = [
  { id: "solid", label: "Solid Mechanics" },
  { id: "fluids", label: "Fluids" },
  { id: "thermo", label: "Thermodynamics" },
  { id: "math", label: "Maths" },
  { id: "utils", label: "Utilities" },
];

export function toolsByCategory(cat: ToolCategoryId) {
  return TOOLS.filter((t) => t.categoryId === cat);
}