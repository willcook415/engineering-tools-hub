// src/tools/beam-bending/model.ts

export type SupportType =
  | "simply_supported"
  | "cantilever"
  | "fixed_fixed"
  | "propped_cantilever";

export type PointLoad = {
  id: string;
  type: "point_load";
  name?: string;
  x: number; // position from left (m)
  P: number; // magnitude (N), +downwards (pick a convention and stick to it)
};

export type UDL = {
  id: string;
  type: "udl";
  name?: string;
  x1: number; // start (m)
  x2: number; // end (m)
  w: number;  // N/m, +downwards
};

export type PointMoment = {
  id: string;
  type: "moment";
  name?: string;
  x: number; // position (m)
  M: number; // N·m, sign by your convention (e.g. +hogging or +sagging)
};

export type Load = PointLoad | UDL | PointMoment;

// (Optional future) support settlements, temperature, etc.
// export type SupportSettlement = { ... }

export type BeamBendingInputs = {
  support: SupportType;
  L: number; // length (m)
  E: number; // Young's modulus (Pa)
  I: number; // second moment (m^4)

  loads: Load[];
};

export type BeamBendingOutputs = {
  // Reactions: for now keep generic so you can handle more support types later
  // Simply supported: R1/R2
  // Cantilever: R, M0
  reactions: Record<string, number>;

  // Convenience values commonly shown in UI
  Mmax: number;
  xMmax: number;

  yMaxDown: number;
  xAtYMaxDown: number;
};

export type BeamBendingPlots = {
  sfd: { x: number; V: number }[];
  bmd: { x: number; M: number }[];
  deflection: { x: number; y: number }[];
};