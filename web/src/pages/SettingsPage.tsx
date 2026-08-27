import { useTranslation } from "react-i18next";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Switch,
  FormControlLabel,
  TextField,
  Button,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Divider,
  Chip,
  LinearProgress,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  type AlertColor,
} from "@mui/material";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  clearStoredToken,
  getStoredToken,
  patchRuntimeConfig,
  getRuntimeConfig,
  checkMihomoVersion,
  getLocalMihomoPackages,
  installLocalMihomoPackage,
  upgradeMihomo,
  installMihomo,
  getSystemProxy,
  setSystemProxy,
  getTunMode,
  setTunMode,
  setStoredToken,
  loginWithToken,
} from "../services/api";
import { useToast } from "../components/toastContext";
import { formatApiError } from "../utils/errors";
import { useThemeContext } from "../App";
import { useState, useEffect, type ReactNode } from "react";
import {
  describeDownloadStatus,
  formatBytes,
  formatBytesPerSecond,
  formatRemainingTime,
  isDownloadTaskActive,
} from "../features/mihomoDownload";
import { useMihomoDownloadTaskContext } from "../contexts/MihomoDownloadTaskContext";
import {
  useApplyDnsConfig,
  useBackups,
  useCreateBackup,
  useDeleteBackup,
  useDnsConfig,
  useRestoreBackup,
  useRestoreDefaultDnsConfig,
  useRuntimeConfigYaml,
  useSaveDnsConfig,
  usePreferences,
  useProxyEnvironment,
  useRestoreDefaultPreferences,
  useSavePreferences,
  useValidateDnsConfig,
} from "../hooks/useApi";
import type { BackupMetadata } from "../services/api";
import { PageTitle } from "../components/SystemChrome";
import {
  getOverviewCardOrder,
  normalizeOverviewCards,
  OVERVIEW_CARD_IDS,
  type OverviewCardId,
} from "../features/preferences";

const sectionCardSx = {
  height: "100%",
} as const;

const sectionCardContentSx = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  height: "100%",
} as const;

const sectionPanelSx = {
  p: 1.5,
  borderRadius: 0,
  border: 1,
  borderColor: "divider",
  bgcolor: "background.default",
} as const;

type ActionMessage = {
  severity: AlertColor;
  text: string;
};

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDate(ts?: number | null): string {
  if (!ts) return "--";
  return new Date(ts * 1000).toLocaleString();
}

