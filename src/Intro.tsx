import { useState } from "react";
import type { TargetTheme } from "./App.tsx";

/**
 * Intro page. Drop the new art at public/assets/intro/intro-bg.png (full-bleed background);
 * until it exists the page falls back to the brand sky gradient.
 */
export default function Intro({ onPlay }: { onPlay: (theme: TargetTheme) => void }) {
  const [hasArt, setHasArt] = useState(true);

  return (
    <div className="intro-page absolute inset-0 z-50 overflow-hidden flex flex-col items-center justify-center gap-6 p-6 text-center">
      {hasArt && (
        <img
          src="/assets/intro/intro-bg.png"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setHasArt(false)}
        />
      )}

      <span className="intro-star text-4xl" style={{ left: "8%", top: "14%", transform: "rotate(-14deg)" }}>★</span>
      <span className="intro-star text-3xl" style={{ right: "9%", top: "20%", transform: "rotate(15deg)" }}>★</span>
      <span className="intro-star pink text-2xl" style={{ left: "16%", bottom: "16%" }}>★</span>
      <span className="intro-star pink text-2xl" style={{ right: "15%", bottom: "12%" }}>★</span>

      <img
        src="/assets/SVG/logo/logo.svg"
        alt="PLAYY"
        className="relative z-10 h-[28vh] max-h-72 w-auto drop-shadow-[0_2px_2px_rgba(0,0,0,0.45)]"
      />

      <div className="relative z-10">
        <h1 className="text-5xl sm:text-6xl text-white" style={{ WebkitTextStroke: "2px #1b1a6e", textShadow: "0 5px 0 #1b1a6e" }}>
          PlayyKingdom Arcade
        </h1>
        <p className="mt-3 text-lg sm:text-xl" style={{ color: "var(--playy-indigo)" }}>
          Pick a game and start striking!
        </p>
      </div>

      <div className="relative z-10 flex flex-col sm:flex-row gap-5 w-full max-w-xl">
        <button onClick={() => onPlay("fruits")} className="btn-3d btn-3d-amber flex-1 py-5 px-6 text-2xl">
          🍎 Fruit Splat
        </button>
        <button onClick={() => onPlay("balloons")} className="btn-3d btn-3d-pink flex-1 py-5 px-6 text-2xl">
          🎈 Balloon Pop
        </button>
      </div>
    </div>
  );
}
