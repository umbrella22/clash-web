import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  Chip,
  Button,
  LinearProgress,
  Alert,
  CircularProgress,
  Snackbar,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import RefreshIcon from "@mui/icons-material/Refresh";
import DownloadIcon from "@mui/icons-material/Download";
import SpeedIcon from "@mui/icons-material/Speed";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import {
  useStatus,
  useMode,
  useSetMode,
  useStartMihomo,
  useStopMihomo,
  useRestartMihomo,
  usePreferences,
} from "../hooks/useApi";
import { useTraffic, useMemory } from "../hooks/useStream";
import {
  getDelay,
  getQuickControlGroups,
} from "../features/proxies";
import {
  useProxyGroups,
  useSelectProxy,
  useTestProxyDelay,
} from "../hooks/useProxies";
import { usePinnedProxyGroups } from "../hooks/usePinnedProxyGroups";
import {
  getMihomoInstallStatus,
  installMihomo,
  pingGoogleWithProxy,
} from "../services/api";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  describeDownloadStatus,
  formatBytes,
  formatBytesPerSecond,
  formatRemainingTime,
  isDownloadTaskActive,
} from "../features/mihomoDownload";
import { useMihomoDownloadTaskContext } from "../contexts/MihomoDownloadTaskContext";
import RealtimeLineChart from "../components/RealtimeLineChart";
import {
  getOverviewCardOrder,
  isOverviewCardVisible,
  normalizeOverviewCards,
  type OverviewCardId,
} from "../features/preferences";

