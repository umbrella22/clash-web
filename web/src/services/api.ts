import axios, { AxiosError } from "axios";

const AUTH_CHANGED_EVENT = "clash-web-auth-changed";
const AUTH_UNAUTHORIZED_EVENT = "clash-web-auth-unauthorized";

export function getStoredToken(): string {
  return localStorage.getItem("clash-web-token") || "";
}

export function setStoredToken(token: string) {
  localStorage.setItem("clash-web-token", token);
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function clearStoredToken() {
  localStorage.removeItem("clash-web-token");
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

function withTokenQuery(path: string): string {
  const token = getStoredToken();
  if (!token) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}token=${encodeURIComponent(token)}`;
}

function attachStoredToken<T extends { headers?: Record<string, string> }>(config: T) {
  const token = getStoredToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}

function handleUnauthorized() {
  clearStoredToken();
  window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
  window.location.hash = "#/login";
}

const api = axios.create({
  baseURL: "/api/v1",
  timeout: 10000,
});

const publicApi = axios.create({
  baseURL: "/api/v1",
  timeout: 10000,
});

api.interceptors.request.use(attachStoredToken);
publicApi.interceptors.request.use(attachStoredToken);

api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error.response?.status === 401) {
      handleUnauthorized();
    }
    return Promise.reject(error);
  }
);

export default api;

export const mihomoApi = axios.create({
  baseURL: "/api/v1/proxy",
  timeout: 10000,
});

export const GOOGLE_CONNECTIVITY_TEST_URL = "https://www.gstatic.com/generate_204";

export interface ProxyDelayResponse {
  delay: number;
}

export function pingGoogleWithProxy(proxyName: string, timeout = 5000) {
  return mihomoApi.get<ProxyDelayResponse>(`/proxies/${encodeURIComponent(proxyName)}/delay`, {
    params: {
      timeout,
      url: GOOGLE_CONNECTIVITY_TEST_URL,
    },
  });
}

mihomoApi.interceptors.request.use(attachStoredToken);

mihomoApi.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error.response?.status === 401) {
      handleUnauthorized();
    }
    return Promise.reject(error);
  }
);

export interface AuthStatus {
  auth_required: boolean;
  authenticated: boolean;
}

export const getAuthStatus = () => publicApi.get<AuthStatus>("/auth/status");
export const loginWithToken = (token: string) =>
  publicApi.post<AuthStatus>("/auth/login", { token });

export interface ServiceStatus {
  mihomo_running: boolean;
  mihomo_api_alive?: boolean;
  service_active: boolean;
  pid: number | null;
  uptime_secs: number | null;
  version?: { version: string; meta: boolean };
  server: { host: string; port: number };
}

export const getStatus = () => api.get<ServiceStatus>("/status");
export const startMihomo = () => api.post("/start");
export const stopMihomo = () => api.post("/stop");
export const restartMihomo = () => api.post("/restart");
export const getMode = () => api.get<{ mode: string }>("/mode");
export const putMode = (mode: string) => api.put("/mode", { mode });
export const getRuntimeConfig = () => api.get("/runtime/config");
export const getRuntimeConfigYaml = () => api.get<ContentResponse>("/runtime/config/yaml");
export const patchRuntimeConfig = (data: Record<string, unknown>) =>
  api.patch("/runtime/config", data);

export interface ContentResponse {
  content: string;
}

export interface SuccessResponse {
  success: boolean;
}

export interface ValidateResponse {
  valid: boolean;
}

export interface PrecheckResult {
  success: boolean;
  error?: string | null;
}

export interface ApiErrorResponse {
  error: string;
  precheck?: PrecheckResult;
}

export function getApiErrorResponse(error: unknown): ApiErrorResponse | null {
  if (!axios.isAxiosError<ApiErrorResponse>(error)) return null;
  return error.response?.data ?? null;
}

export function getPrecheckResult(error: unknown): PrecheckResult | null {
  return getApiErrorResponse(error)?.precheck ?? null;
}

export interface ProfileExtra {
  user_agent?: string;
  request_headers?: Record<string, string>;
  retry_count?: number;
  retry_interval_secs?: number;
  update_interval?: number;
  download_timeout?: number;
  skip_cert_verify?: boolean;
  download_via_proxy?: boolean;
  keep_old_on_failure?: boolean;
}

export interface SubscriptionUpdateDetail {
  success: boolean;
  updated_at: number;
  attempts: number;
  http_status?: number | null;
  error?: string | null;
  downloaded_bytes: number;
  skipped_links?: number;
  kept_old: boolean;
}

export interface OverviewCardPreference {
  id: string;
  visible: boolean;
}

export interface UserPreferences {
  overview_cards: OverviewCardPreference[];
}

export interface ProxyEnvironmentResponse {
  available: boolean;
  reason?: string;
  host?: string;
  port?: number;
  proxy_url?: string;
  no_proxy?: string;
  shell?: {
    export: string;
    unset: string;
  };
}

export interface SubscriptionUpdateResponse {
  success: boolean;
  subscription_info?: ProfileItem["subscription_info"];
  detail: SubscriptionUpdateDetail;
}

export interface BackupMetadata {
  id: string;
  name: string;
  created_at: number;
  size: number;
  restorable: boolean;
  kind: "manual" | "safety_snapshot";
}

export interface BackupsResponse {
  backups: BackupMetadata[];
}

export interface CreateBackupRequest {
  name?: string | null;
}

export interface RestoreBackupResponse {
  restored: BackupMetadata;
  safety_snapshot: BackupMetadata;
}

export interface ProfileItem {
  uid: string;
  name: string;
  desc: string;
  type: "remote" | "local" | "merge" | "script";
  url?: string | null;
  file: string;
  selected: Record<string, string>[];
  updated?: number | null;
  extra?: ProfileExtra | null;
  subscription_info?: {
    upload: number;
    download: number;
    total: number;
    expire?: number | null;
  } | null;
  subscription_update_detail?: SubscriptionUpdateDetail | null;
}

export interface ProfilesResponse {
  profiles: ProfileItem[];
  active?: string | null;
}

export const getProfiles = () => api.get<ProfilesResponse>("/profiles");
export const createProfile = (data: Partial<ProfileItem> & { name: string; type: string }) =>
  api.post<ProfileItem>("/profiles", data);
export const updateProfile = (uid: string, data: Record<string, unknown>) =>
  api.put(`/profiles/${uid}`, data);
export const deleteProfile = (uid: string) => api.delete(`/profiles/${uid}`);
export const activateProfile = (uid: string) =>
  api.post<ProfileItem>(`/profiles/${uid}/activate`, undefined, { timeout: 30000 });
// Backend clamps each download attempt at 120s but may retry up to 3 times with
// up to 60s intervals, so the client must not cut the request short: no timeout.
export const updateSubscription = (uid: string) =>
  api.post<SubscriptionUpdateResponse>(`/profiles/${uid}/update`, undefined, { timeout: 0 });
export const reorderProfiles = (uids: string[]) => api.put("/profiles/reorder", { uids });
export const getProfileFile = (uid: string) => api.get<{ content: string }>(`/profiles/${uid}/file`);
export const saveProfileFile = (uid: string, content: string) =>
  api.put(`/profiles/${uid}/file`, { content });
export const importProfile = (formData: FormData) =>
  api.post<ProfileItem>("/profiles/import", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 30000,
  });
export const getPreferences = () => api.get<UserPreferences>("/preferences");
export const savePreferences = (data: UserPreferences) =>
  api.put<UserPreferences>("/preferences", data);
export const restoreDefaultPreferences = () =>
  api.post<UserPreferences>("/preferences/default");
export const getProxyEnvironment = () =>
  api.get<ProxyEnvironmentResponse>("/proxy/environment");
export const getDnsConfig = () => api.get<ContentResponse>("/dns");
export const saveDnsConfig = (content: string) =>
  api.put<SuccessResponse>("/dns", { content });
export const validateDnsConfig = (content: string) =>
  api.post<ValidateResponse>("/dns/validate", { content });
export const applyDnsConfig = () =>
  api.post<SuccessResponse>("/dns/apply", undefined, { timeout: 30000 });
export const restoreDefaultDnsConfig = () => api.post<ContentResponse>("/dns/default");
export const getBackups = () => api.get<BackupsResponse>("/backups");
export const createBackup = (data: CreateBackupRequest = {}) =>
  api.post<BackupMetadata>("/backups", data);
export const restoreBackup = (id: string) =>
  api.post<RestoreBackupResponse>(`/backups/${id}/restore`);
export const deleteBackup = (id: string) => api.delete<SuccessResponse>(`/backups/${id}`);

export type ApiAxiosError = AxiosError<ApiErrorResponse>;

export function createTrafficWs(): WebSocket {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(
    `${proto}//${location.host}${withTokenQuery("/api/v1/traffic")}`
  );
}

