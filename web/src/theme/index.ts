import { alpha, createTheme } from "@mui/material/styles";

const baseTypography = {
  fontFamily: [
    '"Segoe UI"',
    "Roboto",
    '"Noto Sans SC"',
    "Inter",
    "sans-serif",
  ].join(","),
  h4: {
    fontWeight: 700,
    letterSpacing: "0.02em",
  },
  h5: {
    fontWeight: 700,
    letterSpacing: "0.03em",
  },
  h6: {
    fontWeight: 700,
    letterSpacing: "0.04em",
  },
  button: {
    textTransform: "none" as const,
    fontWeight: 700,
    letterSpacing: "0.04em",
  },
};

function createClashTheme(mode: "light" | "dark") {
  const isDark = mode === "dark";
  const theme = createTheme({
    palette: {
      mode,
      primary: { main: isDark ? "#d6dde8" : "#181c22" },
      secondary: { main: isDark ? "#8fa0b8" : "#566274" },
      success: { main: "#2e7d32" },
      error: { main: "#c62828" },
      warning: { main: "#b26a00" },
      background: {
        default: isDark ? "#10161d" : "#dfe6ef",
        paper: isDark ? "rgba(20, 27, 36, 0.78)" : "rgba(255, 255, 255, 0.62)",
      },
      text: {
        primary: isDark ? "#edf2f8" : "#171b21",
        secondary: isDark ? "#9aa8b8" : "#647181",
      },
      divider: isDark ? "rgba(214, 221, 232, 0.12)" : "rgba(23, 27, 33, 0.1)",
    },
    typography: baseTypography,
    shape: {
      borderRadius: 6,
    },
  });

  return createTheme(theme, {
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            background: isDark
              ? "radial-gradient(circle at 20% 20%, #1d2732 0%, #10161d 58%, #0b1016 100%)"
              : "radial-gradient(circle at 20% 20%, #f3f6f9 0%, #dde4ed 100%)",
          },
          "#root": {
            minHeight: "100vh",
          },
          "*::-webkit-scrollbar": {
            width: "8px",
            height: "8px",
          },
          "*::-webkit-scrollbar-thumb": {
            background: isDark ? "rgba(214, 221, 232, 0.18)" : "rgba(0, 0, 0, 0.14)",
            borderRadius: "999px",
          },
        },
      },
      MuiCard: {
        defaultProps: {
          variant: "outlined",
        },
        styleOverrides: {
          root: {
            backgroundImage: "none",
            backgroundColor: theme.palette.background.paper,
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            borderColor: theme.palette.divider,
            boxShadow: isDark
              ? "0 18px 40px rgba(0, 0, 0, 0.22)"
              : "0 18px 40px rgba(15, 23, 42, 0.08)",
            position: "relative",
            overflow: "hidden",
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
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
            border: `1px solid ${theme.palette.divider}`,
            backgroundColor: isDark
              ? "rgba(17, 23, 31, 0.74)"
              : "rgba(255, 255, 255, 0.68)",
            backdropFilter: "blur(20px) saturate(140%)",
            WebkitBackdropFilter: "blur(20px) saturate(140%)",
            boxShadow: isDark
              ? "0 18px 48px rgba(0, 0, 0, 0.34)"
              : "0 18px 48px rgba(15, 23, 42, 0.12)",
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
            fontWeight: 600,
            "&.Mui-selected": {
              backgroundColor: alpha(theme.palette.primary.main, isDark ? 0.18 : 0.1),
            },
            "&.Mui-selected:hover": {
              backgroundColor: alpha(theme.palette.primary.main, isDark ? 0.24 : 0.14),
            },
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          icon: {
            opacity: 0.72,
          },
          select: {
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            paddingInline: 16,
          },
          contained: {
            boxShadow: "none",
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            fontWeight: 700,
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
            borderRadius: 4,
            backgroundColor: isDark
              ? alpha("#ffffff", 0.03)
              : alpha("#ffffff", 0.48),
            fontFamily: '"Courier New", monospace',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: isDark ? "rgba(17, 23, 31, 0.82)" : "rgba(248, 250, 252, 0.78)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderColor: theme.palette.divider,
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: {
            height: 2,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 42,
            fontWeight: 700,
            letterSpacing: "0.05em",
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 4,
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            overflow: "hidden",
          },
        },
      },
    },
  });
}

export const darkTheme = createClashTheme("dark");
export const lightTheme = createClashTheme("light");
