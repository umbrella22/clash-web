import { alpha, createTheme } from "@mui/material/styles";

// EVE HUD semantic token: gold marks core resources (traffic totals, memory,
// capacitor-like gauges). Red stays reserved for error/hostile states.
declare module "@mui/material/styles" {
  interface Palette {
    gold: Palette["primary"];
  }
  interface PaletteOptions {
    gold?: PaletteOptions["primary"];
  }
}

const monoFont = [
  '"JetBrains Mono Variable"',
  '"JetBrains Mono"',
  '"SFMono-Regular"',
  '"Cascadia Code"',
  '"Courier New"',
  'monospace',
].join(", ");

const sansFont = [
  '"Inter Variable"',
  '"Inter"',
  '"Segoe UI"',
  'Roboto',
  '"Noto Sans SC"',
  'sans-serif',
].join(", ");

const baseTypography = {
  fontFamily: sansFont,
  h4: {
    fontWeight: 800,
    letterSpacing: "-0.025em",
    textWrap: "balance" as const,
  },
  h5: {
    fontWeight: 800,
    letterSpacing: "-0.02em",
    textWrap: "balance" as const,
  },
  h6: {
    fontWeight: 760,
    letterSpacing: "-0.01em",
    textWrap: "balance" as const,
  },
  body1: { textWrap: "pretty" as const },
  body2: { textWrap: "pretty" as const },
  button: {
    textTransform: "none" as const,
    fontWeight: 750,
    letterSpacing: "0.02em",
  },
};