function SettingsSectionCard({
  title,
  description,
  headerRight,
  footer,
  children,
}: {
  title: string;
  description?: ReactNode;
  headerRight?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card variant="outlined" sx={sectionCardSx}>
      <CardContent sx={sectionCardContentSx}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: { xs: "flex-start", md: "center" },
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <Typography variant="h6">{title}</Typography>
          {headerRight}
        </Box>
        <Divider />
        {description ? (
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        ) : null}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1 }}>
          {children}
        </Box>
        {footer ? (
          <Box sx={{ pt: 2, borderTop: 1, borderColor: "divider" }}>
            {footer}
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConfirmDialog({
  open,
  title,
  text,
  confirmColor = "primary",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  text: string;
  confirmColor?: "primary" | "error" | "warning";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      {title ? <DialogTitle>{title}</DialogTitle> : null}
      <DialogContent>
        <DialogContentText>{text}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="contained" color={confirmColor} onClick={onConfirm}>
          {t("common.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { mode, setThemeMode } = useThemeContext();
  const showToast = useToast();

  const { data: config } = useQuery({
    queryKey: ["runtimeConfig"],
    queryFn: () => getRuntimeConfig().then((r) => r.data),
  });

  const patchMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => patchRuntimeConfig(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runtimeConfig"] }),
  });

  const [mixedPort, setMixedPort] = useState(7890);
  const [allowLan, setAllowLan] = useState(false);
  const [logLevel, setLogLevel] = useState("info");
  const [ipv6, setIpv6] = useState(false);
  const [accessToken, setAccessToken] = useState(getStoredToken());
  const [savedToken, setSavedToken] = useState(getStoredToken());
  const [tokenSaving, setTokenSaving] = useState(false);

  useEffect(() => {
    if (config) {
      setMixedPort(config["mixed-port"] ?? 7890);
      setAllowLan(config["allow-lan"] ?? false);
      setLogLevel(config["log-level"] ?? "info");
      setIpv6(config["ipv6"] ?? false);
    }
  }, [config]);

  const handleSaveClash = () => {
    patchMut.mutate(
      {
        "mixed-port": mixedPort,
        "allow-lan": allowLan,
        "log-level": logLevel,
        ipv6,
      },
      {
        onSuccess: () => showToast({ message: t("settings.saved"), severity: "success" }),
        onError: (error) =>
          showToast({ message: formatApiError(error, t("settings.save_failed")), severity: "error" }),
      }
    );
  };

  const handleSaveToken = async () => {
    const token = accessToken.trim();
    setTokenSaving(true);
    try {
      if (!token) {
        clearStoredToken();
        setSavedToken("");
      } else {
        // Verify the token against the backend before persisting it locally.
        await loginWithToken(token);
        setStoredToken(token);
        setSavedToken(token);
      }
      showToast({ message: t("settings.saved"), severity: "success" });
    } catch (error) {
      showToast({ message: formatApiError(error, t("settings.save_failed")), severity: "error" });
    } finally {
      setTokenSaving(false);
    }
  };

  return (
    <Box>
      <PageTitle title={t("settings.title")} eyebrow="SYSTEM CONFIGURATION" aux="SERVICE & RUNTIME OPTIONS" />
      <Grid container spacing={3}>
        {/* Mihomo Version */}
        <Grid size={{ xs: 12 }}>
          <MihomoVersionCard />
        </Grid>

        {/* System Proxy + TUN Mode */}
        <Grid size={{ xs: 12, md: 6 }}>
          <SystemProxyCard />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TunModeCard />
        </Grid>

        <Grid size={{ xs: 12 }}>
          <OverviewCardsCard />
        </Grid>

        {/* Clash Settings */}
        <Grid size={{ xs: 12, md: 6 }}>
          <SettingsSectionCard
            title={t("settings.clash")}
            description={t("settings.clash_desc")}
            footer={
              <Button variant="contained" onClick={handleSaveClash} disabled={patchMut.isPending} fullWidth>
                {t("settings.save")}
              </Button>
            }
          >
            <Box sx={sectionPanelSx}>
              <TextField
                label={t("settings.mixed_port")}
                type="number"
                size="small"
                fullWidth
                value={mixedPort}
                onChange={(e) => setMixedPort(Number(e.target.value))}
                sx={{ mb: 0 }}
              />
            </Box>
            <Box sx={sectionPanelSx}>
              <FormControlLabel
                control={<Switch checked={allowLan} onChange={(e) => setAllowLan(e.target.checked)} />}
                label={t("settings.allow_lan")}
                sx={{ mb: 0.5, display: "flex", mr: 0 }}
              />
              <FormControlLabel
                control={<Switch checked={ipv6} onChange={(e) => setIpv6(e.target.checked)} />}
                label="IPv6"
                sx={{ display: "flex", mr: 0 }}
              />
            </Box>
            <Box sx={sectionPanelSx}>
              <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                <InputLabel>{t("settings.log_level")}</InputLabel>
                <Select value={logLevel} label={t("settings.log_level")} onChange={(e) => setLogLevel(e.target.value)}>
                  <MenuItem value="silent">Silent</MenuItem>
                  <MenuItem value="error">Error</MenuItem>
                  <MenuItem value="warning">Warning</MenuItem>
                  <MenuItem value="info">Info</MenuItem>
                  <MenuItem value="debug">Debug</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </SettingsSectionCard>
        </Grid>

        {/* Web Settings */}
        <Grid size={{ xs: 12, md: 6 }}>
          <SettingsSectionCard
            title={t("settings.web")}
            description={t("settings.web_desc")}
            footer={
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <Chip size="small" label={`${t("settings.language")}: ${i18n.language === "zh" ? "中文" : "English"}`} />
                <Chip size="small" label={`${t("settings.theme")}: ${mode === "dark" ? t("settings.dark") : t("settings.light")}`} />
                <Chip
                  size="small"
                  color={savedToken ? "success" : "default"}
                  label={savedToken ? t("settings.token_saved") : t("settings.token_empty")}
                />
              </Box>
            }
          >
            <Box sx={sectionPanelSx}>
              <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                <InputLabel>{t("settings.language")}</InputLabel>
                <Select
                  value={i18n.language}
                  label={t("settings.language")}
                  onChange={(e) => {
                    i18n.changeLanguage(e.target.value);
                    localStorage.setItem("clash-web-language", e.target.value);
                  }}
                >
                  <MenuItem value="en">English</MenuItem>
                  <MenuItem value="zh">中文</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Box sx={sectionPanelSx}>
              <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                <InputLabel>{t("settings.theme")}</InputLabel>
                <Select
                  value={mode}
                  label={t("settings.theme")}
                  onChange={(e) => setThemeMode(e.target.value as "dark" | "light")}
                >
                  <MenuItem value="dark">{t("settings.dark")}</MenuItem>
                  <MenuItem value="light">{t("settings.light")}</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Box sx={sectionPanelSx}>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <TextField
                  label={t("settings.access_token")}
                  size="small"
                  fullWidth
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  sx={{ mb: 0 }}
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => void handleSaveToken()}
                  disabled={tokenSaving}
                  sx={{ flexShrink: 0 }}
                >
                  {t("settings.save")}
                </Button>
              </Box>
            </Box>
          </SettingsSectionCard>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <BackupsCard />
        </Grid>

        <Grid size={{ xs: 12 }}>
          <RuntimeYamlCard />
        </Grid>

        <Grid size={{ xs: 12 }}>
          <DnsConfigCard />
        </Grid>
      </Grid>
    </Box>
  );
}

function BackupsCard() {
  const { t } = useTranslation();
  const { data, isLoading, isFetching, refetch } = useBackups();
  const createMut = useCreateBackup();
  const restoreMut = useRestoreBackup();
  const deleteMut = useDeleteBackup();
  const [backupName, setBackupName] = useState("");
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    { kind: "restore" | "delete"; backup: BackupMetadata } | null
  >(null);

  const backups = data?.backups ?? [];
  const actionPending = createMut.isPending || restoreMut.isPending || deleteMut.isPending;

  const handleCreate = () => {
    createMut.mutate(
      { name: backupName.trim() || undefined },
      {
        onSuccess: () => {
          setBackupName("");
          setMessage({ severity: "success", text: t("settings.backup_created") });
        },
        onError: (error) =>
          setMessage({ severity: "error", text: formatApiError(error, t("settings.backup_create_failed")) }),
      }
    );
  };

  const handleRestore = (backup: BackupMetadata) => {
    restoreMut.mutate(backup.id, {
      onSuccess: (response) =>
        setMessage({
          severity: "success",
          text: t("settings.backup_restored", { name: response.data.safety_snapshot.name }),
        }),
      onError: (error) =>
        setMessage({ severity: "error", text: formatApiError(error, t("settings.backup_restore_failed")) }),
    });
  };

  const handleDelete = (backup: BackupMetadata) => {
    deleteMut.mutate(backup.id, {
      onSuccess: () => setMessage({ severity: "success", text: t("settings.backup_deleted") }),
      onError: (error) =>
        setMessage({ severity: "error", text: formatApiError(error, t("settings.backup_delete_failed")) }),
    });
  };

  const handleConfirmAction = () => {
    if (!confirmAction) return;
    const { kind, backup } = confirmAction;
    setConfirmAction(null);
    if (kind === "restore") {
      handleRestore(backup);
    } else {
      handleDelete(backup);
    }
  };

  return (
    <SettingsSectionCard
      title={t("settings.backups")}
      description={t("settings.backups_desc")}
      headerRight={
        <Button size="small" variant="outlined" onClick={() => void refetch()} disabled={isFetching || actionPending}>
          {t("settings.refresh")}
        </Button>
      }
      footer={
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          <TextField
            label={t("settings.backup_name")}
            size="small"
            value={backupName}
            onChange={(e) => setBackupName(e.target.value)}
            sx={{ minWidth: { xs: "100%", sm: 260 } }}
          />
          <Button variant="contained" onClick={handleCreate} disabled={actionPending}>
            {t("settings.create_backup")}
          </Button>
        </Box>
      }
    >
      {message ? <Alert severity={message.severity}>{message.text}</Alert> : null}
      {isLoading ? <LinearProgress /> : null}
      {!isLoading && backups.length === 0 ? (
        <Alert severity="info">{t("settings.no_backups")}</Alert>
      ) : null}
      {backups.map((backup) => (
        <Box
          key={backup.id}
          sx={{
            ...sectionPanelSx,
            display: "flex",
            justifyContent: "space-between",
            alignItems: { xs: "flex-start", md: "center" },
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="subtitle2">{backup.name}</Typography>
              <Chip
                size="small"
                color={backup.kind === "safety_snapshot" ? "warning" : "default"}
                label={
                  backup.kind === "safety_snapshot"
                    ? t("settings.backup_kind_safety_snapshot")
                    : t("settings.backup_kind_manual")
                }
              />
              {!backup.restorable ? <Chip size="small" color="error" label={t("settings.backup_not_restorable")} /> : null}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
              {formatDate(backup.created_at)} · {formatBytes(backup.size)}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setConfirmAction({ kind: "restore", backup })}
              disabled={actionPending || !backup.restorable}
            >
              {t("settings.restore")}
            </Button>
            <Button
              size="small"
              color="error"
              variant="outlined"
              onClick={() => setConfirmAction({ kind: "delete", backup })}
              disabled={actionPending}
            >
              {t("settings.delete")}
            </Button>
          </Box>
        </Box>
      ))}
      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.backup.name}
        text={
          confirmAction?.kind === "delete"
            ? t("settings.confirm_delete_backup")
            : t("settings.confirm_restore_backup")
        }
        confirmColor={confirmAction?.kind === "delete" ? "error" : "primary"}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
      />
    </SettingsSectionCard>
  );
}

function RuntimeYamlCard() {
  const { t } = useTranslation();
  const { data, isFetching, refetch } = useRuntimeConfigYaml();
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const content = data?.content ?? "";

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setMessage({ severity: "success", text: t("settings.runtime_yaml_copied") });
    } catch (error) {
      setMessage({ severity: "error", text: formatApiError(error, t("settings.runtime_yaml_copy_failed")) });
    }
  };

  return (
    <SettingsSectionCard
      title={t("settings.runtime_yaml")}
      description={t("settings.runtime_yaml_desc")}
      headerRight={
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button size="small" variant="outlined" onClick={() => void refetch()} disabled={isFetching}>
            {t("settings.refresh")}
          </Button>
          <Button size="small" variant="outlined" onClick={handleCopy} disabled={!content}>
            {t("settings.copy")}
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => downloadTextFile("runtime.yaml", content)}
            disabled={!content}
          >
            {t("settings.download")}
          </Button>
        </Box>
      }
    >
      {message ? <Alert severity={message.severity}>{message.text}</Alert> : null}
      <TextField
        multiline
        fullWidth
        minRows={14}
        maxRows={28}
        value={isFetching && !content ? t("settings.loading") : content}
        slotProps={{ input: { readOnly: true } }}
        sx={{
          "& .MuiInputBase-root": {
            fontFamily: "monospace",
            fontSize: "0.85rem",
          },
        }}
      />
    </SettingsSectionCard>
  );
}

