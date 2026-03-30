import { Routes, Route, Navigate } from "react-router-dom";
import Shell from "./layout/Shell";
import Home from "../pages/Home";
import ToolPage from "../pages/ToolPage";

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tools/:slug" element={<ToolPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}