/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Volume2,
  VolumeX,
  RotateCcw,
  Code,
  Download,
  Copy,
  Check,
  Crosshair,
  Sparkles,
  Bomb as BombIcon,
  Timer,
  Trophy,
  ExternalLink,
  Target,
  Flame
} from "lucide-react";

// ==========================================
// GAME CONSTANTS
// ==========================================
const GAME_DURATION_SEC = 60;
const COMBO_WINDOW_SEC = 2.0; // Quick succession window for score multipliers
const GRAVITY_FRUITS = 980;
const GRAVITY_BALLOONS = 740; // Floater gravity for carnival balloons
const BALL_STRIKE_RADIUS = 84; // Scaled for 75% larger targets
const SPLAT_LIFESPAN = 2.0; // Juice splats / confetti fade over 2.0s
const BOMB_PENALTY = 200;

export type TargetTheme = "fruits" | "balloons";

interface TargetType {
  name: string;
  color: string;
  accentColor: string;
  points: number;
  radius: number;
  leaf?: boolean;
  stringColor?: string;
}

// 75% Larger Fruit Targets
const FRUIT_TYPES: TargetType[] = [
  { name: "Apple", color: "#ef4444", accentColor: "#f87171", points: 50, radius: 105, leaf: true },
  { name: "Orange", color: "#f97316", accentColor: "#fb923c", points: 60, radius: 98, leaf: true },
  { name: "Banana", color: "#facc15", accentColor: "#fef08a", points: 70, radius: 91, leaf: false },
  { name: "Watermelon", color: "#10b981", accentColor: "#f43f5e", points: 80, radius: 130, leaf: false },
  { name: "Plum", color: "#a855f7", accentColor: "#c084fc", points: 90, radius: 95, leaf: true },
];