function OverviewCardsCard() {
  const { t } = useTranslation();
  const { data, isLoading } = usePreferences();
  const saveMut = useSavePreferences();
  const restoreMut = useRestoreDefaultPreferences();
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const cards = normalizeOverviewCards(data?.overview_cards);

  const handleSave = (nextCards: typeof cards) => {
    saveMut.mutate(
      { overview_cards: nextCards },
      {
        onSuccess: () => setMessage({ severity: "success", text: t("settings.overview_cards_saved") }),
        onError: (error) =>
          setMessage({ severity: "error", text: formatApiError(error, t("settings.overview_cards_save_failed")) }),
      }
    );
  };

  const handleToggle = (id: OverviewCardId) => {
    handleSave(cards.map((card) => (card.id === id ? { ...card, visible: !card.visible } : card)));
  };

  const handleMove = (id: OverviewCardId, direction: -1 | 1) => {
    const fromIndex = getOverviewCardOrder(cards, id);
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= cards.length) return;
    const nextCards = [...cards];
    const [card] = nextCards.splice(fromIndex, 1);
    nextCards.splice(toIndex, 0, card);
    handleSave(nextCards);
  };

  const handleRestore = () => {
    restoreMut.mutate(undefined, {
      onSuccess: () => setMessage({ severity: "success", text: t("settings.overview_cards_restored") }),
      onError: (error) =>
        setMessage({ severity: "error", text: formatApiError(error, t("settings.overview_cards_restore_failed")) }),
    });
  };

  const actionPending = isLoading || saveMut.isPending || restoreMut.isPending;

  return (
    <SettingsSectionCard
      title={t("settings.overview_cards")}
      description={t("settings.overview_cards_desc")}
      headerRight={
        <Button
          size="small"
          variant="outlined"
          color="warning"
          onClick={() => setConfirmRestore(true)}
          disabled={actionPending}
        >
          {t("settings.restore_default")}
        </Button>
      }
    >
      {message ? <Alert severity={message.severity}>{message.text}</Alert> : null}
      <ConfirmDialog
        open={confirmRestore}
        title={t("settings.restore_default")}
        text={t("settings.confirm_restore_default")}
        confirmColor="warning"
        onCancel={() => setConfirmRestore(false)}
        onConfirm={() => {
          setConfirmRestore(false);
          handleRestore();
        }}
      />
      <Grid container spacing={1.5}>
        {OVERVIEW_CARD_IDS.map((id) => {
          const card = cards.find((item) => item.id === id);
          const order = getOverviewCardOrder(cards, id);

          return (
            <Grid key={id} size={{ xs: 12, md: 6 }} sx={{ order }}>
              <Box sx={sectionPanelSx}>
                <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, alignItems: "center" }}>
                  <Box>
                    <Typography variant="subtitle2">{t(`settings.overview_card_${id}`)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("settings.overview_card_order", { order: order + 1 })}
                    </Typography>
                  </Box>
                  <Switch
                    checked={card?.visible ?? true}
                    onChange={() => handleToggle(id)}
                    disabled={actionPending}
                  />
                </Box>
                <Box sx={{ display: "flex", gap: 1, mt: 1.5 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => handleMove(id, -1)}
                    disabled={actionPending || order === 0}
                  >
                    {t("settings.move_up")}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => handleMove(id, 1)}
                    disabled={actionPending || order === OVERVIEW_CARD_IDS.length - 1}
                  >
                    {t("settings.move_down")}
                  </Button>
                </Box>
              </Box>
            </Grid>
          );
        })}
      </Grid>
    </SettingsSectionCard>
  );
}

