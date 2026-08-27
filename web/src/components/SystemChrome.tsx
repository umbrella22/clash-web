import { Box, Card, Typography, type SxProps, type Theme } from "@mui/material";
import { alpha } from "@mui/material/styles";
function SignalAssembly() {
  return (
    <Box
      component="svg"
      aria-hidden
      viewBox="0 0 132 64"
      sx={{
        width: 116,
        height: 56,
        flex: "0 0 auto",
        display: { xs: "none", lg: "block" },
        overflow: "visible",
        "& .signal-assembly__orbit--auxiliary": {
          transformBox: "fill-box",
          transformOrigin: "center",
          animation: "signal-assembly-orbit 10s linear infinite reverse",
        },
        "& .signal-assembly__electron": {
          // Starts at the right edge of the main ellipse, then traces that ellipse as an electron.
          transform: "translate(37.8px, 0)",
          transformBox: "fill-box",
          transformOrigin: "center",
          animation: "signal-assembly-electron 4.8s linear infinite",
          willChange: "transform, opacity",
        },
        "@keyframes signal-assembly-orbit": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        "@keyframes signal-assembly-electron": {
          "0%, 100%": { transform: "translate(37.8px, 0)", opacity: 0.98 },
          "12.5%": { transform: "translate(26.7px, -7.4px)", opacity: 0.82 },
          "25%": { transform: "translate(0, -10.5px)", opacity: 0.56 },
          "37.5%": { transform: "translate(-26.7px, -7.4px)", opacity: 0.76 },
          "50%": { transform: "translate(-37.8px, 0)", opacity: 0.98 },
          "62.5%": { transform: "translate(-26.7px, 7.4px)", opacity: 1 },
          "75%": { transform: "translate(0, 10.5px)", opacity: 0.9 },
          "87.5%": { transform: "translate(26.7px, 7.4px)", opacity: 1 },
        },
        "@media (prefers-reduced-motion: reduce)": {
          "& .signal-assembly__orbit--auxiliary, & .signal-assembly__electron": {
            animation: "none",
          },
        },
      }}
    >
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <circle cx="52" cy="32" r="19" opacity="0.58" />
        <ellipse className="signal-assembly__orbit" cx="52" cy="32" rx="43" ry="12" opacity="0.7" />
        <ellipse className="signal-assembly__orbit signal-assembly__orbit--auxiliary" cx="52" cy="32" rx="31" ry="9" opacity="0.38" transform="rotate(-45 52 32)" />
        <path d="M88 10H124V46H106" opacity="0.34" />
        <path d="M12 52H37" opacity="0.34" />
      </g>
      <circle className="signal-assembly__electron" cx="52" cy="32" r="3.5" fill="currentColor" />
      <circle cx="52" cy="32" r="4" fill="currentColor" opacity="0.82" />
    </Box>
  );
}

export function PageTitle({
  title,
  count,
  actions,
  eyebrow = "CONTROL SURFACE",
  aux,
}: {
  title: string;
  count?: number;
  actions?: React.ReactNode;
  eyebrow?: string;
  /** English auxiliary label under the Chinese title (EVE bilingual rule). */
  aux?: string;
}) {
  return (
    <Box
      component="header"
      sx={{
        display: "flex",
        alignItems: { xs: "flex-start", md: "flex-end" },
        justifyContent: "space-between",
        gap: 2,
        flexWrap: "wrap",
        mb: { xs: 2.25, md: 3 },
        pb: 2,
        borderBottom: 1,
        borderColor: "divider",
        position: "relative",
        "&::after": {
          content: '""',
          position: "absolute",
          left: 0,
          bottom: -1,
          width: { xs: 44, md: 72 },
          height: 2,
          backgroundColor: "primary.main",
        },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.85 }}>
          <Box sx={{ width: 7, height: 7, bgcolor: "primary.main" }} />
          <Typography
            sx={{
              fontFamily: '"JetBrains Mono", "Courier New", monospace',
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.15em",
              color: "text.secondary",
            }}
          >
            // {eyebrow}
          </Typography>
          {typeof count === "number" ? (
            <Typography
              sx={{
                fontFamily: '"JetBrains Mono", "Courier New", monospace',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "0.1em",
                color: "primary.main",
              }}
            >
              {String(count).padStart(2, "0")} ITEMS
            </Typography>
          ) : null}
        </Box>
        <Typography
          variant="h4"
          sx={{
            fontSize: { xs: 26, md: 32 },
            lineHeight: 1.04,
            color: "text.primary",
          }}
        >
          {title}
        </Typography>
        {aux ? (
          <Typography
            sx={{
              mt: 0.8,
              fontFamily: '"JetBrains Mono", "Courier New", monospace',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.16em",
              color: "text.secondary",
            }}
          >
            {aux}
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, ml: "auto" }}>
        <Box sx={{ color: "primary.main", lineHeight: 0 }}><SignalAssembly /></Box>
        {actions ? <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>{actions}</Box> : null}
      </Box>
    </Box>
  );
}

export function SystemPanel({
  children,
  sx,
}: {
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}) {
  return (
    <Card
      sx={{
        position: "relative",
        overflow: "hidden",
        // HUD corner brackets: two quiet cyan ticks marking panel geometry.
        "&::before, &::after": {
          content: '""',
          position: "absolute",
          width: 14,
          height: 14,
          borderColor: (currentTheme: Theme) => alpha(currentTheme.palette.primary.main, 0.4),
          borderStyle: "solid",
          pointerEvents: "none",
          zIndex: 1,
        },
        "&::before": { top: 6, left: 6, borderWidth: "1px 0 0 1px" },
        "&::after": { bottom: 6, right: 6, borderWidth: "0 1px 1px 0" },
        ...sx,
      }}
    >
      {children}
    </Card>
  );
}
