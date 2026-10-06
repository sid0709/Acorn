"use client";

import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Dialog,
  DialogHeader,
  FileUploader,
  Glyph,
  HStack,
  IconButton,
  Layout,
  LayoutContent,
  LayoutFooter,
  ProgressBar,
  SectionCard,
  Selector,
  Stack,
  Table,
  Text,
  TextInput,
  formatBytes,
  type TableColumn,
} from "sid-ui";
import {
  analyzeLibraryFile,
  deleteLibraryFile,
  listLibrary,
  makeLibraryPrimary,
  uploadLibraryFile,
} from "@/lib/resume/api";
import {
  RESUME_LIBRARY_ACCEPT,
  RESUME_LIBRARY_MAX_BYTES,
  RESUME_SKILL_CATEGORIES,
  type ResumeLibraryRow,
  type ResumeLibrarySource,
  type ResumeSkillCategory,
} from "@acorn/shared/resume-library";
import {
  RESUME_ANALYZE_CONCURRENCY,
  RESUME_BULK_UPLOAD_CONCURRENCY,
  failureSummary,
  fileBase64,
  resumesFromFolder,
  runPool,
  stackCounts,
  type FolderResume,
} from "./library-batch";

const VIEWS: { value: ResumeLibrarySource; label: string }[] = [
  { value: "uploaded", label: "Uploaded" },
  { value: "generated", label: "Generated" },
];

const SKILL_CATEGORY_LABEL: Record<ResumeSkillCategory, string> = {
  hard: "Languages and frameworks",
  devops: "Cloud and infrastructure",
  tools: "Tools",
  domain: "Domain",
  soft: "Soft skills",
};

const BULK_DIALOG_WIDTH = 480;
const SKILLS_DIALOG_WIDTH = 560;

type BatchProgress = { current: number; total: number };

