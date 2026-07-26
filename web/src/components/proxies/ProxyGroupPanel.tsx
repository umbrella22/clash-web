import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  CardContent,
  Chip,
  Collapse,
  Grid,
  IconButton,
  LinearProgress,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { SxProps, Theme } from "@mui/material/styles";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SpeedIcon from "@mui/icons-material/Speed";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import { SystemPanel } from "../SystemChrome";
import { getDelay, type GroupSummary, type ProxyItem } from "../../features/proxies";
import { ProxyNodeCard } from "./ProxyNodeCard";

const oneLineText: SxProps<Theme> = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export interface ProxyGroupPanelProps {
  groupName: string;
  type: string;
  now?: string;
  pinned: boolean;
  collapsed: boolean;
  summary: GroupSummary;
  visibleNames: string[];
  proxies: Record<string, ProxyItem>;
  /** Session-local delay results keyed by node name; overrides history data. */
  delayOverrides: Record<string, number>;
  testingNodes: ReadonlySet<string>;
  pendingSelection: { group: string; name: string } | null;
  batchTesting: boolean;
  /** True while a search forces all panels open; collapse controls are inert. */
  collapseLocked: boolean;
  onTogglePinned: (groupName: string) => void;
  onToggleCollapsed: (groupName: string) => void;
  onTestGroup: (groupName: string) => void;
  onSelectNode: (groupName: string, name: string) => void;
  onTestNode: (name: string) => void;
  sx?: SxProps<Theme>;
}

export function ProxyGroupPanel({
  groupName,
  type,
  now,
  pinned,
  collapsed,
  summary,
  visibleNames,
  proxies,
  delayOverrides,
  testingNodes,
  pendingSelection,
  batchTesting,
  collapseLocked,
  onTogglePinned,
  onToggleCollapsed,
  onTestGroup,
  onSelectNode,
  onTestNode,
  sx,
}: ProxyGroupPanelProps) {
  const { t } = useTranslation();
  const availablePercent = summary.totalNodes > 0
    ? Math.round((summary.availableNodes / summary.totalNodes) * 100)
    : 0;

  // Stable per-group callback so memoized node cards do not re-render
  // whenever unrelated state changes on the page.
  const handleSelect = useCallback(
    (name: string) => onSelectNode(groupName, name),
    [groupName, onSelectNode]
  );

  return (
    <SystemPanel sx={sx}>
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Box
          onClick={collapseLocked ? undefined : () => onToggleCollapsed(groupName)}
          sx={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 1.5,
            cursor: collapseLocked ? "default" : "pointer",
            userSelect: "none",
          }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, minWidth: 0, ...oneLineText }}>
                {groupName}
              </Typography>
              <Chip label={type} size="small" variant="outlined" sx={{ height: 22 }} />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", ...oneLineText }}>
              {now ? t("proxies.current_selected", { name: now }) : t("proxies.no_current_selected")}
            </Typography>
          </Box>
          <Box
            sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}
            onClick={(event) => event.stopPropagation()}
          >
            <Tooltip title={t("proxies.test_group")}>
              <span>
                <IconButton
                  size="small"
                  disabled={batchTesting}
                  onClick={() => onTestGroup(groupName)}
                  aria-label={t("proxies.test_group")}
                  sx={(theme) => ({
                    border: 1,
                    borderColor: "divider",
                    backgroundColor: alpha(theme.palette.background.default, 0.34),
                  })}
                >
                  <SpeedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={pinned ? t("proxies.unpin_group") : t("proxies.pin_group")}>
              <IconButton
                size="small"
                color={pinned ? "warning" : "default"}
                onClick={() => onTogglePinned(groupName)}
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
            <Tooltip title={collapsed ? t("proxies.expand_group") : t("proxies.collapse_group")}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => onToggleCollapsed(groupName)}
                  disabled={collapseLocked}
                  aria-label={collapsed ? t("proxies.expand_group") : t("proxies.collapse_group")}
                  aria-expanded={!collapsed}
                  sx={(theme) => ({
                    border: 1,
                    borderColor: "divider",
                    backgroundColor: alpha(theme.palette.background.default, 0.34),
                  })}
                >
                  <ExpandMoreIcon
                    fontSize="small"
                    sx={{
                      transform: collapsed ? "rotate(0deg)" : "rotate(180deg)",
                      transition: "transform 0.2s ease",
                    }}
                  />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>

        <Collapse in={!collapsed} timeout={200} unmountOnExit>
          <Box
            sx={(theme) => ({
              mt: 1.5,
              mb: 1.75,
              p: 1.25,
              borderRadius: 0,
              border: 1,
              borderColor: "divider",
              backgroundColor: alpha(theme.palette.background.default, 0.32),
            })}
          >
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

          <Grid container spacing={1}>
            {visibleNames.map((name) => {
              const proxy = proxies[name];
              const override = delayOverrides[name];
              const delay = override !== undefined ? override : getDelay(proxy);

              return (
                <Grid key={name} size={{ xs: 12, sm: 6 }}>
                  <ProxyNodeCard
                    name={name}
                    type={proxy?.type}
                    delay={delay}
                    timedOut={override !== undefined && override <= 0}
                    active={name === now}
                    selecting={pendingSelection?.group === groupName && pendingSelection.name === name}
                    testing={testingNodes.has(name)}
                    onSelect={handleSelect}
                    onTest={onTestNode}
                  />
                </Grid>
              );
            })}
          </Grid>
        </Collapse>
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
