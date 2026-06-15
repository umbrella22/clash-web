import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Typography,
  IconButton,
  TextField,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useQuery } from "@tanstack/react-query";
import {
  filterRules,
  getRuleTypes,
  sortRules,
  summarizeRules,
  type RuleItem,
  type RulesResponse,
  type RuleSortKey,
  type RuleTypeFilter,
  type SortDirection,
} from "../features/rules";
import { mihomoApi } from "../services/api";
import { PageTitle, SystemPanel } from "../components/SystemChrome";

export default function RulesPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<RuleTypeFilter>("all");
  const [sortKey, setSortKey] = useState<RuleSortKey>("type");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["rules"],
    queryFn: () => mihomoApi.get<RulesResponse>("/rules").then((r) => r.data),
  });

  const allRules: RuleItem[] = useMemo(() => (data?.rules ?? []) as RuleItem[], [data]);
  const summary = useMemo(() => summarizeRules(allRules), [allRules]);
  const ruleTypes = useMemo(() => getRuleTypes(allRules), [allRules]);
  const rules = useMemo(
    () => sortRules(filterRules(allRules, search, typeFilter), sortKey, sortDirection),
    [allRules, search, sortDirection, sortKey, typeFilter]
  );

  if (isLoading)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
        <CircularProgress />
      </Box>
    );

  return (
    <Box>
      <PageTitle
        title={t("rules.title")}
        count={rules.length}
        actions={
          <Tooltip title={t("rules.refresh")}>
            <span>
              <IconButton onClick={() => void refetch()} disabled={isFetching}>
                {isFetching ? <CircularProgress size={20} /> : <RefreshIcon />}
              </IconButton>
            </span>
          </Tooltip>
        }
      />

      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
        <Chip label={t("rules.summary_total", { count: summary.total })} variant="outlined" />
        <Chip label={t("rules.summary_direct", { count: summary.direct })} variant="outlined" />
        <Chip label={t("rules.summary_reject", { count: summary.reject })} variant="outlined" />
        <Chip label={t("rules.summary_proxy", { count: summary.proxyGroups })} variant="outlined" />
        <Chip label={t("rules.summary_top_type", { type: summary.topType ?? t("rules.none") })} variant="outlined" />
      </Box>

      <Box sx={{ display: "flex", gap: 1.5, mb: 2, flexWrap: "wrap" }}>
        <TextField
          size="small"
          placeholder={t("rules.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1, minWidth: 260 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start"><SearchIcon /></InputAdornment>
              ),
            },
          }}
        />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>{t("rules.filter_type")}</InputLabel>
          <Select
            label={t("rules.filter_type")}
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <MenuItem value="all">{t("rules.filter_all")}</MenuItem>
            {ruleTypes.map((type) => (
              <MenuItem key={type} value={type}>{type}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>{t("rules.sort")}</InputLabel>
          <Select
            label={t("rules.sort")}
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as RuleSortKey)}
          >
            <MenuItem value="type">{t("rules.type")}</MenuItem>
            <MenuItem value="payload">{t("rules.payload")}</MenuItem>
            <MenuItem value="proxy">{t("rules.proxy")}</MenuItem>
            <MenuItem value="size">{t("rules.size")}</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>{t("rules.direction")}</InputLabel>
          <Select
            label={t("rules.direction")}
            value={sortDirection}
            onChange={(event) => setSortDirection(event.target.value as SortDirection)}
          >
            <MenuItem value="asc">{t("rules.asc")}</MenuItem>
            <MenuItem value="desc">{t("rules.desc")}</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <SystemPanel>
        <TableContainer component={Paper} variant="outlined" sx={{ backgroundColor: "transparent" }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t("rules.type")}</TableCell>
              <TableCell>{t("rules.payload")}</TableCell>
              <TableCell>{t("rules.proxy")}</TableCell>
              <TableCell>{t("rules.size")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.slice(0, 500).map((r: RuleItem, i: number) => (
              <TableRow key={i} hover>
                <TableCell><Chip label={r.type} size="small" variant="outlined" /></TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.payload}
                  </Typography>
                </TableCell>
                <TableCell><Typography variant="body2">{r.proxy}</Typography></TableCell>
                <TableCell><Typography variant="body2">{r.size ?? "-"}</Typography></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </TableContainer>
      </SystemPanel>
      {rules.length === 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          {allRules.length === 0 ? t("rules.empty") : t("rules.empty_filtered")}
        </Alert>
      )}
      {rules.length > 500 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          {t("rules.truncated", { shown: 500, total: rules.length })}
        </Alert>
      )}
    </Box>
  );
}
