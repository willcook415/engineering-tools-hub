export type WarningCode = "input" | "range" | "stability" | "assumption";

export type ToolWarning = {
  code: WarningCode;
  message: string;
};

export type ToolCheck = {
  label: string;
  value: string;
  pass?: boolean;
};

export type ToolOutput = {
  label: string;
  value: string;
};

export type ToolTable = {
  columns: string[];
  rows: string[][];
};

export type ToolSeries = {
  title: string;
  xKey: string;
  xLabel: string;
  yLabel: string;
  lines: Array<{ key: string; label: string }>;
  points: Array<Record<string, number>>;
};

export type ToolComputeResult = {
  outputs: ToolOutput[];
  checks: ToolCheck[];
  warnings: ToolWarning[];
  steps?: string[];
  table?: ToolTable;
  series?: ToolSeries;
};

export type ToolInputDef = {
  key: string;
  label: string;
  type: "number" | "select" | "text" | "textarea";
  defaultValue: string;
  placeholder?: string;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  rows?: number;
  options?: ReadonlyArray<{ value: string; label: string }>;
  helpText?: string;
};

export type ToolRuntimeSpec = {
  slug: string;
  name: string;
  summary: string;
  disclaimer?: string;
  inputs: ReadonlyArray<ToolInputDef>;
  validate: (raw: Record<string, string>) => string[];
  compute: (raw: Record<string, string>) => ToolComputeResult;
  sampleValid: Record<string, string>;
  sampleInvalid: Record<string, string>;
};
