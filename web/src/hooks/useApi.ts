import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getStatus,
  startMihomo,
  stopMihomo,
  restartMihomo,
  getMode,
  putMode,
  getRuntimeConfig,
  getRuntimeConfigYaml,
  patchRuntimeConfig,
  getDnsConfig,
  saveDnsConfig,
  validateDnsConfig,
  applyDnsConfig,
  restoreDefaultDnsConfig,
  getBackups,
  createBackup,
  restoreBackup,
  deleteBackup,
  getProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  activateProfile,
  updateSubscription,
  reorderProfiles,
  getProfileFile,
  saveProfileFile,
  importProfile,
  getPreferences,
  savePreferences,
  restoreDefaultPreferences,
  getProxyEnvironment,
  type CreateBackupRequest,
  type ProfileItem,
  type UserPreferences,
} from "../services/api";

const refetchRuntimeQueries = (qc: ReturnType<typeof useQueryClient>) => {
  qc.refetchQueries({ queryKey: ["proxies"] });
  qc.refetchQueries({ queryKey: ["proxyProviders"] });
  qc.refetchQueries({ queryKey: ["runtimeConfig"] });
  qc.refetchQueries({ queryKey: ["runtimeConfigYaml"] });
  qc.refetchQueries({ queryKey: ["mode"] });
};

export const useStatus = () =>
  useQuery({
    queryKey: ["status"],
    queryFn: () => getStatus().then((r) => r.data),
    refetchInterval: 5000,
  });

export const useMode = () =>
  useQuery({
    queryKey: ["mode"],
    queryFn: () => getMode().then((r) => r.data),
    refetchInterval: 5000,
  });

export const useSetMode = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: string) => putMode(mode),
    onSuccess: () => {
      qc.refetchQueries({ queryKey: ["mode"] });
      qc.refetchQueries({ queryKey: ["runtimeConfig"] });
    },
  });
};

export const useStartMihomo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => startMihomo(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["status"] }),
  });
};

export const useStopMihomo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => stopMihomo(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["status"] }),
  });
};

export const useRestartMihomo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => restartMihomo(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["status"] }),
  });
};

export const useRuntimeConfig = () =>
  useQuery({
    queryKey: ["runtimeConfig"],
    queryFn: () => getRuntimeConfig().then((r) => r.data),
  });

export const useRuntimeConfigYaml = () =>
  useQuery({
    queryKey: ["runtimeConfigYaml"],
    queryFn: () => getRuntimeConfigYaml().then((r) => r.data),
  });

export const usePatchRuntimeConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => patchRuntimeConfig(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runtimeConfig"] });
      qc.invalidateQueries({ queryKey: ["runtimeConfigYaml"] });
    },
  });
};

export const useDnsConfig = () =>
  useQuery({
    queryKey: ["dnsConfig"],
    queryFn: () => getDnsConfig().then((r) => r.data),
  });

export const useSaveDnsConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => saveDnsConfig(content),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dnsConfig"] }),
  });
};

export const useValidateDnsConfig = () =>
  useMutation({
    mutationFn: (content: string) => validateDnsConfig(content),
  });

export const useApplyDnsConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => applyDnsConfig(),
    onSuccess: () => {
      qc.refetchQueries({ queryKey: ["runtimeConfig"] });
      qc.refetchQueries({ queryKey: ["runtimeConfigYaml"] });
      qc.refetchQueries({ queryKey: ["proxies"] });
      qc.refetchQueries({ queryKey: ["proxyProviders"] });
    },
  });
};

export const useRestoreDefaultDnsConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => restoreDefaultDnsConfig(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dnsConfig"] });
      qc.invalidateQueries({ queryKey: ["runtimeConfigYaml"] });
    },
  });
};

export const useBackups = () =>
  useQuery({
    queryKey: ["backups"],
    queryFn: () => getBackups().then((r) => r.data),
  });

export const useCreateBackup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data?: CreateBackupRequest) => createBackup(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backups"] }),
  });
};

export const useRestoreBackup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreBackup(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backups"] });
      qc.invalidateQueries({ queryKey: ["profiles"] });
      qc.invalidateQueries({ queryKey: ["dnsConfig"] });
      refetchRuntimeQueries(qc);
    },
  });
};

export const useDeleteBackup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteBackup(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backups"] }),
  });
};

export const useProfiles = () =>
  useQuery({
    queryKey: ["profiles"],
    queryFn: () => getProfiles().then((r) => r.data),
  });

export const useCreateProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<ProfileItem> & { name: string; type: string }) =>
      createProfile(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
};

export const useUpdateProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ uid, data }: { uid: string; data: Record<string, unknown> }) =>
      updateProfile(uid, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
};

export const useDeleteProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uid: string) => deleteProfile(uid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
};

export const useActivateProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uid: string) => activateProfile(uid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles"] });
      refetchRuntimeQueries(qc);
    },
  });
};

export const useUpdateSubscription = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uid: string) => updateSubscription(uid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles"] });
      refetchRuntimeQueries(qc);
    },
  });
};

export const useReorderProfiles = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uids: string[]) => reorderProfiles(uids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
};

export const useProfileFile = (uid: string | null) =>
  useQuery({
    queryKey: ["profileFile", uid],
    queryFn: () => getProfileFile(uid!).then((r) => r.data),
    enabled: !!uid,
  });

export const useSaveProfileFile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ uid, content }: { uid: string; content: string }) =>
      saveProfileFile(uid, content),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["profileFile", vars.uid] }),
  });
};

export const useImportProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) => importProfile(formData),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
};

export const usePreferences = () =>
  useQuery({
    queryKey: ["preferences"],
    queryFn: () => getPreferences().then((r) => r.data),
  });

export const useSavePreferences = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UserPreferences) => savePreferences(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preferences"] }),
  });
};

export const useRestoreDefaultPreferences = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => restoreDefaultPreferences(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preferences"] }),
  });
};

export const useProxyEnvironment = () =>
  useQuery({
    queryKey: ["proxyEnvironment"],
    queryFn: () => getProxyEnvironment().then((r) => r.data),
  });
