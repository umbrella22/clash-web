import { useCallback, useState, type ReactNode } from "react";
import { Alert, Snackbar } from "@mui/material";
import { ToastContext, type Toast } from "./toastContext";

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(Toast & { id: number }) | null>(null);
  const [open, setOpen] = useState(false);

  const showToast = useCallback((next: Toast) => {
    // A fresh id remounts the Snackbar so the auto-hide timer restarts even
    // when a toast replaces one that is already showing.
    setToast({ ...next, id: Date.now() });
    setOpen(true);
  }, []);

  const handleClose = (_event: unknown, reason?: string) => {
    if (reason === "clickaway") return;
    setOpen(false);
  };

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <Snackbar
        key={toast?.id}
        open={open}
        autoHideDuration={toast?.severity === "error" ? 6000 : 2500}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={toast?.severity ?? "info"} onClose={() => setOpen(false)}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}
