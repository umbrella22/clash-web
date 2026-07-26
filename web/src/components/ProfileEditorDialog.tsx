import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Alert,
} from "@mui/material";
import { useProfileFile, useSaveProfileFile } from "../hooks/useApi";
import { useToast } from "./toastContext";
import ConfirmDialog from "./ConfirmDialog";
import { formatApiError } from "../utils/errors";

interface Props {
  uid: string | null;
  onClose: () => void;
}

export default function ProfileEditorDialog({ uid, onClose }: Props) {
  const { t } = useTranslation();
  const showToast = useToast();
  const { data, isLoading } = useProfileFile(uid);
  const saveMut = useSaveProfileFile();
  const [content, setContent] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

  useEffect(() => {
    if (!uid) {
      setContent("");
      setSaveError(null);
      return;
    }
    if (data?.content !== undefined) setContent(data.content);
  }, [data?.content, uid]);

  const isDirty = !!uid && !isLoading && content !== (data?.content ?? "");

  const doClose = () => {
    setConfirmingClose(false);
    setSaveError(null);
    onClose();
  };

  const requestClose = () => {
    if (isDirty) {
      setConfirmingClose(true);
      return;
    }
    doClose();
  };

  const handleSave = () => {
    if (!uid) return;
    setSaveError(null);
    saveMut.mutate(
      { uid, content },
      {
        onSuccess: () => {
          showToast({ severity: "success", message: t("profiles.saved") });
          onClose();
        },
        onError: (error) => {
          setSaveError(formatApiError(error, t("profiles.save_failed")));
        },
      }
    );
  };

  return (
    <Dialog open={!!uid} onClose={requestClose} maxWidth="md" fullWidth>
      <DialogTitle>{t("profiles.edit")}</DialogTitle>
      <DialogContent>
        {saveError && (
          <Alert severity="error" sx={{ mb: 1 }} onClose={() => setSaveError(null)}>
            {saveError}
          </Alert>
        )}
        {isLoading ? (
          <Typography>{t("common.loading")}</Typography>
        ) : (
          <TextField
            multiline
            fullWidth
            minRows={20}
            maxRows={30}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            sx={{
              "& .MuiInputBase-root": {
                fontFamily: "monospace",
                fontSize: "0.85rem",
              },
            }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={requestClose}>{t("profiles.cancel")}</Button>
        <Button onClick={handleSave} variant="contained" disabled={saveMut.isPending || !uid}>
          {t("profiles.save")}
        </Button>
      </DialogActions>
      <ConfirmDialog
        open={confirmingClose}
        message={t("profiles.editor_dirty_confirm")}
        confirmColor="warning"
        onConfirm={doClose}
        onCancel={() => setConfirmingClose(false)}
      />
    </Dialog>
  );
}
