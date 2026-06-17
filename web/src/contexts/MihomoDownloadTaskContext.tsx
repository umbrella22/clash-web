import { createContext, useContext, type ReactNode } from "react";

import { useMihomoDownloadTask } from "../hooks/useMihomoDownloadTask";

type MihomoDownloadTaskContextValue = ReturnType<typeof useMihomoDownloadTask>;

const MihomoDownloadTaskContext = createContext<MihomoDownloadTaskContextValue | null>(null);

export function MihomoDownloadTaskProvider({ children }: { children: ReactNode }) {
  const value = useMihomoDownloadTask();

  return (
    <MihomoDownloadTaskContext.Provider value={value}>
      {children}
    </MihomoDownloadTaskContext.Provider>
  );
}

export function useMihomoDownloadTaskContext() {
  const value = useContext(MihomoDownloadTaskContext);
  if (!value) {
    throw new Error("useMihomoDownloadTaskContext must be used within MihomoDownloadTaskProvider");
  }
  return value;
}
