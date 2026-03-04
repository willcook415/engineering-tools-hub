export type Step = {
  title?: string;
  latex?: string;     // pretty equation
  note?: string;      // small text line
};

export type SolveResult<Out, Plot> = {
  outputs: Out;
  steps: Step[];
  plots: Plot;
};