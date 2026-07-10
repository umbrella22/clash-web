import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import DashboardIcon from "@mui/icons-material/Dashboard";
import PublicIcon from "@mui/icons-material/Public";
import DescriptionIcon from "@mui/icons-material/Description";
import LinkIcon from "@mui/icons-material/Link";
import TerminalIcon from "@mui/icons-material/Terminal";
import GavelIcon from "@mui/icons-material/Gavel";
import SettingsIcon from "@mui/icons-material/Settings";
import MenuIcon from "@mui/icons-material/Menu";

import { useMihomoDownloadTaskContext } from "../contexts/MihomoDownloadTaskContext";
import {
  describeDownloadStatus,
  formatBytes,
  formatRemainingTime,
} from "../features/mihomoDownload";
import { useStatus } from "../hooks/useApi";

const DRAWER_WIDTH = 258;

const navItems = [
  { key: "overview", path: "/", code: "01", icon: <DashboardIcon /> },
  { key: "proxies", path: "/proxies", code: "02", icon: <PublicIcon /> },
  { key: "profiles", path: "/profiles", code: "03", icon: <DescriptionIcon /> },
  { key: "connections", path: "/connections", code: "04", icon: <LinkIcon /> },
  { key: "logs", path: "/logs", code: "05", icon: <TerminalIcon /> },
  { key: "rules", path: "/rules", code: "06", icon: <GavelIcon /> },
  { key: "settings", path: "/settings", code: "07", icon: <SettingsIcon /> },
] as const;

