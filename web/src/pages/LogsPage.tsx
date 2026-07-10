import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Typography,
  TextField,
  InputAdornment,
  Chip,
  List,
  ListItem,
  Paper,
  Divider,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import SearchIcon from "@mui/icons-material/Search";
import { createLogsWs } from "../services/api";
import { PageTitle, SystemPanel } from "../components/SystemChrome";
import {
  appendLogs,
  filterLogs,
  getVisibleLogs,
  LOG_FLUSH_INTERVAL_MS,
  type LogEntry,
} from "../features/logs";

export default function LogsPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingLogsRef = useRef<LogEntry[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const mountedRef = useRef(false);
  const isDark = theme.palette.mode === "dark";
  const accentColor = isDark ? "#7ee787" : theme.palette.primary.main;
  const mutedColor = theme.palette.text.secondary;
  const panelTextColor = theme.palette.text.primary;
  const logColors: Record<string, string> = {
    error: theme.palette.error.main,
    warning: theme.palette.warning.main,
    info: isDark ? "#7ee787" : theme.palette.success.main,
    debug: mutedColor,
  };

  const flushPendingLogs = useCallback(() => {
    if (pendingLogsRef.current.length === 0) return;
    const pending = pendingLogsRef.current;
    pendingLogsRef.current = [];
    setLogs((prev) => appendLogs(prev, pending));
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current || wsRef.current) return;
    const ws = createLogsWs("debug");
    wsRef.current = ws;
    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
    };
    ws.onmessage = (e) => {
      try {
        const entry: LogEntry = JSON.parse(e.data);
        pendingLogsRef.current.push(entry);
        if (flushTimerRef.current === null) {
          flushTimerRef.current = window.setTimeout(() => {
            flushTimerRef.current = null;
            flushPendingLogs();
          }, LOG_FLUSH_INTERVAL_MS);
        }
      } catch {}
    };
    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      if (!mountedRef.current || reconnectTimerRef.current !== null) return;
      const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 10000);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };
  }, [flushPendingLogs]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
      pendingLogsRef.current = [];
    };
  }, [connect]);

  const filtered = useMemo(() => filterLogs(logs, filter, search), [filter, logs, search]);
  const visibleLogs = useMemo(() => getVisibleLogs(filtered), [filtered]);
  const hiddenCount = filtered.length - visibleLogs.length;

  return (
    <Box>
      <PageTitle
        title={t("logs.title")}
        count={filtered.length}
        actions={
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {(["all", "info", "warning", "error", "debug"] as const).map((level) => (
              <Chip
                key={level}
                label={level === "all" ? "All" : t(`logs.${level}`)}
                size="small"
                variant={filter === level ? "filled" : "outlined"}
                onClick={() => setFilter(level)}
                sx={{ fontFamily: '"Courier New", monospace' }}
              />
            ))}
          </Box>
        }
      />

      <SystemPanel
        sx={{
          backgroundColor: isDark
            ? "rgba(13, 17, 23, 0.82)"
            : alpha(theme.palette.background.paper, 0.92),
          color: panelTextColor,
          borderColor: alpha(accentColor, isDark ? 0.18 : 0.22),
          boxShadow: isDark
            ? "0 18px 40px rgba(0, 0, 0, 0.3)"
            : "0 18px 40px rgba(15, 23, 42, 0.1)",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            opacity: 0.18,
            background: isDark
              ? "linear-gradient(rgba(18,16,16,0) 50%, rgba(255,255,255,0.035) 50%), linear-gradient(90deg, rgba(255,0,0,0.02), rgba(0,255,0,0.02), rgba(0,0,255,0.02))"
              : "linear-gradient(rgba(255,255,255,0) 50%, rgba(15,23,42,0.03) 50%), linear-gradient(90deg, rgba(37,99,235,0.03), rgba(16,185,129,0.03), rgba(139,92,246,0.03))",
            backgroundSize: "100% 3px, 3px 100%",
          }}
        />

        <Box sx={{ p: 2.25, position: "relative", zIndex: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 2, flexWrap: "wrap", mb: 1.5 }}>
            <Box>
              <Typography sx={{ fontFamily: '"Courier New", monospace', fontWeight: 700, letterSpacing: "0.12em", color: accentColor }}>
                PRTS / SYSTEM LOG STREAM
              </Typography>
              <Typography variant="caption" sx={{ color: mutedColor, fontFamily: '"Courier New", monospace' }}>
                realtime websocket relay / buffer {logs.length} entries
              </Typography>
            </Box>
          </Box>

          <TextField
            size="small"
            placeholder={t("logs.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            fullWidth
            sx={{
              mb: 2,
              "& .MuiOutlinedInput-root": {
                color: panelTextColor,
                backgroundColor: isDark
                  ? alpha("#ffffff", 0.02)
                  : alpha(theme.palette.background.default, 0.48),
                fontFamily: '"Courier New", monospace',
              },
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: alpha(accentColor, isDark ? 0.2 : 0.18),
              },
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start"><SearchIcon sx={{ color: accentColor }} /></InputAdornment>
                ),
              },
            }}
          />

          <Paper
            variant="outlined"
            sx={{
              height: "calc(100vh - 300px)",
              overflow: "auto",
              borderRadius: 0,
              borderColor: alpha(accentColor, isDark ? 0.15 : 0.14),
              backgroundColor: isDark
                ? "rgba(0, 0, 0, 0.25)"
                : alpha(theme.palette.background.default, 0.32),
            }}
            ref={listRef}
          >
            <List dense disablePadding>
              {visibleLogs.map((l, i) => {
                const logIndex = hiddenCount + i;
                return (
                <Box key={`${logIndex}-${l.type}-${l.payload}`}>
                  <ListItem sx={{ py: 0.65, px: 1.5, alignItems: "flex-start" }}>
                    <Box sx={{ display: "grid", gridTemplateColumns: "88px 82px 1fr", gap: 1.5, width: "100%" }}>
                      <Typography variant="caption" sx={{ fontFamily: '"Courier New", monospace', color: mutedColor }}>
                        #{String(logIndex + 1).padStart(4, "0")}
                      </Typography>
                      <Typography variant="caption" sx={{ fontFamily: '"Courier New", monospace', color: logColors[l.type] ?? panelTextColor, fontWeight: 700 }}>
                        [{l.type.toUpperCase()}]
                      </Typography>
                      <Typography variant="caption" sx={{ fontFamily: '"Courier New", monospace', color: panelTextColor, lineHeight: 1.8, wordBreak: "break-word" }}>
                        {l.payload}
                      </Typography>
                    </Box>
                  </ListItem>
                  {i < visibleLogs.length - 1 && <Divider sx={{ borderColor: alpha(accentColor, isDark ? 0.08 : 0.1) }} />}
                </Box>
                );
              })}
            </List>
          </Paper>
        </Box>
      </SystemPanel>
    </Box>
  );
}
