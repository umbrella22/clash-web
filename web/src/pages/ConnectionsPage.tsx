import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  type AlertColor,
  Box,
  Button,
  Typography,
  IconButton,
  TextField,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Tooltip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import CloseIcon from "@mui/icons-material/Close";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  filterConnections,
  formatBytes,
  sortConnections,
  summarizeConnections,
  type Connection,
  type ConnectionNetworkFilter,
  type ConnectionsData,
  type ConnectionSortKey,
  type SortDirection,
} from "../features/connections";
import { mihomoApi } from "../services/api";
import { PageTitle, SystemPanel } from "../components/SystemChrome";

const CONNECTION_REFETCH_INTERVAL_MS = 5000;
const CONNECTION_VISIBLE_LIMIT = 200;

function timeAgo(start: string): string {
  const diff = Date.now() - new Date(start).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

export default function ConnectionsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [networkFilter, setNetworkFilter] = useState<ConnectionNetworkFilter>("all");
  const [sortKey, setSortKey] = useState<ConnectionSortKey>("time");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [snack, setSnack] = useState<{ severity: AlertColor; message: string } | null>(null);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["connections"],
    queryFn: () => mihomoApi.get<ConnectionsData>("/connections").then((r) => r.data),
    refetchInterval: (query) => {
      const count = Array.isArray(query.state.data?.connections)
        ? query.state.data.connections.length
        : 0;
      return document.visibilityState === "hidden" || count > 1000
        ? false
        : CONNECTION_REFETCH_INTERVAL_MS;
    },
    refetchIntervalInBackground: false,
    staleTime: 1500,
  });

  const deleteConn = useMutation({
    mutationFn: (id: string) => mihomoApi.delete(`/connections/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["connections"] });
      setSnack({ severity: "success", message: t("connections.close_success") });
    },
    onError: () => setSnack({ severity: "error", message: t("connections.close_failed") }),
  });

  const closeAll = useMutation({
    mutationFn: () => mihomoApi.delete("/connections"),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["connections"] });
      setSnack({ severity: "success", message: t("connections.close_all_success") });
    },
    onError: () => setSnack({ severity: "error", message: t("connections.close_all_failed") }),
  });

  const connections = Array.isArray(data?.connections) ? data.connections : [];

  const summary = useMemo(() => summarizeConnections(connections), [connections]);
  const filtered = useMemo(
    () => sortConnections(filterConnections(connections, search, networkFilter), sortKey, sortDirection),
    [connections, networkFilter, search, sortDirection, sortKey]
  );
  const visibleConnections = useMemo(
    () => filtered.slice(0, CONNECTION_VISIBLE_LIMIT),
    [filtered]
  );

  if (isLoading)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
        <CircularProgress />
      </Box>
    );

  return (
    <Box>
      <PageTitle
        title={t("connections.title")}
        count={filtered.length}
        actions={
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            {isFetching && <CircularProgress size={18} />}
            <Tooltip title={t("connections.close_all")}>
              <IconButton onClick={() => closeAll.mutate()} color="error" disabled={closeAll.isPending}>
                {closeAll.isPending ? <CircularProgress size={20} /> : <DeleteSweepIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        }
      />

      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
        <Chip label={t("connections.summary_total", { count: summary.total })} variant="outlined" />
        <Chip label={t("connections.summary_tcp", { count: summary.tcp })} variant="outlined" />
        <Chip label={t("connections.summary_udp", { count: summary.udp })} variant="outlined" />
        <Chip label={t("connections.summary_download", { value: formatBytes(summary.download) })} variant="outlined" />
        <Chip label={t("connections.summary_upload", { value: formatBytes(summary.upload) })} variant="outlined" />
        <Chip label={t("connections.summary_top_chain", { name: summary.topChain ?? t("connections.none") })} variant="outlined" />
      </Box>

      <Box sx={{ display: "flex", gap: 1.5, mb: 2, flexWrap: "wrap" }}>
        <TextField
          size="small"
          placeholder={t("connections.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1, minWidth: 260 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start"><SearchIcon /></InputAdornment>
              ),
            },
          }}
        />
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>{t("connections.filter_network")}</InputLabel>
          <Select
            label={t("connections.filter_network")}
            value={networkFilter}
            onChange={(event) => setNetworkFilter(event.target.value as ConnectionNetworkFilter)}
          >
            <MenuItem value="all">{t("connections.filter_all")}</MenuItem>
            <MenuItem value="tcp">TCP</MenuItem>
            <MenuItem value="udp">UDP</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>{t("connections.sort")}</InputLabel>
          <Select
            label={t("connections.sort")}
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as ConnectionSortKey)}
          >
            <MenuItem value="time">{t("connections.sort_time")}</MenuItem>
            <MenuItem value="download">{t("connections.sort_download")}</MenuItem>
            <MenuItem value="upload">{t("connections.sort_upload")}</MenuItem>
            <MenuItem value="host">{t("connections.sort_host")}</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>{t("connections.direction")}</InputLabel>
          <Select
            label={t("connections.direction")}
            value={sortDirection}
            onChange={(event) => setSortDirection(event.target.value as SortDirection)}
          >
            <MenuItem value="desc">{t("connections.desc")}</MenuItem>
            <MenuItem value="asc">{t("connections.asc")}</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <SystemPanel>
        <TableContainer component={Paper} variant="outlined" sx={{ backgroundColor: "transparent" }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t("connections.host")}</TableCell>
              <TableCell>{t("connections.network")}</TableCell>
              <TableCell>{t("connections.type")}</TableCell>
              <TableCell>{t("connections.chains")}</TableCell>
              <TableCell>{t("connections.dl")}</TableCell>
              <TableCell>{t("connections.ul")}</TableCell>
              <TableCell>{t("connections.time")}</TableCell>
              <TableCell padding="checkbox" />
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleConnections.map((c: Connection) => {
              const host = c.metadata?.host || c.metadata?.destinationIP || "-";
              const port = c.metadata?.destinationPort;

              return (
                <TableRow key={c.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {port ? `${host}:${port}` : host}
                    </Typography>
                  </TableCell>
                  <TableCell><Chip label={c.metadata?.network ?? "-"} size="small" /></TableCell>
                  <TableCell><Typography variant="caption">{c.metadata?.type ?? "-"}</Typography></TableCell>
                  <TableCell><Typography variant="caption">{(c.chains ?? []).join(" → ") || "-"}</Typography></TableCell>
                  <TableCell><Typography variant="caption">{formatBytes(c.download)}</Typography></TableCell>
                  <TableCell><Typography variant="caption">{formatBytes(c.upload)}</Typography></TableCell>
                  <TableCell><Typography variant="caption">{timeAgo(c.start)}</Typography></TableCell>
                  <TableCell padding="checkbox">
                    <IconButton size="small" onClick={() => deleteConn.mutate(c.id)} disabled={deleteConn.isPending}>
                      {deleteConn.isPending ? <CircularProgress size={16} /> : <CloseIcon fontSize="small" />}
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </TableContainer>
      </SystemPanel>
      {isError && (
        <Alert severity="error" sx={{ mt: 2 }} action={
          <Button color="inherit" size="small" onClick={() => void refetch()}>
            Retry
          </Button>
        }>
          {error instanceof Error ? error.message : t("connections.close_failed")}
        </Alert>
      )}
      {filtered.length === 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          {connections.length === 0 ? t("connections.empty") : t("connections.empty_filtered")}
        </Alert>
      )}
      {filtered.length > CONNECTION_VISIBLE_LIMIT && (
        <Alert severity="info" sx={{ mt: 2 }}>
          {t("connections.truncated", { shown: CONNECTION_VISIBLE_LIMIT, total: filtered.length })}
        </Alert>
      )}
      {connections.length > 1000 && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {t("connections.polling_paused_large", { count: connections.length })}
        </Alert>
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
