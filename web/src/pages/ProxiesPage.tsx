import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  type AlertColor,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Snackbar,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import SpeedIcon from "@mui/icons-material/Speed";
import RefreshIcon from "@mui/icons-material/Refresh";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { alpha } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";
import type { SxProps } from "@mui/material/styles";
import { PageTitle, SystemPanel } from "../components/SystemChrome";
import { runWithConcurrency } from "../features/async";
import {
  createProxyGroups,
  filterGroupProxyNames,
  filterProviders,
  getDelay,
  GROUP_TYPES,
  type GroupSummary,
  type ProviderVehicleFilter,
  type ProxiesResponse,
  type ProxyAvailabilityFilter,
  type ProxyItem,
  type ProxySortMode,
  type ProvidersResponse,
  sortProxyGroupsByPinned,
  sortProxyNames,
  summarizeGroup,
  summarizeProvider,
} from "../features/proxies";
import { usePinnedProxyGroups } from "../hooks/usePinnedProxyGroups";
import { mihomoApi, pingGoogleWithProxy } from "../services/api";

const DELAY_TEST_CONCURRENCY = 6;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatActionError(error: unknown, fallback: string): string {
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message || fallback;
  }

  return fallback;
}

type SnackState = {
  severity: AlertColor;
  message: string;
};

type ActiveSelection = {
  groupName: string;
  groupType: string;
  nodeName: string;
  nodeType?: string;
  delay: number;
};

