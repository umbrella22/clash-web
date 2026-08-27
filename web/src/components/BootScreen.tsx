import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { keyframes } from "@emotion/react";
import { Box, Typography, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";

/**
 * Full-screen boot sequence, fused from the boot-preview prototype into the
 * EVE HUD palette. Replays on every page load over the auth handshake, and
 * its wipe transitions into whatever the router settled on underneath — the
 * login terminal or the main console.
 * Timeline (seconds): core .12 → brand .42 → status .7 → progress .9–2.9 →
 * online 2.45 → accent wipe 2.48 → black wipe 2.72 → chrome clear 3.16 →
 * dismiss 3.5.
 * Click or Escape skips; prefers-reduced-motion collapses it to a flash.
 */

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const coreEnter = keyframes`
  from { opacity: 0; transform: translateY(12px) scale(0.94); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`;

const hexReveal = keyframes`
  from { clip-path: inset(0 100% 0 0); }
  to { clip-path: inset(0); }
`;

const coreActivate = keyframes`
  0% { transform: rotate(45deg) scale(0.6); opacity: 0.5; }
  100% { transform: rotate(45deg) scale(1); opacity: 1; }
`;

const coreFlash = keyframes`
  0%, 100% { filter: none; }
  50% { filter: drop-shadow(0 0 12px currentColor); }
`;

const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
`;

const clipReveal = keyframes`
  from { opacity: 0; transform: translateY(10px); clip-path: inset(0 100% 0 0); }
  to { opacity: 1; transform: translateY(0); clip-path: inset(0); }
`;

const statusIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const statusOut = keyframes`
  from { opacity: 1; }
  to { opacity: 0; }
`;

const bootNumbers = keyframes`
  0% { content: "000"; }
  12% { content: "011"; }
  27% { content: "029"; }
  43% { content: "047"; }
  59% { content: "068"; }
  77% { content: "087"; }
  100% { content: "100"; }
`;

const progressGrow = keyframes`
  from { transform: scaleX(0); }
  32% { transform: scaleX(0.18); }
  58% { transform: scaleX(0.53); }
  to { transform: scaleX(1); }
`;

const wipeAccent = keyframes`
  0% { transform: translateX(-101%); }
  52% { transform: translateX(0); }
  100% { transform: translateX(101%); }
`;

const wipeBlack = keyframes`
  0% { transform: translateX(-101%); }
  58% { transform: translateX(0); }
  100% { transform: translateX(101%); }
`;

// The root no longer fades — fading it while the black wipe exited leaked a
// translucent boot ghost over the app. It now merely times the unmount.
const bootDismiss = keyframes`
  0% { visibility: visible; }
  100% { visibility: hidden; }
`;

// Boot chrome hides at 90.4% of the timeline (≈3.16s): the 2.72s black-wipe
// delay plus 58% of its 0.76s run is exactly full coverage, so the wipe then
// exits over the app itself instead of revealing fading boot remnants.
const contentClear = keyframes`
  0%, 90.4% { visibility: visible; }
  90.401%, 100% { visibility: hidden; }
`;

const scan = keyframes`
  from { transform: translateY(-20%); }
  to { transform: translateY(20%); }
`;

const EASE_OUT = "cubic-bezier(0.18, 0.8, 0.2, 1)";
const EASE_SHARP = "cubic-bezier(0.75, 0, 0.18, 1)";
const EASE_DISMISS = "cubic-bezier(0.5, 0, 0.18, 1)";

// Shared with App and LoginPage so the boot layer can hand off to the login
// entrance choreography instead of both playing independently.
export const BOOT_DISMISSED_EVENT = "clash-web-boot-dismissed";

export default function BootScreen({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const [skipping, setSkipping] = useState(false);

  // Deterministic reduced-motion path: CSS overrides alone cannot reliably
  // cancel every staggered child animation, so we unmount almost instantly.
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(onDone, 50);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  const isDark = theme.palette.mode === "dark";
  const accent = theme.palette.primary.main;
  const success = theme.palette.success.main;
  const bg = isDark ? "#02060a" : "#e9eff3";
  const bgDeep = isDark ? "#04090e" : "#dfe7ed";
  const ink = theme.palette.text.primary;
  const inkMuted = theme.palette.text.secondary;

  const skip = useCallback(() => {
    setSkipping((alreadySkipping) => {
      if (alreadySkipping) return alreadySkipping;
      window.setTimeout(onDone, 160);
      return true;
    });
  }, [onDone]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") skip();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [skip]);

  const corner = (position: Record<string, string>) => (
    <Box
      aria-hidden
      sx={{
        position: "fixed",
        width: 24,
        height: 24,
        borderColor: alpha(accent, 0.34),
        borderStyle: "solid",
        zIndex: 3,
        pointerEvents: "none",
        ...position,
      }}
    />
  );

  // Portal to body: as a direct child of #root the overlay loses to the
  // `#root > * { position: relative; z-index: 1 }` rule (ID specificity beats
  // the emotion class), collapsing `fixed` to in-flow content height.
  return createPortal(
    <Box
      role="status"
      aria-label="系统启动中 System booting"
      onClick={skip}
      onAnimationEnd={(event) => {
        // The root's only own animation is the dismiss sequence; child
        // animation events bubble up, so match on the target instead of name.
        if (event.target === event.currentTarget) onDone();
      }}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        overflow: "hidden",
        cursor: "pointer",
        color: ink,
        userSelect: "none",
        fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", "Courier New", monospace',
        ...(skipping
          ? { transitionProperty: "opacity", transitionDuration: "160ms", opacity: 0 }
          : { animation: `${bootDismiss} 3.5s ${EASE_DISMISS} forwards` }),
        "@media (prefers-reduced-motion: reduce)": {
          animationDuration: "0.01s",
        },
      }}
    >
      {/* Backdrop + instruments, hidden as one block at black-wipe coverage
          so the wipe exits over the app, not over boot remnants. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          background: bg,
          animation: `${contentClear} 3.5s linear forwards`,
          "&::before": {
            content: '""',
            position: "absolute",
            inset: 0,
            background: [
              `radial-gradient(circle at 71% 52%, ${alpha(accent, isDark ? 0.3 : 0.22)}, transparent 30%)`,
              isDark
                ? "linear-gradient(90deg, rgba(0,0,0,0.12), rgba(0,0,0,0.32) 55%, rgba(0,0,0,0.55))"
                : "linear-gradient(90deg, rgba(255,255,255,0.2), rgba(255,255,255,0) 60%)",
            ].join(", "),
            opacity: 0.9,
            pointerEvents: "none",
          },
          "@media (prefers-reduced-motion: reduce)": {
            animationDuration: "0.01s",
          },
        }}
      >
      {/* Grid + scanlines */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          opacity: 0.16,
          pointerEvents: "none",
          backgroundImage: [
            `linear-gradient(${alpha(ink, isDark ? 0.07 : 0.08)} 1px, transparent 1px)`,
            `linear-gradient(90deg, ${alpha(ink, isDark ? 0.07 : 0.08)} 1px, transparent 1px)`,
          ].join(", "),
          backgroundSize: "48px 48px",
          "&::after": {
            content: '""',
            position: "absolute",
            inset: 0,
            background: `repeating-linear-gradient(0deg, transparent 0 3px, ${alpha(ink, isDark ? 0.025 : 0.03)} 3px 4px)`,
            animation: `${scan} 7s linear infinite`,
          },
        }}
      />

      {/* Top-left boot index */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          left: { xs: "16px", md: "30px" },
          top: "27px",
          display: "flex",
          alignItems: "flex-start",
          gap: 1.25,
          color: inkMuted,
          fontSize: 9,
          fontWeight: 600,
          lineHeight: 1.55,
          letterSpacing: "0.18em",
          opacity: 0,
          animation: `${fadeInUp} 0.5s 0.4s ease-out forwards`,
          "& i": {
            display: "block",
            width: 22,
            height: 4,
            marginTop: 4,
            backgroundColor: accent,
          },
        }}
      >
        <i />
        <span>
          启动序列 BOOT SEQUENCE
          <br />
          CLASH WEB / CONSOLE
        </span>
      </Box>

      {/* Percent counter (content-driven digits, tabular so no width jitter) */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          left: { xs: "16px", md: "30px" },
          top: "69px",
          color: ink,
          fontWeight: 700,
          fontSize: 30,
          lineHeight: 1,
          opacity: 0,
          animation: `${fadeInUp} 0.5s 0.45s ease-out forwards`,
          "&::before": {
            content: '"%"',
            position: "absolute",
            left: 54,
            top: 4,
            color: accent,
            fontSize: 9,
            fontWeight: 700,
          },
          "&::after": {
            content: '"000"',
            animation: `${bootNumbers} 2.4s 0.2s steps(1, end) forwards`,
            fontVariantNumeric: "tabular-nums",
          },
          "@media (prefers-reduced-motion: reduce)": {
            "&::after": { content: '"100"', animation: "none" },
          },
        }}
      />

      {/* Side diagnostics */}
      {[
        { no: "01", label: "接口总线 INTERFACE BUS", value: "就绪 READY", side: "left" as const },
        { no: "02", label: "主题配置 THEME PROFILE", value: "已应用 APPLIED", side: "right" as const },
      ].map((item) => (
        <Box
          key={item.no}
          aria-hidden
          sx={{
            position: "absolute",
            top: "50%",
            display: { xs: "none", md: "grid" },
            gridTemplateColumns: "28px auto",
            columnGap: 1,
            width: 170,
            paddingTop: 1,
            borderTop: `1px solid ${alpha(ink, 0.14)}`,
            color: inkMuted,
            fontSize: 7,
            fontWeight: 600,
            lineHeight: 1.6,
            letterSpacing: "0.13em",
            opacity: 0,
            animation: `${fadeInUp} 0.5s 0.85s ease-out forwards`,
            ...(item.side === "left" ? { left: "5%" } : { right: "5%" }),
            "& b": { gridRow: "1 / 3", color: ink, fontSize: 18, fontWeight: 700 },
            "& em": { marginTop: 0.5, color: accent, fontStyle: "normal" },
          }}
        >
          <b>{item.no}</b>
          <span>{item.label}</span>
          <em>{item.value}</em>
        </Box>
      ))}

      {/* Center: instrument core + brand + status */}
      <Box
        sx={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "min(62vw, 610px)",
          textAlign: "center",
        }}
      >
        <Box
          component="svg"
          aria-hidden
          viewBox="-90 -90 180 180"
          sx={{
            width: { xs: 118, md: 150, lg: 190 },
            height: { xs: 118, md: 150, lg: 190 },
            opacity: 0,
            animation: `${coreEnter} 0.7s 0.12s ${EASE_OUT} both`,
            color: accent,
            "& .boot-ring, & .boot-hex": { transformOrigin: "0 0" },
            "& .boot-ring-a": {
              stroke: inkMuted,
              opacity: 0.8,
              animation: `${spin} 18s linear infinite`,
            },
            "& .boot-ring-b": {
              stroke: inkMuted,
              opacity: 0.5,
              animation: `${spin} 24s linear infinite reverse`,
            },
            "& .boot-hex": {
              stroke: ink,
              fill: "none",
              strokeWidth: 2,
              strokeDasharray: "30 10",
              animation: `${hexReveal} 0.6s 0.18s ${EASE_OUT} both, ${spin} 30s 1s linear infinite`,
            },
            "& .boot-ring-inner": {
              stroke: accent,
              opacity: 0.9,
              animation: `${spin} 6s linear infinite reverse`,
            },
            "& .boot-core-block": {
              fill: accent,
              animation: `${coreActivate} 0.5s 0.2s ${EASE_OUT} both, ${coreFlash} 0.3s 2.45s ease-out`,
            },
            "@media (prefers-reduced-motion: reduce)": {
              animation: "none",
              opacity: 1,
              "& .boot-ring-a, & .boot-ring-b, & .boot-hex, & .boot-ring-inner, & .boot-core-block": {
                animation: "none",
              },
              "& .boot-core-block": { transform: "rotate(45deg) scale(1)", opacity: 1 },
            },
          }}
        >
          <circle className="boot-ring boot-ring-a" r="60" fill="none" strokeWidth="1.2" strokeDasharray="4 12" />
          <circle className="boot-ring boot-ring-b" r="70" fill="none" strokeWidth="1" strokeDasharray="2 30" />
          <path
            className="boot-hex"
            d="M40 0 L20 34.6 L-20 34.6 L-40 0 L-20 -34.6 L20 -34.6 Z"
          />
          <circle className="boot-ring boot-ring-inner" r="28" fill="none" strokeWidth="2" strokeDasharray="50 100" />
          <rect className="boot-core-block" x="-8" y="-8" width="16" height="16" />
        </Box>

        <Typography
          aria-hidden
          sx={{
            mt: 2.75,
            fontFamily: "inherit",
            fontWeight: 700,
            fontSize: "clamp(28px, 5vw, 54px)",
            lineHeight: 0.92,
            letterSpacing: "-0.02em",
            color: accent,
            textShadow: `0 0 26px ${alpha(accent, isDark ? 0.32 : 0.24)}`,
            opacity: 0,
            animation: `${clipReveal} 0.7s 0.42s ${EASE_OUT} both`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none", opacity: 1 },
          }}
        >
          CLASH WEB
        </Typography>
        <Typography
          aria-hidden
          sx={{
            mt: 1.75,
            color: inkMuted,
            fontWeight: 600,
            fontSize: { xs: 8, md: 9 },
            letterSpacing: { xs: "0.18em", md: "0.3em" },
            textTransform: "uppercase",
            opacity: 0,
            animation: `${fadeInUp} 0.5s 0.6s ease-out forwards`,
          }}
        >
          网络控制台 · NETWORK CONTROL CONSOLE
        </Typography>

        <Box aria-hidden sx={{ position: "relative", mt: 2, height: 14, width: "100%" }}>
          <Box
            component="span"
            sx={{
              position: "absolute",
              inset: 0,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: "0.22em",
              color: inkMuted,
              opacity: 0,
              animation: `${statusIn} 0.5s 0.7s ease-out forwards, ${statusOut} 0.2s 2.42s ease-in forwards`,
            }}
          >
            核心链路初始化 · CORE LINK INITIALIZING
          </Box>
          <Box
            component="span"
            sx={{
              position: "absolute",
              inset: 0,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: "0.22em",
              color: success,
              opacity: 0,
              animation: `${statusIn} 0.3s 2.45s ease-out forwards`,
            }}
          >
            系统在线 · SYSTEM ONLINE
          </Box>
        </Box>
      </Box>

      {/* Bottom progress — right half of the screen only: from the viewport
          centerline to the corner-bracket frame's inner right edge. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          left: "50%",
          right: { xs: "16px", md: "30px" },
          bottom: "64px",
          opacity: 0,
          animation: `${fadeInUp} 0.5s 0.9s ease-out forwards`,
        }}
      >
        <Box sx={{ height: 5, overflow: "hidden", backgroundColor: alpha(ink, isDark ? 0.14 : 0.12) }}>
          <Box
            sx={{
              width: "100%",
              height: 5,
              transformOrigin: "left",
              transform: "scaleX(0)",
              backgroundImage: `linear-gradient(90deg, ${accent} 0 70%, ${success} 100%)`,
              boxShadow: `0 0 14px ${alpha(accent, 0.3)}`,
              animation: `${progressGrow} 2.2s 0.9s cubic-bezier(0.16, 0.82, 0.2, 1) forwards`,
              "@media (prefers-reduced-motion: reduce)": { transform: "scaleX(1)", animation: "none" },
            }}
          />
        </Box>
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1.4 }}>
          <Box component="b" sx={{ color: inkMuted, fontSize: 7, fontWeight: 600, letterSpacing: "0.2em" }}>
            模块装载 · MODULE LOADING
          </Box>
          <Box component="em" sx={{ color: accent, fontSize: 7, fontWeight: 600, letterSpacing: "0.2em", fontStyle: "normal" }}>
            点击跳过 · CLICK TO SKIP
          </Box>
        </Box>
      </Box>

      {corner({ left: "5px", top: "36px", borderWidth: "1px 0 0 1px" })}
      {corner({ right: "5px", top: "36px", borderWidth: "1px 1px 0 0" })}
      {corner({ left: "5px", bottom: "20px", borderWidth: "0 0 1px 1px" })}
      {corner({ right: "5px", bottom: "20px", borderWidth: "0 1px 1px 0" })}
      </Box>

      {/* Accent brand wipe, then black clear */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 11,
          backgroundImage: `linear-gradient(90deg, ${accent} 0 7%, ${alpha(accent, 0.82)} 7% 100%)`,
          transform: "translateX(-101%)",
          animation: `${wipeAccent} 0.7s 2.48s ${EASE_SHARP} forwards`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none", background: "transparent" },
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 10,
          backgroundColor: bgDeep,
          transform: "translateX(-101%)",
          animation: `${wipeBlack} 0.76s 2.72s ${EASE_SHARP} forwards`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none", background: "transparent" },
        }}
      />
    </Box>,
    document.body,
  );
}
