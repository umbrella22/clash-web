import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import PublicIcon from "@mui/icons-material/Public";
import DescriptionIcon from "@mui/icons-material/Description";
import LinkIcon from "@mui/icons-material/Link";
import TerminalIcon from "@mui/icons-material/Terminal";
import GavelIcon from "@mui/icons-material/Gavel";
import SettingsIcon from "@mui/icons-material/Settings";
import MenuIcon from "@mui/icons-material/Menu";

import { useStatus } from "../hooks/useApi";
import { useMihomoDownloadTaskContext } from "../contexts/MihomoDownloadTaskContext";
import {
  describeDownloadStatus,
  formatBytes,
  formatRemainingTime,
} from "../features/mihomoDownload";
import { alpha } from "@mui/material/styles";

const DRAWER_WIDTH = 220;

const navItems = [
  { key: "overview", path: "/", icon: <DashboardIcon /> },
  { key: "proxies", path: "/proxies", icon: <PublicIcon /> },
  { key: "profiles", path: "/profiles", icon: <DescriptionIcon /> },
  { key: "connections", path: "/connections", icon: <LinkIcon /> },
  { key: "logs", path: "/logs", icon: <TerminalIcon /> },
  { key: "rules", path: "/rules", icon: <GavelIcon /> },
  { key: "settings", path: "/settings", icon: <SettingsIcon /> },
];

