import { useTranslation } from "react-i18next";
import { useMemo, useState, type ReactNode } from "react";
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  Chip,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  Alert,
  CircularProgress,
  MenuItem,
  Select,
  Tooltip,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import RefreshIcon from "@mui/icons-material/Refresh";
import DownloadIcon from "@mui/icons-material/Download";
import SpeedIcon from "@mui/icons-material/Speed";
import PublicIcon from "@mui/icons-material/Public";
import NearMeIcon from "@mui/icons-material/NearMe";
import {
  useStatus,
  useMode,
  useSetMode,
  useStartMihomo,
  useStopMihomo,
  useRestartMihomo,
  usePreferences,
} from "../hooks/useApi";
import {
  getCurrentProxyTarget,
  getDelay,
  getDelayColor,
  normalizeClashMode,
  type ClashMode,
} from "../features/proxies";
import {
  useProxyGroups,
  useSelectProxy,
  useTestProxyDelay,
} from "../hooks/useProxies";
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
import { PageTitle } from "../components/SystemChrome";
import { useToast } from "../components/toastContext";
import { formatApiError } from "../utils/errors";
import TrafficCard from "../components/overview/TrafficCard";
import MemoryCard from "../components/overview/MemoryCard";
import {
  metricPanelSx,
  sharedCardContentSx,
  sharedCardSx,
} from "../components/overview/overviewCardStyles";
import {
  getOverviewCardOrder,
  isOverviewCardVisible,
  normalizeOverviewCards,
  type OverviewCardId,
} from "../features/preferences";

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
type Mode = ClashMode;

const MODE_COLORS: Record<Mode, "primary" | "warning" | "success"> = {
  rule: "primary",
  global: "warning",
  direct: "success",
};

const MODE_ICONS: Record<Mode, ReactNode> = {
  rule: <AccountTreeIcon fontSize="small" />,
  global: <PublicIcon fontSize="small" />,
  direct: <NearMeIcon fontSize="small" />,
};

const CURRENT_PROXY_RULE_GROUP_STORAGE_KEY = "clash-web-current-proxy-rule-group";

function readStoredRuleGroup(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(CURRENT_PROXY_RULE_GROUP_STORAGE_KEY) ?? "";
}

function writeStoredRuleGroup(groupName: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CURRENT_PROXY_RULE_GROUP_STORAGE_KEY, groupName);
}

