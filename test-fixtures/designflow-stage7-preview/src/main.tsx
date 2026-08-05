import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Header } from "./Header";
import "./style.css";

function App() {
  return (
    <main data-designflow-fixture="stage7-preview">
      <Header />
      <section className="content" data-designflow-region="content">
        <p className="eyebrow">Spendly</p>
        <h1>Simple spending, clearly understood.</h1>
        <p className="lede">A deterministic local preview for real-reference visual validation.</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
