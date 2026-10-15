"use client";

import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  CheckboxInput,
  Collapsible,
  Dialog,
  DialogHeader,
  FileUploader,
  Glyph,
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  ProgressBar,
  SectionCard,
  Selector,
  Stack,
  Text,
  TextInput,
  useToast,
} from "sid-ui";
import {
  analyzeLibraryFile,
  deleteLibraryFile,
  listLibrary,
  makeLibraryPrimary,
  uploadLibraryFile,
} from "@/lib/resume/api";
import {
  LIBRARY_KIND,
  RESUME_LIBRARY_ACCEPT,
  RESUME_LIBRARY_MAX_BYTES,
  RESUME_SKILL_CATEGORIES,
  type LibraryKind,
  type ResumeLibraryRow,
  type ResumeLibrarySource,
  type ResumeSkillCategory,
} from "@acorn/shared/resume-library";
import {
  RESUME_ANALYZE_CONCURRENCY,
  BULK_ALIAS_PREVIEW,
  RESUME_BULK_UPLOAD_CONCURRENCY,
  failureSummary,
  libraryUploadInput,
  resumesFromFolder,
  runPool,
  storedPdfText,
  type FolderResume,
} from "./library-batch";
import { AliasDialog } from "./alias-dialog";
import { LibraryCards, groupByStack } from "./library-cards";

const VIEWS: { value: ResumeLibrarySource; label: string }[] = [
  { value: "uploaded", label: "Uploaded" },
  { value: "generated", label: "Generated" },
];

const KINDS: { value: LibraryKind; label: string }[] = [
  { value: LIBRARY_KIND.resume, label: "Résumés" },
  { value: LIBRARY_KIND.coverLetter, label: "Cover letters" },
];

/** What one file of each kind is called in this page's copy. */
const KIND_NOUN: Record<LibraryKind, { one: string; many: string }> = {
  [LIBRARY_KIND.resume]: { one: "résumé", many: "résumés" },
  [LIBRARY_KIND.coverLetter]: { one: "cover letter", many: "cover letters" },
};

/** A row's kind; rows saved before kinds existed are résumés. */
const kindOf = (row: ResumeLibraryRow): LibraryKind => row.kind ?? LIBRARY_KIND.resume;

/** "1 résumé" / "3 résumés". */
const countOf = (count: number, kind: LibraryKind) =>
  `${count} ${count === 1 ? KIND_NOUN[kind].one : KIND_NOUN[kind].many}`;

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

type LibraryStart = Awaited<ReturnType<typeof listLibrary>>;