export default function OverviewPage() {
  const { t } = useTranslation();
  const {
    data: status,
    isLoading,
    isError: statusLoadFailed,
    refetch: refetchStatus,
  } = useStatus();
  const { data: modeData } = useMode();
  const setMode = useSetMode();
  const startMihomo = useStartMihomo();
  const stopMihomo = useStopMihomo();
  const restartMihomo = useRestartMihomo();
  const { data: preferences } = usePreferences();
  const { proxies, isLoading: proxiesLoading } = useProxyGroups();
  const selectProxy = useSelectProxy();
  const testProxyDelay = useTestProxyDelay();
  const [selectedRuleGroupName, setSelectedRuleGroupName] = useState(readStoredRuleGroup);
  const showToast = useToast();
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
  const currentMode = normalizeClashMode(modeData?.mode);
  const isRunning = status?.mihomo_running ?? false;
  const progressStatusKey = activeProgress
    ? `settings.download_status_${describeDownloadStatus(activeProgress.status)}`
    : "settings.download_status_idle";
  const progressStatusLabel = t(progressStatusKey);
  const downloadedLabel =
    activeProgress && activeProgress.total > 0
      ? `${formatBytes(activeProgress.downloaded)} / ${formatBytes(activeProgress.total)}`
      : formatBytes(activeProgress?.downloaded);
  const currentProxyTarget = useMemo(
    () => getCurrentProxyTarget(proxies, currentMode, selectedRuleGroupName),
    [currentMode, proxies, selectedRuleGroupName]
  );
  const currentProxyNode = currentProxyTarget.node;
  const currentProxyDelayColor = getDelayColor(currentProxyTarget.nodeDelay);
  const pingGoogle = useMutation({
    mutationFn: (name: string) => pingGoogleWithProxy(name).then((response) => response.data),
    onSuccess: (result, name) => {
      showToast({
        severity: "success",
        message: t("proxies.google_ping_success", { name, delay: result.delay }),
      });
    },
    onError: (error, name) => {
      showToast({
        severity: "error",
        message: formatApiError(error, t("proxies.google_ping_failed", { name })),
      });
    },
  });
  const overviewCards = useMemo(
    () => normalizeOverviewCards(preferences?.overview_cards),
    [preferences?.overview_cards]
  );

  const handleToggle = () => {
    if (isRunning) stopMihomo.mutate();
    else startMihomo.mutate();
  };
  const handleProxyGroupChange = (groupName: string) => {
    setSelectedRuleGroupName(groupName);
    writeStoredRuleGroup(groupName);
  };
  const handleProxyNodeChange = (name: string) => {
    if (!currentProxyTarget.groupName || currentMode === "direct") return;

    selectProxy.mutate(
      { group: currentProxyTarget.groupName, name },
      {
        onSuccess: () => {
          showToast({
            severity: "success",
            message: t("proxies.switch_success", {
              group: currentProxyTarget.groupName,
              name,
            }),
          });
        },
        onError: (error) => {
          showToast({
            severity: "error",
            message: formatApiError(
              error,
              t("proxies.switch_failed", {
                group: currentProxyTarget.groupName,
                name,
              })
            ),
          });
        },
      }
    );
  };
  const handleModeChange = (mode: Mode) => {
    if (mode === currentMode) return;

    setMode.mutate(mode, {
      onSuccess: () => {
        showToast({
          severity: "success",
          message: t("overview.mode_switch_success", {
            mode: t(`overview.mode_${mode}`),
          }),
        });
      },
      onError: (error) => {
        showToast({
          severity: "error",
          message: formatApiError(
            error,
            t("overview.mode_switch_failed", {
              mode: t(`overview.mode_${mode}`),
            })
          ),
        });
      },
    });
  };
  const handleCurrentProxyDelayTest = () => {
    if (!currentProxyTarget.nodeName || currentMode === "direct") return;

    testProxyDelay.mutate(currentProxyTarget.nodeName, {
      onSuccess: () => {
        showToast({
          severity: "success",
          message: t("proxies.delay_test_success", { count: 1 }),
        });
      },
      onError: (error) => {
        showToast({
          severity: "error",
          message: formatApiError(error, t("proxies.summary_current_delay_na")),
        });
      },
    });
  };
  const handleCurrentProxyPing = () => {
    if (!currentProxyTarget.nodeName || currentMode === "direct") return;
    pingGoogle.mutate(currentProxyTarget.nodeName);
  };
  const getCardGridSx = (id: OverviewCardId) => ({
    display: isOverviewCardVisible(overviewCards, id) ? "flex" : "none",
    order: getOverviewCardOrder(overviewCards, id),
  });

  if (isLoading) return <Typography>{t("common.loading")}</Typography>;

  // Full-page error only when there is no cached data at all — a transient
  // background-poll failure must not unmount the live charts (they own their
  // WebSocket streams and would lose accumulated history).
  if (statusLoadFailed && !status) {
    return (
      <Box>
        <PageTitle title={t("overview.title")} eyebrow="NETWORK OVERVIEW" />
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetchStatus()}>
              {t("common.retry")}
            </Button>
          }
        >
          {t("overview.status_load_failed")}
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <PageTitle title={t("overview.title")} eyebrow="NETWORK OVERVIEW" />

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
          {t("overview.mihomo_not_installed")}
          {installInfo?.latest_version ? ` (${installInfo.latest_version}, ${installInfo.arch})` : ""}
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
                      borderRadius: 0,
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
                      borderRadius: 0,
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
                      borderRadius: 0,
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
                    {isRunning ? t("overview.stop") : t("overview.start")}
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<RefreshIcon />}
                    onClick={() => restartMihomo.mutate()}
                    disabled={restartMihomo.isPending}
                  >
                    {t("overview.restart")}
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
                    {t("overview.current_proxy_title")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t("overview.current_proxy_description")}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  <Tooltip title={t("overview.current_proxy_test")}>
                    <span>
                      <IconButton
                        onClick={handleCurrentProxyDelayTest}
                        disabled={
                          !currentProxyTarget.nodeName ||
                          currentMode === "direct" ||
                          testProxyDelay.isPending
                        }
                      >
                        {testProxyDelay.isPending ? <CircularProgress size={20} /> : <SpeedIcon />}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={pingGoogle.isPending ? <CircularProgress size={16} /> : <SpeedIcon />}
                    onClick={handleCurrentProxyPing}
                    disabled={
                      !currentProxyTarget.nodeName ||
                      currentMode === "direct" ||
                      pingGoogle.isPending
                    }
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
              ) : !currentProxyTarget.nodeName && currentMode !== "direct" ? (
                <Alert severity="info">{t("overview.current_proxy_empty")}</Alert>
              ) : (
                <Grid container spacing={1.5}>
                  <Grid size={{ xs: 12, md: 7 }}>
                  <Box
                    sx={{
                      ...metricPanelSx,
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      gap: 1.5,
                    }}
                  >
                    <Box
                      sx={(theme) => ({
                        p: 1.5,
                        borderRadius: 0,
                        bgcolor: alpha(theme.palette.primary.main, 0.08),
                        boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.18)}`,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: { xs: "flex-start", sm: "center" },
                        gap: 1.5,
                        flexWrap: "wrap",
                      })}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="caption" color="text.secondary">
                          {t("overview.current_proxy_selected")}
                        </Typography>
                        <Typography
                          variant="h6"
                          sx={{
                            mt: 0.25,
                            maxWidth: { xs: "100%", md: 460 },
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {currentProxyTarget.nodeName || "—"}
                        </Typography>
                        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 0.75 }}>
                          <Chip label={currentProxyTarget.groupName || "—"} size="small" color="primary" />
                          {currentProxyNode?.type ? (
                            <Chip label={currentProxyNode.type} size="small" variant="outlined" />
                          ) : null}
                          {currentProxyTarget.isChainSelection ? (
                            <Chip label={t("overview.current_proxy_chain")} size="small" color="warning" />
                          ) : null}
                        </Box>
                      </Box>
                      {currentMode !== "direct" ? (
                        <Chip
                          label={
                            currentProxyTarget.nodeDelay > 0
                              ? `${currentProxyTarget.nodeDelay}ms`
                              : t("proxies.unavailable")
                          }
                          size="small"
                          color={currentProxyDelayColor === "default" ? undefined : currentProxyDelayColor}
                          variant={currentProxyDelayColor === "default" ? "outlined" : "filled"}
                        />
                      ) : (
                        <Chip label={t("overview.mode_direct")} size="small" color="success" />
                      )}
                    </Box>

                    <Grid container spacing={1.5}>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <FormControl fullWidth size="small">
                          <InputLabel>{t("overview.current_proxy_group")}</InputLabel>
                          <Select
                            value={currentProxyTarget.groupName}
                            label={t("overview.current_proxy_group")}
                            onChange={(event) => handleProxyGroupChange(event.target.value)}
                            disabled={currentProxyTarget.groupLocked || currentProxyTarget.groups.length === 0}
                          >
                            {currentMode === "direct" ? (
                              <MenuItem value="DIRECT">DIRECT</MenuItem>
                            ) : (
                              (currentMode === "global" && currentProxyTarget.selectedGroup
                                ? [currentProxyTarget.selectedGroup]
                                : currentProxyTarget.groups
                              ).map((group) => (
                                <MenuItem key={group.groupName} value={group.groupName}>
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                                    <Typography sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {group.groupName}
                                    </Typography>
                                    <Chip label={group.type} size="small" variant="outlined" />
                                  </Box>
                                </MenuItem>
                              ))
                            )}
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <FormControl fullWidth size="small">
                          <InputLabel>{t("overview.current_proxy_node")}</InputLabel>
                          <Select
                            value={currentProxyTarget.nodeName}
                            label={t("overview.current_proxy_node")}
                            onChange={(event) => handleProxyNodeChange(event.target.value)}
                            disabled={
                              currentMode === "direct" ||
                              !currentProxyTarget.groupName ||
                              currentProxyTarget.nodeOptions.length === 0 ||
                              selectProxy.isPending
                            }
                            renderValue={(selected) => {
                              const selectedName = String(selected);
                              const delay = getDelay(proxies[selectedName]);
                              const delayColor = getDelayColor(delay);

                              return (
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                                  <Typography sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                                    {selectedName}
                                  </Typography>
                                  {currentMode !== "direct" ? (
                                    <Chip
                                      label={delay > 0 ? `${delay}ms` : t("proxies.unavailable")}
                                      size="small"
                                      color={delayColor === "default" ? undefined : delayColor}
                                      variant={delayColor === "default" ? "outlined" : "filled"}
                                      sx={{ height: 22, flexShrink: 0 }}
                                    />
                                  ) : null}
                                </Box>
                              );
                            }}
                          >
                            {currentProxyTarget.nodeOptions.map((name) => {
                              const node = proxies[name];
                              const delay = getDelay(node);
                              const delayColor = getDelayColor(delay);

                              return (
                                <MenuItem key={name} value={name}>
                                  <Box
                                    sx={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 1,
                                      width: "100%",
                                      minWidth: 0,
                                    }}
                                  >
                                    <Box sx={{ minWidth: 0 }}>
                                      <Typography sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {name}
                                      </Typography>
                                      {node?.type ? (
                                        <Typography variant="caption" color="text.secondary">
                                          {node.type}
                                        </Typography>
                                      ) : null}
                                    </Box>
                                    <Chip
                                      label={delay > 0 ? `${delay}ms` : t("proxies.unavailable")}
                                      size="small"
                                      color={delayColor === "default" ? undefined : delayColor}
                                      variant={delayColor === "default" ? "outlined" : "filled"}
                                      sx={{ height: 22, flexShrink: 0 }}
                                    />
                                  </Box>
                                </MenuItem>
                              );
                            })}
                          </Select>
                        </FormControl>
                      </Grid>
                    </Grid>

                    {currentProxyTarget.isChainSelection ? (
                      <Alert severity="warning" sx={{ py: 0.5 }}>
                        {t("overview.current_proxy_chain_hint", {
                          group: currentProxyTarget.chainTarget?.groupName ?? currentProxyTarget.nodeName,
                        })}
                      </Alert>
                    ) : null}
                  </Box>
                  </Grid>

                  <Grid size={{ xs: 12, md: 5 }}>
                    <Box
                      sx={{
                        ...metricPanelSx,
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        gap: 1.5,
                      }}
                    >
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {t("overview.mode")}
                        </Typography>
                        <Box
                          sx={{
                            display: "grid",
                            gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))", md: "1fr" },
                            gap: 1,
                            mt: 1,
                          }}
                        >
                          {MODES.map((mode) => {
                            const active = currentMode === mode;
                            return (
                              <Button
                                key={mode}
                                variant={active ? "contained" : "outlined"}
                                color={active ? MODE_COLORS[mode] : "inherit"}
                                startIcon={MODE_ICONS[mode]}
                                onClick={() => handleModeChange(mode)}
                                disabled={setMode.isPending}
                                sx={{
                                  minHeight: 52,
                                  display: "flex",
                                  justifyContent: "flex-start",
                                  alignItems: "center",
                                  gap: 1,
                                  borderRadius: 0,
                                  textTransform: "none",
                                  transitionProperty: "transform, box-shadow, background-color, border-color",
                                  "&:active": { transform: "scale(0.96)" },
                                }}
                              >
                                <Box sx={{ textAlign: "left", minWidth: 0 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    {t(`overview.mode_${mode}`)}
                                  </Typography>
                                  <Typography variant="caption" sx={{ opacity: active ? 0.88 : 0.72 }}>
                                    {t(`overview.mode_${mode}_description`)}
                                  </Typography>
                                </Box>
                              </Button>
                            );
                          })}
                        </Box>
                      </Box>

                      <Box
                        sx={(theme) => ({
                          mt: "auto",
                          p: 1.5,
                          borderRadius: 0,
                          bgcolor: alpha(theme.palette.background.paper, 0.58),
                          boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.divider, 0.75)}`,
                        })}
                      >
                        <Typography variant="caption" color="text.secondary">
                          {t("overview.current_proxy_effective")}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 0.75 }}>
                          {t(
                            currentMode === "direct"
                              ? "overview.current_proxy_effect_direct"
                              : currentMode === "global"
                                ? "overview.current_proxy_effect_global"
                                : "overview.current_proxy_effect_rule",
                            {
                              group: currentProxyTarget.groupName || "—",
                              node: currentProxyTarget.nodeName || "—",
                            }
                          )}
                        </Typography>
                      </Box>
                    </Box>
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Traffic Card — owns its own WS stream so realtime updates stay local */}
        <Grid size={{ xs: 12, md: 6 }} sx={getCardGridSx("traffic")}>
          <TrafficCard />
        </Grid>

        {/* Memory Card — owns its own WS stream so realtime updates stay local */}
        <Grid size={{ xs: 12, md: 6 }} sx={getCardGridSx("memory")}>
          <MemoryCard />
        </Grid>
      </Grid>
    </Box>
  );
}