const oneLineText: SxProps<Theme> = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export default function ProxiesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState(0);
  const [sortMode, setSortMode] = useState<ProxySortMode>("default");
  const [availabilityFilter, setAvailabilityFilter] =
    useState<ProxyAvailabilityFilter>("all");
  const [pendingSelection, setPendingSelection] = useState<{
    group: string;
    name: string;
  } | null>(null);
  const [isTestingAll, setIsTestingAll] = useState(false);
  const [snack, setSnack] = useState<SnackState | null>(null);
  const { pinnedGroupNames, togglePinnedGroup } = usePinnedProxyGroups();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["proxies"],
    queryFn: () => mihomoApi.get<ProxiesResponse>("/").then((response) => response.data),
    refetchInterval: 10000,
  });

  const selectProxy = useMutation({
    mutationFn: ({ group, name }: { group: string; name: string }) =>
      mihomoApi.put(`/proxies/${encodeURIComponent(group)}`, { name }),
    onMutate: ({ group, name }) => setPendingSelection({ group, name }),
    onSuccess: async (_, variables) => {
      await qc.refetchQueries({ queryKey: ["proxies"] });
      setSnack({
        severity: "success",
        message: t("proxies.switch_success", {
          group: variables.group,
          name: variables.name,
        }),
      });
    },
    onError: (error, variables) => {
      setSnack({
        severity: "error",
        message: formatActionError(
          error,
          t("proxies.switch_failed", {
            group: variables.group,
            name: variables.name,
          })
        ),
      });
    },
    onSettled: () => setPendingSelection(null),
  });

  const proxies: Record<string, ProxyItem> = (data?.proxies ?? {}) as Record<string, ProxyItem>;
  const isProvidersTab = tab === GROUP_TYPES.length + 1;
  const groupType = tab === 0 ? null : GROUP_TYPES[tab - 1];
  const groups = useMemo(() => createProxyGroups(proxies), [proxies]);
  const displayGroups = useMemo(() => {
    const targetGroups = groupType
      ? groups.filter((group) => group.type === groupType)
      : groups;

    return sortProxyGroupsByPinned(targetGroups, pinnedGroupNames)
      .map((group) => ({
        ...group,
        pinned: pinnedGroupNames.includes(group.groupName),
        summary: summarizeGroup(group, proxies),
        visibleNames: sortProxyNames(
          filterGroupProxyNames(group, proxies, search, availabilityFilter),
          proxies,
          sortMode
        ),
      }))
      .filter((group) => group.visibleNames.length > 0);
  }, [availabilityFilter, groupType, groups, pinnedGroupNames, proxies, search, sortMode]);
  const testTargetNames = useMemo(
    () => Array.from(new Set(displayGroups.flatMap((group) => group.visibleNames))),
    [displayGroups]
  );
  const activeSelections = useMemo<ActiveSelection[]>(
    () =>
      groups
        .filter((group) => group.now)
        .map((group) => {
          const nodeName = group.now as string;
          const node = proxies[nodeName];
          return {
            groupName: group.groupName,
            groupType: group.type,
            nodeName,
            nodeType: node?.type,
            delay: getDelay(node),
          };
        }),
    [groups, proxies]
  );
  const primarySelection = activeSelections.find((selection) => selection.groupName === "GLOBAL") ?? activeSelections[0];

  const pingGoogle = useMutation({
    mutationFn: (proxyName: string) => pingGoogleWithProxy(proxyName).then((response) => response.data),
    onSuccess: (result, proxyName) => {
      setSnack({
        severity: "success",
        message: t("proxies.google_ping_success", {
          name: proxyName,
          delay: result.delay,
        }),
      });
    },
    onError: (error, proxyName) => {
      setSnack({
        severity: "error",
        message: formatActionError(error, t("proxies.google_ping_failed", { name: proxyName })),
      });
    },
  });

  async function handleTestAll() {
    if (testTargetNames.length === 0) {
      setSnack({
        severity: "info",
        message: t("proxies.no_nodes_to_test"),
      });
      return;
    }

    setIsTestingAll(true);
    const results = await runWithConcurrency(
      testTargetNames,
      DELAY_TEST_CONCURRENCY,
      (name) =>
        mihomoApi.get(
          `/proxies/${encodeURIComponent(name)}/delay?timeout=5000&url=https://www.gstatic.com/generate_204`
        )
    );
    setIsTestingAll(false);
    await qc.invalidateQueries({ queryKey: ["proxies"] });

    const failedCount = results.filter((result) => result.status === "rejected").length;
    if (failedCount === 0) {
      setSnack({
        severity: "success",
        message: t("proxies.delay_test_success", { count: testTargetNames.length }),
      });
      return;
    }

    setSnack({
      severity: failedCount === testTargetNames.length ? "error" : "warning",
      message: t("proxies.delay_test_partial", {
        success: testTargetNames.length - failedCount,
        failed: failedCount,
      }),
    });
  }

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <PageTitle title={t("proxies.title")} />

      <Box
        sx={(theme) => ({
          display: "flex",
          gap: 1.5,
          mb: 2,
          flexWrap: "wrap",
          p: 1.25,
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          background: alpha(theme.palette.background.paper, 0.58),
          backdropFilter: "blur(18px)",
        })}
      >
        <TextField
          size="small"
          placeholder={t("proxies.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ flex: 1, minWidth: 260 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            },
          }}
        />
        {!isProvidersTab && (
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>{t("proxies.filter_status")}</InputLabel>
            <Select
              label={t("proxies.filter_status")}
              value={availabilityFilter}
              onChange={(event) =>
                setAvailabilityFilter(event.target.value as ProxyAvailabilityFilter)
              }
            >
              <MenuItem value="all">{t("proxies.filter_all_nodes")}</MenuItem>
              <MenuItem value="available">{t("proxies.filter_available_nodes")}</MenuItem>
              <MenuItem value="unavailable">{t("proxies.filter_unavailable_nodes")}</MenuItem>
            </Select>
          </FormControl>
        )}
        {!isProvidersTab && (
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{t("proxies.sort")}</InputLabel>
            <Select
              label={t("proxies.sort")}
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as ProxySortMode)}
            >
              <MenuItem value="default">{t("proxies.sort_default")}</MenuItem>
              <MenuItem value="delay">{t("proxies.sort_delay")}</MenuItem>
              <MenuItem value="name">{t("proxies.sort_name")}</MenuItem>
            </Select>
          </FormControl>
        )}
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          {!isProvidersTab && (
            <Tooltip title={t("proxies.delay_test_all")}>
              <span>
                <IconButton
                  onClick={() => void handleTestAll()}
                  disabled={isTestingAll}
                  sx={(theme) => ({
                    border: 1,
                    borderColor: "divider",
                    bgcolor: alpha(theme.palette.background.paper, 0.56),
                  })}
                >
                  {isTestingAll ? <CircularProgress size={20} /> : <SpeedIcon />}
                </IconButton>
              </span>
            </Tooltip>
          )}
          <Tooltip title={t("proxies.refresh")}>
            <span>
              <IconButton
                onClick={() => void refetch()}
                disabled={isFetching}
                sx={(theme) => ({
                  border: 1,
                  borderColor: "divider",
                  bgcolor: alpha(theme.palette.background.paper, 0.56),
                })}
              >
                {isFetching ? <CircularProgress size={20} /> : <RefreshIcon />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        {!isProvidersTab && (
          <Button
            variant="outlined"
            startIcon={pingGoogle.isPending ? <CircularProgress size={16} /> : <SpeedIcon />}
            onClick={() => primarySelection && pingGoogle.mutate(primarySelection.nodeName)}
            disabled={!primarySelection || pingGoogle.isPending}
            sx={{ minWidth: 150 }}
          >
            {pingGoogle.isPending ? t("proxies.google_pinging") : t("proxies.google_ping")}
          </Button>
        )}
      </Box>

      {!isProvidersTab && (
        <ActiveSelectionPanel
          primarySelection={primarySelection}
          selections={activeSelections}
          pinging={pingGoogle.isPending}
          onPing={(name) => pingGoogle.mutate(name)}
        />
      )}

      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2, minHeight: 44 }}
      >
        <Tab label={t("proxies.tab_all")} />
        {GROUP_TYPES.map((type) => (
          <Tab key={type} label={type} />
        ))}
        <Tab label={t("proxies.tab_providers")} />
      </Tabs>

      {tab <= GROUP_TYPES.length ? (
        displayGroups.length > 0 ? (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 2 }}>
            {displayGroups.map((group) => (
              <SystemPanel
                key={group.groupName}
                sx={{ gridColumn: { xs: "span 12", lg: "span 6", xl: "span 4" } }}
              >
                <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                  <GroupHeader
                    groupName={group.groupName}
                    type={group.type}
                    current={group.now}
                    pinned={group.pinned}
                    summary={group.summary}
                    onTogglePinned={() => togglePinnedGroup(group.groupName)}
                  />

                  <Grid container spacing={1}>
                    {group.visibleNames.map((name) => {
                      const proxy = proxies[name];
                      const delay = getDelay(proxy);
                      const isActive = name === group.now;
                      const isSelecting =
                        selectProxy.isPending &&
                        pendingSelection?.group === group.groupName &&
                        pendingSelection.name === name;

                      return (
                        <Grid key={name} size={{ xs: 12, sm: 6 }}>
                          <ProxyNodeCard
                            name={name}
                            type={proxy?.type}
                            delay={delay}
                            active={isActive}
                            selecting={isSelecting}
                            disabled={selectProxy.isPending}
                            onSelect={() => selectProxy.mutate({ group: group.groupName, name })}
                          />
                        </Grid>
                      );
                    })}
                  </Grid>
                </CardContent>
              </SystemPanel>
            ))}
          </Box>
        ) : (
          <Alert severity="info">{t("proxies.empty_groups")}</Alert>
        )
      ) : (
        <ProxyProviders
          proxies={proxies}
          search={search}
          onNotify={(severity, message) => setSnack({ severity, message })}
        />
      )}

      <Snackbar
        open={!!snack}
        autoHideDuration={2500}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snack?.severity ?? "info"} onClose={() => setSnack(null)}>
          {snack?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function GroupHeader({
  groupName,
  type,
  current,
  pinned,
  summary,
  onTogglePinned,
}: {
  groupName: string;
  type: string;
  current?: string;
  pinned: boolean;
  summary: GroupSummary;
  onTogglePinned: () => void;
}) {
  const { t } = useTranslation();
  const availablePercent = summary.totalNodes > 0
    ? Math.round((summary.availableNodes / summary.totalNodes) * 100)
    : 0;

  return (
    <Box sx={{ mb: 1.75 }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5, mb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, minWidth: 0, ...oneLineText }}>
              {groupName}
            </Typography>
            <Chip label={type} size="small" variant="outlined" sx={{ height: 22 }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", ...oneLineText }}>
            {current ? t("proxies.current_selected", { name: current }) : t("proxies.no_current_selected")}
          </Typography>
        </Box>
        <Tooltip title={pinned ? t("proxies.unpin_group") : t("proxies.pin_group")}>
          <IconButton
            size="small"
            color={pinned ? "warning" : "default"}
            onClick={onTogglePinned}
            aria-label={pinned ? t("proxies.unpin_group") : t("proxies.pin_group")}
            sx={(theme) => ({
              border: 1,
              borderColor: pinned ? alpha(theme.palette.warning.main, 0.42) : "divider",
              backgroundColor: pinned ? alpha(theme.palette.warning.main, 0.12) : alpha(theme.palette.background.default, 0.34),
            })}
          >
            {pinned ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={(theme) => ({ p: 1.25, borderRadius: 1.5, border: 1, borderColor: "divider", backgroundColor: alpha(theme.palette.background.default, 0.32) })}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.75 }}>
          <Typography variant="caption" color="text.secondary">
            {t("proxies.summary_available", { available: summary.availableNodes, total: summary.totalNodes })}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {availablePercent}%
          </Typography>
        </Box>
        <LinearProgress variant="determinate" value={availablePercent} color={summary.availableNodes > 0 ? "success" : "inherit"} sx={{ height: 5, mb: 1 }} />
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
          <Metric label={t("proxies.metric_current")} value={summary.activeDelay !== null ? `${summary.activeDelay}ms` : "--"} />
          <Metric label={t("proxies.metric_best")} value={summary.bestDelay !== null ? `${summary.bestDelay}ms` : "--"} />
          <Metric label={t("proxies.metric_average")} value={summary.averageDelay !== null ? `${summary.averageDelay}ms` : "--"} />
        </Box>
      </Box>
    </Box>
  );
}

