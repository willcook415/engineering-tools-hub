import { useCallback, useState } from "react";
import type { PolynomialInputs } from "../model";

export type PolynomialEditorState = {
  coefficients: number[];
  degree: number;
  tolerance: number;
  residualTolerance: number;
  maxIterations: number;
  stepDetail: "brief" | "detailed";
  solveMode: "auto" | "exact" | "numeric";
  numericMethod: "dk" | "aberth";
  sortMode: "real_first" | "by_magnitude";
  lightweightPlots: boolean;
};

function deepCopy(state: PolynomialEditorState): PolynomialEditorState {
  return {
    ...state,
    coefficients: [...state.coefficients],
  };
}

export function toPolynomialInputs(state: PolynomialEditorState): PolynomialInputs {
  return {
    coefficients: state.coefficients,
    deltaTolerance: state.tolerance,
    residualTolerance: state.residualTolerance,
    maxIterations: state.maxIterations,
    stepDetail: state.stepDetail,
    solveMode: state.solveMode,
    numericMethod: state.numericMethod,
  };
}

export function usePolynomialHistory(initial: PolynomialEditorState, cap = 80) {
  const [state, setState] = useState<PolynomialEditorState>(deepCopy(initial));
  const [history, setHistory] = useState<PolynomialEditorState[]>([]);
  const [future, setFuture] = useState<PolynomialEditorState[]>([]);

  const commit = useCallback((next: PolynomialEditorState | ((prev: PolynomialEditorState) => PolynomialEditorState)) => {
    setState((prev) => {
      const resolved = typeof next === "function" ? (next as (s: PolynomialEditorState) => PolynomialEditorState)(prev) : next;
      setHistory((h) => [...h.slice(-(cap - 1)), deepCopy(prev)]);
      setFuture([]);
      return deepCopy(resolved);
    });
  }, [cap]);

  const commitTransient = useCallback((next: PolynomialEditorState | ((prev: PolynomialEditorState) => PolynomialEditorState)) => {
    setState((prev) => {
      const resolved = typeof next === "function" ? (next as (s: PolynomialEditorState) => PolynomialEditorState)(prev) : next;
      return deepCopy(resolved);
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setFuture((f) => [deepCopy(state), ...f].slice(0, cap));
      setState(deepCopy(prev));
      return h.slice(0, -1);
    });
  }, [cap, state]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const [next, ...rest] = f;
      setHistory((h) => [...h, deepCopy(state)].slice(-cap));
      setState(deepCopy(next));
      return rest;
    });
  }, [cap, state]);

  const reset = useCallback((next: PolynomialEditorState) => {
    setState(deepCopy(next));
    setHistory([]);
    setFuture([]);
  }, []);

  return {
    state,
    history,
    future,
    commit,
    commitTransient,
    undo,
    redo,
    reset,
  };
}
