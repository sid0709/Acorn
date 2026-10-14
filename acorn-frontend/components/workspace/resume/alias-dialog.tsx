"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogHeader,
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  TextInput,
} from "sid-ui";

const ALIAS_DIALOG_WIDTH = 480;

/**
 * Asks what a single picked file is called in the library. `onDecide` gets the trimmed alias,
 * or null when the person cancels. The file's own name is the starting point.
 */
export function AliasDialog({
  file,
  onDecide,
}: {
  file: File | null;
  onDecide: (alias: string | null) => void;
}) {
  return (
    <Dialog
      isOpen={file !== null}
      onOpenChange={(open) => {
        if (!open) onDecide(null);
      }}
      purpose="form"
      width={ALIAS_DIALOG_WIDTH}
    >
      {file ? <AliasForm key={file.name} file={file} onDecide={onDecide} /> : null}
    </Dialog>
  );
}

function AliasForm({ file, onDecide }: { file: File; onDecide: (alias: string | null) => void }) {
  const [alias, setAlias] = useState(file.name);
  const trimmed = alias.trim();
  const confirm = () => {
    if (trimmed) onDecide(trimmed);
  };

  return (
    <Layout
      height="auto"
      header={
        <DialogHeader
          title="Name this résumé"
          subtitle={`${file.name} is listed in your library, and shown when Acorn recommends it, under this alias.`}
          onOpenChange={() => onDecide(null)}
          hasDivider
        />
      }
      content={
        <LayoutContent>
          <TextInput
            label="Alias"
            description="For example fullstack-java-david.docx. Files saved under the same alias are kept together."
            value={alias}
            onChange={setAlias}
            onEnter={confirm}
            hasAutoFocus
            isRequired
          />
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider>
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="ghost" onClick={() => onDecide(null)} />
            <Button label="Upload" variant="primary" isDisabled={!trimmed} onClick={confirm} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
