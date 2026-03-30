import type { SectionDefinition, SectionLibraryId } from "./model";

export type SectionFieldDef = {
  key: string;
  label: string;
  hint?: string;
};

export const SECTION_FIELD_MAP: Record<SectionLibraryId, SectionFieldDef[]> = {
  rectangular: [
    { key: "b", label: "Width b" },
    { key: "h", label: "Depth h" },
  ],
  circular_solid: [{ key: "D", label: "Diameter D" }],
  circular_hollow: [
    { key: "Do", label: "Outer diameter Do" },
    { key: "Di", label: "Inner diameter Di" },
  ],
  i_beam: [
    { key: "bf", label: "Flange width bf" },
    { key: "tf", label: "Flange thickness tf" },
    { key: "tw", label: "Web thickness tw" },
    { key: "h", label: "Overall depth h" },
  ],
  channel: [
    { key: "b", label: "Flange width b" },
    { key: "tf", label: "Flange thickness tf" },
    { key: "tw", label: "Web thickness tw" },
    { key: "h", label: "Overall depth h" },
  ],
};

export type ResolvedSection = {
  A?: number;
  I: number;
  Z?: number;
  depth?: number;
};

function canonicalDim(section: SectionDefinition, key: string, aliases: string[] = []) {
  if (section.dims[key] !== undefined) return section.dims[key];
  for (const k of aliases) {
    if (section.dims[k] !== undefined) return section.dims[k];
  }
  return undefined;
}

function dimToMeters(section: SectionDefinition, value: number) {
  const scale = section.unit === "mm" ? 1e-3 : 1;
  return value * scale;
}

export function getSectionDimensionIssues(section: SectionDefinition): string[] {
  const issues: string[] = [];
  const requiredKeys: Record<SectionLibraryId, Array<{ key: string; aliases?: string[] }>> = {
    rectangular: [{ key: "b", aliases: ["width"] }, { key: "h", aliases: ["depth"] }],
    circular_solid: [{ key: "D", aliases: ["d"] }],
    circular_hollow: [{ key: "Do", aliases: ["D"] }, { key: "Di", aliases: ["d"] }],
    i_beam: [{ key: "bf" }, { key: "tf" }, { key: "tw" }, { key: "h", aliases: ["depth"] }],
    channel: [{ key: "b", aliases: ["bf", "width"] }, { key: "tf", aliases: ["t"] }, { key: "tw", aliases: ["t"] }, { key: "h", aliases: ["depth"] }],
  };
  for (const def of requiredKeys[section.id]) {
    const v = canonicalDim(section, def.key, def.aliases);
    if (v === undefined) {
      issues.push(`Section dimension "${def.key}" is required for ${section.id}.`);
      continue;
    }
    if (!Number.isFinite(v) || v <= 0) {
      issues.push(`Section dimension "${def.key}" must be > 0.`);
    }
  }

  if (section.id === "circular_hollow") {
    const Do = canonicalDim(section, "Do", ["D"]);
    const Di = canonicalDim(section, "Di", ["d"]);
    if (Do !== undefined && Di !== undefined && Di >= Do) {
      issues.push("Section dimension constraint failed: Di must be less than Do.");
    }
  }

  if (section.id === "i_beam") {
    const h = canonicalDim(section, "h", ["depth"]);
    const tf = canonicalDim(section, "tf");
    if (h !== undefined && tf !== undefined && h <= 2 * tf) {
      issues.push("Section dimension constraint failed: i_beam requires h > 2*tf.");
    }
  }

  if (section.id === "channel") {
    const h = canonicalDim(section, "h", ["depth"]);
    const tf = canonicalDim(section, "tf", ["t"]);
    if (h !== undefined && tf !== undefined && h <= tf) {
      issues.push("Section dimension constraint failed: channel requires h > tf.");
    }
  }

  return issues;
}

export function resolveSectionProperties(section: SectionDefinition | undefined): ResolvedSection | undefined {
  if (!section) return undefined;
  if (getSectionDimensionIssues(section).length > 0) return undefined;

  const d = (key: string, aliases: string[] = []) => {
    const v = canonicalDim(section, key, aliases);
    if (v === undefined) return undefined;
    return dimToMeters(section, v);
  };

  if (section.id === "rectangular") {
    const b = d("b", ["width"]);
    const h = d("h", ["depth"]);
    if (!b || !h) return undefined;
    const I = (b * h ** 3) / 12;
    const A = b * h;
    return { I, A, Z: I / (h / 2), depth: h };
  }

  if (section.id === "circular_solid") {
    const D = d("D", ["d"]);
    if (!D) return undefined;
    const I = (Math.PI * D ** 4) / 64;
    const A = (Math.PI * D ** 2) / 4;
    return { I, A, Z: I / (D / 2), depth: D };
  }

  if (section.id === "circular_hollow") {
    const Do = d("Do", ["D"]);
    const Di = d("Di", ["d"]);
    if (!Do || !Di || Di >= Do) return undefined;
    const I = (Math.PI * (Do ** 4 - Di ** 4)) / 64;
    const A = (Math.PI * (Do ** 2 - Di ** 2)) / 4;
    return { I, A, Z: I / (Do / 2), depth: Do };
  }

  if (section.id === "i_beam") {
    const bf = d("bf");
    const tf = d("tf");
    const tw = d("tw");
    const h = d("h");
    if (!bf || !tf || !tw || !h || h <= 2 * tf) return undefined;
    const hw = h - 2 * tf;
    const Iflange = 2 * ((bf * tf ** 3) / 12 + bf * tf * (h / 2 - tf / 2) ** 2);
    const Iweb = (tw * hw ** 3) / 12;
    const I = Iflange + Iweb;
    const A = 2 * bf * tf + tw * hw;
    return { I, A, Z: I / (h / 2), depth: h };
  }

  const b = d("b", ["bf", "width"]);
  const tf = d("tf", ["t"]);
  const tw = d("tw", ["t"]);
  const h = d("h", ["depth"]);
  if (!b || !tw || !h || !tf || h <= tf) return undefined;
  const hw = h - tf;
  const Iflange = (b * tf ** 3) / 12 + b * tf * (h / 2 - tf / 2) ** 2;
  const Iweb = (tw * hw ** 3) / 12 + tw * hw * (tf / 2) ** 2;
  const I = Iflange + Iweb;
  const A = b * tf + tw * hw;
  return { I, A, Z: I / (h / 2), depth: h };
}