function DnsConfigCard() {
  const { t } = useTranslation();
  const { data, isLoading } = useDnsConfig();
  const saveMut = useSaveDnsConfig();
  const validateMut = useValidateDnsConfig();
  const applyMut = useApplyDnsConfig();
  const restoreMut = useRestoreDefaultDnsConfig();
  const [content, setContent] = useState("");
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  useEffect(() => {
    if (data?.content !== undefined) setContent(data.content);
  }, [data?.content]);

  const handleValidate = () => {
    validateMut.mutate(content, {
      onSuccess: (response) =>
        setMessage({
          severity: response.data.valid ? "success" : "error",
          text: response.data.valid ? t("settings.dns_valid") : t("settings.dns_invalid"),
        }),
      onError: (error) =>
        setMessage({ severity: "error", text: formatApiError(error, t("settings.dns_validate_failed")) }),
    });
  };

  const handleSave = () => {
    saveMut.mutate(content, {
      onSuccess: () => setMessage({ severity: "success", text: t("settings.dns_saved") }),
      onError: (error) =>
        setMessage({ severity: "error", text: formatApiError(error, t("settings.dns_save_failed")) }),
    });
  };

  const handleApply = () => {
    applyMut.mutate(undefined, {
      onSuccess: () => setMessage({ severity: "success", text: t("settings.dns_applied") }),
      onError: (error) =>
        setMessage({ severity: "error", text: formatApiError(error, t("settings.dns_apply_failed")) }),
    });
  };

  const handleRestore = () => {
    restoreMut.mutate(undefined, {
      onSuccess: (response) => {
        setContent(response.data.content);
        setMessage({ severity: "success", text: t("settings.dns_restored") });
      },
      onError: (error) =>
        setMessage({ severity: "error", text: formatApiError(error, t("settings.dns_restore_failed")) }),
    });
  };

  const actionPending = saveMut.isPending || validateMut.isPending || applyMut.isPending || restoreMut.isPending;

  return (
    <SettingsSectionCard
      title={t("settings.dns_config")}
      description={t("settings.dns_config_desc")}
      footer={
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button variant="outlined" onClick={handleValidate} disabled={actionPending || isLoading}>
            {t("settings.validate")}
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={actionPending || isLoading}>
            {t("settings.save")}
          </Button>
          <Button variant="outlined" onClick={handleApply} disabled={actionPending || isLoading}>
            {t("settings.apply")}
          </Button>
          <Button
            color="warning"
            variant="outlined"
            onClick={() => setConfirmRestore(true)}
            disabled={actionPending}
          >
            {t("settings.restore_default")}
          </Button>
        </Box>
      }
    >
      {message ? <Alert severity={message.severity}>{message.text}</Alert> : null}
      <ConfirmDialog
        open={confirmRestore}
        title={t("settings.restore_default")}
        text={t("settings.confirm_restore_default")}
        confirmColor="warning"
        onCancel={() => setConfirmRestore(false)}
        onConfirm={() => {
          setConfirmRestore(false);
          handleRestore();
        }}
      />
      <TextField
        multiline
        fullWidth
        minRows={14}
        maxRows={28}
        value={isLoading ? t("settings.loading") : content}
        onChange={(e) => setContent(e.target.value)}
        disabled={isLoading}
        sx={{
          "& .MuiInputBase-root": {
            fontFamily: "monospace",
            fontSize: "0.85rem",
          },
        }}
      />
    </SettingsSectionCard>
  );
}

