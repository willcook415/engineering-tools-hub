import type { MaterialDefinition } from "./model";

export const MATERIAL_PRESETS: MaterialDefinition[] = [
  {
    id: "steel_s275",
    name: "Steel S275",
    E: 210e9,
    nu: 0.3,
    density: 7850,
    yieldStress: 275e6,
  },
  {
    id: "steel_s355",
    name: "Steel S355",
    E: 210e9,
    nu: 0.3,
    density: 7850,
    yieldStress: 355e6,
  },
  {
    id: "aluminium_6061_t6",
    name: "Aluminium 6061-T6",
    E: 69e9,
    nu: 0.33,
    density: 2700,
    yieldStress: 276e6,
  },
  {
    id: "timber_glulam_gl24",
    name: "Glulam GL24",
    E: 11e9,
    nu: 0.28,
    density: 450,
    yieldStress: 24e6,
  },
];