/** Uploaded files and résumés the generator saved, with folder upload and skill analysis. */
export function ResumeLibrary() {
  const [rows, setRows] = useState<ResumeLibraryRow[]>([]);
  const [view, setView] = useState<ResumeLibrarySource>("uploaded");
  const [search, setSearch] = useState("");
  const [stack, setStack] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [bulkPending, setBulkPending] = useState<FolderResume[] | null>(null);
  const [uploadProgress, setUploadProgress] = useState<BatchProgress | null>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState<BatchProgress | null>(null);
  const [stoppingAnalysis, setStoppingAnalysis] = useState(false);
  const [reanalyzeIds, setReanalyzeIds] = useState<string[] | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [skillsRow, setSkillsRow] = useState<ResumeLibraryRow | null>(null);
  const bulkRef = useRef<HTMLInputElement>(null);
  const stopAnalyze = useRef(false);

  const busy = uploadProgress !== null || analyzeProgress !== null;

  const reload = async () => {
    const result = await listLibrary();
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRows(result.data.resumes);
  };

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const result = await listLibrary();
      if (cancel) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRows(result.data.resumes);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    bulkRef.current?.setAttribute("webkitdirectory", "");
    bulkRef.current?.setAttribute("directory", "");
  }, []);

  const uploadItems = async (items: FolderResume[]) => {
    if (!items.length) return;
    setError("");
    setUploadProgress({ current: 0, total: items.length });
    try {
      const failed = await runPool(
        items,
        RESUME_BULK_UPLOAD_CONCURRENCY,
        async (item) => {
          const result = await uploadLibraryFile({
            fileName: item.file.name,
            title: item.techStack,
            contentBase64: await fileBase64(item.file),
          });
          return result.ok ? null : { fileName: item.file.name, error: result.message };
        },
        (current, total) => setUploadProgress({ current, total }),
      );
      if (failed.length) setError(failureSummary("file(s) failed to upload", items.length, failed));
      await reload();
    } finally {
      setUploadProgress(null);
    }
  };

  const pickFolder = (files: FileList | null) => {
    if (!files?.length) return;
    const picked = resumesFromFolder(files);
    if (!picked.ok) {
      setError(picked.message);
      return;
    }
    setError("");
    setBulkPending(picked.items);
  };

  const analyzeIds = async (ids: string[], force: boolean) => {
    const targets = rows.filter((row) => ids.includes(row.id) && row.source === "uploaded");
    if (!targets.length) return;
    stopAnalyze.current = false;
    setError("");
    setReanalyzeIds(null);
    setAnalyzeProgress({ current: 0, total: targets.length });
    try {
      const failed = await runPool(
        targets,
        RESUME_ANALYZE_CONCURRENCY,
        async (row) => {
          const result = await analyzeLibraryFile(row.id, force);
          return result.ok ? null : { fileName: row.fileName, error: result.message };
        },
        (current, total) => setAnalyzeProgress({ current, total }),
        () => stopAnalyze.current,
      );
      const stopped = stopAnalyze.current;
      setSelected([]);
      if (failed.length)
        setError(failureSummary("résumé(s) failed to analyze", targets.length, failed));
      else if (stopped) setError("Analysis was stopped.");
      await reload();
    } finally {
      stopAnalyze.current = false;
      setStoppingAnalysis(false);
      setAnalyzeProgress(null);
    }
  };

  const removeSelected = async () => {
    const ids = deleteIds ?? [];
    setDeleteIds(null);
    if (!ids.length) return;
    setError("");
    const failed: { fileName: string; error: string }[] = [];
    for (const id of ids) {
      const result = await deleteLibraryFile(id);
      if (!result.ok) {
        const row = rows.find((item) => item.id === id);
        failed.push({ fileName: row?.fileName || id, error: result.message });
      }
    }
    setSelected([]);
    if (failed.length) setError(failureSummary("file(s) failed to delete", ids.length, failed));
    await reload();
  };

  const startAnalyze = () => {
    const targets = rows.filter((row) => selected.includes(row.id) && row.source === "uploaded");
    if (!targets.length) {
      setError("Select uploaded résumés to analyze.");
      return;
    }
    const ids = targets.map((row) => row.id);
    if (targets.some((row) => row.analyzed)) {
      setReanalyzeIds(ids);
      return;
    }
    void analyzeIds(ids, false);
  };

  const act = async (run: () => Promise<{ ok: boolean; message?: string }>) => {
    setError("");
    const result = await run();
    if (!result.ok) setError(result.message || "Couldn’t update the library.");
    await reload();
  };

  const stacks = ["all", ...new Set(rows.map((row) => row.title).filter(Boolean))];
  const query = search.trim().toLowerCase();
  const visible = rows.filter((row) => {
    if (row.source !== view) return false;
    if (stack !== "all" && row.title !== stack) return false;
    if (!query) return true;
    const skills = (row.skillProfile ?? []).map((skill) => skill.name).join(" ");
    return [row.fileName, row.title, row.extractedText, skills]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const bulkSummary = bulkPending ? stackCounts(bulkPending) : [];
  const alreadyAnalyzed = reanalyzeIds
    ? rows.filter((row) => reanalyzeIds.includes(row.id) && row.analyzed).length
    : 0;

  const columns: TableColumn<ResumeLibraryRow>[] = [
    {
      key: "fileName",
      header: "File",
      render: (item) => (
        <HStack gap={2} vAlign="center">
          <Glyph name="file" />
          <Text weight="semibold">{item.fileName}</Text>
          {item.isPrimary ? <Badge label="Default" variant="blue" /> : null}
          {item.analyzed ? <Badge label="Analyzed" variant="green" /> : null}
        </HStack>
      ),
    },
    {
      key: "title",
      header: "Tech stack",
      render: (item) => <Text>{item.title || "—"}</Text>,
    },
    {
      key: "skillCount",
      header: "Skills",
      render: (item) => {
        const count = item.skillCount ?? item.skillProfile?.length ?? 0;
        if (!item.analyzed || count === 0) return <Text color="secondary">—</Text>;
        return (
          <Button
            label={`${count} skills`}
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setSkillsRow(item);
            }}
          />
        );
      },
    },
    {
      key: "size",
      header: "Size",
      render: (item) => <Text color="secondary">{item.size ? formatBytes(item.size) : "—"}</Text>,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (item) => (
        <HStack gap={1} hAlign="end">
          {item.isPrimary ? null : (
            <Button
              label="Make default"
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                void act(async () => makeLibraryPrimary(item.id));
              }}
            />
          )}
          <IconButton
            label={`Remove ${item.fileName}`}
            icon={<Glyph name="trash" />}
            variant="ghost"
            size="sm"
            isDisabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              void act(async () => deleteLibraryFile(item.id));
            }}
          />
        </HStack>
      ),
    },
  ];

  return (
    <Stack gap={4}>
      {error ? <Banner status="error" title="Library" description={error} /> : null}
      <SectionCard
        title="Upload"
        description="Drop files, or bulk-upload a folder whose subfolders are tech-stack names. Each résumé is stored under its parent folder."
      >
        <Stack gap={3}>
          <HStack gap={2} wrap="wrap">
            <Button
              label="Bulk upload"
              variant="secondary"
              icon={<Glyph name="folder" />}
              isDisabled={busy}
              onClick={() => bulkRef.current?.click()}
            />
          </HStack>
          <FileUploader
            label="Résumé files"
            accept={RESUME_LIBRARY_ACCEPT}
            maxSize={RESUME_LIBRARY_MAX_BYTES}
            maxFiles={8}
            isDisabled={busy}
            onChange={(files) =>
              void uploadItems(
                files.map((file) => ({
                  file,
                  techStack: file.name.replace(/\.[^.]+$/, "") || file.name,
                })),
              )
            }
          />
          {uploadProgress ? (
            <ProgressBar
              label="Uploading résumés"
              value={uploadProgress.current}
              max={Math.max(uploadProgress.total, 1)}
              hasValueLabel
              formatValueLabel={(value, max) => `${value} of ${max}`}
            />
          ) : null}
        </Stack>
      </SectionCard>
      <SectionCard
        title="Files"
        description="Select uploaded résumés to analyze their skills or delete them before uploading again."
      >
        <Stack gap={3}>
          <HStack gap={3} wrap="wrap" vAlign="end">
            <Selector
              label="View"
              value={view}
              options={VIEWS}
              onChange={(value) => {
                setView(value as ResumeLibrarySource);
                setSelected([]);
              }}
            />
            <TextInput label="Search" value={search} onChange={setSearch} />
            <Selector
              label="Stack"
              value={stack}
              options={stacks.map((item) => ({
                value: item,
                label: item === "all" ? "All stacks" : item,
              }))}
              onChange={setStack}
            />
            {view === "uploaded" ? (
              analyzeProgress ? (
                <Button
                  label={stoppingAnalysis ? "Stopping…" : "Stop analysis"}
                  variant="secondary"
                  isDisabled={stoppingAnalysis}
                  onClick={() => {
                    stopAnalyze.current = true;
                    setStoppingAnalysis(true);
                  }}
                />
              ) : (
                <>
                  <Button
                    label={`Analyze (${selected.length})`}
                    variant="primary"
                    icon={<Glyph name="sparkle" />}
                    isDisabled={busy || selected.length === 0}
                    onClick={startAnalyze}
                  />
                  <Button
                    label={`Delete (${selected.length})`}
                    variant="destructive"
                    isDisabled={busy || selected.length === 0}
                    onClick={() => setDeleteIds(selected)}
                  />
                </>
              )
            ) : null}
          </HStack>
          {analyzeProgress ? (
            <ProgressBar
              label="Analyzing résumés"
              value={analyzeProgress.current}
              max={Math.max(analyzeProgress.total, 1)}
              hasValueLabel
              formatValueLabel={(value, max) => `${value} of ${max}`}
            />
          ) : null}
          <Table
            caption="Resume library"
            variant="plain"
            selection={view === "uploaded" ? "multiple" : "none"}
            selectedKeys={selected}
            onSelectionChange={setSelected}
            columns={columns}
            rows={visible}
            rowKey={(item) => item.id}
            empty={view === "generated" ? "No generated résumés yet." : "No uploaded files yet."}
          />
        </Stack>
      </SectionCard>
      <input
        ref={bulkRef}
        type="file"
        hidden
        multiple
        accept={RESUME_LIBRARY_ACCEPT}
        onChange={(event) => {
          pickFolder(event.target.files);
          event.target.value = "";
        }}
      />
      <Dialog
        isOpen={bulkPending !== null}
        onOpenChange={(open) => {
          if (!open) setBulkPending(null);
        }}
        purpose="form"
        width={BULK_DIALOG_WIDTH}
      >
        <Layout
          height="fill"
          header={
            <DialogHeader
              title="Confirm bulk upload"
              subtitle={`${bulkPending?.length ?? 0} files across ${bulkSummary.length} tech stacks. The parent folder name is the stack.`}
              onOpenChange={() => setBulkPending(null)}
              hasDivider
            />
          }
          content={
            <LayoutContent>
              <HStack gap={2} wrap="wrap">
                {bulkSummary.map((item) => (
                  <Badge
                    key={item.stack}
                    label={item.count === 1 ? item.stack : `${item.stack} · ${item.count}`}
                  />
                ))}
              </HStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} hAlign="end">
                <Button label="Cancel" variant="ghost" onClick={() => setBulkPending(null)} />
                <Button
                  label="Upload all"
                  variant="primary"
                  onClick={() => {
                    const pending = bulkPending;
                    setBulkPending(null);
                    if (pending) void uploadItems(pending);
                  }}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
      <Dialog
        isOpen={reanalyzeIds !== null}
        onOpenChange={(open) => {
          if (!open) setReanalyzeIds(null);
        }}
        purpose="form"
        width={BULK_DIALOG_WIDTH}
      >
        <Layout
          height="auto"
          header={
            <DialogHeader
              title="Analyze again?"
              subtitle={`${alreadyAnalyzed} selected résumé${alreadyAnalyzed === 1 ? " is" : "s are"} already analyzed. Analyzing again replaces skill scores.`}
              onOpenChange={() => setReanalyzeIds(null)}
              hasDivider
            />
          }
          content={
            <LayoutContent>
              <Text color="secondary">
                Skills are read from the résumé text and saved on each file in the library.
              </Text>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} hAlign="end">
                <Button label="Cancel" variant="ghost" onClick={() => setReanalyzeIds(null)} />
                <Button
                  label="Analyze again"
                  variant="primary"
                  onClick={() => {
                    if (reanalyzeIds) void analyzeIds(reanalyzeIds, true);
                  }}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
      <Dialog
        isOpen={deleteIds !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteIds(null);
        }}
        purpose="form"
        width={BULK_DIALOG_WIDTH}
      >
        <Layout
          height="auto"
          header={
            <DialogHeader
              title="Delete selected résumés?"
              subtitle={`${deleteIds?.length ?? 0} file${deleteIds?.length === 1 ? "" : "s"} will be removed from the library, including the stored file.`}
              onOpenChange={() => setDeleteIds(null)}
              hasDivider
            />
          }
          content={
            <LayoutContent>
              <Text color="secondary">You can upload the same folder again after this.</Text>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} hAlign="end">
                <Button label="Cancel" variant="ghost" onClick={() => setDeleteIds(null)} />
                <Button
                  label="Delete"
                  variant="destructive"
                  onClick={() => void removeSelected()}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
      <Dialog
        isOpen={skillsRow !== null}
        onOpenChange={(open) => {
          if (!open) setSkillsRow(null);
        }}
        purpose="info"
        width={SKILLS_DIALOG_WIDTH}
      >
        <Layout
          height="fill"
          header={
            <DialogHeader
              title={skillsRow ? `${skillsRow.title} — ${skillsRow.fileName}` : "Skills"}
              subtitle="Skills extracted from this résumé, with a category and a level from 2 to 5."
              onOpenChange={() => setSkillsRow(null)}
              hasDivider
            />
          }
          content={
            <LayoutContent>
              <SkillProfile skills={skillsRow?.skillProfile ?? []} />
            </LayoutContent>
          }
        />
      </Dialog>
    </Stack>
  );
}

function SkillProfile({ skills }: { skills: ResumeLibraryRow["skillProfile"] }) {
  const known = new Set<string>(RESUME_SKILL_CATEGORIES);
  const extras = [...new Set(skills.map((skill) => skill.category))].filter(
    (category) => !known.has(category),
  );
  const categories = [...RESUME_SKILL_CATEGORIES, ...extras];
  return (
    <Stack gap={4}>
      {categories.map((category) => {
        const group = skills.filter((skill) => skill.category === category);
        if (!group.length) return null;
        const label =
          category in SKILL_CATEGORY_LABEL
            ? SKILL_CATEGORY_LABEL[category as ResumeSkillCategory]
            : category;
        return (
          <Stack key={category} gap={2}>
            <Text weight="semibold">{label}</Text>
            {group.map((skill) => (
              <HStack key={`${category}-${skill.name}`} hAlign="between">
                <Text>{skill.name}</Text>
                <Text color="secondary">{`Level ${skill.level}`}</Text>
              </HStack>
            ))}
          </Stack>
        );
      })}
    </Stack>
  );
}