function createClashTheme(mode: "light" | "dark") {
  const isDark = mode === "dark";
  // Deep-space holo palette (dark) vs. pale daylight-ops ice (light).
  const space = {
    void: isDark ? "#02060a" : "#e9eff3",
    deck: isDark ? "#050d14" : "#dde7ec",
    surface: isDark ? "rgba(7, 17, 24, 0.78)" : "rgba(252, 254, 255, 0.92)",
    surfaceRaised: isDark ? "rgba(12, 24, 33, 0.88)" : "rgba(247, 251, 253, 0.98)",
    ink: isDark ? "#c2dbe4" : "#132a35",
    muted: isDark ? "#68838f" : "#4e6a76",
    subtle: isDark ? "#445862" : "#7a919b",
    signal: isDark ? "#5fd0e0" : "#1e7e93",
    signalSoft: isDark ? "#9fe7f0" : "#5cb8c9",
    success: isDark ? "#7bc98a" : "#25743c",
    warning: isDark ? "#d98e4a" : "#96591b",
    gold: isDark ? "#e8c25a" : "#8f7415",
    info: isDark ? "#6fb7ff" : "#2f6fae",
    danger: isDark ? "#e05d5d" : "#c23c3c",
    divider: isDark ? "rgba(110, 190, 210, 0.16)" : "rgba(19, 42, 53, 0.14)",
    dividerStrong: isDark ? "rgba(110, 190, 210, 0.3)" : "rgba(19, 42, 53, 0.28)",
  };

  const theme = createTheme({
    palette: {
      mode,
      primary: { main: space.signal, contrastText: isDark ? "#04141a" : "#f4fbfd" },
      secondary: { main: space.ink },
      success: { main: space.success },
      error: { main: space.danger },
      warning: { main: space.warning },
      info: { main: space.info },
      gold: { main: space.gold },
      background: { default: space.void, paper: space.surface },
      text: { primary: space.ink, secondary: space.muted },
      divider: space.divider,
      action: {
        hover: alpha(space.signal, isDark ? 0.07 : 0.05),
        selected: alpha(space.signal, isDark ? 0.16 : 0.1),
        disabledBackground: alpha(space.ink, isDark ? 0.08 : 0.06),
      },
    },
    typography: baseTypography,
    shape: { borderRadius: 0 },
  });

  const hairline = `1px solid ${space.divider}`;
  const raisedShadow = isDark
    ? "0 24px 56px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(160, 220, 235, 0.05)"
    : "0 18px 42px rgba(23, 46, 58, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.9)";

  return createTheme(theme, {
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            WebkitFontSmoothing: "antialiased",
            MozOsxFontSmoothing: "grayscale",
          },
          body: {
            color: space.ink,
            backgroundColor: space.void,
            backgroundImage: isDark
              ? [
                  "radial-gradient(circle at 50% -18%, rgba(95, 208, 224, 0.1), transparent 34%)",
                  "radial-gradient(circle at 96% 78%, rgba(95, 208, 224, 0.07), transparent 30%)",
                  "linear-gradient(145deg, #04101a 0%, #02060a 48%, #030a10 100%)",
                ].join(", ")
              : [
                  "radial-gradient(circle at 50% -12%, rgba(255, 255, 255, 0.9), transparent 34%)",
                  "radial-gradient(circle at 98% 78%, rgba(30, 126, 147, 0.08), transparent 26%)",
                  "linear-gradient(145deg, #f2f7fa 0%, #e9eff3 50%, #e2eaef 100%)",
                ].join(", "),
            fontVariantNumeric: "tabular-nums",
          },
          "#root": {
            minHeight: "100vh",
            position: "relative",
            isolation: "isolate",
          },
          "h1, h2, h3, h4, h5, h6": { textWrap: "balance" },
          "p, li, figcaption": { textWrap: "pretty" },
          "*::-webkit-scrollbar": { width: "8px", height: "8px" },
          "*::-webkit-scrollbar-track": { background: alpha(space.ink, isDark ? 0.03 : 0.04) },
          "*::-webkit-scrollbar-thumb": {
            background: alpha(space.muted, isDark ? 0.34 : 0.3),
            border: `2px solid ${space.void}`,
            backgroundClip: "padding-box",
          },
          "*::-webkit-scrollbar-thumb:hover": { background: alpha(space.signal, isDark ? 0.75 : 0.6) },
          "::selection": { backgroundColor: alpha(space.signal, isDark ? 0.4 : 0.24), color: isDark ? "#eafcff" : "#0d2430" },
        },
      },
      MuiCard: {
        defaultProps: { variant: "outlined" },
        styleOverrides: {
          root: {
            // Two opposing corners stay visible. The remaining trace draws and clears clockwise.
            backgroundImage: [
              `linear-gradient(90deg, ${space.signal}, ${space.signal})`,
              `linear-gradient(180deg, ${space.signal}, ${space.signal})`,
              `linear-gradient(180deg, ${space.signal}, ${space.signal})`,
              `linear-gradient(90deg, ${space.signal}, ${space.signal})`,
              `linear-gradient(180deg, ${space.signal}, ${space.signal})`,
              `linear-gradient(180deg, ${space.signal}, ${space.signal})`,
              `linear-gradient(180deg, ${space.signal}, ${space.signal})`,
              `linear-gradient(180deg, ${space.signal}, ${space.signal})`,
              `linear-gradient(90deg, ${space.signal}, ${space.signal})`,
              `linear-gradient(90deg, ${space.signal}, ${space.signal})`,
              `linear-gradient(135deg, ${space.surfaceRaised}, ${space.surface})`,
            ].join(", "),
            backgroundOrigin: "border-box",
            backgroundPosition: "left top, left top, right bottom, right bottom, right top, left bottom, right bottom, left top, right top, left bottom, 0 0",
            backgroundRepeat: "no-repeat",
            backgroundSize: "24px 1px, 1px 24px, 1px 24px, 24px 1px, 1px 0, 1px 0, 1px 0, 1px 0, 0 1px, 0 1px, 100% 100%",
            backgroundColor: space.surface,
            border: hairline,
            borderRadius: 0,
            boxShadow: raisedShadow,
            position: "relative",
            overflow: "hidden",
            transitionProperty: "border-color, background-size, transform, box-shadow",
            transitionDuration: "180ms",
            transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
            "@keyframes card-perimeter-enter": {
              "0%": {
                backgroundSize: "24px 1px, 1px 24px, 1px 24px, 24px 1px, 1px 0, 1px 0, 1px 0, 1px 0, 0 1px, 0 1px, 100% 100%",
              },
              "25%": {
                backgroundSize: "100% 1px, 1px 24px, 1px 24px, 24px 1px, 1px 0, 1px 0, 1px 0, 1px 0, 0 1px, 0 1px, 100% 100%",
              },
              "50%": {
                backgroundSize: "100% 1px, 1px 24px, 1px 24px, 24px 1px, 1px 100%, 1px 0, 1px 0, 1px 0, 0 1px, 0 1px, 100% 100%",
              },
              "75%": {
                backgroundSize: "100% 1px, 1px 24px, 1px 24px, 100% 1px, 1px 100%, 1px 100%, 1px 0, 1px 0, 0 1px, 0 1px, 100% 100%",
              },
              "100%": {
                backgroundSize: "100% 1px, 1px 24px, 1px 24px, 100% 1px, 1px 100%, 1px 100%, 1px 0, 1px 0, 0 1px, 0 1px, 100% 100%",
              },
            },
            "@keyframes card-perimeter-leave": {
              "0%": {
                backgroundSize: "24px 1px, 1px 24px, 1px 24px, 24px 1px, 1px 0, 1px 0, 1px 100%, 1px 100%, 100% 1px, 100% 1px, 100% 100%",
              },
              "25%": {
                backgroundSize: "24px 1px, 1px 24px, 1px 24px, 24px 1px, 1px 0, 1px 0, 1px 100%, 1px 100%, 0 1px, 100% 1px, 100% 100%",
              },
              "50%": {
                backgroundSize: "24px 1px, 1px 24px, 1px 24px, 24px 1px, 1px 0, 1px 0, 1px 0, 1px 100%, 0 1px, 100% 1px, 100% 100%",
              },
              "75%": {
                backgroundSize: "24px 1px, 1px 24px, 1px 24px, 24px 1px, 1px 0, 1px 0, 1px 0, 1px 100%, 0 1px, 0 1px, 100% 100%",
              },
              "100%": {
                backgroundSize: "24px 1px, 1px 24px, 1px 24px, 24px 1px, 1px 0, 1px 0, 1px 0, 1px 0, 0 1px, 0 1px, 100% 100%",
              },
            },
            "&:hover": {
              backgroundSize: "100% 1px, 1px 24px, 1px 24px, 100% 1px, 1px 100%, 1px 100%, 1px 0, 1px 0, 0 1px, 0 1px, 100% 100%",
              borderColor: alpha(space.signal, isDark ? 0.66 : 0.56),
              boxShadow: isDark
                ? "0 26px 60px rgba(0, 0, 0, 0.48), inset 0 1px 0 rgba(160, 220, 235, 0.07)"
                : "0 22px 50px rgba(23, 46, 58, 0.13), inset 0 1px 0 rgba(255, 255, 255, 0.94)",
            },
            '&[data-card-trace="enter"]': {
              animation: "card-perimeter-enter 360ms cubic-bezier(0.2, 0, 0, 1) both",
            },
            '&[data-card-trace="leave"]': {
              animation: "card-perimeter-leave 280ms cubic-bezier(0.2, 0, 0, 1) both",
            },
            "@media (prefers-reduced-motion: reduce)": {
              transition: "none",
              '&[data-card-trace]': { animation: "none" },
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: `linear-gradient(135deg, ${space.surfaceRaised}, ${space.surface})`,
            backgroundColor: space.surface,
            borderRadius: 0,
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            minHeight: 40,
            borderRadius: 0,
            boxShadow: "none",
            transitionProperty: "background-color, border-color, color, transform",
            transitionDuration: "150ms",
            transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
            "&:active": { transform: "scale(0.98)" },
          },
          contained: {
            boxShadow: "none",
            "&:hover": { boxShadow: "none" },
          },
          outlined: {
            borderColor: alpha(space.ink, isDark ? 0.42 : 0.34),
            "&:hover": { borderColor: space.signal, backgroundColor: alpha(space.signal, isDark ? 0.1 : 0.06) },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            width: 40,
            height: 40,
            borderRadius: 0,
            border: `1px solid ${alpha(space.ink, isDark ? 0.2 : 0.18)}`,
            transitionProperty: "background-color, border-color, color, transform",
            transitionDuration: "150ms",
            transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
            "&:hover": { borderColor: space.signal, backgroundColor: alpha(space.signal, isDark ? 0.11 : 0.07) },
            "&:active": { transform: "scale(0.96)" },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            height: 27,
            borderRadius: 0,
            fontFamily: monoFont,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.035em",
            borderColor: alpha(space.ink, isDark ? 0.22 : 0.2),
            transitionProperty: "background-color, border-color, color",
            transitionDuration: "150ms",
            transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
          },
        },
      },
      MuiTextField: {
        defaultProps: { variant: "outlined" },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 0,
            backgroundColor: alpha(space.deck, isDark ? 0.72 : 0.42),
            fontFamily: monoFont,
            transitionProperty: "box-shadow, background-color",
            transitionDuration: "150ms",
            "& .MuiOutlinedInput-notchedOutline": { borderColor: alpha(space.dividerStrong, isDark ? 0.9 : 0.8) },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: alpha(space.signal, 0.55) },
            "&.Mui-focused": { boxShadow: `inset 3px 0 0 ${space.signal}` },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: space.signal },
          },
          input: { letterSpacing: "0.02em" },
        },
      },
      MuiInputLabel: {
        styleOverrides: { root: { letterSpacing: "0.04em", fontWeight: 700 } },
      },
      MuiMenu: {
        defaultProps: { slotProps: { paper: { elevation: 0 } } },
        styleOverrides: {
          paper: { marginTop: 8, border: hairline, boxShadow: raisedShadow },
          list: { paddingBlock: 4 },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            minHeight: 38,
            fontWeight: 650,
            transitionProperty: "background-color, color",
            transitionDuration: "120ms",
            "&.Mui-selected": { backgroundColor: alpha(space.signal, isDark ? 0.15 : 0.09) },
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundImage: `linear-gradient(180deg, ${alpha(space.signal, isDark ? 0.05 : 0.1)}, transparent 20%), linear-gradient(145deg, ${space.surfaceRaised}, ${space.surface})`,
            backgroundColor: space.surface,
            borderRight: hairline,
            boxShadow: isDark ? "18px 0 56px rgba(0, 0, 0, 0.42)" : "18px 0 56px rgba(23, 46, 58, 0.1)",
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: 44 },
          indicator: { height: 2, borderRadius: 0, background: space.signal },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 44,
            fontWeight: 750,
            letterSpacing: "0.04em",
            transitionProperty: "color, background-color",
            transitionDuration: "150ms",
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 0,
            border: hairline,
            boxShadow: `inset 3px 0 0 currentColor`,
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            height: 4,
            borderRadius: 0,
            backgroundColor: alpha(space.ink, isDark ? 0.12 : 0.1),
          },
          bar: {
            borderRadius: 0,
            backgroundImage: `linear-gradient(90deg, ${space.signal}, ${space.signalSoft})`,
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderBottomColor: space.divider },
          head: {
            color: space.muted,
            fontFamily: monoFont,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            backgroundColor: alpha(space.ink, isDark ? 0.05 : 0.04),
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: { "&.MuiTableRow-hover:hover": { backgroundColor: alpha(space.signal, isDark ? 0.07 : 0.045) } },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 0,
            backgroundColor: isDark ? "rgba(8, 20, 28, 0.97)" : "rgba(250, 253, 255, 0.98)",
            color: space.ink,
            boxShadow: raisedShadow,
            border: hairline,
            fontWeight: 650,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 0, border: hairline, boxShadow: raisedShadow },
        },
      },
    },
  });
}

export const darkTheme = createClashTheme("dark");
export const lightTheme = createClashTheme("light");
