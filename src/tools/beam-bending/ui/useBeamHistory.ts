import { useCallback, useState } from "react";
import type { BeamBendingInputs } from "../model";

function deepCopyInputs(v: BeamBendingInputs): BeamBendingInputs {
  return {
    ...v,
    loads: v.loads.map((l) => ({ ...l })),
  };
}

export function useBeamHistory(initial: BeamBendingInputs, cap = 80) {
  const [inputs, setInputs] = useState<BeamBendingInputs>(deepCopyInputs(initial));
  const [history, setHistory] = useState<BeamBendingInputs[]>([]);
  const [future, setFuture] = useState<BeamBendingInputs[]>([]);

  const commit = useCallback((next: BeamBendingInputs | ((prev: BeamBendingInputs) => BeamBendingInputs)) => {
    setInputs((prev) => {
      const resolved = typeof next === "function" ? (next as (v: BeamBendingInputs) => BeamBendingInputs)(prev) : next;
      setHistory((h) => [...h.slice(-(cap - 1)), deepCopyInputs(prev)]);
      setFuture([]);
      return deepCopyInputs(resolved);
    });
  }, [cap]);

  const commitTransient = useCallback((next: BeamBendingInputs | ((prev: BeamBendingInputs) => BeamBendingInputs)) => {
    setInputs((prev) => {
      const resolved = typeof next === "function" ? (next as (v: BeamBendingInputs) => BeamBendingInputs)(prev) : next;
      return deepCopyInputs(resolved);
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setFuture((f) => [deepCopyInputs(inputs), ...f].slice(0, cap));
      setInputs(deepCopyInputs(prev));
      return h.slice(0, -1);
    });
  }, [cap, inputs]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const [next, ...rest] = f;
      setHistory((h) => [...h, deepCopyInputs(inputs)].slice(-cap));
      setInputs(deepCopyInputs(next));
      return rest;
    });
  }, [cap, inputs]);

  const reset = useCallback((next: BeamBendingInputs) => {
    setInputs(deepCopyInputs(next));
    setHistory([]);
    setFuture([]);
  }, []);

  return {
    inputs,
    setInputs,
    history,
    future,
    commit,
    commitTransient,
    undo,
    redo,
    reset,
  };
}
