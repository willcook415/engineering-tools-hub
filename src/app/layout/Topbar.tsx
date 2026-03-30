type TopbarProps = {
  onToggleSidebar: () => void;
};

export default function Topbar({ onToggleSidebar }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbarLeft">
        <button type="button" className="menuBtn" onClick={onToggleSidebar} aria-label="Toggle navigation menu">
          <span />
          <span />
          <span />
        </button>
        <div>
          <div className="topbarTitle">Engineering Tools Hub</div>
          <div className="topbarHint">Formulae | Steps | Plots | PDF Reports</div>
        </div>
      </div>
    </header>
  );
}
