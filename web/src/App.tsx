import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Box,
  CircularProgress,
  CssBaseline,
  ThemeProvider,
  Typography,
} from "@mui/material";
import { createContext, useContext, useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import MainLayout from "./layouts/MainLayout";
import ConnectionsPage from "./pages/ConnectionsPage";
import LoginPage from "./pages/LoginPage";
import LogsPage from "./pages/LogsPage";
import OverviewPage from "./pages/OverviewPage";
import ProfilesPage from "./pages/ProfilesPage";
import ProxiesPage from "./pages/ProxiesPage";
import RulesPage from "./pages/RulesPage";
import SettingsPage from "./pages/SettingsPage";
import { MihomoDownloadTaskProvider } from "./contexts/MihomoDownloadTaskContext";
import {
  clearStoredToken,
  getAuthStatus,
  loginWithToken,
  setStoredToken,
} from "./services/api";
import { darkTheme, lightTheme } from "./theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function getThemeMode(): "dark" | "light" {
  const saved = localStorage.getItem("clash-web-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

interface ThemeContextType {
  mode: "dark" | "light";
  toggleTheme: () => void;
  setThemeMode: (mode: "dark" | "light") => void;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: "dark",
  toggleTheme: () => {},
  setThemeMode: () => {},
});

export const useThemeContext = () => useContext(ThemeContext);

interface AuthContextType {
  loading: boolean;
  authRequired: boolean;
  authenticated: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  loading: true,
  authRequired: false,
  authenticated: true,
  login: async () => {},
  logout: () => {},
});

export const useAuthContext = () => useContext(AuthContext);

function MainRoutes() {
  return (
    <Routes>
      <Route path="/" element={<OverviewPage />} />
      <Route path="/proxies" element={<ProxiesPage />} />
      <Route path="/profiles" element={<ProfilesPage />} />
      <Route path="/connections" element={<ConnectionsPage />} />
      <Route path="/logs" element={<LogsPage />} />
      <Route path="/rules" element={<RulesPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AuthLoadingScreen() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <CircularProgress />
      <Typography variant="body2" color="text.secondary">
        Checking authentication...
      </Typography>
    </Box>
  );
}

function AppRouter() {
  const [authState, setAuthState] = useState({
    loading: true,
    authRequired: false,
    authenticated: true,
  });

  useEffect(() => {
    let cancelled = false;

    const syncAuthState = async () => {
      try {
        const { data } = await getAuthStatus();
        if (!cancelled) {
          setAuthState({
            loading: false,
            authRequired: data.auth_required,
            authenticated: data.authenticated,
          });
        }
      } catch {
        if (!cancelled) {
          setAuthState({
            loading: false,
            authRequired: true,
            authenticated: false,
          });
        }
      }
    };

    const handleAuthChange = () => {
      void syncAuthState();
    };

    void syncAuthState();
    window.addEventListener("clash-web-auth-changed", handleAuthChange);
    window.addEventListener("clash-web-auth-unauthorized", handleAuthChange);

    return () => {
      cancelled = true;
      window.removeEventListener("clash-web-auth-changed", handleAuthChange);
      window.removeEventListener("clash-web-auth-unauthorized", handleAuthChange);
    };
  }, []);

  const login = async (token: string) => {
    const { data } = await loginWithToken(token);
    setStoredToken(token);
    setAuthState({
      loading: false,
      authRequired: data.auth_required,
      authenticated: data.authenticated,
    });
  };

  const logout = () => {
    clearStoredToken();
    setAuthState((current) => ({
      ...current,
      authenticated: current.authRequired ? false : true,
    }));
  };

  if (authState.loading) {
    return <AuthLoadingScreen />;
  }

  const needsLogin = authState.authRequired && !authState.authenticated;

  return (
    <AuthContext.Provider value={{ ...authState, login, logout }}>
      <Routes>
        {needsLogin ? (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        ) : (
          <>
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route
              path="*"
              element={
                <MihomoDownloadTaskProvider>
                  <MainLayout>
                    <MainRoutes />
                  </MainLayout>
                </MihomoDownloadTaskProvider>
              }
            />
          </>
        )}
      </Routes>
    </AuthContext.Provider>
  );
}

export default function App() {
  const [mode, setMode] = useState<"dark" | "light">(getThemeMode);
  const theme = mode === "dark" ? darkTheme : lightTheme;

  useEffect(() => {
    document.documentElement.dataset.clashTheme = mode;
  }, [mode]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const getCard = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>(".MuiCard-root") : null;
    const isWithinCard = (card: HTMLElement, target: EventTarget | null) =>
      target instanceof Node && card.contains(target);

    const handlePointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const card = getCard(event.target);
      if (!card || isWithinCard(card, event.relatedTarget)) return;
      card.dataset.cardTrace = "enter";
    };

    const handlePointerOut = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const card = getCard(event.target);
      if (!card || isWithinCard(card, event.relatedTarget)) return;
      card.dataset.cardTrace = "leave";
    };

    const handleAnimationEnd = (event: AnimationEvent) => {
      if (
        !(event.target instanceof HTMLElement) ||
        !event.target.matches(".MuiCard-root") ||
        !["card-perimeter-enter", "card-perimeter-leave"].includes(event.animationName)
      ) {
        return;
      }
      delete event.target.dataset.cardTrace;
    };

    document.addEventListener("pointerover", handlePointerOver);
    document.addEventListener("pointerout", handlePointerOut);
    document.addEventListener("animationend", handleAnimationEnd);

    return () => {
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("animationend", handleAnimationEnd);
    };
  }, []);

  const setThemeMode = (next: "dark" | "light") => {
    setMode(next);
    localStorage.setItem("clash-web-theme", next);
  };

  const toggleTheme = () => {
    setThemeMode(mode === "dark" ? "light" : "dark");
  };

  return (
    <ThemeContext.Provider value={{ mode, toggleTheme, setThemeMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <AppRouter />
          </HashRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </ThemeContext.Provider>
  );
}
