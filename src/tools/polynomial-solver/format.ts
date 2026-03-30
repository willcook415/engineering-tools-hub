import type { Complex } from "./model";

export function fmtNumber(value: number, digits = 6) {
  if (!Number.isFinite(value)) return "-";
  const x = Math.abs(value) < 1e-14 ? 0 : value;
  const abs = Math.abs(x);
  if (abs >= 1e6 || (abs > 0 && abs < 1e-4)) return x.toExponential(3);
  return x.toFixed(digits).replace(/\.?0+$/, "");
}

export function fmtComplex(z: Complex, digits = 6) {
  const re = Math.abs(z.re) < 1e-12 ? 0 : z.re;
  const im = Math.abs(z.im) < 1e-12 ? 0 : z.im;
  if (Math.abs(im) < 1e-12) return fmtNumber(re, digits);
  const sign = im >= 0 ? "+" : "-";
  return `${fmtNumber(re, digits)} ${sign} ${fmtNumber(Math.abs(im), digits)}i`;
}

export function polynomialLatex(coefficients: number[]) {
  const n = coefficients.length - 1;
  const terms: string[] = [];
  for (let i = 0; i < coefficients.length; i += 1) {
    const c = coefficients[i];
    if (Math.abs(c) < 1e-14) continue;
    const degree = n - i;
    const absC = Math.abs(c);
    const sign = c >= 0 ? "+" : "-";
    const coeffStr = absC === 1 && degree > 0 ? "" : fmtNumber(absC, 6);
    const xPart = degree === 0 ? "" : degree === 1 ? "x" : `x^{${degree}}`;
    const body = `${coeffStr}${xPart}`;
    if (terms.length === 0) {
      terms.push(c < 0 ? `-${body}` : body);
    } else {
      terms.push(` ${sign} ${body}`);
    }
  }
  if (terms.length === 0) return "0";
  return `${terms.join("")} = 0`;
}
