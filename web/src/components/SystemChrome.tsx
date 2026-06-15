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
      sx={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 2,
        flexWrap: "wrap",
        mb: 2,
      }}
    >
      <Box>
        <Typography variant="h5" sx={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {title}
          {typeof count === "number" ? ` (${count})` : ""}
        </Typography>
      </Box>
      {actions}
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
        "&::after": {
          content: '""',
          position: "absolute",
          top: -1,
          left: -1,
          width: 12,
          height: 12,
          borderTop: 2,
          borderLeft: 2,
          borderColor: "text.primary",
          opacity: 0.55,
        },
        ...sx,
      }}
    >
      {children}
    </Card>
  );
}