function formatSpeed(bytes: number): string {
  return formatBytes(bytes) + "/s";
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

const MODES = ["rule", "global", "direct"] as const;
type Mode = (typeof MODES)[number];

const MODE_COLORS: Record<Mode, "primary" | "warning" | "success"> = {
  rule: "primary",
  global: "warning",
  direct: "success",
};

function getDelayColor(delay: number): "success" | "warning" | "error" | "default" {
  if (delay < 0) return "default";
  if (delay <= 500) return "success";
  if (delay <= 1200) return "warning";
  return "error";
}

export default function OverviewPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { data: status, isLoading } = useStatus();
  const { data: modeData } = useMode();
  const setMode = useSetMode();
  const startMihomo = useStartMihomo();
  const stopMihomo = useStopMihomo();
  const restartMihomo = useRestartMihomo();
  const { data: preferences } = usePreferences();
  const { proxies, groups: proxyGroups, isLoading: proxiesLoading } = useProxyGroups();
  const selectProxy = useSelectProxy();
  const testProxyDelay = useTestProxyDelay();
  const { pinnedGroupNames, togglePinnedGroup } = usePinnedProxyGroups();
  const [quickProxySnack, setQuickProxySnack] = useState<string | null>(null);
  const { traffic, history, status: trafficStreamStatus } = useTraffic();
  const { memory, history: memoryHistory, status: memoryStreamStatus } = useMemory();
  const { progress, actionError, actionPending, runDownloadAction } =
    useMihomoDownloadTaskContext();

  const { data: installInfo } = useQuery({
    queryKey: ["mihomoInstall"],
    queryFn: () => getMihomoInstallStatus().then((r) => r.data),
  });

  const handleInstall = async () => {
    await runDownloadAction(() => installMihomo(), t("settings.download_request_failed"));
  };

  const mihomoInstalled = installInfo?.installed ?? true;
  const activeProgress = isDownloadTaskActive(progress) ? progress : null;
  const currentMode = (modeData?.mode || "rule") as Mode;
  const isRunning = status?.mihomo_running ?? false;
  const memUsed = memory.inuse;
  const memoryLimitFromHistory = memoryHistory.findLast((item) => item.oslimit > 0)?.oslimit ?? 0;
  const memTotal = memory.oslimit > 0 ? memory.oslimit : memoryLimitFromHistory;
  const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
  const progressStatusKey = activeProgress
    ? `settings.download_status_${describeDownloadStatus(activeProgress.status)}`
    : "settings.download_status_idle";
  const progressStatusLabel = t(progressStatusKey);
  const downloadedLabel =
    activeProgress && activeProgress.total > 0
      ? `${formatBytes(activeProgress.downloaded)} / ${formatBytes(activeProgress.total)}`
      : formatBytes(activeProgress?.downloaded);
  const trafficLabels = useMemo(
    () => Array.from({ length: Math.max(history.length, 12) }, (_, index) => `${index + 1}`),
    [history.length]
  );
  const memoryLabels = useMemo(
    () => Array.from({ length: Math.max(memoryHistory.length, 12) }, (_, index) => `${index + 1}`),
    [memoryHistory.length]
  );
  const trafficSeries = useMemo(
    () => [
      {
        label: t("overview.upload"),
        values: trafficLabels.map((_, index) => history[index]?.up ?? 0),
        borderColor: theme.palette.info.main,
        backgroundColor: alpha(theme.palette.info.main, 0.12),
      },
      {
        label: t("overview.download"),
        values: trafficLabels.map((_, index) => history[index]?.down ?? 0),
        borderColor: theme.palette.success.main,
        backgroundColor: alpha(theme.palette.success.main, 0.12),
      },
    ],
    [history, t, theme.palette.info.main, theme.palette.success.main, trafficLabels]
  );
  const memorySeries = useMemo(
    () => [
      {
        label: t("overview.memory"),
        values: memoryLabels.map((_, index) => memoryHistory[index]?.inuse ?? 0),
        borderColor: theme.palette.secondary.main,
        backgroundColor: alpha(theme.palette.secondary.main, 0.12),
      },
    ],
    [memoryHistory, memoryLabels, t, theme.palette.secondary.main]
  );
  const quickProxyGroups = useMemo(
    () => getQuickControlGroups(proxyGroups, pinnedGroupNames, 3),
    [pinnedGroupNames, proxyGroups]
  );
  const quickActiveSelection = useMemo(() => {
    const group = quickProxyGroups.find((item) => item.groupName === "GLOBAL") ?? quickProxyGroups[0];
    if (!group?.now) return null;
    const node = proxies[group.now];
    return {
      groupName: group.groupName,
      groupType: group.type,
      nodeName: group.now,
      nodeType: node?.type,
      delay: getDelay(node),
    };
  }, [proxies, quickProxyGroups]);
  const pingGoogle = useMutation({
    mutationFn: (name: string) => pingGoogleWithProxy(name).then((response) => response.data),
    onSuccess: (result, name) => {
      setQuickProxySnack(t("proxies.google_ping_success", { name, delay: result.delay }));
    },
    onError: (_, name) => {
      setQuickProxySnack(t("proxies.google_ping_failed", { name }));
    },
  });
  const overviewCards = useMemo(
    () => normalizeOverviewCards(preferences?.overview_cards),
    [preferences?.overview_cards]
  );
  const sharedCardSx = {
    position: "relative",
    display: "flex",
    width: "100%",
    height: "100%",
    minHeight: 340,
    "&::after": {
      content: '""',
      position: "absolute",
      top: 0,
      left: 0,
      width: 12,
      height: 12,
      borderTop: 2,
      borderLeft: 2,
      borderColor: "text.primary",
      opacity: 0.7,
    },
  } as const;
  const sharedCardContentSx = {
    display: "flex",
    flexDirection: "column",
    gap: 1.5,
    width: "100%",
    height: "100%",
  } as const;
  const metricPanelSx = {
    p: 1.5,
    border: 1,
    borderColor: "divider",
    borderRadius: 1.5,
    bgcolor: "background.default",
  } as const;

  const handleToggle = () => {
    if (isRunning) stopMihomo.mutate();
    else startMihomo.mutate();
  };
  const handleQuickProxyDelayTest = () => {
    quickProxyGroups.forEach((group) => {
      group.all.forEach((name) => testProxyDelay.mutate(name));
    });
  };
  const getCardGridSx = (id: OverviewCardId) => ({
    display: isOverviewCardVisible(overviewCards, id) ? "flex" : "none",
    order: getOverviewCardOrder(overviewCards, id),
  });

  if (isLoading) return <Typography>Loading...</Typography>;

  return (
    <Box>
      <Typography variant="h5" gutterBottom sx={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {t("overview.title")}
      </Typography>

      {!mihomoInstalled && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={actionPending ? <CircularProgress size={16} /> : <DownloadIcon />}
              onClick={handleInstall}
              disabled={actionPending}
            >
              {actionPending ? t("settings.installing") : t("settings.install")}
            </Button>
          }
        >
          mihomo is not installed.
          {installInfo?.latest_version && ` Latest: ${installInfo.latest_version}`}
          {" "}(Arch: {installInfo?.arch})
        </Alert>
      )}

      {actionError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {actionError}
        </Alert>
      )}

      {activeProgress && (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 1,
                mb: 1,
              }}
            >
              <Typography variant="h6">{t("settings.download_task")}</Typography>
              <Chip
                label={progressStatusLabel}
                color={
                  activeProgress.status === "error"
                    ? "error"
                    : activeProgress.status === "done"
                      ? "success"
                      : activeProgress.active
                        ? "info"
                        : "default"
                }
                size="small"
              />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {activeProgress.message}
            </Typography>
            <LinearProgress
              variant={activeProgress.total > 0 ? "determinate" : "indeterminate"}
              value={activeProgress.percent}
              sx={{ mb: 1.5 }}
            />
            <Grid container spacing={2}>
              <Grid size={{ xs: 6, md: 3 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("settings.progress")}
                </Typography>
                <Typography variant="body2">{downloadedLabel}</Typography>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("settings.speed")}
                </Typography>
                <Typography variant="body2">
                  {formatBytesPerSecond(activeProgress.bytes_per_sec)}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("settings.eta")}
                </Typography>
                <Typography variant="body2">
                  {formatRemainingTime(activeProgress.remaining_secs)}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("settings.current_task")}
                </Typography>
                <Typography variant="body2">
                  {activeProgress.task_type === "upgrade"
                    ? t("settings.upgrade")
                    : t("settings.install")}
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      {mihomoInstalled && installInfo?.version && (
        <Alert severity="success" sx={{ mb: 2 }}>
          mihomo detected: {installInfo.version} ({installInfo.path})
        </Alert>
      )}

      <Grid container spacing={2}>
        {/* Control Card */}
        <Grid size={{ xs: 12 }} sx={getCardGridSx("control")}>
          <Card sx={sharedCardSx}>
            <CardContent sx={sharedCardContentSx}>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: { xs: "flex-start", md: "center" },
                  gap: 2,
                  flexWrap: "wrap",
                }}
              >
                <Box>
                  <Typography variant="h6" gutterBottom sx={{ mb: 0.5 }}>
                    {t("overview.control")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t("overview.control_description")}
                  </Typography>
                </Box>
                <Chip
                  label={isRunning ? t("overview.running") : t("overview.stopped")}
                  color={isRunning ? "success" : "error"}
                  size="small"
                />
              </Box>

              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, md: 4 }}>
                  <Box
                    sx={{
                      p: 1.5,
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1.5,
                      bgcolor: "background.default",
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {t("overview.version")}
                    </Typography>
                    <Typography variant="body1" sx={{ mt: 0.5, fontWeight: 600 }}>
                      {status?.version?.version ?? "—"}
                    </Typography>
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <Box
                    sx={{
                      p: 1.5,
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1.5,
                      bgcolor: "background.default",
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {t("overview.pid")}
                    </Typography>
                    <Typography variant="body1" sx={{ mt: 0.5, fontWeight: 600 }}>
                      {status?.pid != null ? status.pid : "—"}
                    </Typography>
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <Box
                    sx={{
                      p: 1.5,
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1.5,
                      bgcolor: "background.default",
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {t("overview.uptime")}
                    </Typography>
                    <Typography variant="body1" sx={{ mt: 0.5, fontWeight: 600 }}>
                      {status?.uptime_secs != null && status.uptime_secs > 0
                        ? formatUptime(status.uptime_secs)
                        : "—"}
                    </Typography>
                  </Box>
                </Grid>
              </Grid>

              <Box
                sx={{
                  p: 1.5,
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1.5,
                  bgcolor: "background.default",
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {t("overview.mode")}
                </Typography>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
                  {MODES.map((mode) => (
                    <Chip
                      key={mode}
                      label={t(`overview.mode_${mode}`)}
                      variant={currentMode === mode ? "filled" : "outlined"}
                      color={currentMode === mode ? MODE_COLORS[mode] : "default"}
                      clickable
                      onClick={() => setMode.mutate(mode)}
                      disabled={setMode.isPending}
                    />
                  ))}
                </Box>
              </Box>

              <Box
                sx={{
                  mt: "auto",
                  pt: 1.5,
                  borderTop: 1,
                  borderColor: "divider",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: { xs: "flex-start", md: "center" },
                  gap: 2,
                  flexWrap: "wrap",
                }}
              >
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t("overview.actions")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {isRunning ? t("overview.running") : t("overview.stopped")}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={isRunning ? <StopIcon /> : <PlayArrowIcon />}
                    onClick={handleToggle}
                    disabled={startMihomo.isPending || stopMihomo.isPending}
                    color={isRunning ? "error" : "success"}
                  >
                    {isRunning ? "Stop" : "Start"}
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<RefreshIcon />}
                    onClick={() => restartMihomo.mutate()}
                    disabled={restartMihomo.isPending}
                  >
                    Restart
                  </Button>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12 }} sx={getCardGridSx("quick_proxy")}>
          <Card sx={sharedCardSx}>
            <CardContent sx={sharedCardContentSx}>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: { xs: "flex-start", md: "center" },
                  gap: 2,
                  flexWrap: "wrap",
                }}
              >
                <Box>
                  <Typography variant="h6" gutterBottom sx={{ mb: 0.5 }}>
                    {t("overview.quick_proxy_title")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t("overview.quick_proxy_description")}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  <Chip
                    label={`${quickProxyGroups.length} / ${proxyGroups.length || 0}`}
                    size="small"
                    variant="outlined"
                  />
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<SpeedIcon />}
                    onClick={handleQuickProxyDelayTest}
                    disabled={quickProxyGroups.length === 0 || testProxyDelay.isPending}
                  >
                    {t("overview.quick_proxy_test_all")}
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={pingGoogle.isPending ? <CircularProgress size={16} /> : <SpeedIcon />}
                    onClick={() => quickActiveSelection && pingGoogle.mutate(quickActiveSelection.nodeName)}
                    disabled={!quickActiveSelection || pingGoogle.isPending}
                  >
                    {pingGoogle.isPending ? t("proxies.google_pinging") : t("proxies.google_ping")}
                  </Button>
                </Box>
              </Box>

              {proxiesLoading ? (
                <Box
                  sx={{
                    flexGrow: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <CircularProgress size={28} />
                </Box>
              ) : quickProxyGroups.length === 0 ? (
                <Alert severity="info">{t("overview.quick_proxy_empty")}</Alert>
              ) : (
                <>
                  <Box
                    sx={{
                      p: 1.5,
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1.5,
                      bgcolor: "background.default",
                      display: "flex",
                      alignItems: { xs: "flex-start", md: "center" },
                      justifyContent: "space-between",
                      gap: 1.5,
                      flexWrap: "wrap",
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary">
                        {t("overview.quick_proxy_active_selection")}
                      </Typography>
                      {quickActiveSelection ? (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.75, flexWrap: "wrap" }}>
                          <Chip label={quickActiveSelection.groupName} color="primary" size="small" />
                          <Typography variant="subtitle1" sx={{ fontWeight: 800, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {quickActiveSelection.nodeName}
                          </Typography>
                          {quickActiveSelection.nodeType && <Chip label={quickActiveSelection.nodeType} size="small" variant="outlined" />}
                          <Chip
                            label={quickActiveSelection.delay >= 0 ? `${quickActiveSelection.delay}ms` : t("proxies.unavailable")}
                            size="small"
                            color={getDelayColor(quickActiveSelection.delay) === "default" ? undefined : getDelayColor(quickActiveSelection.delay)}
                            variant={getDelayColor(quickActiveSelection.delay) === "default" ? "outlined" : "filled"}
                          />
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {t("proxies.no_active_selection")}
                        </Typography>
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 420 }}>
                      {t("overview.quick_proxy_selection_help")}
                    </Typography>
                  </Box>

                  <Grid container spacing={1.5}>
                    {quickProxyGroups.map((group) => {
                      const visibleNodes = group.all.slice(0, 8);
                      const hiddenCount = Math.max(group.all.length - visibleNodes.length, 0);

                      return (
                      <Grid key={group.groupName} size={{ xs: 12, md: 4 }}>
                        <Box
                          sx={{
                            ...metricPanelSx,
                            height: "100%",
                            display: "flex",
                            flexDirection: "column",
                            gap: 1.25,
                          }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              gap: 1,
                            }}
                          >
                            <Box sx={{ minWidth: 0 }}>
                              <Box
                                sx={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 1,
                                  flexWrap: "wrap",
                                }}
                              >
                                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                                  {group.groupName}
                                </Typography>
                                {pinnedGroupNames.includes(group.groupName) && (
                                  <Chip
                                    label={t("overview.quick_proxy_pinned")}
                                    color="warning"
                                    size="small"
                                  />
                                )}
                                <Chip label={group.type} size="small" variant="outlined" />
                              </Box>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mt: 0.5 }}
                              >
                                {t("overview.quick_proxy_current")}: {group.now ?? "—"}
                              </Typography>
                            </Box>
                            <Button
                              variant="text"
                              size="small"
                              startIcon={
                                pinnedGroupNames.includes(group.groupName) ? (
                                  <StarIcon />
                                ) : (
                                  <StarBorderIcon />
                                )
                              }
                              color={pinnedGroupNames.includes(group.groupName) ? "warning" : "inherit"}
                              onClick={() => togglePinnedGroup(group.groupName)}
                            >
                              {pinnedGroupNames.includes(group.groupName)
                                ? t("overview.quick_proxy_unpin")
                                : t("overview.quick_proxy_pin")}
                            </Button>
                            <Button
                              variant="text"
                              size="small"
                              startIcon={<SpeedIcon />}
                              onClick={() => {
                                group.all.forEach((name) => testProxyDelay.mutate(name));
                              }}
                              disabled={testProxyDelay.isPending}
                            >
                              {t("overview.quick_proxy_test")}
                            </Button>
                          </Box>

                          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" }, gap: 1 }}>
                            {visibleNodes.map((name) => {
                              const delay = getDelay(proxies[name]);
                              const isActive = name === group.now;
                              const delayColor = getDelayColor(delay);

                              return (
                                <Button
                                  key={`${group.groupName}-${name}`}
                                  variant="outlined"
                                  onClick={() =>
                                    selectProxy.mutate({ group: group.groupName, name })
                                  }
                                  disabled={selectProxy.isPending}
                                  sx={(theme) => ({
                                    minHeight: 56,
                                    justifyContent: "flex-start",
                                    textAlign: "left",
                                    borderRadius: 1.5,
                                    p: 1,
                                    borderColor: isActive ? alpha(theme.palette.primary.main, 0.78) : "divider",
                                    bgcolor: isActive ? alpha(theme.palette.primary.main, 0.14) : alpha(theme.palette.background.paper, 0.36),
                                    color: "text.primary",
                                  })}
                                >
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, width: "100%", minWidth: 0 }}>
                                    {isActive ? <CheckCircleIcon fontSize="small" color="primary" /> : <RadioButtonUncheckedIcon fontSize="small" color="disabled" />}
                                    <Box sx={{ minWidth: 0, flex: 1 }}>
                                      <Typography variant="caption" sx={{ display: "block", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {name}
                                      </Typography>
                                      <Chip
                                        label={delay >= 0 ? `${delay}ms` : t("proxies.unavailable")}
                                        size="small"
                                        color={delayColor === "default" ? undefined : delayColor}
                                        variant={delayColor === "default" ? "outlined" : "filled"}
                                        sx={{ height: 18, mt: 0.5 }}
                                      />
                                    </Box>
                                  </Box>
                                </Button>
                              );
                            })}
                            {hiddenCount > 0 && (
                              <Chip
                                label={t("overview.quick_proxy_more", { count: hiddenCount })}
                                size="small"
                                variant="outlined"
                              />
                            )}
                          </Box>
                        </Box>
                      </Grid>
                      );
                    })}
                  </Grid>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Traffic Card */}
        <Grid size={{ xs: 12, md: 6 }} sx={getCardGridSx("traffic")}>
          <Card sx={sharedCardSx}>
            <CardContent sx={sharedCardContentSx}>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: { xs: "flex-start", md: "center" },
                  gap: 2,
                  flexWrap: "wrap",
                }}
              >
                <Box>
                  <Typography variant="h6" gutterBottom sx={{ mb: 0.5 }}>
                    {t("overview.traffic")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t("overview.traffic_description")}
                  </Typography>
                </Box>
                <Chip
                  label={trafficStreamStatus === "open" ? t("overview.realtime") : t("overview.reconnecting")}
                  size="small"
                  color={trafficStreamStatus === "open" ? "info" : "warning"}
                  variant="outlined"
                />
              </Box>
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Box sx={metricPanelSx}>
                    <Typography variant="caption" color="text.secondary">
                      {t("overview.upload")}
                    </Typography>
                    <Typography variant="body1" sx={{ mt: 0.5, color: "info.main", fontWeight: 600 }}>
                      {formatSpeed(traffic.up)}
                    </Typography>
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Box sx={metricPanelSx}>
                    <Typography variant="caption" color="text.secondary">
                      {t("overview.download")}
                    </Typography>
                    <Typography variant="body1" sx={{ mt: 0.5, color: "success.main", fontWeight: 600 }}>
                      {formatSpeed(traffic.down)}
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
              <Box
                sx={{
                  ...metricPanelSx,
                  flexGrow: 1,
                  minHeight: 240,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {t("overview.traffic_chart")}
                </Typography>
                <Box sx={{ mt: 1.25, flex: 1, minHeight: 180 }}>
                  <RealtimeLineChart
                    labels={trafficLabels}
                    series={trafficSeries}
                    valueFormatter={formatBytesPerSecond}
                  />
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Memory Card */}
        <Grid size={{ xs: 12, md: 6 }} sx={getCardGridSx("memory")}>
          <Card sx={sharedCardSx}>
            <CardContent sx={sharedCardContentSx}>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: { xs: "flex-start", md: "center" },
                  gap: 2,
                  flexWrap: "wrap",
                }}
              >
                <Box>
                  <Typography variant="h6" gutterBottom sx={{ mb: 0.5 }}>
                    {t("overview.memory")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t("overview.memory_description")}
                  </Typography>
                </Box>
                <Chip
                  label={memoryStreamStatus === "open" ? t("overview.realtime") : t("overview.reconnecting")}
                  size="small"
                  color={memoryStreamStatus === "open" ? "secondary" : "warning"}
                  variant="outlined"
                />
              </Box>
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Box sx={metricPanelSx}>
                    <Typography variant="caption" color="text.secondary">
                      {t("overview.memory_in_use")}
                    </Typography>
                    <Typography variant="body1" sx={{ mt: 0.5, fontWeight: 600 }}>
                      {formatBytes(memUsed)}
                    </Typography>
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Box sx={metricPanelSx}>
                    <Typography variant="caption" color="text.secondary">
                      {t("overview.memory_total")}
                    </Typography>
                    <Typography variant="body1" sx={{ mt: 0.5, fontWeight: 600 }}>
                      {memTotal > 0 ? formatBytes(memTotal) : "—"}
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
              <Box sx={metricPanelSx}>
                <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, mb: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("overview.memory_usage")}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {memPct.toFixed(1)}%
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(memPct, 100)}
                  sx={{ height: 8, borderRadius: 4 }}
                />
              </Box>
              <Box
                sx={{
                  ...metricPanelSx,
                  flexGrow: 1,
                  minHeight: 240,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {t("overview.memory_chart")}
                </Typography>
                <Box sx={{ mt: 1.25, flex: 1, minHeight: 180 }}>
                  <RealtimeLineChart
                    labels={memoryLabels}
                    series={memorySeries}
                    valueFormatter={formatBytes}
                  />
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Snackbar
        open={!!quickProxySnack}
        autoHideDuration={2500}
        onClose={() => setQuickProxySnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="info" onClose={() => setQuickProxySnack(null)}>
          {quickProxySnack}
        </Alert>
      </Snackbar>
    </Box>
  );
}
