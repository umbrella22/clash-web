import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActions,
  Grid,
  Button,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  MenuItem,
  Select,
  FormControl,
  FormControlLabel,
  InputLabel,
  Switch,
  Snackbar,
  Alert,
  Tooltip,
  type AlertColor,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import LinkIcon from "@mui/icons-material/Link";
import DescriptionIcon from "@mui/icons-material/Description";
import MergeTypeIcon from "@mui/icons-material/MergeType";
import CodeIcon from "@mui/icons-material/Code";
import {
  useProfiles,
  useCreateProfile,
  useUpdateProfile,
  useDeleteProfile,
  useActivateProfile,
  useUpdateSubscription,
  useImportProfile,
} from "../hooks/useApi";
import ProfileEditorDialog from "../components/ProfileEditorDialog";
import { PageTitle } from "../components/SystemChrome";
import { getPrecheckResult } from "../services/api";
import type { ProfileExtra, ProfileItem } from "../services/api";

type SnackState = {
  severity: AlertColor;
  message: string;
};

function formatActionError(error: unknown, fallback: string): string {
  const precheck = getPrecheckResult(error);
  if (precheck?.error) return `${fallback}: ${precheck.error}`;

  if (typeof error === "object" && error && "response" in error) {
    const response = error.response as { data?: { error?: string } } | undefined;
    if (response?.data?.error) return response.data.error;
  }

  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message || fallback;
  }

  return fallback;
}