interface MainLayoutProps {
  children: ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: status } = useStatus();
  const { progress, actionPending } = useMihomoDownloadTaskContext();

  const isProxyConnected = status?.mihomo_running ?? false;
  const downloadStatusActive = actionPending && progress;
  const activeItem = navItems.find((item) => item.path === location.pathname) ?? navItems[0];
  const sysStatusLabel = downloadStatusActive
    ? t(`settings.download_status_${describeDownloadStatus(progress.status)}`)
    : isProxyConnected
      ? "Proxy linked"
      : "Proxy offline";
  const sysStatusDetail = downloadStatusActive
    ? progress.total > 0
      ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)} · ETA ${formatRemainingTime(progress.remaining_secs)}`
      : progress.message
    : isProxyConnected
      ? status?.version?.version || `${status?.server.host}:${status?.server.port}`
      : "Waiting for mihomo";
  const statusTone = downloadStatusActive ? "info" : isProxyConnected ? "success" : "error";
  const statusColor = `${statusTone}.main`;

  const drawer = (
    <Box
      sx={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: theme.palette.mode === "dark" ? 0.68 : 0.45,
          backgroundImage: [
            `linear-gradient(${alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.055 : 0.06)} 1px, transparent 1px)`,
            `linear-gradient(90deg, ${alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.055 : 0.06)} 1px, transparent 1px)`,
            `radial-gradient(circle at 100% 18%, ${alpha(theme.palette.primary.main, 0.22)}, transparent 28%)`,
          ].join(", "),
          backgroundSize: "36px 36px, 36px 36px, 100% 100%",
          maskImage: "linear-gradient(to bottom, black 0%, black 72%, transparent 100%)",
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          right: -84,
          top: 42,
          width: 178,
          height: 178,
          border: `1px solid ${alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.24 : 0.18)}`,
          borderRadius: "50%",
          opacity: 0.76,
          "&::before, &::after": {
            content: '""',
            position: "absolute",
            borderRadius: "50%",
            inset: 20,
            border: `1px solid ${alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.12 : 0.1)}`,
          },
          "&::after": {
            inset: 43,
            borderColor: alpha(theme.palette.primary.main, 0.72),
            animation: "layout-beacon 3.4s ease-in-out infinite",
          },
        }}
      />

      <Box
        sx={{
          px: 3,
          pt: 3,
          pb: 2.5,
          position: "relative",
          zIndex: 1,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography
          sx={{
            fontFamily: '"JetBrains Mono", "Courier New", monospace',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.16em",
            color: "primary.main",
          }}
        >
          // NETWORK CONTROL
        </Typography>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mt: 1.15 }}>
          <Typography
            component="span"
            sx={{
              fontFamily: '"JetBrains Mono", "Courier New", monospace',
              fontSize: 31,
              fontWeight: 900,
              letterSpacing: "-0.08em",
              lineHeight: 0.95,
              color: "text.primary",
            }}
          >
            CLASH
          </Typography>
          <Typography
            component="span"
            sx={{
              fontFamily: '"JetBrains Mono", "Courier New", monospace',
              fontSize: 12,
              letterSpacing: "0.18em",
              color: "text.secondary",
            }}
          >
            WEB
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.75 }}>
          <Box
            sx={{
              width: 7,
              height: 7,
              bgcolor: statusColor,
              boxShadow: (currentTheme) => `0 0 14px ${currentTheme.palette[statusTone].main}`,
              animation: isProxyConnected || downloadStatusActive ? "layout-status-pulse 2s ease-in-out infinite" : "none",
            }}
          />
          <Typography
            sx={{
              fontFamily: '"JetBrains Mono", "Courier New", monospace',
              fontSize: 10,
              letterSpacing: "0.13em",
              color: "text.secondary",
            }}
          >
            {isProxyConnected ? "LINK ESTABLISHED" : "AWAITING LINK"}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ px: 1.5, pt: 2.25, pb: 0.75, position: "relative", zIndex: 1 }}>
        <Typography
          sx={{
            px: 1.5,
            mb: 1,
            fontFamily: '"JetBrains Mono", "Courier New", monospace',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.16em",
            color: "text.secondary",
          }}
        >
          SYSTEM MODULES
        </Typography>
        <List disablePadding>
          {navItems.map((item) => {
            const selected = location.pathname === item.path;
            return (
              <ListItem key={item.key} disablePadding sx={{ mb: 0.35 }}>
                <ListItemButton
                  selected={selected}
                  onClick={() => {
                    navigate(item.path);
                    if (isMobile) setMobileOpen(false);
                  }}
                  sx={{
                    minHeight: 48,
                    px: 1.5,
                    gap: 1.25,
                    color: selected ? "text.primary" : "text.secondary",
                    borderLeft: "2px solid transparent",
                    borderTop: `1px solid ${selected ? alpha(theme.palette.text.primary, 0.12) : "transparent"}`,
                    borderBottom: `1px solid ${selected ? alpha(theme.palette.text.primary, 0.12) : "transparent"}`,
                    transitionProperty: "background-color, color, border-color, transform",
                    transitionDuration: "160ms",
                    "&:hover": {
                      color: "text.primary",
                      backgroundColor: alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.055 : 0.045),
                      transform: "translateX(3px)",
                    },
                    "&.Mui-selected": {
                      backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.14 : 0.09),
                      borderLeftColor: "primary.main",
                    },
                    "&.Mui-selected:hover": {
                      backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.19 : 0.12),
                    },
                  }}
                >
                  <Typography
                    sx={{
                      width: 21,
                      flex: "0 0 auto",
                      fontFamily: '"JetBrains Mono", "Courier New", monospace',
                      fontSize: 10,
                      fontWeight: 700,
                      color: selected ? "primary.main" : "text.secondary",
                    }}
                  >
                    {item.code}
                  </Typography>
                  <ListItemIcon
                    sx={{
                      minWidth: 0,
                      color: "inherit",
                      display: "grid",
                      placeItems: "center",
                      "& .MuiSvgIcon-root": { fontSize: 20 },
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={t(`nav.${item.key}`)}
                    secondary={selected ? "ACTIVE CHANNEL" : undefined}
                    slotProps={{
                      primary: { sx: { fontSize: 13, fontWeight: 760, letterSpacing: "0.025em", lineHeight: 1.12 } },
                      secondary: {
                        sx: {
                          mt: 0.35,
                          fontFamily: '"JetBrains Mono", "Courier New", monospace',
                          fontSize: 9,
                          letterSpacing: "0.12em",
                          color: "primary.main",
                        },
                      },
                    }}
                    sx={{ my: 0, minWidth: 0 }}
                  />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Box>

      <Box
        sx={{
          mt: "auto",
          px: 3,
          py: 2.25,
          position: "relative",
          zIndex: 1,
          borderTop: 1,
          borderColor: "divider",
          backgroundColor: alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.025 : 0.035),
        }}
      >
        <Typography
          sx={{
            fontFamily: '"JetBrains Mono", "Courier New", monospace',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.16em",
            color: "text.secondary",
          }}
        >
          LIVE STATUS
        </Typography>
        <Typography sx={{ mt: 0.8, fontSize: 14, fontWeight: 760, color: "text.primary" }}>
          {sysStatusLabel}
        </Typography>
        <Typography
          sx={{
            mt: 0.45,
            minHeight: 30,
            fontFamily: '"JetBrains Mono", "Courier New", monospace',
            fontSize: 10,
            lineHeight: 1.5,
            letterSpacing: "0.02em",
            color: "text.secondary",
            overflowWrap: "anywhere",
          }}
        >
          {sysStatusDetail}
        </Typography>
        <Box sx={{ height: 3, mt: 1.25, overflow: "hidden", backgroundColor: alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.1 : 0.1) }}>
          <Box
            sx={{
              width: "42%",
              height: "100%",
              backgroundColor: statusColor,
              boxShadow: (currentTheme) => `0 0 14px ${currentTheme.palette[statusTone].main}`,
              animation: downloadStatusActive || isProxyConnected ? "layout-loader 2.2s ease-in-out infinite" : "none",
            }}
          />
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        position: "relative",
        "@keyframes layout-loader": {
          "0%": { transform: "translateX(-120%)" },
          "52%, 100%": { transform: "translateX(340%)" },
        },
        "@keyframes layout-status-pulse": {
          "0%, 100%": { opacity: 0.65, transform: "scale(0.9)" },
          "50%": { opacity: 1, transform: "scale(1.2)" },
        },
        "@keyframes layout-beacon": {
          "0%, 100%": { opacity: 0.22, transform: "scale(0.82)" },
          "50%": { opacity: 0.9, transform: "scale(1)" },
        },
      }}
    >
      {isMobile && (
        <IconButton
          aria-label="Open navigation"
          onClick={() => setMobileOpen((open) => !open)}
          sx={{
            position: "fixed",
            top: 14,
            left: 14,
            zIndex: 1300,
            backgroundColor: "background.paper",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.18)",
          }}
        >
          <MenuIcon />
        </IconButton>
      )}

      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: 0, minHeight: "100vh" }}>
        {isMobile ? (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ "& .MuiDrawer-paper": { boxSizing: "border-box", width: DRAWER_WIDTH, minHeight: "100vh" } }}
          >
            {drawer}
          </Drawer>
        ) : (
          <Drawer
            variant="permanent"
            open
            sx={{
              "& .MuiDrawer-paper": {
                boxSizing: "border-box",
                width: DRAWER_WIDTH,
                position: "fixed",
                inset: "0 auto 0 0",
                minHeight: "100vh",
              },
            }}
          >
            {drawer}
          </Drawer>
        )}
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          minHeight: "100vh",
          overflow: "auto",
          position: "relative",
          px: { xs: 1.5, md: 4 },
          pb: { xs: 2.5, md: 4 },
          pt: { xs: 7.5, md: 2.25 },
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            opacity: theme.palette.mode === "dark" ? 0.54 : 0.4,
            backgroundImage: [
              `linear-gradient(${alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.035 : 0.045)} 1px, transparent 1px)`,
              `linear-gradient(90deg, ${alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.035 : 0.045)} 1px, transparent 1px)`,
            ].join(", "),
            backgroundSize: { xs: "32px 32px", md: "56px 56px" },
            maskImage: "linear-gradient(to bottom, black 0%, transparent 62%)",
          }}
        />
        <Box sx={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 1640, mx: "auto" }}>
          <Box
            sx={{
              minHeight: 42,
              mb: { xs: 2, md: 3 },
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
              <Typography
                sx={{
                  fontFamily: '"JetBrains Mono", "Courier New", monospace',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  color: "primary.main",
                  whiteSpace: "nowrap",
                }}
              >
                {activeItem.code} /
              </Typography>
              <Typography
                sx={{
                  fontFamily: '"JetBrains Mono", "Courier New", monospace',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  color: "text.secondary",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t(`nav.${activeItem.key}`).toUpperCase()} · CONTROL SURFACE
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flex: "0 0 auto" }}>
              <Box sx={{ width: 6, height: 6, bgcolor: statusColor, animation: isProxyConnected ? "layout-status-pulse 2s ease-in-out infinite" : "none" }} />
              <Typography
                sx={{
                  fontFamily: '"JetBrains Mono", "Courier New", monospace',
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  color: "text.secondary",
                }}
              >
                {isProxyConnected ? "ONLINE" : "OFFLINE"}
              </Typography>
            </Box>
          </Box>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
