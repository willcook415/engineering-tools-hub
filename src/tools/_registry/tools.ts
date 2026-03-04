export type ToolCategoryId = "solid" | "fluids" | "thermo" | "math" | "utils";

export type ToolMeta = {
  slug: string;
  name: string;
  description: string;
  categoryId: ToolCategoryId;
  tags: string[];
};

export const TOOLS: ToolMeta[] = [
  {
    slug: "beam-bending",
    name: "Beam Bending",
    description: "Reactions, SFD/BMD, deflection curve, and worked steps.",
    categoryId: "solid",
    tags: ["Euler–Bernoulli", "SFD", "BMD", "Deflection"],
  },
];