function formatSubscriptionStatus(profile: ProfileItem, t: TFunction): string {
  const detail = profile.subscription_update_detail;
  if (!detail) return t("profiles.subscription_update_never");

  const parts = [
    t(detail.success ? "profiles.subscription_update_success" : "profiles.subscription_update_failed"),
    formatDate(detail.updated_at),
  ];
  if (detail.http_status) parts.push(`HTTP ${detail.http_status}`);
  parts.push(t("profiles.subscription_update_attempts", { count: detail.attempts }));
  parts.push(formatBytes(detail.downloaded_bytes));
  if (detail.kept_old) parts.push(t("profiles.subscription_kept_old"));

  return parts.join(" · ");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(ts?: number | null): string {
  if (!ts) return "--";
  return new Date(ts * 1000).toLocaleString();
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  remote: <LinkIcon fontSize="small" color="primary" />,
  local: <DescriptionIcon fontSize="small" color="action" />,
  merge: <MergeTypeIcon fontSize="small" color="secondary" />,
  script: <CodeIcon fontSize="small" color="warning" />,
};

export default function ProfilesPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useProfiles();
  const createMut = useCreateProfile();
  const updateMut = useUpdateProfile();
  const deleteMut = useDeleteProfile();
  const activateMut = useActivateProfile();
  const updateSubMut = useUpdateSubscription();
  const importMut = useImportProfile();

  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialType, setCreateInitialType] = useState<ProfileItem["type"]>("local");
  const [createTitle, setCreateTitle] = useState("");
  const [profileEditorUid, setProfileEditorUid] = useState<string | null>(null);
  const [fileEditorUid, setFileEditorUid] = useState<string | null>(null);
  const [snack, setSnack] = useState<SnackState | null>(null);

  const profiles = data?.profiles ?? [];
  const activeUid = data?.active ?? null;

  const openCreateDialog = useCallback(
    (initialType: ProfileItem["type"], title: string) => {
      setCreateInitialType(initialType);
      setCreateTitle(title);
      setCreateOpen(true);
    },
    []
  );

  const handleFileImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yaml,.yml,.txt";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      importMut.mutate(fd, {
        onSuccess: () => setSnack({ severity: "success", message: "Imported" }),
        onError: (error) =>
          setSnack({ severity: "error", message: formatActionError(error, "Import failed") }),
      });
    };
    input.click();
  }, [importMut]);

  const handleUpdateAll = useCallback(() => {
    profiles
      .filter((p) => p.type === "remote" && p.url)
      .forEach((p) => updateSubMut.mutate(p.uid));
  }, [profiles, updateSubMut]);

  if (isLoading) return <Typography>Loading...</Typography>;

  return (
    <Box>
      <PageTitle
        title={t("profiles.title")}
        actions={
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<CloudDownloadIcon />}
            onClick={handleUpdateAll}
            disabled={updateSubMut.isPending}
          >
            {t("profiles.update_all")}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<LinkIcon />}
            onClick={() => openCreateDialog("remote", t("profiles.import"))}
          >
            {t("profiles.import")}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<UploadFileIcon />}
            onClick={handleFileImport}
          >
            {t("profiles.import_file")}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => openCreateDialog("local", t("profiles.new"))}
          >
            {t("profiles.new")}
          </Button>
          </Box>
        }
      />

      {profiles.length === 0 && (
        <Typography color="text.secondary" sx={{ textAlign: "center", mt: 4 }}>
          No profiles yet. Click "{t("profiles.new")}" to create one.
        </Typography>
      )}

      <Grid container spacing={2}>
        {profiles.map((profile) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={profile.uid}>
            <ProfileCard
              profile={profile}
              isActive={activeUid === profile.uid}
              onActivate={() =>
                activateMut.mutate(profile.uid, {
                  onSuccess: () => setSnack({ severity: "success", message: "Activated" }),
                  onError: (error) =>
                    setSnack({
                      severity: "error",
                      message: formatActionError(error, "Activation failed"),
                    }),
                })
              }
              onUpdate={() => updateSubMut.mutate(profile.uid, {
                onSuccess: () => setSnack({ severity: "success", message: "Updated" }),
                onError: (error) =>
                  setSnack({
                    severity: "error",
                    message: formatActionError(error, "Update failed"),
                  }),
              })}
              onEdit={() => setProfileEditorUid(profile.uid)}
              onEditFile={() => setFileEditorUid(profile.uid)}
              onDelete={() =>
                deleteMut.mutate(profile.uid, {
                  onSuccess: () => setSnack({ severity: "success", message: "Deleted" }),
                  onError: (error) =>
                    setSnack({
                      severity: "error",
                      message: formatActionError(error, "Delete failed"),
                    }),
                })
              }
              isUpdating={updateSubMut.isPending}
              isActivating={activateMut.isPending}
            />
          </Grid>
        ))}
      </Grid>

      <CreateProfileDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        initialType={createInitialType}
        title={createTitle || t("profiles.new")}
        onSubmit={(data) => {
          createMut.mutate(data, {
            onSuccess: (response) => {
              if (data.type === "remote") {
                updateSubMut.mutate(response.data.uid, {
                  onSuccess: () => {
                    setCreateOpen(false);
                    setSnack({ severity: "success", message: "Imported" });
                  },
                  onError: (error) => {
                    setCreateOpen(false);
                    setSnack({
                      severity: "warning",
                      message: formatActionError(error, "Created, but failed to fetch URL"),
                    });
                  },
                });
                return;
              }

              setCreateOpen(false);
              setSnack({ severity: "success", message: "Created" });
            },
            onError: (error) =>
              setSnack({ severity: "error", message: formatActionError(error, "Create failed") }),
          });
        }}
        isPending={createMut.isPending || updateSubMut.isPending}
      />

      <EditProfileDialog
        profile={profiles.find((profile) => profile.uid === profileEditorUid) ?? null}
        onClose={() => setProfileEditorUid(null)}
        onSubmit={(uid, data) => {
          updateMut.mutate(
            { uid, data },
            {
              onSuccess: () => {
                setProfileEditorUid(null);
                setSnack({ severity: "success", message: t("profiles.saved") });
              },
              onError: (error) =>
                setSnack({ severity: "error", message: formatActionError(error, "Save failed") }),
            }
          );
        }}
        isPending={updateMut.isPending}
      />

      <ProfileEditorDialog
        uid={fileEditorUid}
        onClose={() => setFileEditorUid(null)}
      />

      <Snackbar
        open={!!snack}
        autoHideDuration={2000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snack?.severity ?? "info"} onClose={() => setSnack(null)}>
          {snack?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function ProfileCard({
  profile,
  isActive,
  onActivate,
  onUpdate,
  onEdit,
  onEditFile,
  onDelete,
  isUpdating,
  isActivating,
}: {
  profile: ProfileItem;
  isActive: boolean;
  onActivate: () => void;
  onUpdate: () => void;
  onEdit: () => void;
  onEditFile: () => void;
  onDelete: () => void;
  isUpdating: boolean;
  isActivating: boolean;
}) {
  const { t } = useTranslation();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const si = profile.subscription_info;

  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: isActive ? "primary.main" : undefined,
        borderWidth: isActive ? 2 : 1,
        position: "relative",
        transition: "transform 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease",
        "&:hover": {
          transform: "translateY(-4px)",
          boxShadow: (theme) => theme.shadows[6],
        },
        "&::after": {
          content: '""',
          position: "absolute",
          top: -1,
          left: -1,
          width: 12,
          height: 12,
          borderTop: 2,
          borderLeft: 2,
          borderColor: isActive ? "primary.main" : "text.primary",
          opacity: isActive ? 1 : 0.55,
        },
      }}
    >
      {isActive && (
        <Chip
          icon={<CheckCircleIcon />}
          label={t("profiles.active")}
          color="primary"
          size="small"
          sx={{ position: "absolute", top: 8, right: 8 }}
        />
      )}
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, pr: 8 }}>
          {TYPE_ICON[profile.type]}
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, letterSpacing: "0.03em" }}>
            {profile.name}
          </Typography>
          <Chip label={profile.type} size="small" variant="outlined" />
        </Box>
        {profile.desc && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {profile.desc}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {t("profiles.updated")}: {formatDate(profile.updated)}
        </Typography>
        {profile.type === "remote" && (
          <Box
            sx={{
              mt: 1,
              p: 1,
              border: 1,
              borderColor: profile.subscription_update_detail?.success === false ? "warning.main" : "divider",
              borderRadius: 1,
              bgcolor: "background.default",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <Typography variant="caption" color="text.secondary">
                {t("profiles.subscription_update_detail")}
              </Typography>
              {profile.subscription_update_detail ? (
                <Chip
                  size="small"
                  color={profile.subscription_update_detail.success ? "success" : "warning"}
                  label={
                    profile.subscription_update_detail.success
                      ? t("profiles.subscription_update_success")
                      : t("profiles.subscription_update_failed")
                  }
                />
              ) : null}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
              {formatSubscriptionStatus(profile, t)}
            </Typography>
            {profile.subscription_update_detail?.error ? (
              <Alert severity="warning" sx={{ mt: 1, py: 0 }}>
                {profile.subscription_update_detail.error}
              </Alert>
            ) : null}
          </Box>
        )}
        {si && si.total > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {t("profiles.subscription")}:{" "}
              {formatBytes(si.upload + si.download)} / {formatBytes(si.total)}
            </Typography>
            {si.expire && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {t("profiles.expire")}: {formatDate(si.expire)}
              </Typography>
            )}
          </Box>
        )}
      </CardContent>
      <CardActions sx={{ justifyContent: "flex-end" }}>
        {!isActive && (
          <Button size="small" onClick={onActivate} disabled={isActivating}>
            {t("profiles.activate")}
          </Button>
        )}
        {profile.type === "remote" && (
          <Tooltip title={t("profiles.update")}>
            <IconButton size="small" onClick={onUpdate} disabled={isUpdating}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={t("profiles.edit")}>
          <IconButton size="small" onClick={onEdit}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("profiles.edit_file")}>
          <IconButton size="small" onClick={onEditFile}>
            <CodeIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("profiles.delete")}>
          <IconButton size="small" onClick={() => setDeleteDialogOpen(true)} color="error">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </CardActions>
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t("profiles.delete_confirm_title")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t("profiles.delete_confirm_content", { name: profile.name })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t("profiles.cancel")}</Button>
          <Button
            onClick={() => {
              onDelete();
              setDeleteDialogOpen(false);
            }}
            color="error"
          >
            {t("profiles.confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

function CreateProfileDialog({
  open,
  onClose,
  initialType,
  title,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  initialType: ProfileItem["type"];
  title: string;
  onSubmit: (data: Partial<ProfileItem> & { name: string; type: string }) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [type, setType] = useState<ProfileItem["type"]>(initialType);
  const [url, setUrl] = useState("");
  const [extra, setExtra] = useState<ProfileExtra>({ keep_old_on_failure: true });

  useEffect(() => {
    if (!open) return;
    setName("");
    setType(initialType);
    setUrl("");
    setExtra({ keep_old_on_failure: true });
  }, [open, initialType]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (type === "remote" && !url.trim()) return;
    onSubmit({
      name: name.trim(),
      type,
      url: type === "remote" ? url.trim() : undefined,
      extra: type === "remote" ? normalizeProfileExtra(extra) : undefined,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "16px !important" }}>
        <TextField
          label={t("profiles.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          autoFocus
        />
        <FormControl fullWidth>
          <InputLabel>{t("profiles.type")}</InputLabel>
          <Select value={type} label={t("profiles.type")} onChange={(e) => setType(e.target.value)}>
            <MenuItem value="local">{t("profiles.local")}</MenuItem>
            <MenuItem value="remote">{t("profiles.import")}</MenuItem>
            <MenuItem value="merge">{t("profiles.merge")}</MenuItem>
            <MenuItem value="script">{t("profiles.script")}</MenuItem>
          </Select>
        </FormControl>
        {type === "remote" && (
          <>
            <TextField
              label="URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              fullWidth
            />
            <ProfileAdvancedOptions extra={extra} onChange={setExtra} />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("profiles.cancel")}</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={isPending || !name.trim() || (type === "remote" && !url.trim())}
        >
          {t("profiles.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EditProfileDialog({
  profile,
  onClose,
  onSubmit,
  isPending,
}: {
  profile: ProfileItem | null;
  onClose: () => void;
  onSubmit: (uid: string, data: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [url, setUrl] = useState("");
  const [extra, setExtra] = useState<ProfileExtra>({});

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setDesc(profile.desc ?? "");
    setUrl(profile.url ?? "");
    setExtra(profile.extra ?? {});
  }, [profile]);

  const handleSubmit = () => {
    if (!profile || !name.trim()) return;
    if (profile.type === "remote" && !url.trim()) return;
    onSubmit(profile.uid, {
      name: name.trim(),
      desc: desc.trim(),
      url: profile.type === "remote" ? url.trim() : undefined,
      extra: profile.type === "remote" ? normalizeProfileExtra(extra) : undefined,
    });
  };

  return (
    <Dialog open={!!profile} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("profiles.edit")}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "16px !important" }}>
        <TextField
          label={t("profiles.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          autoFocus
        />
        <TextField
          label={t("profiles.description")}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          fullWidth
        />
        {profile?.type === "remote" && (
          <>
            <TextField
              label="URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              fullWidth
            />
            <ProfileAdvancedOptions extra={extra} onChange={setExtra} />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("profiles.cancel")}</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={isPending || !name.trim() || (profile?.type === "remote" && !url.trim())}
        >
          {t("profiles.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ProfileAdvancedOptions({
  extra,
  onChange,
}: {
  extra: ProfileExtra;
  onChange: (extra: ProfileExtra) => void;
}) {
  const { t } = useTranslation();
  const updateExtra = (patch: ProfileExtra) => onChange({ ...extra, ...patch });

  return (
    <Box sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1.5 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {t("profiles.advanced_subscription")}
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <TextField
          label={t("profiles.user_agent")}
          value={extra.user_agent ?? ""}
          onChange={(e) => updateExtra({ user_agent: e.target.value })}
          fullWidth
          size="small"
        />
        <TextField
          label={t("profiles.request_headers")}
          defaultValue={formatRequestHeaders(extra.request_headers)}
          onChange={(e) => updateExtra({ request_headers: parseRequestHeaders(e.target.value) })}
          placeholder={t("profiles.request_headers_placeholder")}
          helperText={t("profiles.request_headers_help")}
          multiline
          minRows={3}
          fullWidth
          size="small"
        />
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
          <TextField
            label={t("profiles.update_interval")}
            type="number"
            value={extra.update_interval ?? ""}
            onChange={(e) => updateExtra({ update_interval: parseOptionalNumber(e.target.value) })}
            fullWidth
            size="small"
          />
          <TextField
            label={t("profiles.download_timeout")}
            type="number"
            value={extra.download_timeout ?? ""}
            onChange={(e) => updateExtra({ download_timeout: parseOptionalNumber(e.target.value) })}
            fullWidth
            size="small"
          />
          <TextField
            label={t("profiles.retry_count")}
            type="number"
            value={extra.retry_count ?? ""}
            onChange={(e) => updateExtra({ retry_count: parseOptionalNumber(e.target.value) })}
            fullWidth
            size="small"
          />
          <TextField
            label={t("profiles.retry_interval_secs")}
            type="number"
            value={extra.retry_interval_secs ?? ""}
            onChange={(e) => updateExtra({ retry_interval_secs: parseOptionalNumber(e.target.value) })}
            fullWidth
            size="small"
          />
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column" }}>
          <FormControlLabel
            control={
              <Switch
                checked={!!extra.skip_cert_verify}
                onChange={(e) => updateExtra({ skip_cert_verify: e.target.checked })}
              />
            }
            label={t("profiles.skip_cert_verify")}
          />
          <FormControlLabel
            control={
              <Switch
                checked={!!extra.download_via_proxy}
                onChange={(e) => updateExtra({ download_via_proxy: e.target.checked })}
              />
            }
            label={t("profiles.download_via_proxy")}
          />
          <FormControlLabel
            control={
              <Switch
                checked={extra.keep_old_on_failure ?? false}
                onChange={(e) => updateExtra({ keep_old_on_failure: e.target.checked })}
              />
            }
            label={t("profiles.keep_old_on_failure")}
          />
        </Box>
      </Box>
    </Box>
  );
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatRequestHeaders(headers?: Record<string, string>): string {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function parseRequestHeaders(value: string): Record<string, string> | undefined {
  const headers = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) return acc;
      const key = line.slice(0, separatorIndex).trim();
      const headerValue = line.slice(separatorIndex + 1).trim();
      if (key && headerValue) acc[key] = headerValue;
      return acc;
    }, {});

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function normalizeProfileExtra(extra: ProfileExtra): ProfileExtra {
  return {
    user_agent: extra.user_agent?.trim() || undefined,
    request_headers: extra.request_headers,
    retry_count: extra.retry_count,
    retry_interval_secs: extra.retry_interval_secs,
    update_interval: extra.update_interval,
    download_timeout: extra.download_timeout,
    skip_cert_verify: extra.skip_cert_verify || undefined,
    download_via_proxy: extra.download_via_proxy || undefined,
    keep_old_on_failure: extra.keep_old_on_failure || undefined,
  };
}
