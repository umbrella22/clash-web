import { createContext, useContext } from "react";
import type { AlertColor } from "@mui/material";

export type Toast = {
  message: string;
  severity: AlertColor;
};

export const ToastContext = createContext<(toast: Toast) => void>(() => {});

/** App-wide toast dispatcher. Errors linger long enough to read; successes stay brief. */
export function useToast() {
  return useContext(ToastContext);
}
