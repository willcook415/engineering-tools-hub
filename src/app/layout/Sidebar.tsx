import { Link, useLocation } from "react-router-dom";
import { toolCategories, toolsByCategory } from "../../tools/_registry/categories";

type SidebarProps = {
  isOpen: boolean;
  onNavigate: () => void;
};

export default function Sidebar({ isOpen, onNavigate }: SidebarProps) {
  const loc = useLocation();

  return (
    <aside className={isOpen ? "sidebar open" : "sidebar"}>
      <div className="brand">
        <div className="brandMark">ET</div>
        <div className="brandText">
          <div className="brandTitle">Engineering Tools</div>
          <div className="brandSub">Hub</div>
        </div>
      </div>

      <nav className="nav">
        <Link className={loc.pathname === "/" ? "navItem active" : "navItem"} to="/" onClick={onNavigate}>
          Home
        </Link>

        <div className="navSectionTitle">Tools</div>

        {toolCategories.map((cat) => (
          <div key={cat.id} className="navSection">
            <div className="navSectionLabel">{cat.label}</div>
            {toolsByCategory(cat.id).map((t) => (
              <Link
                key={t.slug}
                to={`/tools/${t.slug}`}
                className={loc.pathname === `/tools/${t.slug}` ? "navItem active" : "navItem"}
                onClick={onNavigate}
              >
                {t.name}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
