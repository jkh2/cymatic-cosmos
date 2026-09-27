import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./app.css";
import { Console } from "@/components/cosmos/console";
import { Stage } from "@/components/cosmos/stage";

function App() {
  return (
    <main className="relative h-dvh overflow-hidden bg-void text-ink">
      <p className="sr-only">
        Twelve polyrhythmic orbits stir a Navier–Stokes smoke field. Play to sound the center. Drag to stir.
      </p>
      <Stage />
      <Console />
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
