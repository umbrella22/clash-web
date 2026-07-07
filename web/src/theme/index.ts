import { alpha, createTheme } from "@mui/material/styles";

const monoFont = [
  '"JetBrains Mono"',
  '"SFMono-Regular"',
  '"Cascadia Code"',
  '"Courier New"',
  "monospace",
].join(",");

const baseTypography = {
  fontFamily: [
    '"Inter"',
    '"Segoe UI"',
    "Roboto",
    '"Noto Sans SC"',
    "sans-serif",
  ].join(","),
  h4: {
    fontWeight: 800,
    letterSpacing: "0.02em",
    textWrap: "balance" as const,
  },
  h5: {
    fontWeight: 800,
    letterSpacing: "0.08em",
    textWrap: "balance" as const,
  },
  h6: {
    fontWeight: 800,
    letterSpacing: "0.04em",
    textWrap: "balance" as const,
  },
  body1: {
    textWrap: "pretty" as const,
  },
  body2: {
    textWrap: "pretty" as const,
  },
  button: {
    textTransform: "none" as const,
    fontWeight: 800,
    letterSpacing: "0.04em",
  },
};

function createClashTheme(mode: "light" | "dark") {
  const isDark = mode === "dark";
  const space = {
    void: isDark ? "#030712" : "#dfeaf2",
    deck: isDark ? "#07111d" : "#edf7fb",
    glass: isDark ? "rgba(8, 18, 31, 0.68)" : "rgba(246, 253, 255, 0.72)",
    glassStrong: isDark ? "rgba(10, 28, 45, 0.78)" : "rgba(255, 255, 255, 0.82)",
    cyan: isDark ? "#5df2ff" : "#007b8f",
    violet: isDark ? "#b79cff" : "#6757d8",
    amber: isDark ? "#ffd166" : "#a15c00",
    green: isDark ? "#5dffb2" : "#077f4f",
    red: isDark ? "#ff5c8a" : "#c02654",
    text: isDark ? "#e9fbff" : "#0b1721",
    textMuted: isDark ? "#91aec2" : "#486173",
    ring: isDark ? "rgba(93, 242, 255, 0.24)" : "rgba(0, 123, 143, 0.2)",
    ringSoft: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)",
  };

  const theme = createTheme({
    palette: {
      mode,
      primary: { main: space.cyan, contrastText: isDark ? "#021018" : "#ffffff" },
      secondary: { main: space.violet },
      success: { main: space.green },
      error: { main: space.red },
      warning: { main: space.amber },
      info: { main: isDark ? "#6bb7ff" : "#0969b8" },
      background: {
        default: space.void,
        paper: space.glass,
      },
      text: {
        primary: space.text,
        secondary: space.textMuted,
      },
      divider: isDark ? "rgba(132, 229, 255, 0.14)" : "rgba(0, 68, 84, 0.12)",
      action: {
        hover: isDark ? "rgba(93, 242, 255, 0.08)" : "rgba(0, 123, 143, 0.08)",
        selected: isDark ? "rgba(93, 242, 255, 0.14)" : "rgba(0, 123, 143, 0.12)",
        disabledBackground: isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.06)",
      },
    },
    typography: baseTypography,
    shape: {
      borderRadius: 8,
    },
  });

  const glassShadow = isDark
    ? [
        `0 0 0 1px ${alpha(space.cyan, 0.14)}`,
        "0 18px 44px rgba(0, 0, 0, 0.42)",
        `inset 0 1px 0 ${alpha("#ffffff", 0.1)}`,
      ].join(", ")
    : [
        "0 0 0 1px rgba(0, 0, 0, 0.08)",
        "0 18px 44px rgba(31, 77, 92, 0.15)",
        "inset 0 1px 0 rgba(255, 255, 255, 0.72)",
      ].join(", ");

  const glassShadowHover = isDark
    ? [
        `0 0 0 1px ${alpha(space.cyan, 0.28)}`,
        `0 0 28px ${alpha(space.cyan, 0.1)}`,
        "0 24px 58px rgba(0, 0, 0, 0.5)",
        `inset 0 1px 0 ${alpha("#ffffff", 0.12)}`,
      ].join(", ")
    : [
        "0 0 0 1px rgba(0, 0, 0, 0.1)",
        "0 24px 58px rgba(31, 77, 92, 0.18)",
        "inset 0 1px 0 rgba(255, 255, 255, 0.84)",
      ].join(", ");

  return createTheme(theme, {
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            WebkitFontSmoothing: "antialiased",
            MozOsxFontSmoothing: "grayscale",
          },
          body: {
            color: space.text,
            backgroundColor: space.void,
            backgroundImage: isDark
              ? [
                  "radial-gradient(circle at 12% 14%, rgba(93, 242, 255, 0.16) 0, transparent 28%)",
                  "radial-gradient(circle at 82% 12%, rgba(183, 156, 255, 0.13) 0, transparent 24%)",
                  "radial-gradient(circle at 76% 88%, rgba(255, 209, 102, 0.1) 0, transparent 26%)",
                  "linear-gradient(135deg, #030712 0%, #07111d 48%, #02040a 100%)",
                ].join(", ")
              : [
                  "radial-gradient(circle at 14% 16%, rgba(0, 188, 212, 0.2) 0, transparent 30%)",
                  "radial-gradient(circle at 86% 12%, rgba(103, 87, 216, 0.14) 0, transparent 24%)",
                  "linear-gradient(135deg, #edf7fb 0%, #dbe8f0 54%, #f8fbff 100%)",
                ].join(", "),
            fontVariantNumeric: "tabular-nums",
          },
          "#root": {
            minHeight: "100vh",
            position: "relative",
            isolation: "isolate",
          },
          "h1, h2, h3, h4, h5, h6": {
            textWrap: "balance",
          },
          "p, li, figcaption": {
            textWrap: "pretty",
          },
          "*::-webkit-scrollbar": {
            width: "10px",
            height: "10px",
          },
          "*::-webkit-scrollbar-track": {
            background: isDark ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 0, 0, 0.04)",
          },
          "*::-webkit-scrollbar-thumb": {
            background: isDark
              ? "linear-gradient(180deg, rgba(93, 242, 255, 0.55), rgba(183, 156, 255, 0.35))"
              : "linear-gradient(180deg, rgba(0, 123, 143, 0.46), rgba(103, 87, 216, 0.28))",
            border: "2px solid transparent",
            borderRadius: "999px",
            backgroundClip: "padding-box",
          },
        },
      },
      MuiCard: {
        defaultProps: {
          variant: "outlined",
        },
        styleOverrides: {
          root: {
            backgroundImage: `linear-gradient(145deg, ${space.glassStrong}, ${space.glass})`,
            backgroundColor: space.glass,
            backdropFilter: "blur(24px) saturate(150%)",
            WebkitBackdropFilter: "blur(24px) saturate(150%)",
            borderColor: "transparent",
            borderRadius: 8,
            boxShadow: glassShadow,
            position: "relative",
            overflow: "hidden",
            transitionProperty: "box-shadow, transform, background-color",
            transitionDuration: "180ms",
            transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
            "&::before": {
              content: '""',
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              backgroundImage: [
                `linear-gradient(90deg, ${alpha(space.cyan, 0.18)}, transparent 22%, transparent 78%, ${alpha(space.violet, 0.1)})`,
                `linear-gradient(180deg, ${alpha("#ffffff", isDark ? 0.08 : 0.55)}, transparent 34%)`,
              ].join(", "),
              opacity: 0.72,
            },
            "&:hover": {
              boxShadow: glassShadowHover,
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: `linear-gradient(145deg, ${space.glassStrong}, ${space.glass})`,
            backgroundColor: space.glass,
            backdropFilter: "blur(20px) saturate(145%)",
            WebkitBackdropFilter: "blur(20px) saturate(145%)",
          },
        },
      },
      MuiMenu: {
        defaultProps: {
          slotProps: {
            paper: {
              elevation: 0,
            },
          },
        },
        styleOverrides: {
          paper: {
            marginTop: 8,
            borderRadius: 8,
            backgroundImage: `linear-gradient(145deg, ${space.glassStrong}, ${space.glass})`,
            boxShadow: glassShadowHover,
            border: `1px solid ${space.ring}`,
            overflow: "hidden",
          },
          list: {
            paddingBlock: 6,
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            marginInline: 6,
            borderRadius: 6,
            fontWeight: 700,
            letterSpacing: "0.02em",
            transitionProperty: "background-color, color, transform",
            transitionDuration: "150ms",
            "&:hover": {
              transform: "translateX(2px)",
            },
            "&.Mui-selected": {
              backgroundColor: alpha(space.cyan, isDark ? 0.18 : 0.12),
              color: theme.palette.text.primary,
            },
            "&.Mui-selected:hover": {
              backgroundColor: alpha(space.cyan, isDark ? 0.24 : 0.16),
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            minHeight: 40,
            borderRadius: 8,
            paddingInline: 16,
            position: "relative",
            overflow: "hidden",
            transitionProperty: "transform, box-shadow, background-color, border-color, color",
            transitionDuration: "160ms",
            transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
            "&:active": {
              transform: "scale(0.96)",
            },
            "&.Mui-disabled": {
              transform: "none",
            },
          },
          contained: {
            color: isDark ? "#021018" : "#ffffff",
            backgroundImage: `linear-gradient(135deg, ${space.cyan}, ${isDark ? "#8fffd5" : "#009ab0"})`,
            boxShadow: `0 0 0 1px ${alpha(space.cyan, 0.2)}, 0 12px 28px ${alpha(space.cyan, isDark ? 0.18 : 0.16)}`,
            "&:hover": {
              backgroundImage: `linear-gradient(135deg, ${isDark ? "#86f7ff" : "#009ab0"}, ${isDark ? "#baffdf" : "#007b8f"})`,
              boxShadow: `0 0 0 1px ${alpha(space.cyan, 0.34)}, 0 16px 34px ${alpha(space.cyan, isDark ? 0.24 : 0.2)}`,
            },
            "&.Mui-disabled": {
              color: alpha(space.text, isDark ? 0.72 : 0.62),
              backgroundImage: "none",
              backgroundColor: alpha(space.deck, isDark ? 0.82 : 0.74),
              boxShadow: `inset 0 0 0 1px ${alpha(space.cyan, isDark ? 0.18 : 0.14)}`,
            },
          },
          outlined: {
            borderColor: alpha(space.cyan, isDark ? 0.32 : 0.3),
            backgroundColor: alpha(space.cyan, isDark ? 0.05 : 0.06),
            boxShadow: `inset 0 0 0 1px ${alpha("#ffffff", isDark ? 0.04 : 0.42)}`,
            "&:hover": {
              borderColor: alpha(space.cyan, isDark ? 0.6 : 0.5),
              backgroundColor: alpha(space.cyan, isDark ? 0.1 : 0.1),
              boxShadow: `0 0 22px ${alpha(space.cyan, isDark ? 0.12 : 0.08)}`,
            },
            "&.Mui-disabled": {
              color: alpha(space.text, isDark ? 0.6 : 0.5),
              borderColor: alpha(space.cyan, isDark ? 0.16 : 0.12),
              backgroundColor: alpha(space.deck, isDark ? 0.5 : 0.52),
              boxShadow: `inset 0 0 0 1px ${alpha("#ffffff", isDark ? 0.03 : 0.32)}`,
            },
          },
          text: {
            "&:hover": {
              backgroundColor: alpha(space.cyan, isDark ? 0.08 : 0.08),
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            width: 40,
            height: 40,
            borderRadius: 8,
            color: theme.palette.text.secondary,
            transitionProperty: "transform, color, background-color, box-shadow",
            transitionDuration: "160ms",
            "&:hover": {
              color: theme.palette.text.primary,
              backgroundColor: alpha(space.cyan, isDark ? 0.1 : 0.08),
              boxShadow: `0 0 0 1px ${alpha(space.cyan, 0.18)}`,
            },
            "&:active": {
              transform: "scale(0.96)",
            },
            "&.Mui-disabled": {
              color: alpha(space.text, isDark ? 0.52 : 0.44),
              backgroundColor: alpha(space.deck, isDark ? 0.48 : 0.56),
              boxShadow: `inset 0 0 0 1px ${alpha(space.cyan, isDark ? 0.14 : 0.1)}`,
              transform: "none",
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            fontWeight: 800,
            letterSpacing: "0.03em",
            backgroundColor: alpha(space.cyan, isDark ? 0.1 : 0.08),
            boxShadow: `inset 0 0 0 1px ${space.ringSoft}`,
          },
          outlined: {
            borderColor: alpha(space.cyan, isDark ? 0.34 : 0.26),
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          variant: "outlined",
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            backgroundColor: alpha(space.deck, isDark ? 0.62 : 0.72),
            fontFamily: monoFont,
            boxShadow: `inset 0 0 0 1px ${alpha("#ffffff", isDark ? 0.04 : 0.42)}`,
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            transitionProperty: "box-shadow, background-color",
            transitionDuration: "160ms",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: alpha(space.cyan, isDark ? 0.22 : 0.22),
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: alpha(space.cyan, isDark ? 0.42 : 0.4),
            },
            "&.Mui-focused": {
              boxShadow: `0 0 0 1px ${alpha(space.cyan, 0.38)}, 0 0 26px ${alpha(space.cyan, isDark ? 0.14 : 0.1)}`,
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: space.cyan,
            },
          },
          input: {
            letterSpacing: "0.02em",
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            letterSpacing: "0.04em",
            fontWeight: 700,
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          icon: {
            opacity: 0.72,
            color: theme.palette.text.secondary,
          },
          select: {
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundImage: [
              `linear-gradient(180deg, ${alpha(space.cyan, isDark ? 0.11 : 0.1)}, transparent 26%)`,
              `linear-gradient(145deg, ${space.glassStrong}, ${space.glass})`,
            ].join(", "),
            backgroundColor: space.glass,
            backdropFilter: "blur(28px) saturate(150%)",
            WebkitBackdropFilter: "blur(28px) saturate(150%)",
            borderColor: alpha(space.cyan, isDark ? 0.18 : 0.16),
            boxShadow: isDark
              ? `16px 0 50px rgba(0, 0, 0, 0.42), inset -1px 0 0 ${alpha(space.cyan, 0.16)}`
              : `16px 0 50px rgba(31, 77, 92, 0.14), inset -1px 0 0 ${alpha(space.cyan, 0.18)}`,
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: {
            minHeight: 44,
          },
          indicator: {
            height: 2,
            borderRadius: 999,
            background: `linear-gradient(90deg, ${space.cyan}, ${space.violet})`,
            boxShadow: `0 0 18px ${alpha(space.cyan, 0.45)}`,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 44,
            fontWeight: 800,
            letterSpacing: "0.05em",
            transitionProperty: "color, background-color",
            transitionDuration: "150ms",
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            boxShadow: `inset 0 0 0 1px ${space.ringSoft}`,
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            height: 8,
            borderRadius: 999,
            overflow: "hidden",
            backgroundColor: alpha(space.cyan, isDark ? 0.1 : 0.12),
            boxShadow: `inset 0 0 0 1px ${alpha(space.cyan, 0.12)}`,
          },
          bar: {
            borderRadius: 999,
            backgroundImage: `linear-gradient(90deg, ${space.cyan}, ${space.green})`,
            boxShadow: `0 0 18px ${alpha(space.cyan, 0.44)}`,
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottomColor: alpha(space.cyan, isDark ? 0.12 : 0.1),
          },
          head: {
            color: theme.palette.text.secondary,
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            backgroundColor: alpha(space.cyan, isDark ? 0.06 : 0.05),
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 6,
            backgroundColor: isDark ? "rgba(5, 14, 23, 0.92)" : "rgba(250, 254, 255, 0.92)",
            color: theme.palette.text.primary,
            boxShadow: glassShadow,
            border: `1px solid ${space.ring}`,
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            fontWeight: 700,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 8,
            boxShadow: glassShadowHover,
            border: `1px solid ${space.ring}`,
          },
        },
      },
    },
  });
}

export const darkTheme = createClashTheme("dark");
export const lightTheme = createClashTheme("light");
