import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Box, Card, CardContent, Chip, Grid, Typography, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useTraffic } from "../../hooks/useStream";
import { formatBytes, formatBytesPerSecond } from "../../features/mihomoDownload";
import RealtimeLineChart from "../RealtimeLineChart";
import { metricPanelSx, sharedCardContentSx, sharedCardSx } from "./overviewCardStyles";

function formatSpeed(bytes: number): string {
  return formatBytes(bytes) + "/s";
}

/**
 * Owns the traffic WebSocket stream so its 1s updates re-render only this
 * card instead of the whole overview page.
 */
export default function TrafficCard({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { traffic, history, status: trafficStreamStatus } = useTraffic(enabled);

  const trafficLabels = useMemo(
    () => Array.from({ length: Math.max(history.length, 12) }, (_, index) => `${index + 1}`),
    [history.length]
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
              {t("overview.traffic")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("overview.traffic_description")}
            </Typography>
          </Box>
          <Chip
            label={trafficStreamStatus === "closed" ? t("overview.stopped") : trafficStreamStatus === "open" ? t("overview.realtime") : t("overview.reconnecting")}
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
  );
}
