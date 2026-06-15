import { keyframes } from "@emotion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";

import { useAuthContext } from "../App";
import { clearStoredToken, getStoredToken } from "../services/api";

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

export default function LoginPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();
  const { login } = useAuthContext();
  const [token, setToken] = useState(getStoredToken());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isLoadingActive, setIsLoadingActive] = useState(false);
  const [loadingPercent, setLoadingPercent] = useState(0);
  const [loadingCode, setLoadingCode] = useState("WAITING FOR SYNC");
  const [isComplete, setIsComplete] = useState(false);
  const successTimerRef = useRef<number | null>(null);
  const loadingIntervalRef = useRef<number | null>(null);
  const navigateTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setActive(true), 160);
    return () => window.clearTimeout(timer);
  }, []);

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
    };
  }, []);

  const statusText = useMemo(() => {
    if (isLoadingActive) return isComplete ? "COMPLETE" : "INITIALIZING...";
    if (submitting) return "VERIFYING ACCESS KEY...";
    if (error) return error.toUpperCase();
    return "WAITING FOR AUTHENTICATION";
  }, [error, isComplete, isLoadingActive, submitting]);

  const statusColor = isComplete
    ? "success.main"
    : error
      ? "error.main"
      : submitting || isLoadingActive
        ? "success.main"
        : "text.secondary";
  const isDark = theme.palette.mode === "dark";
  const heroPrimary = isDark ? theme.palette.text.primary : "#1a1a1a";
  const heroMuted = isDark ? theme.palette.text.secondary : "#666";
  const heroLine = isDark ? alpha(theme.palette.text.primary, 0.72) : "#333";
  const heroAccent = theme.palette.success.main;

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
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        "--bg-start": isDark ? "#111821" : "#e8ecf3",
        "--bg-end": isDark ? "#0b1016" : "#d4dceb",
        "--primary": heroPrimary,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        px: { xs: 2, md: 4 },
        py: 4,
        background: "linear-gradient(135deg, var(--bg-start) 0%, var(--bg-end) 100%)",
        overflow: "hidden",
        width: "100%",
        fontFamily: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: "min(100%, 800px)",
          aspectRatio: "16 / 9",
          maxHeight: "calc(100vh - 32px)",
          background: isDark
            ? alpha(theme.palette.background.paper, 0.92)
            : "rgba(255, 255, 255, 0.65)",
          borderRadius: "4px",
          boxShadow: isDark
            ? "0 30px 60px rgba(0, 0, 0, 0.32)"
            : "0 30px 60px rgba(0, 0, 0, 0.1)",
          overflow: "hidden",
          opacity: active ? 1 : 0,
          transform: "translate3d(0, 0, 0)",
          transition: "opacity 0.5s",
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
                  fill: "var(--primary)",
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
                fontFamily: '"Cinzel", serif',
                fontSize: 72,
                fontWeight: 900,
                fill: heroPrimary,
                animation: active ? `${heroReveal} 0.8s ease-out forwards` : "none",
                animationDelay: "1s",
              }}
            >
              PRTS
            </Box>
            <Box
              component="text"
              x="255"
              y="245"
              textAnchor="middle"
              sx={{
                opacity: 0,
                transform: "translateY(10px)",
                fontFamily: '"Lato", sans-serif',
                fontSize: 12,
                letterSpacing: 3,
                fill: heroMuted,
                fontWeight: "bold",
                animation: active ? `${fadeUp} 0.6s ease-out forwards` : "none",
                animationDelay: "1.2s",
              }}
            >
              PRIMITIVE RHODES ISLAND
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
                fontFamily: '"Courier New", monospace',
                fontSize: 22,
                fontWeight: "bold",
                fill: heroPrimary,
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
              component="text"
              x="450"
              y="150"
              sx={{
                opacity: 0,
                transform: "translateY(10px)",
                fontFamily: '"Lato", sans-serif',
                fontSize: 11,
                fontWeight: "bold",
                letterSpacing: 1,
                fill: heroLine,
                animation: active ? `${fadeUp} 0.6s ease-out forwards` : "none",
                animationDelay: "1.6s",
              }}
            >
              ACCESS KEY
            </Box>
            <Box
              component="rect"
              x="450"
              y="165"
              width="240"
              height="40"
              sx={{
                fill: "none",
                stroke: error ? theme.palette.error.main : heroLine,
                strokeWidth: 2,
                strokeDasharray: 600,
                strokeDashoffset: 600,
                opacity: 0,
                transition: "stroke 0.3s",
                animation: active
                  ? `${drawRect} 1s cubic-bezier(0.22, 1, 0.36, 1) forwards`
                  : "none",
                animationDelay: "1.7s",
              }}
            />
            <Box
              component="text"
              x="690"
              y="300"
              textAnchor="end"
              sx={{
                opacity: 0,
                transform: "translateY(10px)",
                fontFamily: '"Lato", sans-serif',
                fontSize: 10,
                fill: heroMuted,
                animation: active ? `${fadeUp} 0.6s ease-out forwards` : "none",
                animationDelay: "2.2s",
              }}
            >
              {submitting ? "Verifying..." : "Connection Lost?"}
            </Box>
          </g>

          <g
            style={{
              opacity: isLoadingActive ? 1 : 0,
              pointerEvents: "none",
              transition: "opacity 0.5s ease 0.5s",
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
                fontFamily: '"Courier New", monospace',
                fontSize: 12,
                fontWeight: "bold",
                fill: heroLine,
                letterSpacing: 2,
              }}
            >
              INITIALIZING...
            </Box>
            <Box
              component="text"
              y="105"
              textAnchor="middle"
              sx={{
                fontFamily: '"Courier New", monospace',
                fontWeight: "bold",
                fontSize: 24,
                fill: isComplete ? heroAccent : heroPrimary,
              }}
            >
              {loadingPercent}%
            </Box>
            <Box
              component="text"
              y="120"
              textAnchor="middle"
              sx={{
                fontFamily: '"Courier New", monospace',
                fontSize: 10,
                fill: isComplete ? heroAccent : heroMuted,
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
                ...(isExiting
                  ? {
                      filter: "blur(2px)",
                    }
                  : null),
              }}
            >
              <TextField
                type="password"
                fullWidth
                autoFocus
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={t("auth.token")}
                disabled={submitting}
                variant="standard"
                slotProps={{ input: { disableUnderline: true } }}
                sx={{
                  pointerEvents: "auto",
                  "& .MuiInputBase-root": {
                    height: "100%",
                    px: 1.5,
                    backgroundColor: "transparent",
                    fontFamily: '"Courier New", monospace',
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

              {error && (
                <Alert
                  severity="error"
                  sx={{
                    position: "absolute",
                    left: 0,
                    top: "calc(100% + 84px)",
                    width: "240px",
                    py: 0,
                    pointerEvents: "none",
                  }}
                >
                  {error}
                </Alert>
              )}
            </Box>

            <Box
              sx={{
                position: "absolute",
                left: "56.25%",
                top: "71.1111%",
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
                disabled={submitting}
                sx={{
                  width: "100%",
                  height: "100%",
                  minWidth: 0,
                  borderRadius: 0,
                  bgcolor: "text.primary",
                  color: "background.paper",
                  fontFamily: '"Segoe UI", sans-serif',
                  letterSpacing: "2px",
                  fontWeight: "bold",
                  boxShadow: "none",
                  "&:hover": {
                    bgcolor: isDark ? alpha(theme.palette.text.primary, 0.86) : "#000",
                    boxShadow: "none",
                  },
                }}
              >
                {submitting ? <CircularProgress size={18} color="inherit" /> : "CONNECT"}
              </Button>
            </Box>
          </Box>

          <Typography
            sx={{
              position: "absolute",
              left: "56.25%",
              top: "82.2222%",
              width: "28%",
              height: 20,
              pointerEvents: "none",
              opacity: 0,
              animation: active ? `${simpleFade} 0.5s ease forwards` : "none",
              animationDelay: "2.4s",
              fontFamily: '"Courier New", monospace',
              fontSize: 12,
              lineHeight: "20px",
              letterSpacing: "0.08em",
              color: statusColor,
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
              top: "87.5556%",
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
