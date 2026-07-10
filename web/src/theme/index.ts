import { alpha, createTheme } from "@mui/material/styles";

const monoFont = [
  '"JetBrains Mono"',
  '"SFMono-Regular"',
  '"Cascadia Code"',
  '"Courier New"',
  "monospace",
].join(",");

const sansFont = [
  '"Inter"',
  '"Segoe UI"',
  "Roboto",
  '"Noto Sans SC"',
  "sans-serif",
].join(",");

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
  const space = {
    void: isDark ? "#070708" : "#f2f0eb",
    deck: isDark ? "#101114" : "#e7e4de",
    surface: isDark ? "rgba(18, 19, 22, 0.9)" : "rgba(255, 254, 250, 0.94)",
    surfaceRaised: isDark ? "rgba(26, 27, 31, 0.94)" : "rgba(250, 248, 243, 0.98)",
    ink: isDark ? "#f2f1ec" : "#171719",
    muted: isDark ? "#9b9a96" : "#66645f",
    subtle: isDark ? "#61615f" : "#96938d",
    signal: isDark ? "#ff4d61" : "#cf3148",
    signalSoft: isDark ? "#ff9ba5" : "#a01e34",
    success: isDark ? "#a8f0c1" : "#16734a",
    warning: isDark ? "#ffc96b" : "#9a5a00",
    info: isDark ? "#c3c8ff" : "#4d57a9",
    divider: isDark ? "rgba(242, 241, 236, 0.14)" : "rgba(23, 23, 25, 0.14)",
    dividerStrong: isDark ? "rgba(242, 241, 236, 0.28)" : "rgba(23, 23, 25, 0.28)",
  };

  const theme = createTheme({
    palette: {
      mode,
      primary: { main: space.signal, contrastText: "#fffdf9" },
      secondary: { main: space.ink },
      success: { main: space.success },
      error: { main: space.signal },
      warning: { main: space.warning },
      info: { main: space.info },
      background: { default: space.void, paper: space.surface },
      text: { primary: space.ink, secondary: space.muted },
      divider: space.divider,
      action: {
        hover: alpha(space.ink, isDark ? 0.07 : 0.05),
        selected: alpha(space.signal, isDark ? 0.16 : 0.1),
        disabledBackground: alpha(space.ink, isDark ? 0.08 : 0.06),
      },
    },
    typography: baseTypography,
    shape: { borderRadius: 0 },
  });

  const hairline = `1px solid ${space.divider}`;
  const raisedShadow = isDark
    ? "0 24px 56px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.04)"
    : "0 18px 42px rgba(31, 28, 24, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)";

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
                  "radial-gradient(circle at 50% -18%, rgba(255, 255, 255, 0.08), transparent 34%)",
                  "radial-gradient(circle at 96% 78%, rgba(255, 77, 97, 0.13), transparent 26%)",
                  "linear-gradient(145deg, #111215 0%, #070708 48%, #09090a 100%)",
                ].join(", ")
              : [
                  "radial-gradient(circle at 50% -12%, rgba(255, 255, 255, 0.94), transparent 34%)",
                  "radial-gradient(circle at 98% 78%, rgba(207, 49, 72, 0.1), transparent 26%)",
                  "linear-gradient(145deg, #f8f6f0 0%, #eeece6 50%, #e7e4de 100%)",
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
            background: alpha(space.ink, isDark ? 0.28 : 0.22),
            border: `2px solid ${space.void}`,
            backgroundClip: "padding-box",
          },
          "*::-webkit-scrollbar-thumb:hover": { background: alpha(space.signal, isDark ? 0.8 : 0.65) },
          "::selection": { backgroundColor: alpha(space.signal, isDark ? 0.48 : 0.28), color: "#fffdf9" },
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
                backgroundSize: "100% 1px, 1px 24px, 1px 24px, 100% 1px, 1px 100%, 1px 0, 1px 0, 1px 0, 0 1px, 0 1px, 100% 100%",
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
              borderColor: alpha(space.signal, isDark ? 0.72 : 0.62),
              boxShadow: isDark
                ? "0 26px 60px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.06)"
                : "0 22px 50px rgba(31, 28, 24, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.94)",
            },
            '&[data-card-trace="enter"]': {
              animation: "card-perimeter-enter 680ms cubic-bezier(0.45, 0, 0.55, 1) both",
            },
            '&[data-card-trace="leave"]': {
              animation: "card-perimeter-leave 800ms cubic-bezier(0.45, 0, 0.55, 1) both",
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
            "&:active": { transform: "scale(0.98)" },
          },
          contained: {
            boxShadow: "none",
            "&:hover": { boxShadow: "none" },
          },
          outlined: {
            borderColor: alpha(space.ink, isDark ? 0.48 : 0.36),
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
            border: `1px solid ${alpha(space.ink, isDark ? 0.22 : 0.18)}`,
            transitionProperty: "background-color, border-color, color, transform",
            transitionDuration: "150ms",
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
            "& .MuiOutlinedInput-notchedOutline": { borderColor: alpha(space.ink, isDark ? 0.23 : 0.22) },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: alpha(space.ink, isDark ? 0.56 : 0.46) },
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
            backgroundImage: `linear-gradient(180deg, ${alpha(space.ink, isDark ? 0.05 : 0.34)}, transparent 20%), linear-gradient(145deg, ${space.surfaceRaised}, ${space.surface})`,
            backgroundColor: space.surface,
            borderRight: hairline,
            boxShadow: isDark ? "18px 0 56px rgba(0, 0, 0, 0.3)" : "18px 0 56px rgba(31, 28, 24, 0.08)",
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
            backgroundColor: alpha(space.ink, isDark ? 0.055 : 0.05),
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: { "&.MuiTableRow-hover:hover": { backgroundColor: alpha(space.signal, isDark ? 0.075 : 0.045) } },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 0,
            backgroundColor: isDark ? "rgba(20, 20, 22, 0.97)" : "rgba(255, 254, 250, 0.98)",
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
