import React from "react";
import { NavLink, Routes, Route } from "react-router-dom";
import { LaurelMark } from "./components/LaurelMark.js";
import { Dashboard } from "./pages/Dashboard.js";
import { NewTrial } from "./pages/NewTrial.js";
import { Agents } from "./pages/Agents.js";
import { TestPacks } from "./pages/TestPacks.js";
import { TrialResults } from "./pages/TrialResults.js";
import { ReceiptDetail } from "./pages/ReceiptDetail.js";
import { Trials } from "./pages/Trials.js";

export function App() {
  return (
    <div className="app-shell">
      <header className="header">
        <div className="brand">
          <span className="laurel-mark"><LaurelMark /></span>
          <div>
            <div className="brand-title">Colosseum</div>
            <div className="brand-tag">Agent Proving Ground</div>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>Arena</NavLink>
          <NavLink to="/new" className={({ isActive }) => (isActive ? "active" : "")}>New Trial</NavLink>
          <NavLink to="/trials" className={({ isActive }) => (isActive ? "active" : "")}>Trials</NavLink>
          <NavLink to="/agents" className={({ isActive }) => (isActive ? "active" : "")}>Agents</NavLink>
          <NavLink to="/packs" className={({ isActive }) => (isActive ? "active" : "")}>Test Packs</NavLink>
        </nav>
      </header>

      <main>
        <div className="arena-floor" aria-hidden="true" />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<NewTrial />} />
          <Route path="/trials" element={<Trials />} />
          <Route path="/trial/:id" element={<TrialResults />} />
          <Route path="/receipt/:trialId/:testId" element={<ReceiptDetail />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/packs" element={<TestPacks />} />
        </Routes>
      </main>

      <footer className="footer">
        Stop guessing if your agent works. Put it in the arena.
      </footer>
    </div>
  );
}