function ActiveSelectionPanel({
  primarySelection,
  selections,
  pinging,
  onPing,
}: {
  primarySelection?: ActiveSelection;
  selections: ActiveSelection[];
  pinging: boolean;
  onPing: (name: string) => void;
}) {
  const { t } = useTranslation();
  const visibleSelections = selections.slice(0, 6);

  return (
    <SystemPanel sx={{ mb: 2 }}>
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
          <Box sx={{ minWidth: 260, flex: 1 }}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.12em" }}>
              {t("proxies.active_selection_title")}
            </Typography>
            {primarySelection ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mt: 0.5, minWidth: 0, flexWrap: "wrap" }}>
                <Chip label={primarySelection.groupName} color="primary" sx={{ maxWidth: 220 }} />
                <Typography variant="h6" sx={{ fontWeight: 900, maxWidth: 420, ...oneLineText }}>
                  {primarySelection.nodeName}
                </Typography>
                {primarySelection.nodeType && <Chip label={primarySelection.nodeType} size="small" variant="outlined" />}
                <Chip
                  label={primarySelection.delay >= 0 ? `${primarySelection.delay}ms` : t("proxies.unavailable")}
                  size="small"
                  color={getDelayColor(primarySelection.delay) === "default" ? undefined : getDelayColor(primarySelection.delay)}
                  variant={getDelayColor(primarySelection.delay) === "default" ? "outlined" : "filled"}
                />
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t("proxies.no_active_selection")}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
              {t("proxies.active_selection_hint")}
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={pinging ? <CircularProgress size={16} /> : <SpeedIcon />}
            onClick={() => primarySelection && onPing(primarySelection.nodeName)}
            disabled={!primarySelection || pinging}
          >
            {pinging ? t("proxies.google_pinging") : t("proxies.google_ping")}
          </Button>
        </Box>
        {visibleSelections.length > 0 && (
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1.5 }}>
            {visibleSelections.map((selection) => (
              <Chip
                key={selection.groupName}
                label={`${selection.groupName} → ${selection.nodeName}`}
                size="small"
                variant={selection.groupName === primarySelection?.groupName ? "filled" : "outlined"}
                color={selection.groupName === primarySelection?.groupName ? "primary" : undefined}
                sx={{ maxWidth: 280 }}
              />
            ))}
          </Box>
        )}
      </CardContent>
    </SystemPanel>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.2 }}>
        {label}
      </Typography>
      <Typography variant="caption" sx={{ display: "block", fontWeight: 800, ...oneLineText }}>
        {value}
      </Typography>
    </Box>
  );
}

