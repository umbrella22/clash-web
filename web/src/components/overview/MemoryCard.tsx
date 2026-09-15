import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  LinearProgress,
  Typography,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useMemory } from "../../hooks/useStream";
import { formatBytes } from "../../features/mihomoDownload";
import RealtimeLineChart from "../RealtimeLineChart";
import { metricPanelSx, sharedCardContentSx, sharedCardSx } from "./overviewCardStyles";

/**
 * Owns the memory WebSocket stream so its 1s updates re-render only this
 * card instead of the whole overview page.
 */
export default function MemoryCard({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { memory, history: memoryHistory, status: memoryStreamStatus } = useMemory(enabled);

  const memUsed = memory.inuse;
  const memoryLimitFromHistory = memoryHistory.findLast((item) => item.oslimit > 0)?.oslimit ?? 0;
  const memTotal = memory.oslimit > 0 ? memory.oslimit : memoryLimitFromHistory;
  const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;

  const memoryLabels = useMemo(
    () => Array.from({ length: Math.max(memoryHistory.length, 12) }, (_, index) => `${index + 1}`),
    [memoryHistory.length]
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

  return (
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
            label={memoryStreamStatus === "closed" ? t("overview.stopped") : memoryStreamStatus === "open" ? t("overview.realtime") : t("overview.reconnecting")}
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
            sx={{ height: 8, borderRadius: 0 }}
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
  );
}
