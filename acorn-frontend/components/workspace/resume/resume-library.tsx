"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  FileUploader,
  Glyph,
  HStack,
  IconButton,
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
  type ResumeLibraryRow,
  type ResumeLibrarySource,
} from "@acorn/shared/resume-library";

const VIEWS: { value: ResumeLibrarySource; label: string }[] = [
  { value: "uploaded", label: "Uploaded" },
  { value: "generated", label: "Generated" },
];

function fileBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  });
}

/** Uploaded files and résumés the generator saved, with search and analyze. */
export function ResumeLibrary() {
  const [rows, setRows] = useState<ResumeLibraryRow[]>([]);
  const [view, setView] = useState<ResumeLibrarySource>("uploaded");
  const [search, setSearch] = useState("");
  const [stack, setStack] = useState("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  const upload = async (files: File[]) => {
    setBusy(true);
    setError("");
    for (const file of files) {
      const result = await uploadLibraryFile({
        fileName: file.name,
        title: file.name.replace(/\.[^.]+$/, ""),
        contentBase64: await fileBase64(file),
      });
      if (!result.ok) {
        setError(result.message);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    await reload();
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
    return [row.fileName, row.title, row.extractedText].join(" ").toLowerCase().includes(query);
  });

  const columns: TableColumn<ResumeLibraryRow>[] = [
    {
      key: "fileName",
      header: "File",
      render: (item) => (
        <HStack gap={2} vAlign="center">
          <Glyph name="file" />
          <Stack gap={0}>
            <Text weight="semibold">{item.fileName}</Text>
            <Text type="supporting" color="secondary">
              {item.title}
            </Text>
          </Stack>
          {item.isPrimary ? <Badge label="Default" variant="blue" /> : null}
          {item.analyzed ? <Badge label="Analyzed" variant="green" /> : null}
        </HStack>
      ),
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
          {item.source === "uploaded" && !item.analyzed ? (
            <Button
              label="Analyze"
              variant="ghost"
              size="sm"
              onClick={() => void act(async () => analyzeLibraryFile(item.id))}
            />
          ) : null}
          {item.isPrimary ? null : (
            <Button
              label="Make default"
              variant="ghost"
              size="sm"
              onClick={() => void act(async () => makeLibraryPrimary(item.id))}
            />
          )}
          <IconButton
            label={`Remove ${item.fileName}`}
            icon={<Glyph name="trash" />}
            variant="ghost"
            size="sm"
            onClick={() => void act(async () => deleteLibraryFile(item.id))}
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
        description="PDF, Word, or text. Analyze a file before Recommend can match it."
      >
        <FileUploader
          label="Résumé files"
          accept={RESUME_LIBRARY_ACCEPT}
          maxSize={RESUME_LIBRARY_MAX_BYTES}
          maxFiles={8}
          isDisabled={busy}
          onChange={(files) => void upload(files)}
        />
      </SectionCard>
      <SectionCard title="Files" description="Uploaded résumés and the ones Generate saved.">
        <Stack gap={3}>
          <HStack gap={3} wrap="wrap">
            <Selector
              label="View"
              value={view}
              options={VIEWS}
              onChange={(value) => setView(value as ResumeLibrarySource)}
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
          </HStack>
          <Table
            caption="Resume library"
            variant="plain"
            columns={columns}
            rows={visible}
            rowKey={(item) => item.id}
            empty={view === "generated" ? "No generated résumés yet." : "No uploaded files yet."}
          />
        </Stack>
      </SectionCard>
    </Stack>
  );
}
