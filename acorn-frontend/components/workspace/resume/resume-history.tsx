"use client";

import { useEffect, useState } from "react";
import {
  Banner,
  Button,
  EmptyState,
  Glyph,
  GridColumn,
  GridSystem,
  HStack,
  SectionCard,
  Selector,
  Stack,
  Text,
  TextInput,
} from "sid-ui";
import type { AcornAccount } from "@/lib/auth/session";
import {
  deleteGeneration,
  downloadGeneration,
  listGenerations,
  previewGeneration,
} from "@/lib/resume/api";
import { RESUME_TEMPLATES } from "@acorn/shared/resume-templates";
import {
  RESUME_HISTORY_PER_PAGE,
  RESUME_HISTORY_SEARCH_DEBOUNCE_MS,
  RESUME_HISTORY_SORTS,
  jdHeadline,
  type ResumeHistoryRun,
  type ResumeHistorySearchIn,
  type ResumeHistorySort,
  type ResumeHistoryStatus,
} from "@acorn/shared/resume-history";

const SEARCH_IN: { value: ResumeHistorySearchIn; label: string }[] = [
  { value: "all", label: "All" },
  { value: "jd", label: "Job description" },
  { value: "resume", label: "Résumé" },
];

const STATUSES: { value: ResumeHistoryStatus; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

/** Searchable generation history: filters, preview, DOCX download, and delete. */
export function ResumeHistory({ account }: { account: AcornAccount }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [searchIn, setSearchIn] = useState<ResumeHistorySearchIn>("all");
  const [status, setStatus] = useState<ResumeHistoryStatus>("all");
  const [model, setModel] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<ResumeHistorySort>("newest");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [runs, setRuns] = useState<ResumeHistoryRun[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), RESUME_HISTORY_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const result = await listGenerations({
        search: debounced,
        searchIn,
        status,
        model: model || undefined,
        templateId: templateId || undefined,
        from: from || undefined,
        to: to || undefined,
        sort,
        limit: RESUME_HISTORY_PER_PAGE,
        offset,
        includeFacets: true,
      });
      if (cancel) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError("");
      setRuns(result.data.runs);
      setTotal(result.data.total);
      setModels(result.data.facets?.models ?? []);
    })();
    return () => {
      cancel = true;
    };
  }, [debounced, searchIn, status, model, templateId, from, to, sort, offset]);

  const open = async (id: string) => {
    setSelected(id);
    const result = await previewGeneration(id);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setHtml(result.data.html);
  };

  const download = async (id: string) => {
    const result = await downloadGeneration(id);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const bytes = Uint8Array.from(atob(result.data.base64), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes]));
    const link = document.createElement("a");
    link.href = url;
    link.download = result.data.name;
    link.click();
    URL.revokeObjectURL(url);
  };

  const remove = async (id: string) => {
    const result = await deleteGeneration(id);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (selected === id) {
      setSelected(null);
      setHtml("");
    }
    setRuns((current) => current.filter((run) => run.id !== id));
    setTotal((count) => Math.max(0, count - 1));
  };

  const page = Math.floor(offset / RESUME_HISTORY_PER_PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / RESUME_HISTORY_PER_PAGE));

  return (
    <Stack gap={4}>
      {error ? <Banner status="error" title="History" description={error} /> : null}
      <SectionCard title="Search" description={`Drafts generated for ${account.name}.`}>
        <Stack gap={3}>
          <TextInput
            label="Search"
            value={search}
            onChange={(value) => {
              setOffset(0);
              setSearch(value);
            }}
          />
          <HStack gap={3} wrap="wrap">
            <Selector
              label="In"
              value={searchIn}
              options={SEARCH_IN}
              onChange={(value) => {
                setOffset(0);
                setSearchIn(value as ResumeHistorySearchIn);
              }}
            />
            <Selector
              label="Status"
              value={status}
              options={STATUSES}
              onChange={(value) => {
                setOffset(0);
                setStatus(value as ResumeHistoryStatus);
              }}
            />
            <Selector
              label="Model"
              value={model || "all"}
              options={[
                { value: "all", label: "Any model" },
                ...models.map((item) => ({ value: item, label: item })),
              ]}
              onChange={(value) => {
                setOffset(0);
                setModel(value === "all" ? "" : value);
              }}
            />
            <Selector
              label="Template"
              value={templateId || "all"}
              options={[
                { value: "all", label: "Any template" },
                ...RESUME_TEMPLATES.map((item) => ({ value: item.id, label: item.name })),
              ]}
              onChange={(value) => {
                setOffset(0);
                setTemplateId(value === "all" ? "" : value);
              }}
            />
            <Selector
              label="Sort"
              value={sort}
              options={RESUME_HISTORY_SORTS.map((item) => ({ value: item.id, label: item.label }))}
              onChange={(value) => {
                setOffset(0);
                setSort(value as ResumeHistorySort);
              }}
            />
          </HStack>
          <HStack gap={3} wrap="wrap">
            <TextInput
              label="From"
              value={from}
              placeholder="YYYY-MM-DD"
              onChange={(value) => {
                setOffset(0);
                setFrom(value);
              }}
            />
            <TextInput
              label="To"
              value={to}
              placeholder="YYYY-MM-DD"
              onChange={(value) => {
                setOffset(0);
                setTo(value);
              }}
            />
          </HStack>
        </Stack>
      </SectionCard>
      {runs.length === 0 ? (
        <EmptyState
          icon={<Glyph name="sparkle" />}
          title="No generations"
          description="Generate a résumé and it shows up here."
        />
      ) : (
        <GridSystem gap={4} align="start">
          <GridColumn span="full" lg={5}>
            <SectionCard title="Runs" description={`${total} match${total === 1 ? "" : "es"}`}>
              <Stack gap={3}>
                {runs.map((run) => (
                  <Stack key={run.id} gap={1}>
                    <Text weight="semibold">
                      {jdHeadline(run.jobDescription) || "Untitled posting"}
                    </Text>
                    <Text type="supporting" color="secondary">
                      {[run.status, run.model, run.templateId].filter(Boolean).join(" · ")}
                    </Text>
                    <HStack gap={1}>
                      <Button
                        label="Preview"
                        variant="ghost"
                        size="sm"
                        onClick={() => void open(run.id)}
                      />
                      <Button
                        label="Download"
                        variant="ghost"
                        size="sm"
                        onClick={() => void download(run.id)}
                      />
                      <Button
                        label="Delete"
                        variant="ghost"
                        size="sm"
                        onClick={() => void remove(run.id)}
                      />
                    </HStack>
                  </Stack>
                ))}
                <HStack gap={2} vAlign="center">
                  <Button
                    label="Previous"
                    variant="secondary"
                    size="sm"
                    isDisabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - RESUME_HISTORY_PER_PAGE))}
                  />
                  <Text color="secondary">{`Page ${page} of ${pages}`}</Text>
                  <Button
                    label="Next"
                    variant="secondary"
                    size="sm"
                    isDisabled={offset + RESUME_HISTORY_PER_PAGE >= total}
                    onClick={() => setOffset(offset + RESUME_HISTORY_PER_PAGE)}
                  />
                </HStack>
              </Stack>
            </SectionCard>
          </GridColumn>
          <GridColumn span="full" lg={7}>
            <SectionCard title="Preview" description="The stored DOCX, shown as HTML.">
              {html ? (
                <iframe
                  title="Generation preview"
                  srcDoc={html}
                  sandbox=""
                  className="resume-preview-frame"
                />
              ) : (
                <Text color="secondary">Choose a run to preview it.</Text>
              )}
            </SectionCard>
          </GridColumn>
        </GridSystem>
      )}
    </Stack>
  );
}
