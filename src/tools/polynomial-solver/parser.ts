export type ParseIssue = {
  index: number;
  token: string;
  message: string;
};

export type ParseResult = {
  ok: boolean;
  coefficients: number[];
  issues: ParseIssue[];
};

function normalizeSymbols(text: string) {
  return text.replace(/\u2212/g, "-");
}

function splitTokens(text: string) {
  return normalizeSymbols(text)
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function parseCoefficientText(text: string): ParseResult {
  const tokens = splitTokens(text);
  if (tokens.length === 0) {
    return {
      ok: false,
      coefficients: [],
      issues: [{ index: -1, token: "", message: "No numeric tokens found." }],
    };
  }

  const coefficients: number[] = [];
  const issues: ParseIssue[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const raw = tokens[i];
    const v = Number(raw);
    if (!Number.isFinite(v)) {
      issues.push({ index: i, token: raw, message: `Token "${raw}" is not a valid number.` });
      continue;
    }
    coefficients.push(v);
  }

  if (coefficients.length < 2) {
    issues.push({ index: -1, token: "", message: "At least two coefficients are required." });
  }

  return {
    ok: issues.length === 0,
    coefficients,
    issues,
  };
}

type Term = {
  coefficient: number;
  power: number;
};

function parseTerm(raw: string): Term | null {
  const term = raw.trim();
  if (!term) return null;
  if (!term.includes("x")) {
    const c0 = Number(term);
    if (!Number.isFinite(c0)) return null;
    return { coefficient: c0, power: 0 };
  }

  const cleaned = term.replace(/\*/g, "");
  const [left, right] = cleaned.split("x");
  let coefficient: number;
  if (left === "" || left === "+") coefficient = 1;
  else if (left === "-") coefficient = -1;
  else {
    const c0 = Number(left);
    if (!Number.isFinite(c0)) return null;
    coefficient = c0;
  }

  let power = 1;
  if (right && right.trim() !== "") {
    const p = right.startsWith("^") ? Number(right.slice(1)) : Number.NaN;
    if (!Number.isInteger(p) || p < 0) return null;
    power = p;
  }
  return { coefficient, power };
}

export function parsePolynomialExpression(text: string): ParseResult {
  const normalized = normalizeSymbols(text).replace(/\s+/g, "");
  if (!normalized) {
    return {
      ok: false,
      coefficients: [],
      issues: [{ index: -1, token: "", message: "Expression is empty." }],
    };
  }

  const [lhsRaw, rhsRaw = "0"] = normalized.split("=");
  if (!lhsRaw) {
    return {
      ok: false,
      coefficients: [],
      issues: [{ index: -1, token: "", message: "Expression left-hand side is empty." }],
    };
  }

  function splitSignedTerms(side: string): string[] {
    const withMarkers = side.replace(/-/g, "+-");
    return withMarkers
      .split("+")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  const lhsTerms = splitSignedTerms(lhsRaw);
  const rhsTerms = splitSignedTerms(rhsRaw);
  const issues: ParseIssue[] = [];
  const buckets = new Map<number, number>();

  function addTerms(terms: string[], sign: 1 | -1, sideName: string) {
    for (let i = 0; i < terms.length; i += 1) {
      const parsed = parseTerm(terms[i]);
      if (!parsed) {
        issues.push({ index: i, token: terms[i], message: `Invalid ${sideName} term "${terms[i]}".` });
        continue;
      }
      const cur = buckets.get(parsed.power) ?? 0;
      buckets.set(parsed.power, cur + sign * parsed.coefficient);
    }
  }

  addTerms(lhsTerms, 1, "LHS");
  addTerms(rhsTerms, -1, "RHS");
  if (issues.length > 0) return { ok: false, coefficients: [], issues };

  const maxPow = Math.max(...Array.from(buckets.keys()));
  const coefficients = Array.from({ length: maxPow + 1 }, (_, i) => buckets.get(maxPow - i) ?? 0);
  if (coefficients.length < 2) {
    return {
      ok: false,
      coefficients,
      issues: [{ index: -1, token: "", message: "Expression resolves to constant form; degree must be >= 1." }],
    };
  }

  return { ok: true, coefficients, issues: [] };
}

export function parseBatchCoefficientLines(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  return lines.map((line, idx) => ({
    lineNo: idx + 1,
    line,
    parsed: /[xX=]/.test(line) ? parsePolynomialExpression(line) : parseCoefficientText(line),
  }));
}
