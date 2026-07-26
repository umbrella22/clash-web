// Shared sx tokens for the overview card grid, kept in one place so the
// page shell and the extracted realtime cards stay visually identical.
export const sharedCardSx = {
  display: "flex",
  width: "100%",
  height: "100%",
  minHeight: 340,
} as const;

export const sharedCardContentSx = {
  display: "flex",
  flexDirection: "column",
  gap: 1.5,
  width: "100%",
  height: "100%",
} as const;

export const metricPanelSx = {
  p: 1.5,
  border: 1,
  borderColor: "divider",
  borderRadius: 0,
  bgcolor: "background.default",
} as const;