/** Uploaded files and résumés the generator saved, with folder upload and skill analysis. */
export function ResumeLibrary({ initial }: { initial: LibraryStart }) {
  const [rows, setRows] = useState<ResumeLibraryRow[]>(() =>
    initial.ok ? initial.data.resumes : [],
  );
  const [view, setView] = useState<ResumeLibrarySource>("uploaded");
  const [kind, setKind] = useState<LibraryKind>(LIBRARY_KIND.resume);
  /** The single file waiting for its alias, and the promise its uploader is awaiting. */
  const [aliasAsk, setAliasAsk] = useState<{
    file: File;
    decide: (alias: string | null) => void;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [stack, setStack] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState(initial.ok ? "" : initial.message);
  const [bulkPending, setBulkPending] = useState<FolderResume[] | null>(null);
  const [uploadProgress, setUploadProgress] = useState<BatchProgress | null>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState<BatchProgress | null>(null);
  const [deleteProgress, setDeleteProgress] = useState<BatchProgress | null>(null);
  const [stoppingAnalysis, setStoppingAnalysis] = useState(false);
  const [reanalyzeIds, setReanalyzeIds] = useState<string[] | null>(null);
  const [skillsRow, setSkillsRow] = useState<ResumeLibraryRow | null>(null);
  const bulkRef = useRef<HTMLInputElement>(null);
  const stopAnalyze = useRef(false);
  const toast = useToast();

  const busy = uploadProgress !== null || analyzeProgress !== null || deleteProgress !== null;

  const notify = (title: string, detail?: string, error = false) => {
    toast({
      type: error ? "error" : "info",
      isAutoHide: true,
      autoHideDuration: error ? 8000 : 3500,
      body: (
        <Stack gap={1}>
          <Text weight="semibold" color="inherit">
            {title}
          </Text>
          {detail ? (
            <Text type="supporting" color="inherit">
              {detail}
            </Text>
          ) : null}
        </Stack>
      ),
    });
  };

  const reload = async () => {
    const result = await listLibrary();
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRows(result.data.resumes);
  };

  useEffect(() => {
    if (initial.ok) return;
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
  }, [initial.ok]);

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
            ...(await libraryUploadInput(item.file, item.alias)),
            kind,
          });
          return result.ok ? null : { fileName: item.file.name, error: result.message };
        },
        (current, total) => setUploadProgress({ current, total }),
      );
      if (failed.length) {
        const summary = failureSummary("file(s) failed to upload", items.length, failed);
        setError(summary);
        notify("Upload finished with errors", summary, true);
      } else {
        notify(`Uploaded ${countOf(items.length, kind)}`);
      }
      await reload();
    } finally {
      setUploadProgress(null);
    }
  };

  /** One file: ask for its alias, then upload it. Throws so the uploader shows what went wrong. */
  const uploadOne = async (file: File) => {
    const alias = await new Promise<string | null>((decide) => setAliasAsk({ file, decide }));
    setAliasAsk(null);
    if (alias === null) throw new Error("Not uploaded.");
    setError("");
    const result = await uploadLibraryFile({
      ...(await libraryUploadInput(file, alias)),
      kind,
    });
    if (!result.ok) throw new Error(result.message);
    notify(`Uploaded ${alias}`);
    await reload();
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
    let finished = 0;
    try {
      const failed = await runPool(
        targets,
        RESUME_ANALYZE_CONCURRENCY,
        async (row) => {
          const text = await storedPdfText(row);
          const result = await analyzeLibraryFile(row.id, force, text || undefined);
          if (!result.ok) return { fileName: row.fileName, error: result.message };
          finished += 1;
          setRows((current) =>
            current.map((item) => (item.id === row.id ? result.data.resume : item)),
          );
          return null;
        },
        (current, total) => setAnalyzeProgress({ current, total }),
        () => stopAnalyze.current,
      );
      const stopped = stopAnalyze.current;
      setSelected([]);
      if (failed.length) {
        const summary = failureSummary(
          `${KIND_NOUN[kind].many} failed to analyze`,
          targets.length,
          failed,
        );
        setError(summary);
        notify("Analysis finished with errors", summary, true);
      } else if (stopped) {
        notify(
          finished === 0 ? "Analysis stopped" : `Analyzed ${countOf(finished, kind)}, then stopped`,
        );
      } else {
        notify(`Analyzed ${countOf(finished, kind)}`);
      }
      await reload();
    } finally {
      stopAnalyze.current = false;
      setStoppingAnalysis(false);
      setAnalyzeProgress(null);
    }
  };

  const removeSelected = async () => {
    const ids = [...selected];
    if (!ids.length || busy) return;
    const names = new Map(
      rows.filter((row) => ids.includes(row.id)).map((row) => [row.id, row.fileName]),
    );
    setError("");
    setSelected([]);
    setDeleteProgress({ current: 0, total: ids.length });
    try {
      const failed = await runPool(
        ids,
        RESUME_BULK_UPLOAD_CONCURRENCY,
        async (id) => {
          const result = await deleteLibraryFile(id);
          if (!result.ok) return { fileName: names.get(id) || id, error: result.message };
          setRows((current) => current.filter((row) => row.id !== id));
          return null;
        },
        (current, total) => setDeleteProgress({ current, total }),
      );
      const done = ids.length - failed.length;
      if (failed.length) {
        const summary = failureSummary("file(s) failed to delete", ids.length, failed);
        setError(summary);
        notify("Delete finished with errors", summary, true);
        await reload();
      } else {
        notify(`Deleted ${countOf(done, kind)}`);
      }
    } finally {
      setDeleteProgress(null);
    }
  };

  const startAnalyze = () => {
    const targets = rows.filter((row) => selected.includes(row.id) && row.source === "uploaded");
    if (!targets.length) {
      setError(`Select uploaded ${KIND_NOUN[kind].many} to analyze.`);
      return;
    }
    const ids = targets.map((row) => row.id);
    if (targets.some((row) => row.analyzed)) {
      setReanalyzeIds(ids);
      return;
    }
    void analyzeIds(ids, false);
  };

  /** Analyze only what is not analyzed yet, leaving the already analyzed files as they are. */
  const analyzeNewOnly = () => {
    const ids = (reanalyzeIds ?? []).filter((id) => !rows.find((row) => row.id === id)?.analyzed);
    setReanalyzeIds(null);
    if (ids.length) void analyzeIds(ids, false);
    else notify(`Everything selected is already analyzed`);
  };

  const act = async (run: () => Promise<{ ok: boolean; message?: string }>, done?: string) => {
    setError("");
    const result = await run();
    if (!result.ok) setError(result.message || "Couldn’t update the library.");
    else if (done) notify(done);
    await reload();
  };

  // Cover letters are only ever uploaded; the generator writes résumés.
  const shownView: ResumeLibrarySource = kind === LIBRARY_KIND.resume ? view : "uploaded";
  const ofKind = rows.filter((row) => kindOf(row) === kind);
  const stacks = ["all", ...new Set(ofKind.map((row) => row.title).filter(Boolean))];
  const query = search.trim().toLowerCase();
  const visible = ofKind.filter((row) => {
    if (row.source !== shownView) return false;
    if (stack !== "all" && row.title !== stack) return false;
    if (!query) return true;
    const skills = (row.skillProfile ?? []).map((skill) => skill.name).join(" ");
    return [row.fileName, row.title, row.extractedText, skills]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const visibleIds = visible.map((row) => row.id);
  const pickedVisible = visibleIds.filter((id) => selected.includes(id)).length;
  const bulkShown = bulkPending?.slice(0, BULK_ALIAS_PREVIEW) ?? [];
  const bulkMore = (bulkPending?.length ?? 0) - bulkShown.length;
  const alreadyAnalyzed = reanalyzeIds
    ? rows.filter((row) => reanalyzeIds.includes(row.id) && row.analyzed).length
    : 0;
  const reanalyzeTotal = reanalyzeIds?.length ?? 0;

  return (
    <Stack gap={4}>
      {error ? <Banner status="error" title="Library" description={error} /> : null}
      <SectionCard
        title="Upload"
        description={`Upload a ${KIND_NOUN[kind].one} for each type of role you apply to and give it an alias. Acorn picks the closest match automatically. Files saved under the same alias are kept together.`}
      >
        <Stack gap={3}>
          <HStack gap={3} wrap="wrap" vAlign="end">
            <Selector
              label="Library"
              value={kind}
              options={KINDS}
              isDisabled={busy}
              onChange={(value) => {
                setKind(value as LibraryKind);
                setSelected([]);
                setStack("all");
              }}
            />
          </HStack>
          <FileUploader
            label={kind === LIBRARY_KIND.resume ? "Résumé files" : "Cover letter files"}
            accept={RESUME_LIBRARY_ACCEPT}
            maxSize={RESUME_LIBRARY_MAX_BYTES}
            description="One file at a time. You name it after you pick it. To add many, use bulk upload."
            isMultiple={false}
            isDisabled={busy}
            upload={uploadOne}
          />
          {uploadProgress ? (
            <ProgressBar
              label={`Uploading ${KIND_NOUN[kind].many}`}
              value={uploadProgress.current}
              max={Math.max(uploadProgress.total, 1)}
              hasValueLabel
              formatValueLabel={(value, max) => `${value} of ${max}`}
            />
          ) : null}
          <Collapsible
            defaultIsOpen={false}
            trigger={
              <Text type="supporting" color="secondary">
                Advanced
              </Text>
            }
          >
            <Stack gap={2}>
              <Text type="supporting" color="secondary">
                Upload a whole folder at once. Each file&apos;s alias is its folders below the one
                you pick, then its name, in lowercase joined by dashes:
                Resume/FullStack/Java/David.docx becomes fullstack-java-david.docx.
              </Text>
              <HStack>
                <Button
                  label="Bulk upload"
                  variant="secondary"
                  icon={<Glyph name="folder" />}
                  isDisabled={busy}
                  onClick={() => bulkRef.current?.click()}
                />
              </HStack>
            </Stack>
          </Collapsible>
        </Stack>
      </SectionCard>
      <SectionCard
        title="Files"
        description={`Tick an alias to analyze its skills or remove it. Skills decide which ${KIND_NOUN[kind].one} each job gets.`}
      >
        <Stack gap={3}>
          <HStack gap={3} wrap="wrap" vAlign="end">
            {kind === LIBRARY_KIND.resume ? (
              <Selector
                label="View"
                value={view}
                options={VIEWS}
                onChange={(value) => {
                  setView(value as ResumeLibrarySource);
                  setSelected([]);
                }}
              />
            ) : null}
            <TextInput label="Search" value={search} onChange={setSearch} />
            <Selector
              label="Alias"
              value={stack}
              options={stacks.map((item) => ({
                value: item,
                label: item === "all" ? "All aliases" : item,
              }))}
              onChange={setStack}
            />
            {shownView === "uploaded" && visible.length > 0 ? (
              <CheckboxInput
                label={`Select all (${visible.length})`}
                value={
                  pickedVisible === 0
                    ? false
                    : pickedVisible === visibleIds.length
                      ? true
                      : "indeterminate"
                }
                isDisabled={busy}
                onChange={(checked) =>
                  setSelected(
                    checked
                      ? [...new Set([...selected, ...visibleIds])]
                      : selected.filter((id) => !visibleIds.includes(id)),
                  )
                }
              />
            ) : null}
            {shownView === "uploaded" && !deleteProgress ? (
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
                    onClick={() => void removeSelected()}
                  />
                </>
              )
            ) : null}
          </HStack>
          {analyzeProgress ? (
            <ProgressBar
              label={`Analyzing ${KIND_NOUN[kind].many}`}
              value={analyzeProgress.current}
              max={Math.max(analyzeProgress.total, 1)}
              hasValueLabel
              formatValueLabel={(value, max) => `${value} of ${max}`}
            />
          ) : null}
          {deleteProgress ? (
            <ProgressBar
              label={`Deleting ${KIND_NOUN[kind].many}`}
              value={deleteProgress.current}
              max={Math.max(deleteProgress.total, 1)}
              hasValueLabel
              formatValueLabel={(value, max) => `${value} of ${max}`}
            />
          ) : null}
          <LibraryCards
            groups={groupByStack(visible)}
            selected={selected}
            selectable={shownView === "uploaded"}
            busy={busy}
            empty={
              shownView === "generated"
                ? "No generated résumés yet."
                : `No uploaded ${KIND_NOUN[kind].many} yet.`
            }
            onSelect={setSelected}
            onMakeDefault={(row) => void act(async () => makeLibraryPrimary(row.id))}
            onRemove={(row) =>
              void act(async () => deleteLibraryFile(row.id), `Removed ${row.fileName}`)
            }
            onShowSkills={setSkillsRow}
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
              subtitle={`${countOf(bulkPending?.length ?? 0, kind)} found. Each is saved under its path inside the folder as the alias.`}
              onOpenChange={() => setBulkPending(null)}
              hasDivider
            />
          }
          content={
            <LayoutContent>
              <HStack gap={2} wrap="wrap">
                {bulkShown.map((item) => (
                  <Badge key={item.alias} label={item.alias} />
                ))}
                {bulkMore > 0 ? <Badge label={`+${bulkMore} more`} /> : null}
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
      <AliasDialog file={aliasAsk?.file ?? null} onDecide={(alias) => aliasAsk?.decide(alias)} />
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
              title="Some are already analyzed"
              subtitle={`${alreadyAnalyzed} of ${countOf(reanalyzeTotal, kind)} selected ${alreadyAnalyzed === 1 ? "is" : "are"} already analyzed. Skip them, or analyze them again and replace their skill scores.`}
              onOpenChange={() => setReanalyzeIds(null)}
              hasDivider
            />
          }
          content={
            <LayoutContent>
              <Text color="secondary">
                Skills are read from the file&apos;s text and saved on each file in the library.
              </Text>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} hAlign="end">
                <Button label="Cancel" variant="ghost" onClick={() => setReanalyzeIds(null)} />
                <Button label="Skip analyzed" variant="secondary" onClick={analyzeNewOnly} />
                <Button
                  label="Analyze all again"
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
              subtitle="Skills extracted from this file, with a category and a level from 2 to 5."
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