function MihomoVersionCard() {
  const { t } = useTranslation();

  const { data: version, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["mihomoVersion"],
    queryFn: () => checkMihomoVersion().then((r) => r.data),
    refetchOnMount: "always",
  });

  const { progress, actionError, actionPending, refreshStatus, runDownloadAction } =
    useMihomoDownloadTaskContext();

  useEffect(() => {
    if (!actionPending) {
      void refetch();
    }
  }, [actionPending, refetch]);

  const handleInstall = async () => {
    await runDownloadAction(() => installMihomo(), t("settings.download_request_failed"));
  };

  const handleUpgrade = async () => {
    await runDownloadAction(() => upgradeMihomo(), t("settings.download_request_failed"));
  };

  const { data: localPackages, refetch: refetchLocalPackages } = useQuery({
    queryKey: ["mihomoLocalPackages"],
    queryFn: () => getLocalMihomoPackages().then((response) => response.data),
  });

  const handleLocalInstall = async (name: string) => {
    const succeeded = await runDownloadAction(
      () => installLocalMihomoPackage(name),
      t("settings.download_request_failed")
    );
    if (succeeded) {
      void refetchLocalPackages();
    }
  };

  const progressStatusKey = progress
    ? `settings.download_status_${describeDownloadStatus(progress.status)}`
    : "settings.download_status_idle";
  const activeProgress = isDownloadTaskActive(progress) ? progress : null;
  const progressStatusLabel = t(progressStatusKey);
  const taskTypeLabel =
    activeProgress?.task_type === "upgrade"
      ? t("settings.upgrade")
      : activeProgress?.task_type === "import"
        ? t("settings.local_import")
        : t("settings.install");
  const lastUpdatedLabel =
    activeProgress?.updated_at != null
      ? new Date(activeProgress.updated_at * 1000).toLocaleTimeString()
      : "--";
  const downloadedLabel =
    activeProgress && activeProgress.total > 0
      ? `${formatBytes(activeProgress.downloaded)} / ${formatBytes(activeProgress.total)}`
      : formatBytes(activeProgress?.downloaded);

  if (isLoading) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>{t("settings.mihomo_version")}</Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <CircularProgress size={20} />
            <Typography variant="body2">{t("settings.checking")}</Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
          <Typography variant="h6">{t("settings.mihomo_version")}</Typography>
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              void refetch();
              void refreshStatus();
            }}
            disabled={actionPending}
          >
            {t("settings.check_update")}
          </Button>
        </Box>
        <Divider sx={{ mb: 2 }} />

        {version && (
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="body2" color="text.secondary">{t("settings.current_version")}</Typography>
              <Typography variant="body1" component="div">
                {version.current_version || (
                  <Chip label={t("settings.not_installed")} size="small" color="warning" />
                )}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="body2" color="text.secondary">{t("settings.latest_version")}</Typography>
              <Typography variant="body1">{version.latest_version ?? "—"}</Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="body2" color="text.secondary">Arch</Typography>
              <Typography variant="body1">{version.arch}</Typography>
            </Grid>
          </Grid>
        )}

        {version && (
          <Box sx={{ mb: 2 }}>
            {version.has_update && version.installed && (
              <Alert severity="info" sx={{ mb: 1 }}>
                {t("settings.update_available")}: {version.latest_version}
              </Alert>
            )}
            {version.installed && !version.has_update && (
              <Alert severity="success" sx={{ mb: 1 }}>
                {t("settings.up_to_date")}
              </Alert>
            )}
          </Box>
        )}

        {isError && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={
              <Button color="inherit" size="small" onClick={() => void refetch()} disabled={isFetching}>
                {t("common.retry")}
              </Button>
            }
          >
            {t("settings.version_check_failed")}
          </Alert>
        )}

        {actionError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {actionError}
          </Alert>
        )}

        <Box
          sx={{
            mb: 2,
            p: 2,
            borderRadius: 0,
            border: 1,
            borderColor: "divider",
            bgcolor: "background.default",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              mb: 1,
            }}
          >
            <Typography variant="subtitle2">{t("settings.download_task")}</Typography>
            <Chip
              label={progressStatusLabel}
              color={
                progress?.status === "error"
                  ? "error"
                  : progress?.status === "done"
                    ? "success"
                    : progress?.active
                      ? "info"
                      : "default"
              }
              size="small"
            />
          </Box>
          {activeProgress ? (
            <>
              <Grid container spacing={2} sx={{ mb: 1.5 }}>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("settings.current_task")}
                  </Typography>
                  <Typography variant="body2">{taskTypeLabel}</Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("settings.progress")}
                  </Typography>
                  <Typography variant="body2">{downloadedLabel}</Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("settings.speed")}
                  </Typography>
                  <Typography variant="body2">
                    {formatBytesPerSecond(activeProgress.bytes_per_sec)}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("settings.eta")}
                  </Typography>
                  <Typography variant="body2">
                    {formatRemainingTime(activeProgress.remaining_secs)}
                  </Typography>
                </Grid>
              </Grid>
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {activeProgress.message}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {activeProgress.percent > 0 ? `${activeProgress.percent.toFixed(1)}%` : ""}
                </Typography>
              </Box>
              <LinearProgress
                variant={activeProgress.total > 0 ? "determinate" : "indeterminate"}
                value={activeProgress.percent}
                sx={{ mb: 1 }}
              />
              <Typography variant="caption" color="text.secondary">
                {t("settings.last_update")}: {lastUpdatedLabel}
              </Typography>
            </>
          ) : (
            <Alert severity="info">{t("settings.no_download_task")}</Alert>
          )}
        </Box>

        <Box sx={{ display: "flex", gap: 1 }}>
          {/* The install endpoint resolves its own download URL server-side, so it
              stays available even when the version check (GitHub API) fails. */}
          {(version ? !version.installed : isError) && (
            <Button
              variant="contained"
              onClick={handleInstall}
              disabled={actionPending}
              startIcon={actionPending ? <CircularProgress size={16} /> : undefined}
            >
              {actionPending ? t("settings.installing") : t("settings.install")}
            </Button>
          )}
          {version && version.installed && version.has_update && (
            <Button
              variant="contained"
              color="primary"
              onClick={handleUpgrade}
              disabled={actionPending}
              startIcon={actionPending ? <CircularProgress size={16} /> : undefined}
            >
              {actionPending ? t("settings.installing") : t("settings.upgrade")}
            </Button>
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {t("settings.local_packages")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t("settings.local_packages_directory")}: <code>{localPackages?.directory ?? "—"}</code>
        </Typography>
        {localPackages && localPackages.packages.length === 0 && (
          <Alert severity="info">{t("settings.local_packages_empty")}</Alert>
        )}
        {localPackages && localPackages.packages.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {localPackages.packages.map((item) => (
              <Box
                key={item.name}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1,
                  p: 1,
                  border: 1,
                  borderColor: "divider",
                  bgcolor: "background.default",
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {item.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatBytes(item.size)} · {formatDate(item.modified_at)}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    void handleLocalInstall(item.name);
                  }}
                  disabled={actionPending}
                >
                  {t("settings.local_import")}
                </Button>
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function SystemProxyCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: proxyEnvironment, isLoading: proxyEnvironmentLoading } = useProxyEnvironment();
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const proxyEnvironmentShell = proxyEnvironment?.available === true ? proxyEnvironment.shell : undefined;
  const proxyEnvironmentAvailable = Boolean(proxyEnvironmentShell);
  const proxyEnvironmentUnavailableReason = proxyEnvironment?.reason ?? t("settings.proxy_environment_unavailable");
  const proxyEnvironmentSummary = proxyEnvironmentAvailable
    ? `${proxyEnvironment?.proxy_url} · NO_PROXY=${proxyEnvironment?.no_proxy}`
    : proxyEnvironmentUnavailableReason;
  const proxyEnvironmentEndpoint = proxyEnvironmentAvailable ? `${proxyEnvironment?.host}:${proxyEnvironment?.port}` : "";

  const { data, isLoading } = useQuery({
    queryKey: ["systemProxy"],
    queryFn: () => getSystemProxy().then((r) => r.data),
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setSystemProxy(enabled),
    onSuccess: () => {
      setMessage(null);
      return qc.invalidateQueries({ queryKey: ["systemProxy"] });
    },
    onError: (error) =>
      setMessage({ severity: "error", text: formatApiError(error, t("settings.system_proxy_failed")) }),
  });

  const handleCopyProxyEnvironment = async (content: string, successText: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setMessage({ severity: "success", text: successText });
    } catch (error) {
      setMessage({ severity: "error", text: formatApiError(error, t("settings.proxy_environment_copy_failed")) });
    }
  };

  return (
    <SettingsSectionCard
      title={t("settings.system_proxy")}
      description={t("settings.system_proxy_desc")}
      headerRight={
        !isLoading && data ? (
          <Chip
            label={data.enabled ? t("settings.enable") : t("settings.disable")}
            color={data.enabled ? "success" : "default"}
            size="small"
          />
        ) : undefined
      }
      footer={
        !isLoading && data ? (
          <Button
            variant={data.enabled ? "outlined" : "contained"}
            size="small"
            onClick={() => toggle.mutate(!data.enabled)}
            disabled={toggle.isPending}
          >
            {data.enabled ? t("settings.disable") : t("settings.enable")}
          </Button>
        ) : undefined
      }
    >
      {message ? <Alert severity={message.severity}>{message.text}</Alert> : null}
      <Box sx={sectionPanelSx}>
        {isLoading ? (
          <CircularProgress size={20} />
        ) : data ? (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
              {data.current_http && (
                <Typography variant="body2" color="text.secondary">
                  HTTP: {data.current_http}
                </Typography>
              )}
            </Box>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t("settings.system_proxy_unavailable")}
          </Typography>
        )}
      </Box>
      <Box sx={sectionPanelSx}>
        <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, alignItems: "center", mb: 1.5 }}>
          <Box>
            <Typography variant="subtitle2">{t("settings.proxy_environment")}</Typography>
            <Typography variant="caption" color="text.secondary">
              {proxyEnvironmentLoading ? t("settings.loading") : proxyEnvironmentSummary}
            </Typography>
          </Box>
          {proxyEnvironmentAvailable ? <Chip size="small" label={proxyEnvironmentEndpoint} /> : null}
        </Box>
        <TextField
          multiline
          fullWidth
          minRows={4}
          value={
            proxyEnvironmentLoading
              ? t("settings.loading")
              : proxyEnvironmentAvailable
                ? proxyEnvironmentShell?.export ?? ""
                : proxyEnvironmentUnavailableReason
          }
          slotProps={{ input: { readOnly: true } }}
          sx={{
            mb: 1.5,
            "& .MuiInputBase-root": {
              fontFamily: "monospace",
              fontSize: "0.85rem",
            },
          }}
        />
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button
            size="small"
            variant="outlined"
            onClick={() =>
              proxyEnvironmentShell &&
              void handleCopyProxyEnvironment(proxyEnvironmentShell.export, t("settings.proxy_environment_export_copied"))
            }
            disabled={!proxyEnvironmentAvailable}
          >
            {t("settings.copy_export")}
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() =>
              proxyEnvironmentShell &&
              void handleCopyProxyEnvironment(proxyEnvironmentShell.unset, t("settings.proxy_environment_unset_copied"))
            }
            disabled={!proxyEnvironmentAvailable}
          >
            {t("settings.copy_unset")}
          </Button>
        </Box>
      </Box>
    </SettingsSectionCard>
  );
}

function TunModeCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const showToast = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["tunMode"],
    queryFn: () => getTunMode().then((r) => r.data),
  });

  const [stack, setStack] = useState("mixed");

  useEffect(() => {
    if (data) setStack(data.stack);
  }, [data]);

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setTunMode(enabled, stack),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["tunMode"] });
    },
    onError: (error) =>
      showToast({ message: formatApiError(error, t("settings.tun_failed")), severity: "error" }),
  });

  const stackChanged = data ? stack !== data.stack : false;
  const buttonLabel = data?.enabled
    ? stackChanged
      ? t("settings.save")
      : t("settings.disable")
    : t("settings.enable");

  return (
    <SettingsSectionCard
      title={t("settings.tun_mode")}
      description={t("settings.tun_mode_desc")}
      headerRight={
        !isLoading && data ? (
          <Chip
            label={data.enabled ? t("settings.enable") : t("settings.disable")}
            color={data.enabled ? "success" : "default"}
            size="small"
          />
        ) : undefined
      }
      footer={
        !isLoading && data ? (
          <Button
            variant={data.enabled ? "outlined" : "contained"}
            size="small"
            onClick={() => toggle.mutate(stackChanged ? data.enabled : !data.enabled)}
            disabled={toggle.isPending}
          >
            {buttonLabel}
          </Button>
        ) : undefined
      }
    >
      <Box sx={sectionPanelSx}>
        {isLoading ? (
          <CircularProgress size={20} />
        ) : data ? (
          <>
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>{t("settings.tun_stack")}</InputLabel>
              <Select
                value={stack}
                label={t("settings.tun_stack")}
                onChange={(e) => setStack(e.target.value)}
              >
                <MenuItem value="mixed">{t("settings.stack_mixed")}</MenuItem>
                <MenuItem value="gvisor">{t("settings.stack_gvisor")}</MenuItem>
                <MenuItem value="system">{t("settings.stack_system")}</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="body2" color="text.secondary">
              {t(`settings.stack_${stack}`)}
            </Typography>
          </>
        ) : null}
      </Box>
    </SettingsSectionCard>
  );
}
