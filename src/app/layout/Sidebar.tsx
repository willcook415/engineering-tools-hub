import { Link, useLocation } from "react-router-dom";
import { toolCategories, toolsByCategory } from "../../tools/_registry/categories";

export default function Sidebar() {
  const loc = useLocation();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandMark">⛭</div>
        <div className="brandText">
          <div className="brandTitle">Engineering Tools</div>
          <div className="brandSub">Hub</div>
        </div>
      </div>

      <nav className="nav">
        <Link className={loc.pathname === "/" ? "navItem active" : "navItem"} to="/">
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