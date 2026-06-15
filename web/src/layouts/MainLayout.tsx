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
import { useMihomoDownloadTask } from "../hooks/useMihomoDownloadTask";
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
  const { progress, actionPending } = useMihomoDownloadTask();

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
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", position: "relative" }}>
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.35,
          backgroundImage:
            `linear-gradient(${alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.08 : 0.03)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.08 : 0.03)} 1px, transparent 1px)`,
          backgroundSize: "36px 36px",
          maskImage: "linear-gradient(to bottom, black 50%, transparent 100%)",
        }}
      />
      <Box
        sx={{
          px: 3,
          py: 3,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography
          sx={{
            fontFamily: '"Courier New", monospace',
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: "-0.04em",
            lineHeight: 1,
            position: "relative",
            display: "inline-flex",
            alignItems: "flex-start",
            gap: 1,
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
              bgcolor: "success.main",
              boxShadow: (theme) => `0 0 10px ${theme.palette.success.main}`,
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
                transition: "all 0.2s ease",
                "&:hover": {
                  color: "text.primary",
                  transform: "translateX(4px)",
                  backgroundColor: "action.hover",
                },
                "&.Mui-selected": {
                  color: "text.primary",
                  background:
                    `linear-gradient(90deg, ${alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.12 : 0.06)}, transparent)`,
                },
                "&.Mui-selected::before": {
                  content: '""',
                  position: "absolute",
                  left: -10,
                  top: 0,
                  bottom: 0,
                  width: 3,
                  borderRadius: 999,
                  backgroundColor: "text.primary",
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
        <Box sx={{ height: 2, bgcolor: "action.hover", overflow: "hidden", position: "relative" }}>
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              bgcolor: statusColor,
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
            backdropFilter: "blur(16px)",
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
            opacity: 0.28,
            backgroundImage:
              `linear-gradient(${alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.06 : 0.025)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.06 : 0.025)} 1px, transparent 1px)`,
            backgroundSize: { xs: "28px 28px", md: "40px 40px" },
            maskImage: "linear-gradient(to bottom, black 30%, transparent 100%)",
          }}
        />
        {children}
      </Box>
    </Box>
  );
}
