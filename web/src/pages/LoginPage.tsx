import { keyframes } from "@emotion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  CircularProgress,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";

import { useAuthContext, useBootPending } from "../App";
import { BOOT_DISMISSED_EVENT } from "../components/BootScreen";
import { clearStoredToken, getStoredToken } from "../services/api";

const MONO_FONT =
  '"JetBrains Mono Variable", "JetBrains Mono", "Courier New", monospace';

const markerSnap = keyframes`
  0% {
    transform: translate(var(--sx), var(--sy)) scale(0.1);
    opacity: 0;
  }

  60% {
    opacity: 1;
  }

  100% {
    transform: translate(0, 0) scale(1);
    opacity: 1;
  }
`;

const drawLine = keyframes`
  to {
    stroke-dashoffset: 0;
  }
`;

const heroReveal = keyframes`
  0% {
    opacity: 0;
    transform: scale(1.2);
    filter: blur(10px);
  }

  100% {
    opacity: 1;
    transform: scale(1);
    filter: none;
  }
`;

const fadeUp = keyframes`
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const drawRect = keyframes`
  to {
    stroke-dashoffset: 0;
  }
`;

const simpleFade = keyframes`
  to {
    opacity: 1;
  }
`;

const slideExitLeft = keyframes`
  to {
    transform: translateX(-600px);
    opacity: 0;
    filter: blur(2px);
  }
