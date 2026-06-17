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
} from "@mui/material";
import { useProfileFile, useSaveProfileFile } from "../hooks/useApi";

interface Props {
  uid: string | null;
  onClose: () => void;
}

export default function ProfileEditorDialog({ uid, onClose }: Props) {
  const { t } = useTranslation();
  const { data, isLoading } = useProfileFile(uid);
  const saveMut = useSaveProfileFile();
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!uid) {
      setContent("");
      return;
    }
    if (data?.content !== undefined) setContent(data.content);
  }, [data?.content, uid]);

  const handleSave = () => {
    if (!uid) return;
    saveMut.mutate(
      { uid, content },
      { onSuccess: onClose }
    );
  };

  return (
    <Dialog open={!!uid} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Typography variant="h6">{t("profiles.edit")}</Typography>
      </DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Typography>Loading...</Typography>
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
        <Button onClick={onClose}>{t("profiles.cancel")}</Button>
        <Button onClick={handleSave} variant="contained" disabled={saveMut.isPending}>
          {t("profiles.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