interface MainLayoutProps {
  children: React.ReactNode;
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
  const sysStatusLabel = downloadStatusActive
    ? t(`settings.download_status_${describeDownloadStatus(progress.status)}`)
    : isProxyConnected
      ? "Proxy Linked"
      : "Proxy Offline";
  const sysStatusDetail = downloadStatusActive
    ? progress.total > 0
      ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)} · ETA ${formatRemainingTime(progress.remaining_secs)}`
      : progress.message
    : isProxyConnected
    ? status?.version?.version || `${status?.server.host}:${status?.server.port}`
    : "Waiting for mihomo";
  const statusColor = downloadStatusActive
    ? "info.main"
    : isProxyConnected
      ? "success.main"
      : "error.main";

  const drawer = (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: theme.palette.mode === "dark" ? 0.5 : 0.34,
          backgroundImage: [
            `linear-gradient(${alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.12 : 0.08)} 1px, transparent 1px)`,
            `linear-gradient(90deg, ${alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.12 : 0.08)} 1px, transparent 1px)`,
            `radial-gradient(circle at 50% 18%, ${alpha(theme.palette.secondary.main, 0.22)}, transparent 44%)`,
          ].join(", "),
          backgroundSize: "32px 32px, 32px 32px, 100% 100%",
          maskImage: "linear-gradient(to bottom, black 50%, transparent 100%)",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          right: -70,
          top: 86,
          width: 160,
          height: 160,
          borderRadius: "50%",
          pointerEvents: "none",
          opacity: 0.34,
          background: `radial-gradient(circle, transparent 48%, ${alpha(theme.palette.primary.main, 0.5)} 49% 50%, transparent 51%),
            repeating-conic-gradient(from 0deg, ${alpha(theme.palette.primary.main, 0.42)} 0deg 6deg, transparent 6deg 18deg)`,
          filter: "drop-shadow(0 0 22px rgba(93, 242, 255, 0.22))",
        }}
      />
      <Box
        sx={{
          px: 3,
          py: 3,
          boxShadow: `inset 0 -1px 0 ${theme.palette.divider}`,
          position: "relative",
          zIndex: 1,
        }}
      >
        <Typography
          sx={{
            fontFamily: '"JetBrains Mono", "Courier New", monospace',
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: 0,
            lineHeight: 1,
            position: "relative",
            display: "inline-flex",
            alignItems: "flex-start",
            gap: 1,
            color: "text.primary",
            textShadow: (theme) =>
              theme.palette.mode === "dark"
                ? `0 0 18px ${alpha(theme.palette.primary.main, 0.32)}`
                : "none",
          }}
        >
          Clash
          <Box
            component="span"
            sx={{
              width: 7,
              height: 7,
              mt: 0.5,
              borderRadius: "50%",
              bgcolor: isProxyConnected ? "success.main" : "error.main",
              boxShadow: (theme) =>
                `0 0 12px ${isProxyConnected ? theme.palette.success.main : theme.palette.error.main}`,
            }}
          />
        </Typography>
        <Typography
          sx={{
            mt: 0.75,
            fontSize: 10,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            color: "text.secondary",
            fontFamily: '"JetBrains Mono", "Courier New", monospace',
          }}
        >
          Web Control Terminal
        </Typography>
      </Box>
      <List sx={{ flex: 1, px: 1.25, py: 1.5, position: "relative", zIndex: 1 }}>
        {navItems.map((item) => (
          <ListItem key={item.key} disablePadding>
            <ListItemButton
              selected={location.pathname === item.path}
              onClick={() => {
                navigate(item.path);
                if (isMobile) setMobileOpen(false);
              }}
              sx={{
                minHeight: 46,
                px: 2,
                borderRadius: 1,
                mb: 0.5,
                alignItems: "center",
                color: "text.secondary",
                transitionProperty: "transform, color, background-color, box-shadow",
                transitionDuration: "180ms",
                transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
                boxShadow: "inset 0 0 0 1px transparent",
                "&:hover": {
                  color: "text.primary",
                  transform: "translateX(4px)",
                  backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.08 : 0.07),
                  boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.16)}`,
                },
                "&.Mui-selected": {
                  color: "text.primary",
                  background: [
                    `linear-gradient(90deg, ${alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.22 : 0.14)}, transparent)`,
                    `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)}, ${alpha(theme.palette.secondary.main, 0.06)})`,
                  ].join(", "),
                  boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.24)}, 0 0 22px ${alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.1 : 0.06)}`,
                },
                "&.Mui-selected::before": {
                  content: '""',
                  position: "absolute",
                  left: -10,
                  top: 0,
                  bottom: 0,
                  width: 3,
                  borderRadius: 999,
                  background: `linear-gradient(180deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                  boxShadow: `0 0 14px ${alpha(theme.palette.primary.main, 0.7)}`,
                },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 38,
                  color: "inherit",
                  alignSelf: "center",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={t(`nav.${item.key}`)}
                slotProps={{
                  primary: {
                    sx: {
                      fontSize: 13,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      lineHeight: 1.2,
                    },
                  },
                }}
                sx={{
                  my: 0,
                  display: "flex",
                  alignItems: "center",
                }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
      <Box
        sx={{
          px: 3,
          py: 2.25,
          borderTop: 1,
          borderColor: "divider",
          color: "text.secondary",
          position: "relative",
          zIndex: 1,
          background: `linear-gradient(180deg, transparent, ${alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.06 : 0.04)})`,
        }}
      >
        <Typography sx={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", mb: 1 }}>
          Sys Status
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.25 }}>
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              bgcolor: statusColor,
              boxShadow: (theme) =>
                `0 0 14px ${downloadStatusActive ? theme.palette.info.main : isProxyConnected ? theme.palette.success.main : theme.palette.error.main}`,
            }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: "text.primary", lineHeight: 1.2 }}>
              {sysStatusLabel}
            </Typography>
            <Typography
              sx={{
                mt: 0.35,
                fontSize: 10,
                fontFamily: '"Courier New", monospace',
                letterSpacing: "0.08em",
              }}
            >
              {sysStatusDetail}
            </Typography>
          </Box>
        </Box>
        <Box
          sx={{
            height: 4,
            borderRadius: 999,
            bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.08 : 0.1),
            overflow: "hidden",
            position: "relative",
            boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.14)}`,
          }}
        >
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              background: (theme) =>
                `linear-gradient(90deg, transparent, ${downloadStatusActive ? theme.palette.info.main : isProxyConnected ? theme.palette.success.main : theme.palette.error.main}, transparent)`,
              animation: downloadStatusActive || isProxyConnected ? "nav-loader 2s ease-in-out infinite" : "none",
              transform: downloadStatusActive || isProxyConnected ? "translateX(-100%)" : "translateX(0)",
              opacity: isProxyConnected ? 1 : 0.72,
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
        "@keyframes nav-loader": {
          "0%": { transform: "translateX(-100%)" },
          "50%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      }}
    >
      {isMobile && (
        <IconButton
          onClick={() => setMobileOpen(!mobileOpen)}
          sx={{
            position: "fixed",
            top: 12,
            left: 12,
            zIndex: 1300,
            border: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
            backdropFilter: "blur(18px) saturate(150%)",
            boxShadow: (theme) => `0 0 0 1px ${alpha(theme.palette.primary.main, 0.16)}, 0 16px 34px rgba(0, 0, 0, 0.28)`,
          }}
        >
          <MenuIcon />
        </IconButton>
      )}

      <Box
        component="nav"
        sx={{
          width: { md: DRAWER_WIDTH },
          flexShrink: 0,
          minHeight: "100vh",
        }}
      >
        {isMobile ? (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{
              "& .MuiDrawer-paper": {
                boxSizing: "border-box",
                width: DRAWER_WIDTH,
                minHeight: "100vh",
              },
            }}
          >
            {drawer}
          </Drawer>
        ) : (
          <Drawer
            variant="permanent"
            sx={{
              "& .MuiDrawer-paper": {
                boxSizing: "border-box",
                width: DRAWER_WIDTH,
                position: "fixed",
                inset: "0 auto 0 0",
                minHeight: "100vh",
              },
            }}
            open
          >
            {drawer}
          </Drawer>
        )}
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          overflow: "auto",
          position: "relative",
          minHeight: "100vh",
          p: { xs: 1.5, md: 3 },
          pt: { xs: 7.5, md: 3 },
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            opacity: theme.palette.mode === "dark" ? 0.36 : 0.24,
            backgroundImage: [
              `linear-gradient(${alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.1 : 0.06)} 1px, transparent 1px)`,
              `linear-gradient(90deg, ${alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.1 : 0.06)} 1px, transparent 1px)`,
              `linear-gradient(135deg, transparent 0 48%, ${alpha(theme.palette.warning.main, 0.12)} 49% 50%, transparent 51%)`,
            ].join(", "),
            backgroundSize: { xs: "28px 28px, 28px 28px, 120px 120px", md: "42px 42px, 42px 42px, 180px 180px" },
            maskImage: "linear-gradient(to bottom, black 30%, transparent 100%)",
          }}
        />
        <Box
          sx={{
            position: "relative",
            zIndex: 1,
            minHeight: "100%",
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
