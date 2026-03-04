import "katex/dist/katex.min.css";
import { BlockMath } from "react-katex";

export default function Latex({ latex }: { latex: string }) {
  return (
    <div className="latex">
      <BlockMath math={latex} />
    </div>
  );
}