export function createMemoryWs(): WebSocket {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(
    `${proto}//${location.host}${withTokenQuery("/api/v1/memory")}`
  );
}

export function createLogsWs(level: string = "debug"): WebSocket {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(
    `${proto}//${location.host}${withTokenQuery(`/api/v1/logs?level=${encodeURIComponent(level)}`)}`
  );
}

export interface MihomoInstallStatus {
  installed: boolean;
  path: string;
  version: string | null;
  arch: string;
  download_url: string;
  latest_version: string | null;
}

export interface MihomoVersionCheck {
  installed: boolean;
  current_version: string | null;
  latest_version: string | null;
  has_update: boolean;
  download_url: string;
  arch: string;
}

export interface DownloadProgress {
  active: boolean;
  task_type: string | null;
  status: string;
  downloaded: number;
  total: number;
  percent: number;
  remaining_secs: number | null;
  bytes_per_sec: number | null;
  started_at: number | null;
  updated_at: number;
  message: string;
}

export interface DownloadTaskStartResponse {
  started: boolean;
  progress: DownloadProgress;
}

export interface LocalMihomoPackage {
  name: string;
  size: number;
  modified_at: number | null;
}

export interface LocalMihomoPackages {
  directory: string;
  packages: LocalMihomoPackage[];
}

