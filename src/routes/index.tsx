import { createFileRoute } from "@tanstack/react-router";
import { Console } from "@/components/cosmos/console";
import { Stage } from "@/components/cosmos/stage";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="relative h-dvh overflow-hidden bg-void text-ink">
      <p className="sr-only">
        Twelve polyrhythmic orbits stir a Navier–Stokes smoke field. Play to sound the center. Drag to add ink.
      </p>
      <Stage />
      <Console />
    </main>
  );
}