function getDelayColor(delay: number): "success" | "warning" | "error" | "default" {
  if (delay < 0) return "default";
  if (delay <= 500) return "success";
  if (delay <= 1200) return "warning";
  return "error";
}

function ProxyNodeCard({
  name,
  type,
  delay,
  active,
  selecting,
  disabled,
  onSelect,
}: {
  name: string;
  type?: string;
  delay: number;
  active: boolean;
  selecting: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const delayColor = getDelayColor(delay);

  return (
    <Button
      fullWidth
      variant="outlined"
      disabled={disabled && !selecting}
      onClick={active ? undefined : onSelect}
      sx={(theme) => ({
        minHeight: 68,
        justifyContent: "flex-start",
        textAlign: "left",
        borderRadius: 1.5,
        p: 1.25,
        borderColor: active ? alpha(theme.palette.primary.main, 0.78) : "divider",
        backgroundColor: active
          ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.16 : 0.08)
          : alpha(theme.palette.background.default, theme.palette.mode === "dark" ? 0.28 : 0.42),
        color: "text.primary",
        boxShadow: active ? `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.26)}` : "none",
        "&:hover": {
          borderColor: active ? alpha(theme.palette.primary.main, 0.86) : alpha(theme.palette.primary.main, 0.5),
          backgroundColor: active
            ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.2 : 0.1)
            : alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.1 : 0.06),
        },
      })}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%", minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", color: active ? "primary.main" : "text.secondary" }}>
          {selecting ? <CircularProgress size={18} /> : active ? <CheckCircleIcon fontSize="small" /> : <RadioButtonUncheckedIcon fontSize="small" />}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 800, lineHeight: 1.3, ...oneLineText }}>
            {name}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.5, minWidth: 0 }}>
            {type && <Chip label={type} size="small" variant="outlined" sx={{ height: 20, maxWidth: 86 }} />}
            <Chip
              label={delay >= 0 ? `${delay}ms` : t("proxies.unavailable")}
              size="small"
              color={delayColor === "default" ? undefined : delayColor}
              variant={delayColor === "default" ? "outlined" : "filled"}
              sx={{ height: 20 }}
            />
          </Box>
        </Box>
      </Box>
    </Button>
  );
}