export const getMihomoInstallStatus = () =>
  api.get<MihomoInstallStatus>("/mihomo/status");
export const getMihomoDownloadStatus = () =>
  api.get<DownloadProgress>("/mihomo/progress/status");
export const getLocalMihomoPackages = () =>
  api.get<LocalMihomoPackages>("/mihomo/local-packages");
export const installMihomo = () =>
  api.post<DownloadTaskStartResponse>("/mihomo/install");
export const installLocalMihomoPackage = (name: string) =>
  api.post<DownloadTaskStartResponse>("/mihomo/local-packages/install", { name });
export const checkMihomoVersion = () =>
  api.get<MihomoVersionCheck>("/mihomo/check");
export const upgradeMihomo = () =>
  api.post<DownloadTaskStartResponse>("/mihomo/upgrade");

export function createProgressSSE(): EventSource {
  const proto = location.protocol === "https:" ? "https:" : "http:";
  return new EventSource(
    `${proto}//${location.host}${withTokenQuery("/api/v1/mihomo/progress")}`
  );
}

export interface SystemProxyStatus {
  enabled: boolean;
  mixed_port: number;
  allow_lan: boolean;
  current_http: string | null;
  current_socks: string | null;
  current_mode: string;
}

export interface TunStatus {
  enabled: boolean;
  stack: string;
}

export const getSystemProxy = () => api.get<SystemProxyStatus>("/system/proxy");
export const setSystemProxy = (enabled: boolean) =>
  api.post("/system/proxy", { enabled });
export const getTunMode = () => api.get<TunStatus>("/system/tun");
export const setTunMode = (enabled: boolean, stack: string = "mixed") =>
  api.post("/system/tun", { enabled, stack });
