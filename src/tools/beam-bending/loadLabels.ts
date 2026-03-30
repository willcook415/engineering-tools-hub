import type { Load } from "./model";

export function loadTypeLabel(type: Load["type"]) {
  if (type === "point_load") return "Point load";
  if (type === "udl") return "Uniformly distributed load";
  if (type === "linear_dist") return "Linearly varying distributed load";
  if (type === "moment") return "Applied moment";
  if (type === "thermal") return "Thermal gradient";
  return "Imposed curvature";
}

export function loadDisplayName(load: Load) {
  const named = load.name?.trim();
  if (named) return named;
  return load.id;
}