`;

const inputReveal = keyframes`
  from {
    opacity: 0;
    transform: translateY(6px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const spin = keyframes`
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
`;

const pulseCore = keyframes`
  0% {
    transform: rotate(45deg) scale(0.8);
    opacity: 0.6;
  }

  100% {
    transform: rotate(45deg) scale(1.2);
    opacity: 1;
  }
`;

const glitchSkew = keyframes`
  0% {
    transform: translate(0, 0);
  }

  20% {
    transform: translate(-4px, 4px);
  }

  40% {
    transform: translate(-4px, -4px);
  }

  60% {
    transform: translate(4px, 4px);
  }

  80% {
    transform: translate(4px, -4px);
  }

  100% {
    transform: translate(0, 0);
  }
`;

const HERO_WORD = "CLASH";
const SCRAMBLE_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>?X0";

export default function LoginPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();
  const { login } = useAuthContext();
  const [token, setToken] = useState(getStoredToken());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const [glitching, setGlitching] = useState(false);
  const [heroText, setHeroText] = useState(HERO_WORD);
  const [isExiting, setIsExiting] = useState(false);
  const [isLoadingActive, setIsLoadingActive] = useState(false);
  const [loadingPercent, setLoadingPercent] = useState(0);
  const [loadingCode, setLoadingCode] = useState("WAITING FOR SYNC");
  const [isComplete, setIsComplete] = useState(false);
  const successTimerRef = useRef<number | null>(null);
  const loadingIntervalRef = useRef<number | null>(null);
  const navigateTimerRef = useRef<number | null>(null);
  const glitchTimerRef = useRef<number | null>(null);
  const scrambleIntervalRef = useRef<number | null>(null);
  const tokenInputRef = useRef<HTMLInputElement | null>(null);

  // Focus only once the input has finished its reveal animation (2.08s delay
  // + 0.35s duration) — focusing an invisible field lets users type blind.
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => tokenInputRef.current?.focus(), 2450);
    return () => window.clearTimeout(timer);
  }, [active]);

  // Coordinate with the boot layer (login.vue's BOOT_DISMISSED_EVENT pattern):
  // the boot sequence replays on every page load, so a freshly mounted login
  // page waits for the wipe handoff; later in-app remounts (logout) enter at
  // once because no boot is pending anymore.
  const bootPending = useBootPending();

  useEffect(() => {
    if (!bootPending) {
      const timer = window.setTimeout(() => setActive(true), 160);
      return () => window.clearTimeout(timer);
    }

    let armTimer = 0;
    let fallbackTimer = 0;
    const armEntrance = () => {
      if (fallbackTimer !== 0) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = 0;
      }
      if (armTimer === 0) {
        armTimer = window.setTimeout(() => setActive(true), 80);
      }
    };

    window.addEventListener(BOOT_DISMISSED_EVENT, armEntrance, { once: true });
    // Safety net: never trap the user if the boot layer fails to report.
    fallbackTimer = window.setTimeout(armEntrance, 8000);

    return () => {
      window.removeEventListener(BOOT_DISMISSED_EVENT, armEntrance);
      window.clearTimeout(armTimer);
      window.clearTimeout(fallbackTimer);
    };
  }, [bootPending]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) {
        window.clearTimeout(successTimerRef.current);
      }

      if (loadingIntervalRef.current !== null) {
        window.clearInterval(loadingIntervalRef.current);
      }

      if (navigateTimerRef.current !== null) {
        window.clearTimeout(navigateTimerRef.current);
      }

      if (glitchTimerRef.current !== null) {
        window.clearTimeout(glitchTimerRef.current);
      }

      if (scrambleIntervalRef.current !== null) {
        window.clearInterval(scrambleIntervalRef.current);
      }
    };
  }, []);

  const statusText = useMemo(() => {
    // Kept terse: this line is single-line (nowrap) above the subtitle.
    if (glitching) return "FATAL ERROR";
    if (isLoadingActive) return isComplete ? "COMPLETE" : "INITIALIZING";
    if (submitting) return "VERIFYING KEY";
    if (error) return error;
    return "WAITING";
  }, [error, glitching, isComplete, isLoadingActive, submitting]);

  const statusColor = glitching
    ? "error.main"
    : isComplete
      ? "success.main"
      : error
        ? "error.main"
        : submitting || isLoadingActive
          ? "primary.main"
          : "text.secondary";

  const isDark = theme.palette.mode === "dark";
  const heroPrimary = theme.palette.text.primary;
  const heroMuted = theme.palette.text.secondary;
  const heroLine = alpha(theme.palette.primary.main, isDark ? 0.7 : 0.6);
  const heroAccent = theme.palette.primary.main;
  const floating = focused || token.length > 0;

  const scrambleHero = () => {
    if (scrambleIntervalRef.current !== null) {
      window.clearInterval(scrambleIntervalRef.current);
    }

    let iterations = 0;
    scrambleIntervalRef.current = window.setInterval(() => {
      setHeroText(
        HERO_WORD.split("")
          .map((char, index) =>
            index < iterations ? char : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)],
          )
          .join(""),
      );

      if (iterations >= HERO_WORD.length) {
        if (scrambleIntervalRef.current !== null) {
          window.clearInterval(scrambleIntervalRef.current);
          scrambleIntervalRef.current = null;
        }
        setHeroText(HERO_WORD);
      }
      iterations += 0.5;
    }, 45);
  };

  // Failed handshake: the terminal glitches and scrambles like the reference
  // login.vue, then recovers to an editable state instead of force-reloading.
  const triggerGlitch = () => {
    setGlitching(true);
    scrambleHero();

    if (glitchTimerRef.current !== null) {
      window.clearTimeout(glitchTimerRef.current);
    }
    glitchTimerRef.current = window.setTimeout(() => {
      glitchTimerRef.current = null;
      setGlitching(false);
    }, 1100);
  };

  const startLoadingCounter = () => {
    if (loadingIntervalRef.current !== null) {
      window.clearInterval(loadingIntervalRef.current);
      loadingIntervalRef.current = null;
    }

    if (navigateTimerRef.current !== null) {
      window.clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }

    let percent = 0;

    loadingIntervalRef.current = window.setInterval(() => {
      percent += Math.floor(Math.random() * 3) + 1;
      if (percent > 100) percent = 100;

      setLoadingPercent(percent);

      if (percent % 5 === 0) {
        setLoadingCode(
          `SYNC: 0x${Math.floor(Math.random() * 16777215)
            .toString(16)
            .toUpperCase()}`,
        );
      }

      if (percent >= 100) {
        if (loadingIntervalRef.current !== null) {
          window.clearInterval(loadingIntervalRef.current);
          loadingIntervalRef.current = null;
        }

        setLoadingCode("COMPLETE");
        setIsComplete(true);
        navigateTimerRef.current = window.setTimeout(() => {
          navigateTimerRef.current = null;
          navigate("/", { replace: true });
        }, 180);
      }
    }, 50);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token.trim()) {
      setError(t("auth.token_required"));
      triggerGlitch();
      return;
    }

    setSubmitting(true);
    setError("");
    setIsExiting(false);
    setIsLoadingActive(false);
    setLoadingPercent(0);
    setLoadingCode("WAITING FOR SYNC");
    setIsComplete(false);
    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }

    try {
      await login(token);
      setSubmitting(false);
      setError("");
      successTimerRef.current = window.setTimeout(() => {
        setIsExiting(true);
        setIsLoadingActive(true);
        startLoadingCounter();
      }, 800);
    } catch (err) {
      clearStoredToken();

      if (axios.isAxiosError(err) && err.response?.status === 401) {
        setError(t("auth.invalid_token"));
      } else {
        setError(t("auth.login_failed"));
      }
      triggerGlitch();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        "--bg-start": isDark ? "#04101a" : "#f2f7fa",
        "--bg-end": isDark ? "#02060a" : "#e2eaef",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        px: { xs: 2, md: 4 },
        py: 4,
        backgroundImage: [
          isDark
            ? "radial-gradient(circle at 18% 18%, rgba(95, 208, 224, 0.14) 0, transparent 30%)"
            : "radial-gradient(circle at 18% 18%, rgba(255, 255, 255, 0.75) 0, transparent 30%)",
          isDark
            ? "radial-gradient(circle at 78% 72%, rgba(95, 208, 224, 0.1) 0, transparent 28%)"
            : "radial-gradient(circle at 78% 72%, rgba(30, 126, 147, 0.1) 0, transparent 28%)",
          "linear-gradient(135deg, var(--bg-start) 0%, var(--bg-end) 100%)",
        ].join(", "),
        overflow: "hidden",
        width: "100%",
        fontFamily: '"Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: "min(100%, 800px)",
          aspectRatio: "16 / 9",
          maxHeight: "calc(100vh - 32px)",
          background: isDark
            ? "linear-gradient(145deg, rgba(10, 22, 30, 0.9), rgba(5, 12, 18, 0.78))"
            : "linear-gradient(145deg, rgba(250, 253, 255, 0.92), rgba(240, 246, 249, 0.78))",
          border: `1px solid ${alpha(theme.palette.primary.main, isDark ? 0.24 : 0.3)}`,
          backdropFilter: "blur(24px) saturate(150%)",
          WebkitBackdropFilter: "blur(24px) saturate(150%)",
          boxShadow: isDark
            ? `0 32px 70px rgba(0, 0, 0, 0.5), 0 0 36px ${alpha(theme.palette.primary.main, 0.1)}`
            : "0 30px 60px rgba(23, 46, 58, 0.16)",
          overflow: "hidden",
          opacity: active ? 1 : 0,
          transform: "translate3d(0, 0, 0)",
          transitionProperty: "opacity",
          transitionDuration: "500ms",
          ...(glitching
            ? {
                animation: `${glitchSkew} 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) 3 both`,
                borderColor: alpha(theme.palette.error.main, 0.66),
                boxShadow: `0 32px 70px rgba(0, 0, 0, 0.5), 0 0 30px ${alpha(theme.palette.error.main, 0.22)}`,
              }
            : null),
          "@media (prefers-reduced-motion: reduce)": {
            "& *, & *::before, & *::after": {
              animationDuration: "0.01ms !important",
              animationDelay: "0s !important",
              animationIterationCount: "1 !important",
              transitionDuration: "0.01ms !important",
            },
          },
        }}
      >
        <Box
          component="svg"
          viewBox="0 0 800 450"
          preserveAspectRatio="xMidYMid meet"
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 1,
            pointerEvents: "none",
            textRendering: "geometricPrecision",
          }}
        >
          <g
            style={{
              animation: isExiting
                ? `${slideExitLeft} 0.8s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards`
                : undefined,
            }}
          >
            {[
              { x: 80, y: 60, sx: "200px", sy: "100px", delay: "0s" },
              { x: 702, y: 60, sx: "-200px", sy: "100px", delay: "0.08s" },
              { x: 80, y: 372, sx: "200px", sy: "-100px", delay: "0.16s" },
              { x: 702, y: 372, sx: "-200px", sy: "-100px", delay: "0.24s" },
            ].map((marker) => (
              <Box
                key={`${marker.x}-${marker.y}`}
                component="rect"
                x={marker.x}
                y={marker.y}
                width="18"
                height="18"
                sx={{
                  fill: glitching ? theme.palette.error.main : "var(--primary)",
                  "--primary": heroPrimary,
                  transformOrigin: "center",
                  opacity: 0,
                  "--sx": marker.sx,
                  "--sy": marker.sy,
                  animation: active
                    ? `${markerSnap} 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards`
                    : "none",
                  animationDelay: marker.delay,
                }}
              />
            ))}
          </g>

          <g
            style={{
              animation: isExiting
                ? `${slideExitLeft} 0.8s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards`
                : undefined,
            }}
          >
            <Box
              component="line"
              x1="130"
              y1="150"
              x2="380"
              y2="150"
              sx={{
                stroke: heroPrimary,
                strokeWidth: 2,
                strokeDasharray: 400,
                strokeDashoffset: 400,
                animation: active ? `${drawLine} 0.8s ease-out forwards` : "none",
                animationDelay: "0.8s",
              }}
            />
            <Box
              component="text"
              x="255"
              y="220"
              textAnchor="middle"
              sx={{
                opacity: 0,
                transformOrigin: "center",
                fontFamily: MONO_FONT,
                fontSize: 72,
                fontWeight: 900,
                fill: glitching ? theme.palette.error.main : heroPrimary,
                animation: active ? `${heroReveal} 0.8s ease-out forwards` : "none",
                animationDelay: "1s",
              }}
            >
              {heroText}
            </Box>
            <Box
              component="text"
              x="255"
              y="245"
              textAnchor="middle"
              sx={{
                opacity: 0,
                transform: "translateY(10px)",
                fontFamily: MONO_FONT,
                fontSize: 12,
                letterSpacing: 3,
                fill: heroMuted,
                fontWeight: "bold",
                animation: active ? `${fadeUp} 0.6s ease-out forwards` : "none",
                animationDelay: "1.2s",
              }}
            >
              ORBITAL RELAY
            </Box>
            <Box
              component="line"
              x1="130"
              y1="265"
              x2="380"
              y2="265"
              sx={{
                stroke: heroPrimary,
                strokeWidth: 1,
                strokeDasharray: 400,
                strokeDashoffset: 400,
                animation: active ? `${drawLine} 0.8s ease-out forwards` : "none",
                animationDelay: "1.3s",
              }}
            />
            <Box
              component="text"
              x="255"
              y="290"
              textAnchor="middle"
              sx={{
                opacity: 0,
                transform: "translateY(10px)",
                fontFamily: MONO_FONT,
                fontSize: 22,
                fontWeight: "bold",
                fill: heroAccent,
                letterSpacing: 1,
                animation: active ? `${fadeUp} 0.6s ease-out forwards` : "none",
                animationDelay: "1.4s",
              }}
            >
              TERMINAL SERVICE
            </Box>
            <Box
              component="line"
              x1="130"
              y1="300"
              x2="380"
              y2="300"
              sx={{
                stroke: heroPrimary,
                strokeWidth: 3,
                strokeDasharray: 400,
                strokeDashoffset: 400,
                animation: active ? `${drawLine} 0.8s ease-out forwards` : "none",
                animationDelay: "1.5s",
              }}
            />
          </g>

          <Box
            component="line"
            x1="410"
            y1="120"
            x2="410"
            y2="330"
            sx={{
              stroke: heroLine,
              strokeWidth: 2,
              strokeDasharray: "4 4",
              strokeDashoffset: 400,
              animation: isExiting
                ? `${slideExitLeft} 0.8s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards`
                : active
                  ? `${drawLine} 0.8s ease-out forwards`
                  : "none",
              animationDelay: "1.4s",
            }}
          />

          <g
            style={{
              animation: isExiting
                ? `${slideExitLeft} 0.8s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards`
                : undefined,
            }}
          >
            <Box
              component="rect"
              x="450"
              y="165"
              width="240"
              height="40"
              sx={{
                fill: "none",
                stroke: error ? theme.palette.error.main : focused ? heroAccent : heroLine,
                strokeWidth: 2,
                strokeDasharray: 600,
                strokeDashoffset: 600,
                opacity: 0,
                transitionProperty: "stroke",
                transitionDuration: "300ms",
                // drawRect only animates the dash; pair it with a fade or the
                // field frame stays at opacity 0 forever.
                animation: active
                  ? `${drawRect} 1s cubic-bezier(0.22, 1, 0.36, 1) forwards, ${simpleFade} 0.5s ease forwards`
                  : "none",
                animationDelay: "1.7s",
              }}
            />
            <Box
              component="text"
              // Telemetry tag rides the button row (button spans y 221–257
              // in viewBox units; 243 centers this 10px baseline with it).
              x="690"
              y="243"
              textAnchor="end"
              sx={{
                opacity: 0,
                transform: "translateY(10px)",
                fontFamily: MONO_FONT,
                fontSize: 10,
                fill: error ? theme.palette.error.main : heroMuted,
                animation: active ? `${fadeUp} 0.6s ease-out forwards` : "none",
                animationDelay: "2.2s",
              }}
            >
              {error ? "LINK ERROR" : "STANDBY"}
            </Box>
          </g>

          <g
            style={{
              opacity: isLoadingActive ? 1 : 0,
              pointerEvents: "none",
              transitionProperty: "opacity",
              transitionDuration: "500ms",
              transitionTimingFunction: "ease",
              transitionDelay: "500ms",
            }}
            transform="translate(400, 225)"
          >
            <Box
              component="circle"
              cx="0"
              cy="0"
              r="45"
              sx={{
                fill: "none",
                stroke: alpha(theme.palette.text.secondary, 0.72),
                strokeWidth: 1,
                strokeDasharray: "2 8",
                opacity: 0.5,
                transformOrigin: "0px 0px",
                animation: `${spin} 10s linear infinite`,
              }}
            />
            <Box
              component="path"
              d="M32 0 L16 27.7 L-16 27.7 L-32 0 L-16 -27.7 L16 -27.7 Z"
              sx={{
                fill: "none",
                stroke: heroPrimary,
                strokeWidth: 2,
                strokeDasharray: "24 8",
                transformOrigin: "0px 0px",
                animation: `${spin} 3s linear infinite`,
              }}
            />
            <Box
              component="circle"
              cx="0"
              cy="0"
              r="22"
              sx={{
                fill: "none",
                stroke: heroAccent,
                strokeWidth: 2,
                strokeDasharray: "40 80",
                transformOrigin: "0px 0px",
                animation: `${spin} 1.5s linear infinite reverse`,
              }}
            />
            <Box
              component="rect"
              x="-6"
              y="-6"
              width="12"
              height="12"
              sx={{
                fill: heroAccent,
                transformOrigin: "0px 0px",
                animation: `${pulseCore} 1s ease-in-out infinite alternate`,
              }}
            />
            <Box
              component="text"
              y="75"
              textAnchor="middle"
              sx={{
                fontFamily: MONO_FONT,
                fontSize: 12,
                fontWeight: "bold",
                fill: heroLine,
                letterSpacing: 2,
              }}
            >
              INITIALIZING
            </Box>
            <Box
              component="text"
              y="105"
              textAnchor="middle"
              sx={{
                fontFamily: MONO_FONT,
                fontWeight: "bold",
                fontSize: 24,
                fill: isComplete ? theme.palette.success.main : heroPrimary,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {loadingPercent}%
            </Box>
            <Box
              component="text"
              y="120"
              textAnchor="middle"
              sx={{
                fontFamily: MONO_FONT,
                fontSize: 10,
                fill: isComplete ? theme.palette.success.main : heroMuted,
              }}
            >
              {loadingCode}
            </Box>
          </g>
        </Box>

        <Box
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <Box
            component="form"
            onSubmit={handleSubmit}
            sx={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
          >
            <Box
              sx={{
                position: "absolute",
                left: "56.25%",
                top: "36.6667%",
                width: "30%",
                height: "8.8889%",
                display: "flex",
                alignItems: "center",
                pointerEvents: "auto",
                opacity: 0,
                animation: isExiting
                  ? `${slideExitLeft} 0.8s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards`
                  : active
                    ? `${simpleFade} 0.5s ease forwards`
                    : "none",
                animationDelay: isExiting ? "0s" : "2s",
                boxShadow: focused
                  ? `0 0 0 1px ${alpha(heroAccent, 0.5)}, 0 0 18px ${alpha(heroAccent, 0.18)}`
                  : "none",
                transitionProperty: "box-shadow",
                transitionDuration: "200ms",
                ...(isExiting
                  ? {
                      filter: "blur(2px)",
                    }
                  : null),
              }}
            >
              <Typography
                component="label"
                htmlFor="clash-token-input"
                sx={{
                  position: "absolute",
                  left: 8,
                  top: "50%",
                  zIndex: 1,
                  px: 0.5,
                  fontFamily: MONO_FONT,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  pointerEvents: "none",
                  color: glitching ? "error.main" : focused ? heroAccent : heroMuted,
                  backgroundColor: floating ? (isDark ? "rgba(9, 20, 28, 0.94)" : "rgba(248, 251, 253, 0.96)") : "transparent",
                  transform: floating ? "translateY(-165%) scale(0.92)" : "translateY(-50%)",
                  transformOrigin: "left center",
                  transitionProperty: "transform, color, background-color",
                  transitionDuration: "220ms",
                  transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  whiteSpace: "nowrap",
                }}
              >
                ACCESS KEY
              </Typography>
              <TextField
                id="clash-token-input"
                type="password"
                fullWidth
                inputRef={tokenInputRef}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                disabled={submitting || glitching}
                variant="standard"
                slotProps={{ input: { disableUnderline: true } }}
                sx={{
                  pointerEvents: "auto",
                  "& .MuiInputBase-root": {
                    height: "100%",
                    px: 1.5,
                    backgroundColor: "transparent",
                    fontFamily: MONO_FONT,
                    fontSize: 18,
                    fontWeight: "bold",
                    color: error ? "error.main" : "text.primary",
                    opacity: 0,
                    transform: "translateY(6px)",
                    animation: active ? `${inputReveal} 0.35s ease forwards` : "none",
                    animationDelay: "2.08s",
                  },
                  "& .MuiInputBase-input": {
                    letterSpacing: "1px",
                    p: 0,
                  },
                }}
              />
            </Box>

            <Box
              sx={{
                position: "absolute",
                left: "56.25%",
                top: "49.1111%",
                width: "15%",
                height: "8%",
                pointerEvents: "auto",
                opacity: 0,
                animation: isExiting
                  ? `${slideExitLeft} 0.8s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards`
                  : active
                    ? `${simpleFade} 0.5s ease forwards`
                    : "none",
                animationDelay: isExiting ? "0s" : "2.4s",
                ...(isExiting
                  ? {
                      filter: "blur(2px)",
                    }
                  : null),
              }}
            >
              <Button
                type="submit"
                variant="contained"
                disabled={submitting || glitching}
                sx={{
                  width: "100%",
                  height: "100%",
                  minWidth: 0,
                  letterSpacing: "0.16em",
                  fontSize: 13,
                  fontWeight: 800,
                  "&:hover": {
                    boxShadow: `0 0 18px ${alpha(theme.palette.primary.main, 0.4)}`,
                  },
                }}
              >
                {submitting || glitching ? <CircularProgress size={18} color="inherit" /> : "CONNECT"}
              </Button>
            </Box>
          </Box>

          <Typography
            sx={{
              position: "absolute",
              left: "56.25%",
              top: "61.1111%",
              width: "33%",
              height: 20,
              pointerEvents: "none",
              opacity: 0,
              animation: active ? `${simpleFade} 0.5s ease forwards` : "none",
              animationDelay: "2.4s",
              fontFamily: MONO_FONT,
              fontSize: 12,
              lineHeight: "20px",
              letterSpacing: "0.08em",
              color: statusColor,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              ...(isExiting
                ? {
                    animation: `${slideExitLeft} 0.8s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards`,
                  }
                : null),
            }}
          >
            {statusText}
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              position: "absolute",
              left: "56.25%",
              top: "67.3333%",
              width: "33%",
              pointerEvents: "none",
              opacity: 0,
              animation: active ? `${simpleFade} 0.5s ease forwards` : "none",
              animationDelay: "2.45s",
              fontSize: 12,
              lineHeight: 1.5,
              ...(isExiting
                ? {
                    animation: `${slideExitLeft} 0.8s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards`,
                  }
                : null),
            }}
          >
            {t("auth.subtitle")}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