function ProxyProviders({
  proxies,
  search,
  onNotify,
}: {
  proxies: Record<string, ProxyItem>;
  search: string;
  onNotify: (severity: AlertColor, message: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [vehicleFilter, setVehicleFilter] =
    useState<ProviderVehicleFilter>("all");
  const [pendingAction, setPendingAction] = useState<{
    type: "update" | "healthcheck";
    name: string;
  } | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["proxyProviders"],
    queryFn: () => mihomoApi.get<ProvidersResponse>("/providers/proxies").then((response) => response.data),
    refetchInterval: 30000,
  });

  const updateProvider = useMutation({
    mutationFn: (name: string) => mihomoApi.put(`/providers/proxies/${encodeURIComponent(name)}`),
    onMutate: (name) => setPendingAction({ type: "update", name }),
    onSuccess: async (_, name) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["proxyProviders"] }),
        qc.invalidateQueries({ queryKey: ["proxies"] }),
      ]);
      onNotify("success", t("proxies.provider_refresh_success", { name }));
    },
    onError: (error, name) => {
      onNotify(
        "error",
        formatActionError(error, t("proxies.provider_refresh_failed", { name }))
      );
    },
    onSettled: () => setPendingAction(null),
  });

  const healthCheck = useMutation({
    mutationFn: (name: string) =>
      mihomoApi.get(`/providers/proxies/${encodeURIComponent(name)}/healthcheck`, {
        timeout: 30000,
      }),
    onMutate: (name) => setPendingAction({ type: "healthcheck", name }),
    onSuccess: async (_, name) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["proxyProviders"] }),
        qc.invalidateQueries({ queryKey: ["proxies"] }),
      ]);
      onNotify("success", t("proxies.provider_healthcheck_success", { name }));
    },
    onError: (error, name) => {
      onNotify(
        "error",
        formatActionError(error, t("proxies.provider_healthcheck_failed", { name }))
      );
    },
    onSettled: () => setPendingAction(null),
  });

  const providers = useMemo(() => {
    if (!data?.providers) return [];

    return Object.entries(data.providers)
      .filter(([, provider]) => provider.vehicleType !== "Compatible")
      .map(([name, provider]) => ({ name, ...provider }));
  }, [data]);
  const vehicleTypes = useMemo(
    () => Array.from(new Set(providers.map((provider) => provider.vehicleType))).sort(),
    [providers]
  );
  const displayProviders = useMemo(
    () =>
      filterProviders(providers, search, vehicleFilter).map((provider) => ({
        ...provider,
        summary: summarizeProvider(provider, proxies),
      })),
    [providers, proxies, search, vehicleFilter]
  );

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (providers.length === 0) {
    return <Alert severity="info">{t("proxies.empty_providers")}</Alert>;
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1.5, flexWrap: "wrap" }}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>{t("proxies.vehicle_type")}</InputLabel>
          <Select
            label={t("proxies.vehicle_type")}
            value={vehicleFilter}
            onChange={(event) => setVehicleFilter(event.target.value)}
          >
            <MenuItem value="all">{t("proxies.vehicle_type_all")}</MenuItem>
            {vehicleTypes.map((type) => (
              <MenuItem key={type} value={type}>
                {type}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Button
          size="small"
          startIcon={isFetching ? <CircularProgress size={16} /> : <RefreshIcon />}
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          {isFetching ? t("proxies.refreshing") : t("proxies.refresh")}
        </Button>
      </Box>

      {displayProviders.length === 0 && (
        <Alert severity="info">{t("proxies.empty_provider_filters")}</Alert>
      )}

      {displayProviders.map((provider) => {
        const sub = provider.subscriptionInfo;
        const used = sub ? (sub.Upload ?? 0) + (sub.Download ?? 0) : 0;
        const total = sub?.Total ?? 0;
        const expire = sub?.Expire;
        const percent = total > 0 ? (used / total) * 100 : 0;
        const isUpdating =
          updateProvider.isPending &&
          pendingAction?.type === "update" &&
          pendingAction.name === provider.name;
        const isHealthChecking =
          healthCheck.isPending &&
          pendingAction?.type === "healthcheck" &&
          pendingAction.name === provider.name;

        return (
          <Card key={provider.name} variant="outlined">
            <CardContent>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  mb: 1,
                  gap: 1.5,
                  flexWrap: "wrap",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {provider.name}
                  </Typography>
                  <Chip label={provider.vehicleType} size="small" variant="outlined" />
                  <Chip
                    size="small"
                    label={t("proxies.summary_nodes", { count: provider.summary.totalNodes })}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    color={provider.summary.availableNodes > 0 ? "success" : "default"}
                    label={t("proxies.summary_available", {
                      available: provider.summary.availableNodes,
                      total: provider.summary.totalNodes,
                    })}
                  />
                  {provider.summary.bestDelay !== null && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t("proxies.summary_best_delay", {
                        delay: provider.summary.bestDelay,
                      })}
                    />
                  )}
                </Box>

                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => updateProvider.mutate(provider.name)}
                    disabled={updateProvider.isPending || healthCheck.isPending}
                    startIcon={isUpdating ? <CircularProgress size={16} /> : <RefreshIcon />}
                  >
                    {isUpdating ? t("proxies.refreshing") : t("proxies.provider_refresh")}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => healthCheck.mutate(provider.name)}
                    disabled={updateProvider.isPending || healthCheck.isPending}
                    startIcon={isHealthChecking ? <CircularProgress size={16} /> : <SpeedIcon />}
                  >
                    {isHealthChecking
                      ? t("proxies.healthchecking")
                      : t("proxies.provider_healthcheck")}
                  </Button>
                </Box>
              </Box>

              {sub && total > 0 && (
                <Box sx={{ mb: 1 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {formatBytes(used)} / {formatBytes(total)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {percent.toFixed(1)}%
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(percent, 100)}
                    sx={{ mb: 0.5 }}
                  />
                  {expire && expire > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      {t("profiles.expire")}: {new Date(expire * 1000).toLocaleDateString()}
                    </Typography>
                  )}
                </Box>
              )}

              {provider.updatedAt && (
                <Typography variant="caption" color="text.secondary">
                  {t("profiles.updated")}: {new Date(provider.updatedAt).toLocaleString()}
                </Typography>
              )}
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
}
