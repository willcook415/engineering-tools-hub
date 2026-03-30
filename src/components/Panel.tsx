export default function Panel({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div className="panelTitle">{title}</div>
        {right ? <div className="panelRight">{right}</div> : null}
      </div>
      <div className="panelBody">{children}</div>
    </section>
  );
}