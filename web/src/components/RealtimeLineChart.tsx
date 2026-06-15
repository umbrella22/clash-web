import { useEffect, useMemo, useRef } from "react";
import {
  Chart,
  CategoryScale,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartDataset,
  type ChartOptions,
} from "chart.js";
import { Box, useTheme } from "@mui/material";

Chart.register(
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler
);

type LineSeries = {
  label: string;
  values: number[];
  borderColor: string;
  backgroundColor: string;
};

interface RealtimeLineChartProps {
  series: LineSeries[];
  labels: string[];
  valueFormatter?: (value: number) => string;
  height?: number | string;
}

export default function RealtimeLineChart({
  series,
  labels,
  valueFormatter = (value) => `${value}`,
  height = "100%",
}: RealtimeLineChartProps) {
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart<"line"> | null>(null);

  const options = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            color: theme.palette.text.secondary,
            font: {
              size: 11,
            },
          },
        },
        tooltip: {
          callbacks: {
            label: (context) =>
              `${context.dataset.label}: ${valueFormatter(context.parsed.y ?? 0)}`,
          },
        },
      },
      elements: {
        point: {
          radius: 0,
          hoverRadius: 3,
        },
        line: {
          borderWidth: 2,
          tension: 0.35,
        },
      },
      scales: {
        x: {
          display: false,
          grid: {
            display: false,
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: theme.palette.text.secondary,
            callback: (value) => valueFormatter(Number(value)),
            maxTicksLimit: 4,
          },
          grid: {
            color: theme.palette.divider,
            drawBorder: false,
          },
        },
      },
    }),
    [theme.palette.divider, theme.palette.text.secondary, valueFormatter]
  );

  const data = useMemo<ChartData<"line">>(
    () => ({
      labels,
      datasets: series.map<ChartDataset<"line">>((item) => ({
        label: item.label,
        data: item.values,
        borderColor: item.borderColor,
        backgroundColor: item.backgroundColor,
        fill: true,
      })),
    }),
    [labels, series]
  );

  useEffect(() => {
    if (!canvasRef.current) return;

    if (!chartRef.current) {
      chartRef.current = new Chart(canvasRef.current, {
        type: "line",
        data,
        options,
      });
      return;
    }

    chartRef.current.data = data;
    chartRef.current.options = options;
    chartRef.current.update("none");
  }, [data, options]);

  useEffect(() => {
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  return (
    <Box sx={{ position: "relative", height, minHeight: 0, width: "100%" }}>
      <canvas ref={canvasRef} />
    </Box>
  );
}
