import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="appShell">
      <Sidebar />
      <div className="appMain">
        <Topbar />
        <main className="appContent">{children}</main>
      </div>
    </div>
  );
}