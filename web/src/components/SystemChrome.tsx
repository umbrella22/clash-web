import { alpha } from "@mui/material/styles";
import { Box, Card, Typography } from "@mui/material";

export function PageTitle({
  title,
  count,
  actions,
}: {
  title: string;
  count?: number;
  actions?: React.ReactNode;
}) {
  return (
    <Box
      sx={(theme) => ({
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 1.5,
        flexWrap: "wrap",
        width: actions ? "100%" : "fit-content",
        maxWidth: "100%",
        minHeight: 44,
        mb: 1.75,
        px: 0.25,
        pr: actions ? 0.25 : 3,
        pb: 0.75,
        position: "relative",
        color: "text.primary",
        "&::before": {
          content: '""',
          position: "absolute",
          left: 0,
          bottom: 0,
          width: 34,
          height: 2,
          borderRadius: 999,
          background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
          boxShadow:
            theme.palette.mode === "dark"
              ? `0 0 16px ${alpha(theme.palette.primary.main, 0.42)}`
              : "none",
        },
        "&::after": {
          content: '""',
          position: "absolute",
          left: 0,
          bottom: 0,
          width: { xs: "100%", md: "min(520px, 54%)" },
          height: 1,
          background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.38)}, ${alpha(
              theme.palette.secondary.main,
              0.14,
            )}, transparent)`,
        },
      })}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
        <Box
          sx={(theme) => ({
            width: 3,
            height: 22,
            flex: "0 0 auto",
            borderRadius: 999,
            background: `linear-gradient(180deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
            opacity: 0.82,
            boxShadow:
              theme.palette.mode === "dark"
                ? `0 0 14px ${alpha(theme.palette.primary.main, 0.36)}`
                : "none",
          })}
        />
        <Typography
          variant="h5"
          sx={{
            fontSize: { xs: 22, md: 23 },
            lineHeight: 1.12,
            letterSpacing: "0.02em",
            fontFamily: "inherit",
            fontWeight: 850,
            textShadow: (theme) =>
              theme.palette.mode === "dark"
                ? `0 0 14px ${alpha(theme.palette.primary.main, 0.22)}`
                : "none",
          }}
        >
          {title}
          {typeof count === "number" ? ` (${count})` : ""}
        </Typography>
      </Box>
      {actions ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, ml: "auto" }}>
          {actions}
        </Box>
      ) : null}
    </Box>
  );
}

export function SystemPanel({
  children,
  sx,
}: {
  children: React.ReactNode;
  sx?: Record<string, unknown>;
}) {
  return (
    <Card
      sx={{
        position: "relative",
        overflow: "hidden",
        "&::after": {
          content: '""',
          position: "absolute",
          top: -1,
          left: -1,
          width: 18,
          height: 18,
          borderTop: 2,
          borderLeft: 2,
          borderColor: "primary.main",
          opacity: 0.74,
          filter: (theme) =>
            theme.palette.mode === "dark"
              ? `drop-shadow(0 0 8px ${alpha(theme.palette.primary.main, 0.5)})`
              : "none",
        },
        "&::before": {
          content: '""',
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: (theme) =>
            `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)}, transparent 36%)`,
        },
        ...sx,
      }}
    >
      {children}
    </Card>
  );
}
