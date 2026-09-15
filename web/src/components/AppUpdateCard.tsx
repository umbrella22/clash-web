import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, FormControlLabel,
  Grid, LinearProgress, Link, Switch, TextField, Typography,
} from "@mui/material";
import {
  checkAppUpdate, getAppUpdateStatus, installAppUpdate, saveAppUpdateSettings,
  type AppInstallPhase, type AppUpdateStatus,
} from "../services/api";
import { formatApiError } from "../utils/errors";

const queryKey = ["appUpdate"];

function isInstalling(phase?: AppInstallPhase) {
  return phase !== undefined && !["idle", "done", "error"].includes(phase);
}

function formatTime(timestamp: number | null | undefined) {
  return timestamp ? new Date(timestamp * 1000).toLocaleString() : "—";
}

export default function AppUpdateCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, error: statusError } = useQuery({
    queryKey,
    queryFn: () => getAppUpdateStatus().then((response) => response.data),
    refetchInterval: (query) =>
      isInstalling(query.state.data?.installation.phase) || query.state.data?.checking ? 2000 : 15000,
    refetchIntervalInBackground: true,
    retry: false,
  });
  const initialVersion = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    if (initialVersion.current && initialVersion.current !== data.current_version) {
      window.location.reload();
    }
    initialVersion.current = data.current_version;
  }, [data]);

  const [draft, setDraft] = useState<{ interval: string; auto: boolean } | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const updateCache = (response: { data: AppUpdateStatus }) => qc.setQueryData(queryKey, response.data);
  const onError = (error: unknown) => setMessage({ error: true, text: formatApiError(error, t("app_updates.action_failed")) });
  const check = useMutation({
    mutationFn: checkAppUpdate,
    onMutate: () => setMessage(null),
    onSuccess: updateCache,
    onError,
  });
  const install = useMutation({
    mutationFn: installAppUpdate,
    onMutate: () => setMessage(null),
    onSuccess: updateCache,
    onError,
  });
  const save = useMutation({
    mutationFn: saveAppUpdateSettings,
    onSuccess: (response) => {
      updateCache(response);
      setDraft(null);
      setMessage({ error: false, text: t("settings.saved") });
    },
    onError,
  });

  const form = draft ?? { interval: String(data?.settings.check_interval_hours ?? 24), auto: data?.settings.auto_update ?? false };
  const interval = Number(form.interval);
  const valid = /^\d+$/.test(form.interval) && interval <= 720 && (!form.auto || interval > 0);
  const installing = isInstalling(data?.installation.phase);
  const checking = check.isPending || data?.checking;
  const busy = installing || checking || install.isPending;

  return (
    <Card variant="outlined">
      <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
          <Typography variant="h6">{t("app_updates.title")}</Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button variant="outlined" size="small" disabled={!data || busy} onClick={() => check.mutate()}>
              {checking ? t("settings.checking") : t("settings.check_update")}
            </Button>
            <Button variant="contained" size="small"
              disabled={!data?.installation_supported || !data.update_available || !data.package_ready || !!data.check_error || busy}
              onClick={() => install.mutate()}>
              {t("app_updates.install")}
            </Button>
          </Box>
        </Box>
        <Divider />
        <Typography variant="body2" color="text.secondary">{t("app_updates.description")}</Typography>
        {(!data && !statusError) || busy ? <LinearProgress /> : null}
        {statusError ? (
          <Alert severity={installing ? "info" : "error"}>
            {installing ? t("app_updates.reconnecting") : formatApiError(statusError, t("app_updates.status_failed"))}
          </Alert>
        ) : null}
        {message ? <Alert severity={message.error ? "error" : "success"}>{message.text}</Alert> : null}
        {data ? (
          <>
            <Grid container spacing={2}>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Typography variant="body2" color="text.secondary">{t("settings.current_version")}</Typography>
                <Typography>{data.current_version}</Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Typography variant="body2" color="text.secondary">{t("settings.latest_version")}</Typography>
                {data.latest ? <Link href={data.latest.url} target="_blank" rel="noreferrer">{data.latest.version}</Link> : <Typography>—</Typography>}
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <Typography variant="body2" color="text.secondary">{t("app_updates.last_check")}</Typography>
                <Typography variant="body2">{formatTime(data.last_checked_at)}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <Typography variant="body2" color="text.secondary">{t("app_updates.next_check")}</Typography>
                <Typography variant="body2">{data.next_check_at === null ? t("app_updates.manual") : formatTime(data.next_check_at)}</Typography>
              </Grid>
            </Grid>
            {data.check_error ? <Alert severity="warning">{data.check_error}</Alert> : !checking && !installing ? (
              <Alert severity={data.update_available ? "info" : data.latest ? "success" : "info"}>
                {data.update_available ? t("settings.update_available") : data.latest ? t("settings.up_to_date")
                  : data.last_checked_at ? t("app_updates.no_release") : t("app_updates.not_checked")}
              </Alert>
            ) : null}
            {!data.installation_supported ? <Alert severity="info">{t("app_updates.unsupported")}</Alert> : null}
            {data.update_available && !data.package_ready ? <Alert severity="info">{t("app_updates.package_pending")}</Alert> : null}
            {data.installation.phase !== "idle" ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Chip size="small" color={data.installation.phase === "error" ? "error" : installing ? "info" : "success"}
                  label={t(`app_updates.phase_${data.installation.phase}`)} />
                {data.installation.version ? <Typography variant="body2">{data.installation.version}</Typography> : null}
                {data.installation.error ? <Alert severity="error" sx={{ width: "100%" }}>{data.installation.error}</Alert> : null}
              </Box>
            ) : null}
            <Divider />
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, flexWrap: "wrap" }}>
              <TextField label={t("app_updates.interval")} type="number" size="small"
                value={form.interval} disabled={save.isPending} error={draft !== null && !valid}
                helperText={t("app_updates.interval_help")}
                slotProps={{ htmlInput: { min: 0, max: 720, step: 1 } }}
                onChange={(event) => setDraft({ ...form, interval: event.target.value, auto: Number(event.target.value) === 0 ? false : form.auto })}
                sx={{ minWidth: { xs: "100%", sm: 280 } }} />
              <FormControlLabel label={t("app_updates.auto_install")}
                control={<Switch checked={form.auto}
                  disabled={save.isPending || interval === 0 || (!data.installation_supported && !form.auto)}
                  onChange={(event) => setDraft({ ...form, auto: event.target.checked })} />} />
              <Button variant="outlined" disabled={!draft || !valid || save.isPending}
                onClick={() => save.mutate({ check_interval_hours: interval, auto_update: form.auto })}>
                {t("settings.save")}
              </Button>
            </Box>
            <Typography variant="body2" color="text.secondary">{t("app_updates.auto_help")}</Typography>
            {data.latest?.notes ? (
              <Box component="details">
                <Box component="summary" sx={{ cursor: "pointer" }}>{t("app_updates.release_notes")}</Box>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", mt: 1 }}>{data.latest.notes}</Typography>
              </Box>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
