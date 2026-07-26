import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import SpeedIcon from "@mui/icons-material/Speed";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { alpha } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";
import type { SxProps } from "@mui/material/styles";
import { PageTitle, SystemPanel } from "../components/SystemChrome";
import { ProxyGroupPanel } from "../components/proxies/ProxyGroupPanel";
import { useToast } from "../components/toastContext";
import { formatApiError } from "../utils/errors";
import { runWithConcurrency } from "../features/async";
import {
  createProxyGroups,
  filterGroupProxyNames,
  filterProviders,
  getDelay,
  getDelayColor,
  GROUP_TYPES,
  type ProviderVehicleFilter,
  type ProxyAvailabilityFilter,
  type ProxyItem,
  type ProxySortMode,
  type ProvidersResponse,
  sortProxyGroupsByPinned,
  sortProxyNames,
  summarizeGroup,
  summarizeProvider,
} from "../features/proxies";
import {
  useCollapsedProxyGroups,
  usePinnedProxyGroups,
} from "../hooks/usePinnedProxyGroups";
import { proxyQueryKey, useProxies, useSelectProxy } from "../hooks/useProxies";
import { mihomoApi, pingGoogleWithProxy } from "../services/api";

const DELAY_TEST_CONCURRENCY = 6;
const SEARCH_DEBOUNCE_MS = 150;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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
  const showToast = useToast();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState(0);
  const [sortMode, setSortMode] = useState<ProxySortMode>("default");
  const [availabilityFilter, setAvailabilityFilter] =
    useState<ProxyAvailabilityFilter>("all");
  // Session-local delay results so batch/single tests can stream into the UI
  // without waiting for a full refetch. Superseded by fresh server data.
  const [delayOverrides, setDelayOverrides] = useState<Record<string, number>>({});
  const [testingNodes, setTestingNodes] = useState<ReadonlySet<string>>(new Set());
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  // Spinner/disable only for user-initiated refreshes; the 10s background
  // poll also flips isFetching and must not make the button flicker.
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const { pinnedGroupNames, togglePinnedGroup } = usePinnedProxyGroups();
  const { isGroupCollapsed, toggleGroupCollapsed } = useCollapsedProxyGroups();
  const isBatchTesting = batchProgress !== null;

  // Debounce the search input so filtering does not run on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useProxies();

  const handleManualRefresh = useCallback(() => {
    setManualRefreshing(true);
    void refetch().finally(() => setManualRefreshing(false));
  }, [refetch]);

  // Fresh server data (poll or post-test invalidation) supersedes the
  // session-local overrides. Render-time adjustment per React's
  // "adjusting state when a prop changes" pattern.
  const [seenDataStamp, setSeenDataStamp] = useState(dataUpdatedAt);
  if (seenDataStamp !== dataUpdatedAt) {
    setSeenDataStamp(dataUpdatedAt);
    if (Object.keys(delayOverrides).length > 0) {
      setDelayOverrides({});
    }
  }

  const selectProxy = useSelectProxy();
  const pendingSelection =
    selectProxy.isPending && selectProxy.variables ? selectProxy.variables : null;
  const { mutate: mutateSelectProxy } = selectProxy;

  const handleSelectNode = useCallback(
    (group: string, name: string) => {
      mutateSelectProxy(
        { group, name },
        {
          onSuccess: () => {
            showToast({
              severity: "success",
              message: t("proxies.switch_success", { group, name }),
            });
          },
          onError: (error) => {
            showToast({
              severity: "error",
              message: formatApiError(error, t("proxies.switch_failed", { group, name })),
            });
          },
        }
      );
    },
    [mutateSelectProxy, showToast, t]
  );

  const proxies = useMemo(
    () => (data?.proxies ?? {}) as Record<string, ProxyItem>,
    [data]
  );
  const isProvidersTab = tab === GROUP_TYPES.length + 1;
  const groupType = tab === 0 ? null : GROUP_TYPES[tab - 1];
  const searchActive = search.trim().length > 0;
  const groups = useMemo(() => createProxyGroups(proxies), [proxies]);
  const displayGroups = useMemo(() => {
    const targetGroups = groupType
      ? groups.filter((group) => group.type === groupType)
      : groups;

    return sortProxyGroupsByPinned(targetGroups, pinnedGroupNames)
      .map((group) => {
        const pinned = pinnedGroupNames.includes(group.groupName);
        return {
          ...group,
          pinned,
          // Pinned groups start expanded, others collapsed; an active search
          // force-expands so matches are actually visible.
          collapsed: searchActive ? false : isGroupCollapsed(group.groupName, !pinned),
          summary: summarizeGroup(group, proxies),
          visibleNames: sortProxyNames(
            filterGroupProxyNames(group, proxies, search, availabilityFilter),
            proxies,
            sortMode
          ),
        };
      })
      .filter((group) => group.visibleNames.length > 0);
  }, [
    availabilityFilter,
    groupType,
    groups,
    isGroupCollapsed,
    pinnedGroupNames,
    proxies,
    search,
    searchActive,
    sortMode,
  ]);
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
            delay: delayOverrides[nodeName] ?? getDelay(node),
          };
        }),
    [delayOverrides, groups, proxies]
  );
  const primarySelection = activeSelections.find((selection) => selection.groupName === "GLOBAL") ?? activeSelections[0];

  const pingGoogle = useMutation({
    mutationFn: (proxyName: string) => pingGoogleWithProxy(proxyName).then((response) => response.data),
    onSuccess: (result, proxyName) => {
      showToast({
        severity: "success",
        message: t("proxies.google_ping_success", {
          name: proxyName,
          delay: result.delay,
        }),
      });
    },
    onError: (error, proxyName) => {
      showToast({
        severity: "error",
        message: formatApiError(error, t("proxies.google_ping_failed", { name: proxyName })),
      });
    },
  });

  const handleTestNode = useCallback((name: string) => {
    setTestingNodes((current) => new Set(current).add(name));
    pingGoogleWithProxy(name)
      .then((response) => {
        const delay = response.data.delay > 0 ? response.data.delay : -1;
        setDelayOverrides((current) => ({ ...current, [name]: delay }));
      })
      .catch(() => {
        setDelayOverrides((current) => ({ ...current, [name]: -1 }));
      })
      .finally(() => {
        setTestingNodes((current) => {
          const next = new Set(current);
          next.delete(name);
          return next;
        });
      });
  }, []);

  const runBatchTest = useCallback(
    async (names: string[]) => {
      const targets = Array.from(new Set(names));
      if (targets.length === 0) {
        showToast({ severity: "info", message: t("proxies.no_nodes_to_test") });
        return;
      }

      setBatchProgress({ done: 0, total: targets.length });
      setTestingNodes((current) => {
        const next = new Set(current);
        targets.forEach((name) => next.add(name));
        return next;
      });

      try {
        const results = await runWithConcurrency(
          targets,
          DELAY_TEST_CONCURRENCY,
          (name) => pingGoogleWithProxy(name).then((response) => response.data),
          (index, result) => {
            // Stream each result into the override map so delays show up as
            // nodes finish, not after the whole batch.
            const name = targets[index];
            const delay =
              result.status === "fulfilled" && result.value.delay > 0
                ? result.value.delay
                : -1;
            setDelayOverrides((current) => ({ ...current, [name]: delay }));
            setTestingNodes((current) => {
              const next = new Set(current);
              next.delete(name);
              return next;
            });
            setBatchProgress((current) =>
              current ? { done: current.done + 1, total: current.total } : current
            );
          }
        );

        const failedCount = results.filter((result) => result.status === "rejected").length;
        if (failedCount === 0) {
          showToast({
            severity: "success",
            message: t("proxies.delay_test_success", { count: targets.length }),
          });
        } else {
          showToast({
            severity: failedCount === targets.length ? "error" : "warning",
            message: t("proxies.delay_test_partial", {
              success: targets.length - failedCount,
              failed: failedCount,
            }),
          });
        }
      } finally {
        setBatchProgress(null);
        setTestingNodes((current) => {
          const next = new Set(current);
          targets.forEach((name) => next.delete(name));
          return next;
        });
        await qc.invalidateQueries({ queryKey: proxyQueryKey });
      }
    },
    [qc, showToast, t]
  );

  const handleTestGroup = useCallback(
    (groupName: string) => {
      const group = displayGroups.find((candidate) => candidate.groupName === groupName);
      if (group) void runBatchTest(group.visibleNames);
    },
    [displayGroups, runBatchTest]
  );

  const handleToggleCollapsed = useCallback(
    (groupName: string) => {
      // While a search forces every panel open, toggling would silently write
      // a collapsed state that only takes effect after the search is cleared.
      if (searchActive) return;
      toggleGroupCollapsed(groupName, !pinnedGroupNames.includes(groupName));
    },
    [pinnedGroupNames, searchActive, toggleGroupCollapsed]
  );

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
          borderRadius: 0,
          background: alpha(theme.palette.background.paper, 0.58),
          backdropFilter: "blur(18px)",
        })}
      >
        <TextField
          size="small"
          placeholder={t("proxies.search")}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
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
            // Fixed-width slot so the chip appearing/disappearing doesn't
            // shift the toolbar buttons when a batch test starts.
            <Box sx={{ minWidth: 128, display: "flex", justifyContent: "flex-end" }}>
              {batchProgress && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={t("proxies.testing_progress", {
                    done: batchProgress.done,
                    total: batchProgress.total,
                  })}
                  sx={{ fontVariantNumeric: "tabular-nums" }}
                />
              )}
            </Box>
          )}
          {!isProvidersTab && (
            <Tooltip title={t("proxies.delay_test_all")}>
              <span>
                <IconButton
                  onClick={() => void runBatchTest(testTargetNames)}
                  disabled={isBatchTesting}
                  sx={(theme) => ({
                    border: 1,
                    borderColor: "divider",
                    bgcolor: alpha(theme.palette.background.paper, 0.56),
                  })}
                >
                  {isBatchTesting ? <CircularProgress size={20} /> : <SpeedIcon />}
                </IconButton>
              </span>
            </Tooltip>
          )}
          <Tooltip title={t("proxies.refresh")}>
            <span>
              <IconButton
                onClick={handleManualRefresh}
                disabled={manualRefreshing}
                sx={(theme) => ({
                  border: 1,
                  borderColor: "divider",
                  bgcolor: alpha(theme.palette.background.paper, 0.56),
                })}
              >
                {manualRefreshing ? <CircularProgress size={20} /> : <RefreshIcon />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
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
        isError && !data ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => void refetch()}>
                {t("common.retry")}
              </Button>
            }
          >
            {t("proxies.load_failed")}
          </Alert>
        ) : displayGroups.length > 0 ? (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(12, 1fr)",
              gap: 2,
              // Keep collapsed panels compact instead of stretching them to
              // the tallest panel in the same grid row.
              alignItems: "start",
            }}
          >
            {displayGroups.map((group) => (
              <ProxyGroupPanel
                key={group.groupName}
                groupName={group.groupName}
                type={group.type}
                now={group.now}
                pinned={group.pinned}
                collapsed={group.collapsed}
                summary={group.summary}
                visibleNames={group.visibleNames}
                proxies={proxies}
                delayOverrides={delayOverrides}
                testingNodes={testingNodes}
                pendingSelection={pendingSelection}
                batchTesting={isBatchTesting}
                collapseLocked={searchActive}
                onTogglePinned={togglePinnedGroup}
                onToggleCollapsed={handleToggleCollapsed}
                onTestGroup={handleTestGroup}
                onSelectNode={handleSelectNode}
                onTestNode={handleTestNode}
                sx={{ gridColumn: { xs: "span 12", lg: "span 6", xl: "span 4" } }}
              />
            ))}
          </Box>
        ) : (
          <Alert severity="info">{t("proxies.empty_groups")}</Alert>
        )
      ) : (
        <ProxyProviders proxies={proxies} search={search} />
      )}
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

function ProxyProviders({
  proxies,
  search,
}: {
  proxies: Record<string, ProxyItem>;
  search: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const showToast = useToast();
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
        qc.invalidateQueries({ queryKey: proxyQueryKey }),
      ]);
      showToast({
        severity: "success",
        message: t("proxies.provider_refresh_success", { name }),
      });
    },
    onError: (error, name) => {
      showToast({
        severity: "error",
        message: formatApiError(error, t("proxies.provider_refresh_failed", { name })),
      });
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
        qc.invalidateQueries({ queryKey: proxyQueryKey }),
      ]);
      showToast({
        severity: "success",
        message: t("proxies.provider_healthcheck_success", { name }),
      });
    },
    onError: (error, name) => {
      showToast({
        severity: "error",
        message: formatApiError(error, t("proxies.provider_healthcheck_failed", { name })),
      });
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
