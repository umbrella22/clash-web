import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Chip, CircularProgress, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { SxProps, Theme } from "@mui/material/styles";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { getDelayColor } from "../../features/proxies";

const oneLineText: SxProps<Theme> = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export interface ProxyNodeCardProps {
  name: string;
  type?: string;
  /** Effective delay in ms; <= 0 means failed/untested. */
  delay: number;
  /** True when the last in-session test for this node failed (timeout). */
  timedOut: boolean;
  active: boolean;
  /** True while a selection request for THIS node is in flight. */
  selecting: boolean;
  /** True while a delay test for THIS node is in flight. */
  testing: boolean;
  onSelect: (name: string) => void;
  onTest: (name: string) => void;
}

/**
 * One proxy node inside a group panel. Memoized with a flat, primitive props
 * shape (plus stable callbacks) so batch delay-test updates only re-render
 * the cards whose data actually changed.
 */
export const ProxyNodeCard = memo(function ProxyNodeCard({
  name,
  type,
  delay,
  timedOut,
  active,
  selecting,
  testing,
  onSelect,
  onTest,
}: ProxyNodeCardProps) {
  const { t } = useTranslation();
  const delayColor = getDelayColor(delay);
  const delayLabel =
    delay > 0 ? `${delay}ms` : timedOut ? t("proxies.delay_timeout") : t("proxies.unavailable");

  return (
    <Button
      fullWidth
      variant="outlined"
      onClick={active || selecting ? undefined : () => onSelect(name)}
      sx={(theme) => ({
        minHeight: 68,
        justifyContent: "flex-start",
        textAlign: "left",
        borderRadius: 0,
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
            <Tooltip title={t("proxies.delay_test")}>
              <Chip
                label={delayLabel}
                size="small"
                icon={testing ? <CircularProgress size={12} color="inherit" /> : undefined}
                color={delayColor === "default" ? undefined : delayColor}
                variant={delayColor === "default" ? "outlined" : "filled"}
                onClick={(event) => {
                  // Test only this node; do not select it.
                  event.stopPropagation();
                  if (!testing) onTest(name);
                }}
                sx={{ height: 20 }}
              />
            </Tooltip>
          </Box>
        </Box>
      </Box>
    </Button>
  );
});
