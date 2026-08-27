import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
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
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import { createLogsWs } from "../services/api";
import { PageTitle, SystemPanel } from "../components/SystemChrome";
import {
  appendLogs,
  filterLogs,
  formatLogTime,
  getVisibleLogs,
  stampLog,
  LOG_BUFFER_LIMIT,
  LOG_FLUSH_INTERVAL_MS,
  type LogEntry,
  type LogRecord,
} from "../features/logs";

// Mirrors the theme's monoFont stack (theme/index.ts does not export it).
const MONO_FONT =
  '"JetBrains Mono Variable", "JetBrains Mono", "SFMono-Regular", "Cascadia Code", "Courier New", monospace';

const AT_BOTTOM_THRESHOLD_PX = 40;

type StreamStatus = "connecting" | "open" | "reconnecting";

export default function LogsPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const listRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingLogsRef = useRef<LogRecord[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const mountedRef = useRef(false);
  const pausedRef = useRef(false);
  const atBottomRef = useRef(true);
  const logIdRef = useRef(0);
  // Mirrors for the zero-dep flush callback: the jump-to-latest pill must
  // count only entries the active filter/search would actually show.
  const filterRef = useRef(filter);
  const searchRef = useRef(search);
  useEffect(() => {
    filterRef.current = filter;
    searchRef.current = search;
    setUnseenCount(0);
  }, [filter, search]);
  const isDark = theme.palette.mode === "dark";
  const accentColor = theme.palette.primary.main;
  const mutedColor = theme.palette.text.secondary;
  const panelTextColor = theme.palette.text.primary;
  const logColors: Record<string, string> = {
    error: theme.palette.error.main,
    warning: theme.palette.warning.main,
    info: theme.palette.success.main,
    debug: mutedColor,
  };

  const flushPendingLogs = useCallback(() => {
    if (pausedRef.current) return;
    if (pendingLogsRef.current.length === 0) return;
    const pending = pendingLogsRef.current;
    pendingLogsRef.current = [];
    setLogs((prev) => appendLogs(prev, pending));
    if (atBottomRef.current) {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      });
    } else {
      const matched = filterLogs(pending, filterRef.current, searchRef.current).length;
      if (matched > 0) {
        setUnseenCount((count) => count + matched);
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current || wsRef.current) return;
    const ws = createLogsWs("debug");
    wsRef.current = ws;
    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      if (mountedRef.current) setStreamStatus("open");
    };
    ws.onmessage = (e) => {
      try {
        const entry: LogEntry = JSON.parse(e.data);
        logIdRef.current += 1;
        pendingLogsRef.current.push(stampLog(entry, logIdRef.current, Date.now()));
        // While paused the pending buffer keeps growing; cap it so a long
        // pause cannot leak memory (oldest pending entries are dropped).
        if (pendingLogsRef.current.length > LOG_BUFFER_LIMIT) {
          pendingLogsRef.current.splice(0, pendingLogsRef.current.length - LOG_BUFFER_LIMIT);
        }
        if (!pausedRef.current && flushTimerRef.current === null) {
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
      setStreamStatus("reconnecting");
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

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_THRESHOLD_PX;
    atBottomRef.current = atBottom;
    if (atBottom) setUnseenCount(0);
  }, []);

  const jumpToLatest = useCallback(() => {
    atBottomRef.current = true;
    setUnseenCount(0);
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    // Entries received while paused stay in the pending buffer; flush them
    // into the visible list on resume.
    if (!next) flushPendingLogs();
  }, [flushPendingLogs]);

  const handleClear = useCallback(() => {
    pendingLogsRef.current = [];
    setLogs([]);
    setUnseenCount(0);
    atBottomRef.current = true;
  }, []);

  const filtered = useMemo(() => filterLogs(logs, filter, search), [filter, logs, search]);
  const visibleLogs = useMemo(() => getVisibleLogs(filtered), [filtered]);

  const statusText =
    streamStatus === "connecting"
      ? t("logs.connecting")
      : streamStatus === "reconnecting"
        ? t("logs.reconnecting")
        : logs.length === 0
          ? t("logs.waiting")
          : null;
  const statusColor = streamStatus === "reconnecting" ? theme.palette.warning.main : mutedColor;

  return (
    <Box>
      <PageTitle
        title={t("logs.title")}
        count={filtered.length}
        aux="EVENT LOG STREAM"
        actions={
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {(["all", "info", "warning", "error", "debug"] as const).map((level) => (
              <Chip
                key={level}
                label={level === "all" ? t("common.all") : t(`logs.${level}`)}
                size="small"
                variant={filter === level ? "filled" : "outlined"}
                onClick={() => setFilter(level)}
                sx={{ fontFamily: MONO_FONT }}
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
              <Typography sx={{ fontFamily: MONO_FONT, fontWeight: 700, letterSpacing: "0.12em", color: accentColor }}>
                PRTS / SYSTEM LOG STREAM
              </Typography>
              <Typography variant="caption" sx={{ color: mutedColor, fontFamily: MONO_FONT }}>
                realtime websocket relay / buffer {logs.length} entries
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              {statusText && (
                <Typography variant="caption" sx={{ fontFamily: MONO_FONT, color: statusColor }}>
                  {statusText}
                </Typography>
              )}
              <Button
                size="small"
                variant={paused ? "contained" : "outlined"}
                color={paused ? "warning" : "primary"}
                startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />}
                onClick={togglePause}
              >
                {paused ? t("logs.resume") : t("logs.pause")}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DeleteSweepIcon />}
                onClick={handleClear}
              >
                {t("logs.clear")}
              </Button>
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
                fontFamily: MONO_FONT,
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

          <Box sx={{ position: "relative" }}>
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
              onScroll={handleScroll}
            >
              <List dense disablePadding>
                {visibleLogs.map((l, i) => (
                  <Box key={l.id}>
                    <ListItem sx={{ py: 0.65, px: 1.5, alignItems: "flex-start" }}>
                      <Box sx={{ display: "grid", gridTemplateColumns: "72px 76px 82px 1fr", gap: 1.5, width: "100%" }}>
                        <Typography variant="caption" sx={{ fontFamily: MONO_FONT, color: mutedColor }}>
                          #{String(l.id).padStart(4, "0")}
                        </Typography>
                        <Typography variant="caption" sx={{ fontFamily: MONO_FONT, color: mutedColor }}>
                          {formatLogTime(l.receivedAt)}
                        </Typography>
                        <Typography variant="caption" sx={{ fontFamily: MONO_FONT, color: logColors[l.type] ?? panelTextColor, fontWeight: 700 }}>
                          [{l.type.toUpperCase()}]
                        </Typography>
                        <Typography variant="caption" sx={{ fontFamily: MONO_FONT, color: panelTextColor, lineHeight: 1.8, wordBreak: "break-word" }}>
                          {l.payload}
                        </Typography>
                      </Box>
                    </ListItem>
                    {i < visibleLogs.length - 1 && <Divider sx={{ borderColor: alpha(accentColor, isDark ? 0.08 : 0.1) }} />}
                  </Box>
                ))}
              </List>
            </Paper>
            {unseenCount > 0 && (
              <Chip
                label={t("logs.jump_to_latest", { count: unseenCount })}
                size="small"
                color="primary"
                icon={<ArrowDownwardIcon />}
                onClick={jumpToLatest}
                sx={{
                  position: "absolute",
                  bottom: 12,
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 2,
                  fontFamily: MONO_FONT,
                }}
              />
            )}
          </Box>
        </Box>
      </SystemPanel>
    </Box>
  );
}
