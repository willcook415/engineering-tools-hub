export default function PlotFrame({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="plotFrame">
      <div className="plotTitle">{title}</div>
      <div className="plotBody">{children}</div>
    </div>
  );
}