// 75% Larger Carnival Balloon Targets
const BALLOON_TYPES: TargetType[] = [
  { name: "Ruby Balloon", color: "#ef4444", accentColor: "#fca5a5", points: 50, radius: 105, stringColor: "#cbd5e1" },
  { name: "Sky Balloon", color: "#0ea5e9", accentColor: "#7dd3fc", points: 60, radius: 98, stringColor: "#cbd5e1" },
  { name: "Gold Balloon", color: "#eab308", accentColor: "#fef08a", points: 70, radius: 91, stringColor: "#cbd5e1" },
  { name: "Emerald Balloon", color: "#10b981", accentColor: "#6ee7b7", points: 80, radius: 130, stringColor: "#cbd5e1" },
  { name: "Magenta Balloon", color: "#ec4899", accentColor: "#fbcfe8", points: 90, radius: 95, stringColor: "#cbd5e1" },
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const flashOverlayRef = useRef<HTMLDivElement | null>(null);

  // High-level UI states
  const [theme, setTheme] = useState<TargetTheme>("fruits");
  const [gameStatus, setGameStatus] = useState<"ready" | "playing" | "gameover">("ready");
  const [score, setScore] = useState<number>(0);
  const [highScore, setHighScore] = useState<number>(() => {
    return parseInt(localStorage.getItem("fruitsplat_highscore") || "0", 10);
  });
  const [timeRemaining, setTimeRemaining] = useState<number>(GAME_DURATION_SEC);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [stats, setStats] = useState({ hits: 0, throws: 0, bombs: 0, maxCombo: 0 });
  const [comboStreak, setComboStreak] = useState<number>(0);

  // Direct DOM refs for 60fps smooth combo timer bar animation (no React re-renders)
  const comboContainerRef = useRef<HTMLDivElement | null>(null);
  const comboProgressBarRef = useRef<HTMLDivElement | null>(null);
  const comboBadgeRef = useRef<HTMLSpanElement | null>(null);
  const comboTextRef = useRef<HTMLSpanElement | null>(null);

  // Developer tool modals
  const [showCodeModal, setShowCodeModal] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [tuioTestActive, setTuioTestActive] = useState<boolean>(false);

  // Engine refs to avoid React re-renders breaking 60fps canvas loop
  const engineRef = useRef({
    status: "ready" as "ready" | "playing" | "gameover",
    theme: "fruits" as TargetTheme,
    score: 0,
    timeRemaining: GAME_DURATION_SEC,
    totalThrows: 0,
    totalHits: 0,
    bombsHit: 0,
    combo: 0,           // Current combo streak multiplier
    comboTimer: 0,      // Time left in current combo window (2.0s)
    maxCombo: 0,        // Round record max combo streak
    spawnTimer: 0,
    bombSpawnTimer: 0,
    shakeIntensity: 0,
    shakeDecay: 18,
    lastFrameTime: performance.now(),
    lastTickSecond: GAME_DURATION_SEC,
    isMuted: false,
    activeFruits: [] as any[],
    juiceSplats: [] as any[],
    floatingScores: [] as any[],
    strikeVisuals: [] as any[],
    width: 0,
    height: 0,
  });

  // Keep theme in sync with engineRef
  useEffect(() => {
    engineRef.current.theme = theme;
  }, [theme]);

  // Web Audio Synth Ref
  const audioCtxRef = useRef<AudioContext | null>(null);

  function getAudioContext() {
    if (!audioCtxRef.current) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        audioCtxRef.current = new AudioCtxClass();
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }

  function playSound(type: "splat" | "pop" | "bomb" | "strike" | "tick" | "start" | "comboBreak", comboLevel: number = 1) {
    if (engineRef.current.isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Pitch factor elevates each consecutive combo hit
      const pitchFactor = 1 + Math.min(comboLevel - 1, 8) * 0.14;

      if (type === "splat") {
        if (engineRef.current.theme === "balloons") {
          // Sharp balloon POP sound: rapid pitch drop + snappy burst
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(820 * pitchFactor, now);
          osc.frequency.exponentialRampToValueAtTime(110 * pitchFactor, now + 0.07);
          gain.gain.setValueAtTime(0.45, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.09);
        } else {
          // Juicy fruit squish pop
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(440 * pitchFactor, now);
          osc.frequency.exponentialRampToValueAtTime(70 * pitchFactor, now + 0.16);
          gain.gain.setValueAtTime(0.35, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.18);
        }

        // Resonant celebratory chord chime for 3x+ combos
        if (comboLevel >= 3) {
          const chime = ctx.createOscillator();
          const chimeGain = ctx.createGain();
          chime.type = "triangle";
          const chimeFreq = 523.25 * Math.pow(1.15, Math.min(comboLevel - 2, 8));
          chime.frequency.setValueAtTime(chimeFreq, now);
          chimeGain.gain.setValueAtTime(0.25, now);
          chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
          chime.connect(chimeGain);
          chimeGain.connect(ctx.destination);
          chime.start(now);
          chime.stop(now + 0.3);
        }
      } else if (type === "pop") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(820 * pitchFactor, now);
        osc.frequency.exponentialRampToValueAtTime(110 * pitchFactor, now + 0.07);
        gain.gain.setValueAtTime(0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.09);

        if (comboLevel >= 3) {
          const chime = ctx.createOscillator();
          const chimeGain = ctx.createGain();
          chime.type = "triangle";
          const chimeFreq = 659.25 * Math.pow(1.15, Math.min(comboLevel - 2, 8));
          chime.frequency.setValueAtTime(chimeFreq, now);
          chimeGain.gain.setValueAtTime(0.25, now);
          chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
          chime.connect(chimeGain);
          chimeGain.connect(ctx.destination);
          chime.start(now);
          chime.stop(now + 0.28);
        }
      } else if (type === "comboBreak") {
        // Distinct breaker tone on bomb hit
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.22);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === "bomb") {
        // Heavy explosive sub-bass impact
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(20, now + 0.45);
        gain.gain.setValueAtTime(0.65, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.52);
      } else if (type === "strike") {
        // Physical ball impact against arcade screen glass
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.08);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.09);
      } else if (type === "tick") {
        // Final countdown warning tick
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === "start") {
        // Upbeat chime
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(640, now + 0.2);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
      }
    } catch {
      // Audio error safety
    }
  }

  // ==========================================
  // ISOLATED PHYSICS & HIT ENGINE
  // ==========================================

  function spawnTarget(isBomb = false) {
    const { width, height, theme: currentTheme } = engineRef.current;
    if (width <= 0 || height <= 0) return;

    const gravity = currentTheme === "balloons" ? GRAVITY_BALLOONS : GRAVITY_FRUITS;
    const margin = 130;
    const x = margin + Math.random() * (width - margin * 2);
    const y = height + 70;

    // Apex height around 18% to 48% from top
    const apexY = height * (0.18 + Math.random() * 0.3);
    const dy = apexY - y;
    const vy = -Math.sqrt(2 * gravity * Math.abs(dy));

    // Diagonal trajectory angled toward screen center
    const centerX = width / 2;
    const drift = (centerX - x) * (0.42 + Math.random() * 0.45);
    const timeToApex = Math.abs(vy) / gravity;
    const vx = drift / timeToApex + (Math.random() - 0.5) * 70;

    if (isBomb) {
      engineRef.current.activeFruits.push({
        id: Math.random(),
        isBomb: true,
        name: "Bomb",
        x,
        y,
        vx,
        vy,
        radius: 109,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 3,
        fuseSpark: 0,
        wobble: Math.random() * Math.PI * 2
      });
    } else {
      const pool = currentTheme === "balloons" ? BALLOON_TYPES : FRUIT_TYPES;
      const type = pool[Math.floor(Math.random() * pool.length)];

      engineRef.current.activeFruits.push({
        id: Math.random(),
        isBomb: false,
        name: type.name,
        color: type.color,
        juiceColor: type.accentColor,
        stringColor: type.stringColor,
        points: type.points,
        radius: type.radius,
        leaf: type.leaf,
        x,
        y,
        vx,
        vy,
        rotation: currentTheme === "balloons" ? (Math.random() - 0.5) * 0.3 : Math.random() * Math.PI * 2,
        vRot: currentTheme === "balloons" ? (Math.random() - 0.5) * 0.8 : (Math.random() - 0.5) * 4,
        wobble: Math.random() * Math.PI * 2,
        stringWiggle: Math.random() * Math.PI * 2
      });
    }
  }

  function handleBallStrike(hitX: number, hitY: number) {
    const engine = engineRef.current;
    if (engine.status !== "playing") return;

    engine.totalThrows++;

    // Impact visual ripple on glass
    engine.strikeVisuals.push({
      x: hitX,
      y: hitY,
      radius: 16,
      maxRadius: 52,
      alpha: 0.95,
      lifespan: 0.28
    });
    playSound("strike");

    // Collision check from top of stack downward
    for (let i = engine.activeFruits.length - 1; i >= 0; i--) {
      const target = engine.activeFruits[i];
      const dx = hitX - target.x;
      const dy = hitY - target.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= target.radius + BALL_STRIKE_RADIUS) {
        if (target.isBomb) {
          // BOMB DETONATION
          engine.bombsHit++;
          engine.score -= BOMB_PENALTY;
          setScore(engine.score);

          // Reset combo streak
          if (engine.combo > 1) {
            addFloatingText(target.x, target.y - 60, "COMBO BROKEN!", "#f87171", 44, true);
            playSound("comboBreak");
          }
          engine.combo = 0;
          engine.comboTimer = 0;
          setComboStreak(0);
          if (comboProgressBarRef.current) comboProgressBarRef.current.style.width = "0%";
          if (comboContainerRef.current) comboContainerRef.current.style.opacity = "0";

          triggerScreenFlash("rgba(239, 68, 68, 0.85)");
          engine.shakeIntensity = 28;
          playSound("bomb");

          addFloatingText(target.x, target.y, `-${BOMB_PENALTY}`, "#ef4444", 46, true);
          createBombDebris(target.x, target.y);
          engine.activeFruits.splice(i, 1);
        } else {
          // TARGET SPLAT / POP WITH COMBO MULTIPLIER
          if (engine.comboTimer > 0) {
            engine.combo += 1;
          } else {
            engine.combo = 1;
          }
          engine.comboTimer = COMBO_WINDOW_SEC;
          if (engine.combo > engine.maxCombo) {
            engine.maxCombo = engine.combo;
          }

          const currentCombo = engine.combo;
          const multiplier = currentCombo;
          const earnedPoints = target.points * multiplier;

          engine.totalHits++;
          engine.score += earnedPoints;
          setScore(engine.score);
          setComboStreak(currentCombo);

          if (comboContainerRef.current) {
            comboContainerRef.current.style.opacity = currentCombo >= 2 ? "1" : "0";
          }
          if (comboProgressBarRef.current) {
            comboProgressBarRef.current.style.width = "100%";
          }
          if (comboBadgeRef.current) {
            comboBadgeRef.current.textContent = `${currentCombo}x`;
          }
          if (comboTextRef.current) {
            comboTextRef.current.textContent = currentCombo >= 5 ? "UNSTOPPABLE" : currentCombo >= 4 ? "ULTRA COMBO" : currentCombo >= 3 ? "MEGA COMBO" : "COMBO";
          }

          playSound("splat", currentCombo);

          // Escalating floating text with combo multiplier badges
          let comboLabel = "";
          let textColor = target.juiceColor;
          let fontSize = 38;

          if (currentCombo === 2) {
            comboLabel = " (2x COMBO!)";
            textColor = "#fbbf24";
            fontSize = 44;
          } else if (currentCombo === 3) {
            comboLabel = " (3x MEGA!)";
            textColor = "#f97316";
            fontSize = 48;
          } else if (currentCombo === 4) {
            comboLabel = " (4x ULTRA!)";
            textColor = "#ef4444";
            fontSize = 52;
          } else if (currentCombo >= 5) {
            comboLabel = ` (${currentCombo}x UNSTOPPABLE!)`;
            textColor = "#e879f9";
            fontSize = 56;
          }

          addFloatingText(target.x, target.y, `+${earnedPoints}${comboLabel}`, textColor, fontSize, currentCombo > 1);

          if (engine.theme === "balloons") {
            createBalloonPopBurst(target.x, target.y, target.color, target.juiceColor, target.radius);
          } else {
            createJuiceSplat(target.x, target.y, target.color, target.juiceColor, target.radius);
          }

          engine.activeFruits.splice(i, 1);
        }
        break;
      }
    }
  }

  // Fruit Juice Splat (puddle & droplets)
  function createJuiceSplat(x: number, y: number, mainColor: string, accentColor: string, baseRadius: number) {
    const particleCount = 26 + Math.floor(Math.random() * 8);
    const particles = [];

    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 320;
      particles.push({
        x: x + (Math.random() - 0.5) * (baseRadius * 0.8),
        y: y + (Math.random() - 0.5) * (baseRadius * 0.8),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 8 + Math.random() * 22,
        friction: 0.92,
        dripSpeed: 14 + Math.random() * 35,
        type: "juice"
      });
    }

    const blotches = [];
    const blotchCount = 5 + Math.floor(Math.random() * 4);
    for (let j = 0; j < blotchCount; j++) {
      const rad = baseRadius * (0.45 + Math.random() * 0.75);
      const dist = Math.random() * (baseRadius * 0.7);
      const ang = Math.random() * Math.PI * 2;
      blotches.push({
        offsetX: Math.cos(ang) * dist,
        offsetY: Math.sin(ang) * dist,
        radius: rad
      });
    }

    engineRef.current.juiceSplats.push({
      x,
      y,
      mainColor,
      accentColor,
      particles,
      blotches,
      shreds: [],
      age: 0,
      maxLifespan: SPLAT_LIFESPAN
    });
  }

  // Balloon Pop Burst (Confetti Ribbons & Rubber Shreds)
  function createBalloonPopBurst(x: number, y: number, mainColor: string, accentColor: string, baseRadius: number) {
    const confettiCount = 32 + Math.floor(Math.random() * 10);
    const particles = [];

    for (let i = 0; i < confettiCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 340;
      const isRibbon = Math.random() > 0.5;
      particles.push({
        x: x + (Math.random() - 0.5) * (baseRadius * 0.5),
        y: y + (Math.random() - 0.5) * (baseRadius * 0.5),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        width: isRibbon ? 12 + Math.random() * 12 : 8 + Math.random() * 8,
        height: isRibbon ? 5 + Math.random() * 6 : 8 + Math.random() * 8,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 12,
        color: Math.random() > 0.3 ? mainColor : (Math.random() > 0.5 ? accentColor : "#fef08a"),
        friction: 0.93,
        dripSpeed: 25 + Math.random() * 40,
        type: "confetti"
      });
    }

    const shreds = [];
    const shredCount = 6 + Math.floor(Math.random() * 4);
    for (let j = 0; j < shredCount; j++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 200;
      shreds.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: baseRadius * (0.2 + Math.random() * 0.25),
        angle: Math.random() * Math.PI * 2,
        color: mainColor
      });
    }

    engineRef.current.juiceSplats.push({
      x,
      y,
      mainColor,
      accentColor,
      particles,
      blotches: [],
      shreds,
      age: 0,
      maxLifespan: SPLAT_LIFESPAN
    });
  }

  function createBombDebris(x: number, y: number) {
    const debrisCount = 36;
    const particles = [];
    for (let i = 0; i < debrisCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 140 + Math.random() * 400;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 8 + Math.random() * 14,
        width: 8 + Math.random() * 14,
        height: 8 + Math.random() * 14,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 14,
        color: Math.random() > 0.4 ? "#f97316" : (Math.random() > 0.5 ? "#ef4444" : "#1f2937"),
        friction: 0.94,
        dripSpeed: 30,
        type: "confetti"
      });
    }

    engineRef.current.juiceSplats.push({
      x,
      y,
      mainColor: "#ef4444",
      accentColor: "#f97316",
      particles,
      blotches: [],
      shreds: [],
      age: 0,
      maxLifespan: 1.2
    });
  }

  function addFloatingText(x: number, y: number, text: string, color: string, fontSize: number, isBold: boolean) {
    engineRef.current.floatingScores.push({
      x,
      y,
      text,
      color,
      fontSize,
      isBold,
      vy: -75,
      alpha: 1.0,
      age: 0,
      lifespan: 1.2
    });
  }

  function triggerScreenFlash(color: string) {
    if (flashOverlayRef.current) {
      flashOverlayRef.current.style.backgroundColor = color;
      flashOverlayRef.current.style.opacity = "1";
      setTimeout(() => {
        if (flashOverlayRef.current) {
          flashOverlayRef.current.style.opacity = "0";
        }
      }, 140);
    }
  }

  useEffect(() => {
    (window as any).simulateTuioStrike = (x: number, y: number) => {
      handleBallStrike(x, y);
    };
    return () => {
      delete (window as any).simulateTuioStrike;
    };
  }, []);

  useEffect(() => {
    if (!tuioTestActive || gameStatus !== "playing") return;
    const interval = setInterval(() => {
      const engine = engineRef.current;
      if (engine.activeFruits.length > 0) {
        const target = engine.activeFruits[Math.floor(Math.random() * engine.activeFruits.length)];
        const scatterX = target.x + (Math.random() - 0.5) * 30;
        const scatterY = target.y + (Math.random() - 0.5) * 30;
        handleBallStrike(scatterX, scatterY);
      }
    }, 600);
    return () => clearInterval(interval);
  }, [tuioTestActive, gameStatus]);

  useEffect(() => {
    engineRef.current.isMuted = isMuted;
  }, [isMuted]);

  const startNewGame = () => {
    getAudioContext();
    playSound("start");

    const engine = engineRef.current;
    engine.status = "playing";
    engine.score = 0;
    engine.timeRemaining = GAME_DURATION_SEC;
    engine.totalThrows = 0;
    engine.totalHits = 0;
    engine.bombsHit = 0;
    engine.combo = 0;
    engine.comboTimer = 0;
    engine.maxCombo = 0;
    engine.spawnTimer = 0;
    engine.bombSpawnTimer = 0;
    engine.shakeIntensity = 0;
    engine.activeFruits = [];
    engine.juiceSplats = [];
    engine.floatingScores = [];
    engine.strikeVisuals = [];
    engine.lastFrameTime = performance.now();
    engine.lastTickSecond = GAME_DURATION_SEC;

    setScore(0);
    setComboStreak(0);
    if (comboProgressBarRef.current) comboProgressBarRef.current.style.width = "0%";
    if (comboContainerRef.current) comboContainerRef.current.style.opacity = "0";
    setTimeRemaining(GAME_DURATION_SEC);
    setGameStatus("playing");
  };

  // Switch variation theme seamlessly
  const switchTheme = (newTheme: TargetTheme) => {
    setTheme(newTheme);
    engineRef.current.theme = newTheme;
    // Clear flying items so the new variation starts immediately
    engineRef.current.activeFruits = [];
  };

  // ==========================================
  // CANVAS MOUNT & 60FPS LOOP
  // ==========================================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      engineRef.current.width = w;
      engineRef.current.height = h;
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    const onPointerDown = (e: PointerEvent) => {
      getAudioContext();
      const rect = canvas.getBoundingClientRect();
      handleBallStrike(e.clientX - rect.left, e.clientY - rect.top);
    };

    const onTouchStart = (e: TouchEvent) => {
      getAudioContext();
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        handleBallStrike(t.clientX - rect.left, t.clientY - rect.top);
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });

    const loop = (currentTime: number) => {
      const engine = engineRef.current;
      const dt = Math.min((currentTime - engine.lastFrameTime) / 1000, 0.05);
      engine.lastFrameTime = currentTime;

      const w = engine.width;
      const h = engine.height;
      const gravity = engine.theme === "balloons" ? GRAVITY_BALLOONS : GRAVITY_FRUITS;

      if (engine.status === "playing") {
        engine.timeRemaining -= dt;

        // Combo countdown and progress bar update (direct DOM for 60fps)
        if (engine.comboTimer > 0) {
          engine.comboTimer -= dt;
          const progressPct = Math.max(0, (engine.comboTimer / COMBO_WINDOW_SEC) * 100);
          if (comboProgressBarRef.current) {
            comboProgressBarRef.current.style.width = `${progressPct}%`;
          }
          if (engine.comboTimer <= 0) {
            engine.comboTimer = 0;
            engine.combo = 0;
            setComboStreak(0);
            if (comboContainerRef.current) {
              comboContainerRef.current.style.opacity = "0";
            }
          }
        }

        const currentSec = Math.ceil(engine.timeRemaining);
        if (currentSec <= 10 && currentSec !== engine.lastTickSecond && currentSec > 0) {
          playSound("tick");
          engine.lastTickSecond = currentSec;
        }

        setTimeRemaining(Math.max(0, currentSec));

        if (engine.timeRemaining <= 0) {
          engine.timeRemaining = 0;
          engine.status = "gameover";
          setGameStatus("gameover");
          setScore(engine.score);
          setStats({
            hits: engine.totalHits,
            throws: engine.totalThrows,
            bombs: engine.bombsHit,
            maxCombo: engine.maxCombo,
          });

          setHighScore((prev) => {
            const next = Math.max(prev, engine.score);
            localStorage.setItem("fruitsplat_highscore", next.toString());
            return next;
          });
        }

        // Paced target spawn rhythm
        engine.spawnTimer += dt;
        if (engine.spawnTimer >= 1.65) {
          engine.spawnTimer = 0;
          if (engine.activeFruits.length < 3) {
            spawnTarget(false);
            if (engine.activeFruits.length <= 1 && Math.random() < 0.25) {
              setTimeout(() => {
                if (engineRef.current.status === "playing" && engineRef.current.activeFruits.length < 3) {
                  spawnTarget(false);
                }
              }, 180);
            }
          }
        }

        // Paced bomb spawn rhythm
        engine.bombSpawnTimer += dt;
        if (engine.bombSpawnTimer >= 6.0) {
          engine.bombSpawnTimer = 0;
          const hasActiveBomb = engine.activeFruits.some((f) => f.isBomb);
          if (!hasActiveBomb && engine.activeFruits.length < 4 && Math.random() < 0.65) {
            spawnTarget(true);
          }
        }
      }

      // Physics update: active targets
      for (let i = engine.activeFruits.length - 1; i >= 0; i--) {
        const f = engine.activeFruits[i];
        f.x += f.vx * dt;
        f.vy += gravity * dt;
        f.y += f.vy * dt;

        if (engine.theme === "balloons" && !f.isBomb) {
          f.wobble = (f.wobble || 0) + dt * 3;
          f.x += Math.sin(f.wobble) * 22 * dt; // gentle balloon sway
          f.rotation = Math.sin(f.wobble) * 0.12;
          if (f.stringWiggle !== undefined) f.stringWiggle += dt * 5;
        } else {
          f.rotation += f.vRot * dt;
        }

        if (f.isBomb) {
          f.fuseSpark = (f.fuseSpark + dt * 15) % (Math.PI * 2);
        }

        if (f.y > h + 160 && f.vy > 0) {
          engine.activeFruits.splice(i, 1);
        }
      }

      // Splats / Confetti update
      for (let i = engine.juiceSplats.length - 1; i >= 0; i--) {
        const burst = engine.juiceSplats[i];
        burst.age += dt;

        for (let j = 0; j < burst.particles.length; j++) {
          const p = burst.particles[j];
          p.x += p.vx * dt;
          p.y += p.vy * dt + p.dripSpeed * dt;
          p.vx *= p.friction;
          p.vy *= p.friction;
          if (p.rotation !== undefined) {
            p.rotation += p.rotSpeed * dt;
          }
        }

        if (burst.shreds) {
          for (let s = 0; s < burst.shreds.length; s++) {
            const sh = burst.shreds[s];
            sh.x += sh.vx * dt;
            sh.y += sh.vy * dt + 15 * dt;
            sh.vx *= 0.94;
            sh.vy *= 0.94;
          }
        }

        if (burst.age >= burst.maxLifespan) {
          engine.juiceSplats.splice(i, 1);
        }
      }

      // Floating scores
      for (let i = engine.floatingScores.length - 1; i >= 0; i--) {
        const fs = engine.floatingScores[i];
        fs.age += dt;
        fs.y += fs.vy * dt;
        fs.alpha = Math.max(0, 1 - fs.age / fs.lifespan);
        if (fs.age >= fs.lifespan) {
          engine.floatingScores.splice(i, 1);
        }
      }

      // Strike rings
      for (let i = engine.strikeVisuals.length - 1; i >= 0; i--) {
        const ring = engine.strikeVisuals[i];
        ring.radius += (ring.maxRadius - ring.radius) * (dt * 18);
        ring.alpha -= dt / ring.lifespan;
        if (ring.alpha <= 0) {
          engine.strikeVisuals.splice(i, 1);
        }
      }

      // Camera shake decay
      if (engine.shakeIntensity > 0) {
        engine.shakeIntensity = Math.max(0, engine.shakeIntensity - engine.shakeDecay * dt * 60);
      }

      // ==========================================
      // RENDER CANVAS
      // ==========================================
      ctx.save();

      if (engine.shakeIntensity > 0) {
        const offsetX = (Math.random() - 0.5) * engine.shakeIntensity;
        const offsetY = (Math.random() - 0.5) * engine.shakeIntensity;
        ctx.translate(offsetX, offsetY);
      }

      // Background color matches theme
      ctx.fillStyle = engine.theme === "balloons" ? "#070d18" : "#090d16";
      ctx.fillRect(0, 0, w, h);

      // Target rings backdrop
      const cx = w / 2;
      const cy = h * 0.44;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
      ctx.lineWidth = 1;
      for (let r = 120; r < Math.max(w, h); r += 160) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Bottom launch stage ambient glow
      const floorGrad = ctx.createLinearGradient(0, h, 0, h - 140);
      const glowColor = engine.theme === "balloons" ? "rgba(244, 63, 94, 0.08)" : "rgba(249, 115, 22, 0.08)";
      floorGrad.addColorStop(0, glowColor);
      floorGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = floorGrad;
      ctx.fillRect(0, h - 140, w, 140);

      // 1. Draw Persistent Splats or Confetti Bursts
      for (let i = 0; i < engine.juiceSplats.length; i++) {
        const burst = engine.juiceSplats[i];
        const alpha = Math.max(0, 1 - burst.age / burst.maxLifespan);

        ctx.save();
        ctx.globalAlpha = alpha;

        // Draw central blotches (for fruits)
        if (burst.blotches && burst.blotches.length > 0) {
          ctx.fillStyle = burst.mainColor;
          for (let b = 0; b < burst.blotches.length; b++) {
            const blotch = burst.blotches[b];
            ctx.beginPath();
            ctx.arc(burst.x + blotch.offsetX, burst.y + blotch.offsetY, blotch.radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Draw rubber shreds (for balloons)
        if (burst.shreds && burst.shreds.length > 0) {
          ctx.fillStyle = burst.mainColor;
          for (let s = 0; s < burst.shreds.length; s++) {
            const sh = burst.shreds[s];
            ctx.save();
            ctx.translate(sh.x, sh.y);
            ctx.rotate(sh.angle);
            ctx.beginPath();
            ctx.moveTo(-sh.size * 0.5, 0);
            ctx.lineTo(sh.size * 0.5, -sh.size * 0.3);
            ctx.lineTo(sh.size * 0.2, sh.size * 0.4);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }

        // Draw particles (either round juice droplets or spinning confetti ribbons)
        for (let p = 0; p < burst.particles.length; p++) {
          const part = burst.particles[p];
          if (part.type === "confetti") {
            ctx.save();
            ctx.translate(part.x, part.y);
            ctx.rotate(part.rotation || 0);
            ctx.fillStyle = part.color || burst.accentColor;
            ctx.fillRect(-part.width / 2, -part.height / 2, part.width, part.height);
            ctx.restore();
          } else {
            ctx.fillStyle = burst.accentColor;
            ctx.beginPath();
            ctx.arc(part.x, part.y, Math.max(1, part.size * (0.4 + 0.6 * alpha)), 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.restore();
      }

      // 2. Draw Active Targets (Fruits vs Balloons)
      for (let i = 0; i < engine.activeFruits.length; i++) {
        const f = engine.activeFruits[i];
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rotation);

        if (f.isBomb) {
          // BOMB RENDERING
          ctx.fillStyle = "#18181b";
          ctx.beginPath();
          ctx.arc(0, 0, f.radius, 0, Math.PI * 2);
          ctx.fill();

          ctx.lineWidth = Math.max(3, f.radius * 0.07);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
          ctx.stroke();

          // Skull / danger hazard center
          ctx.fillStyle = "#ef4444";
          ctx.beginPath();
          ctx.arc(0, 0, f.radius * 0.38, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(0, 0, f.radius * 0.12, 0, Math.PI * 2);
          ctx.fill();

          // Spikes if balloon mode
          if (engine.theme === "balloons") {
            ctx.fillStyle = "#3f3f46";
            for (let sp = 0; sp < 8; sp++) {
              const spAng = (sp / 8) * Math.PI * 2;
              ctx.beginPath();
              ctx.arc(Math.cos(spAng) * f.radius, Math.sin(spAng) * f.radius, f.radius * 0.12, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          // Cap & fuse
          const capW = f.radius * 0.34;
          const capH = f.radius * 0.22;
          ctx.fillStyle = "#71717a";
          ctx.fillRect(-capW / 2, -f.radius - capH + 2, capW, capH);

          ctx.strokeStyle = "#d97706";
          ctx.lineWidth = Math.max(3.5, f.radius * 0.08);
          ctx.beginPath();
          ctx.moveTo(0, -f.radius - capH + 2);
          ctx.quadraticCurveTo(f.radius * 0.28, -f.radius - capH - 14, f.radius * 0.12, -f.radius - capH - 24);
          ctx.stroke();

          const sparkSize = 6 + Math.sin(f.fuseSpark) * 4;
          ctx.fillStyle = "#facc15";
          ctx.beginPath();
          ctx.arc(f.radius * 0.12, -f.radius - capH - 25, sparkSize, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#f97316";
          ctx.beginPath();
          ctx.arc(f.radius * 0.12, -f.radius - capH - 25, sparkSize * 0.6, 0, Math.PI * 2);
          ctx.fill();
        } else if (engine.theme === "balloons") {
          // BALLOON RENDERING
          // 1. Balloon String trailing below
          ctx.strokeStyle = f.stringColor || "#cbd5e1";
          ctx.lineWidth = Math.max(2.5, f.radius * 0.035);
          ctx.beginPath();
          ctx.moveTo(0, f.radius * 0.95);
          const wiggleX = Math.sin(f.stringWiggle || 0) * 18;
          ctx.bezierCurveTo(-15, f.radius * 1.3, 15, f.radius * 1.6, wiggleX, f.radius * 2.0);
          ctx.stroke();

          // 2. Balloon Knot at bottom
          ctx.fillStyle = f.color;
          ctx.beginPath();
          ctx.moveTo(-10, f.radius * 0.88);
          ctx.lineTo(10, f.radius * 0.88);
          ctx.lineTo(14, f.radius * 1.02);
          ctx.lineTo(-14, f.radius * 1.02);
          ctx.closePath();
          ctx.fill();

          // 3. Balloon Oval / Egg Body
          ctx.beginPath();
          ctx.ellipse(0, -f.radius * 0.06, f.radius * 0.82, f.radius * 0.98, 0, 0, Math.PI * 2);
          ctx.fillStyle = f.color;
          ctx.fill();

          // Specular highlight gloss sheen
          ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
          ctx.beginPath();
          ctx.ellipse(-f.radius * 0.32, -f.radius * 0.38, f.radius * 0.18, f.radius * 0.42, -Math.PI / 5, 0, Math.PI * 2);
          ctx.fill();

          // Secondary bounce light
          ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
          ctx.beginPath();
          ctx.arc(f.radius * 0.35, f.radius * 0.38, f.radius * 0.16, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // FRUIT RENDERING
          ctx.fillStyle = f.color;
          ctx.beginPath();
          ctx.arc(0, 0, f.radius, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
          ctx.lineWidth = Math.max(3.5, f.radius * 0.08);
          ctx.beginPath();
          ctx.arc(-f.radius * 0.28, -f.radius * 0.28, f.radius * 0.58, Math.PI * 1.1, Math.PI * 1.7);
          ctx.stroke();

          if (f.leaf) {
            ctx.fillStyle = "#22c55e";
            ctx.beginPath();
            ctx.ellipse(f.radius * 0.28, -f.radius * 0.88, f.radius * 0.35, f.radius * 0.18, Math.PI / 4, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = "#78350f";
            ctx.lineWidth = Math.max(3, f.radius * 0.08);
            ctx.beginPath();
            ctx.moveTo(0, -f.radius + 4);
            ctx.lineTo(f.radius * 0.06, -f.radius - 14);
            ctx.stroke();
          }

          if (f.name === "Orange") {
            ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
            ctx.beginPath();
            ctx.arc(0, 0, f.radius * 0.12, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.restore();
      }

      // 3. Draw strike impact rings
      for (let i = 0; i < engine.strikeVisuals.length; i++) {
        const s = engine.strikeVisuals[i];
        ctx.save();
        ctx.globalAlpha = Math.max(0, s.alpha);

        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.beginPath();
        ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

      // 4. Draw floating text scores
      for (let i = 0; i < engine.floatingScores.length; i++) {
        const fs = engine.floatingScores[i];
        ctx.save();
        ctx.globalAlpha = fs.alpha;
        ctx.font = `${fs.isBold ? "900" : "800"} ${fs.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
        ctx.shadowBlur = 10;
        ctx.lineWidth = Math.max(3, fs.fontSize * 0.1);
        ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
        ctx.strokeText(fs.text, fs.x, fs.y);
        ctx.fillStyle = fs.color;
        ctx.fillText(fs.text, fs.x, fs.y);
        ctx.restore();
      }

      ctx.restore();

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("touchstart", onTouchStart);
    };
  }, []);

  const handleDownloadFile = (fileName: string) => {
    const link = document.createElement("a");
    link.href = `/${fileName}`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyCode = async (fileName: string) => {
    try {
      const resp = await fetch(`/${fileName}`);
      const htmlText = await resp.text();
      await navigator.clipboard.writeText(htmlText);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {}
  };

  const accuracy = stats.throws > 0 ? Math.round((stats.hits / stats.throws) * 100) : 0;
  const isBalloons = theme === "balloons";

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans select-none text-slate-100">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block cursor-crosshair z-0" />
      <div ref={flashOverlayRef} className="absolute inset-0 pointer-events-none z-20 opacity-0 transition-opacity duration-100" />

      {/* Top HUD Bar */}
      <header className="absolute top-0 left-0 w-full h-20 flex items-center justify-between px-6 z-10 pointer-events-none bg-gradient-to-b from-slate-950/90 via-slate-950/40 to-transparent">
        {/* Remaining Time HUD */}
        <div className="flex items-center gap-3">
          <div className="pointer-events-auto flex items-center gap-3 bg-slate-900/90 border border-white/10 rounded-2xl px-5 py-2.5 shadow-xl backdrop-blur-md">
            <Timer className={`w-5 h-5 ${timeRemaining <= 10 ? "text-red-400 animate-pulse" : "text-sky-400"}`} />
            <div>
              <div className="text-[10px] font-bold tracking-wider uppercase text-slate-400 leading-tight">
                Remaining Time
              </div>
              <div className={`text-2xl font-black tabular-nums leading-none ${timeRemaining <= 10 ? "text-red-500 scale-105" : "text-sky-400"}`}>
                {timeRemaining}s
              </div>
            </div>
          </div>

          {/* Theme Variation Switcher Pill */}
          <div className="pointer-events-auto flex items-center p-1 bg-slate-900/90 border border-white/10 rounded-2xl shadow-xl backdrop-blur-md">
            <button
              onClick={() => switchTheme("fruits")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                !isBalloons
                  ? "bg-gradient-to-r from-orange-500 to-amber-500 text-slate-950 shadow-md shadow-orange-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span>🍎</span>
              <span>Fruits</span>
            </button>
            <button
              onClick={() => switchTheme("balloons")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                isBalloons
                  ? "bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md shadow-pink-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span>🎈</span>
              <span>Balloons</span>
            </button>
          </div>

          {highScore > 0 && (
            <div className="hidden lg:flex pointer-events-auto items-center gap-2 bg-slate-900/75 border border-white/10 rounded-2xl px-4 py-2.5 shadow-lg backdrop-blur-md">
              <Trophy className="w-4 h-4 text-amber-400" />
              <div>
                <div className="text-[9px] font-bold tracking-wider uppercase text-slate-400 leading-tight">Best</div>
                <div className="text-sm font-black text-amber-300 tabular-nums">{highScore}</div>
              </div>
            </div>
          )}
        </div>

        {/* Global Score HUD & Controls */}
        <div className="flex items-center gap-3 pointer-events-auto">
          {/* Dynamic Combo Multiplier Card */}
          <div
            ref={comboContainerRef}
            style={{ opacity: 0 }}
            className="flex items-center gap-2.5 bg-gradient-to-r from-amber-500/20 via-orange-500/25 to-red-500/20 border border-amber-500/40 rounded-2xl px-4 py-2 shadow-xl backdrop-blur-md transition-opacity duration-150"
          >
            <Flame className="w-5 h-5 text-amber-400 animate-bounce" />
            <div>
              <div className="flex items-center gap-1.5 leading-tight">
                <span ref={comboTextRef} className="text-[10px] font-black uppercase tracking-wider text-amber-300">
                  COMBO
                </span>
                <span ref={comboBadgeRef} className="text-xs font-black text-white px-1.5 py-0.5 bg-amber-500/40 border border-amber-400/30 rounded-md tabular-nums">
                  {comboStreak > 1 ? `${comboStreak}x` : "1x"}
                </span>
              </div>
              {/* Dynamic 60fps draining progress bar */}
              <div className="w-20 h-1.5 bg-black/40 rounded-full mt-1 overflow-hidden border border-white/10">
                <div
                  ref={comboProgressBarRef}
                  className="h-full bg-gradient-to-r from-amber-400 via-orange-400 to-red-500 rounded-full transition-none"
                  style={{ width: "0%" }}
                />
              </div>
            </div>
          </div>

          <button
            onClick={() => setTuioTestActive(!tuioTestActive)}
            title="Toggle TUIO Auto-Strike Simulator"
            className={`hidden md:flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${
              tuioTestActive
                ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-lg shadow-emerald-500/20"
                : "bg-slate-900/80 border-white/10 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Target className={`w-3.5 h-3.5 ${tuioTestActive ? "animate-spin text-emerald-400" : ""}`} />
            <span>TUIO Auto-Strike: {tuioTestActive ? "ON" : "OFF"}</span>
          </button>

          <div className="flex items-center gap-3 bg-slate-900/90 border border-white/10 rounded-2xl px-5 py-2.5 shadow-xl backdrop-blur-md">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <div>
              <div className="text-[10px] font-bold tracking-wider uppercase text-slate-400 leading-tight">Total Score</div>
              <div className="text-2xl font-black text-amber-400 tabular-nums leading-none">{score}</div>
            </div>
          </div>

          <button
            onClick={() => setShowCodeModal(true)}
            title="Single-File HTML & TUIO Exports"
            className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-900/90 border border-white/10 text-slate-200 hover:bg-slate-800 hover:border-white/20 transition-all shadow-lg cursor-pointer"
          >
            <Code className="w-4 h-4 text-sky-400" />
          </button>

          <button
            onClick={() => {
              getAudioContext();
              setIsMuted(!isMuted);
            }}
            title={isMuted ? "Unmute Sound" : "Mute Sound"}
            className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-900/90 border border-white/10 text-slate-200 hover:bg-slate-800 hover:border-white/20 transition-all shadow-lg cursor-pointer"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>
        </div>
      </header>

      {/* Title / Ready Modal */}
      {gameStatus === "ready" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/75 backdrop-blur-md p-6">
          <div className="w-full max-w-md bg-gradient-to-b from-slate-900/95 to-slate-950/95 border border-white/15 rounded-3xl p-8 text-center shadow-2xl shadow-orange-500/10">
            <div className="flex justify-center mb-3">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg text-3xl ${
                isBalloons
                  ? "bg-gradient-to-tr from-pink-500 to-rose-600 shadow-pink-500/30"
                  : "bg-gradient-to-tr from-amber-500 to-orange-500 shadow-orange-500/30"
              }`}>
                {isBalloons ? "🎈" : "🍎"}
              </div>
            </div>

            <h1 className={`text-4xl font-black tracking-tight bg-clip-text text-transparent ${
              isBalloons
                ? "bg-gradient-to-r from-pink-400 via-rose-300 to-sky-400"
                : "bg-gradient-to-r from-orange-400 via-amber-300 to-red-500"
            }`}>
              {isBalloons ? "BALLOON POP" : "FRUIT SPLAT"}
            </h1>
            <p className="text-sm text-slate-400 mt-2 mb-6 leading-relaxed">
              Amusement Park Ball-Strike Simulator.<br />
              {isBalloons ? "Throw balls at giant carnival balloons to pop confetti!" : "Throw balls at flying fruits to splat juice on the screen!"}
            </p>

            {/* Variation Picker Tabs */}
            <div className="flex gap-2 p-1.5 bg-slate-950/80 border border-white/10 rounded-2xl mb-6">
              <button
                onClick={() => switchTheme("fruits")}
                className={`flex-1 py-2.5 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  !isBalloons
                    ? "bg-gradient-to-r from-orange-500 to-amber-500 text-slate-950 shadow-md"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <span>🍎</span>
                <span>Fruit Splat</span>
              </button>
              <button
                onClick={() => switchTheme("balloons")}
                className={`flex-1 py-2.5 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  isBalloons
                    ? "bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <span>🎈</span>
                <span>Balloon Pop</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-6 text-left">
              <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-2.5">
                <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 mb-0.5">
                  <Sparkles className="w-3 h-3" /> Hit
                </div>
                <div className="text-xs font-extrabold text-slate-100">+50 to +90</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Base score</div>
              </div>

              <div className="bg-white/[0.04] border border-amber-500/30 rounded-2xl p-2.5">
                <div className="flex items-center gap-1 text-[11px] font-bold text-amber-400 mb-0.5">
                  <Flame className="w-3 h-3" /> Combo
                </div>
                <div className="text-xs font-extrabold text-amber-300">2x, 3x, 4x...</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Quick hits</div>
              </div>

              <div className="bg-white/[0.04] border border-red-500/20 rounded-2xl p-2.5">
                <div className="flex items-center gap-1 text-[11px] font-bold text-red-400 mb-0.5">
                  <BombIcon className="w-3 h-3" /> Bomb
                </div>
                <div className="text-xs font-extrabold text-red-400">-200 pts</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Resets combo</div>
              </div>
            </div>

            <button
              onClick={startNewGame}
              className={`w-full py-4 px-6 rounded-2xl text-slate-950 font-black text-lg tracking-wide shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer ${
                isBalloons
                  ? "bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 text-white shadow-pink-500/30"
                  : "bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-slate-950 shadow-orange-500/30"
              }`}
            >
              START {isBalloons ? "POPPING" : "GAME"} (60s)
            </button>

            <div className="mt-4 flex items-center justify-center gap-2 text-[11px] font-medium text-sky-400/90 bg-sky-950/40 border border-sky-500/20 py-1.5 px-3 rounded-full">
              <Crosshair className="w-3.5 h-3.5" />
              <span>TUIO compatible · window.simulateTuioStrike(x, y)</span>
            </div>
          </div>
        </div>
      )}

      {/* Time's Up Screen Modal */}
      {gameStatus === "gameover" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-6">
          <div className="w-full max-w-md bg-gradient-to-b from-slate-900/95 to-slate-950/95 border border-white/15 rounded-3xl p-8 text-center shadow-2xl">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-sky-500/20 text-sky-400 mb-3 border border-sky-500/30">
              <Trophy className="w-7 h-7" />
            </div>

            <h2 className="text-3xl font-black text-white tracking-tight">TIME'S UP!</h2>
            <p className="text-xs text-slate-400 mt-1 mb-6">Amusement park ball-strike performance report:</p>

            <div className="grid grid-cols-2 gap-3 mb-6 text-left">
              <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-3.5">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Final Score</div>
                <div className="text-2xl font-black text-amber-400 tabular-nums">{score}</div>
              </div>

              <div className="bg-white/[0.04] border border-amber-500/30 rounded-2xl p-3.5">
                <div className="text-[10px] uppercase font-bold tracking-wider text-amber-300 flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-amber-400" /> Max Combo
                </div>
                <div className="text-2xl font-black text-amber-400 tabular-nums">{stats.maxCombo > 1 ? `${stats.maxCombo}x Streak` : "1x"}</div>
              </div>

              <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-3.5">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">{isBalloons ? "Balloons Popped" : "Fruits Splatted"}</div>
                <div className="text-2xl font-black text-sky-400 tabular-nums">{stats.hits}</div>
              </div>

              <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-3.5">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Bombs Triggered</div>
                <div className="text-2xl font-black text-red-400 tabular-nums">{stats.bombs}</div>
              </div>

              <div className="col-span-2 bg-white/[0.04] border border-white/10 rounded-2xl p-3.5 flex items-center justify-between">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Strike Accuracy</div>
                <div className="text-2xl font-black text-emerald-400 tabular-nums">{accuracy}%</div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={startNewGame}
                className={`flex-1 py-4 px-6 rounded-2xl font-black text-base tracking-wide shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 ${
                  isBalloons
                    ? "bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 text-white shadow-pink-500/25"
                    : "bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-slate-950 shadow-orange-500/25"
                }`}
              >
                <RotateCcw className="w-4 h-4 stroke-[2.5]" />
                <span>PLAY AGAIN</span>
              </button>

              <button
                onClick={() => setShowCodeModal(true)}
                className="px-4 py-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 transition-all cursor-pointer"
                title="Single-File HTML Export"
              >
                <Download className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Standalone Single-File HTML & TUIO Modal */}
      {showCodeModal && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-6">
          <div className="w-full max-w-2xl bg-slate-900 border border-white/15 rounded-3xl p-6 sm:p-8 flex flex-col max-h-[90vh] shadow-2xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-black text-white flex items-center gap-2">
                  <Code className="w-5 h-5 text-sky-400" />
                  Single-File HTML Variations & TUIO Integration
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Each variation is built entirely within a single self-contained HTML file (HTML, CSS, and vanilla JS in one &lt;script&gt; block).
                </p>
              </div>
              <button
                onClick={() => setShowCodeModal(false)}
                className="text-slate-400 hover:text-white text-lg p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-950 rounded-2xl p-4 border border-white/10 mb-4 overflow-y-auto text-xs font-mono text-slate-300 space-y-4">
              <div className="p-3 bg-slate-900/90 rounded-xl border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-orange-400 font-bold font-sans text-sm">🍎 Variation 1: Fruit Splat</span>
                  <span className="text-slate-500 text-[11px]">public/fruitsplat.html</span>
                </div>
                <p className="text-slate-400 font-sans text-xs mb-3">
                  Giant fruits, ballistic gravity arcs, and 2-second persistent juice splatter puddles with procedural squish audio.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownloadFile("fruitsplat.html")}
                    className="py-1.5 px-3 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Download fruitsplat.html
                  </button>
                  <a
                    href="/fruitsplat.html"
                    target="_blank"
                    rel="noreferrer"
                    className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 font-bold text-xs flex items-center gap-1.5 transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Preview Raw
                  </a>
                </div>
              </div>

              <div className="p-3 bg-slate-900/90 rounded-xl border border-pink-500/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-pink-400 font-bold font-sans text-sm">🎈 Variation 2: Balloon Pop</span>
                  <span className="text-slate-500 text-[11px]">public/balloonpop.html</span>
                </div>
                <p className="text-slate-400 font-sans text-xs mb-3">
                  Giant carnival balloons with knots, strings, gentle wind sway, snappy pop audio, and 2-second confetti ribbon & rubber shred bursts.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownloadFile("balloonpop.html")}
                    className="py-1.5 px-3 rounded-lg bg-pink-500 hover:bg-pink-400 text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Download balloonpop.html
                  </button>
                  <a
                    href="/balloonpop.html"
                    target="_blank"
                    rel="noreferrer"
                    className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-pink-300 font-bold text-xs flex items-center gap-1.5 transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Preview Raw
                  </a>
                </div>
              </div>

              <div className="p-3 bg-slate-900 rounded-xl border border-white/10 text-emerald-400">
                <code>
                  {"// Clean TUIO coordinate entry hook:"}<br />
                  {"window.simulateTuioStrike(touchX, touchY);"}
                </code>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => handleCopyCode(isBalloons ? "balloonpop.html" : "fruitsplat.html")}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 font-bold text-xs flex items-center gap-2 transition-all cursor-pointer"
              >
                {copiedCode ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                <span>{copiedCode ? "Copied Current HTML!" : `Copy Current (${isBalloons ? "Balloon" : "Fruit"}) Code`}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
