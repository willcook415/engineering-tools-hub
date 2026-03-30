import { useState } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function Shell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="appShell">
      <Sidebar isOpen={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      <button
        type="button"
        className={sidebarOpen ? "sidebarOverlay show" : "sidebarOverlay"}
        onClick={() => setSidebarOpen(false)}
        aria-label="Close navigation menu"
      />
      <div className="appMain">
        <Topbar onToggleSidebar={() => setSidebarOpen((v) => !v)} />
        <main className="appContent">{children}</main>
      </div>
    </div>
  );
}
