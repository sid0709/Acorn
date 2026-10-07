"use client";

import {
  Avatar,
  Badge,
  Glyph,
  IconButton,
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
} from "sid-ui";

import type { GmailLabel, GmailProfile } from "@/lib/gmail/types";
import {
  labelTree,
  systemFolders,
  userFolder,
  type GmailFolder,
  type LabelNode,
} from "@/lib/gmail/views";

function countBadge(value: number, isSelected: boolean) {
  return value > 0 ? (
    <Badge label={String(value)} variant={isSelected ? "info" : "neutral"} />
  ) : undefined;
}

/**
 * The connected Gmail account (its own name and photo), Gmail's folders, and the
 * account's labels, nested the way Gmail nests "Parent/Child".
 */
export function MailboxSidebar({
  profile,
  labels,
  selected,
  onSelect,
  countFor,
  onManage,
}: {
  profile: GmailProfile;
  labels: GmailLabel[];
  selected: string;
  onSelect: (key: string) => void;
  /** The badge number for a folder, after mail opened here. */
  countFor: (folder: GmailFolder) => number;
  onManage: () => void;
}) {
  const name = profile.name || profile.email;
  const folders = systemFolders(labels);
  const tree = labelTree(labels);
  const byId = new Map(labels.map((label) => [label.id, label]));

  const renderLabel = (node: LabelNode) => {
    const unread = countFor(userFolder(node.label));
    return (
      <SideNavItem
        key={node.label.id}
        label={node.leaf}
        icon={<Glyph name="tag" />}
        isSelected={selected === node.label.id}
        onClick={() => onSelect(node.label.id)}
        endContent={countBadge(unread, selected === node.label.id)}
      >
        {node.children.length > 0 ? node.children.map(renderLabel) : undefined}
      </SideNavItem>
    );
  };

  return (
    <SideNav
      header={
        <SideNavHeading
          heading={name}
          subheading={profile.name ? profile.email : undefined}
          icon={<Avatar name={name} src={profile.picture || undefined} size={32} tooltip={false} />}
          headerEndContent={
            <IconButton
              label="Manage mailboxes"
              icon={<Glyph name="settings" />}
              variant="ghost"
              size="sm"
              onClick={onManage}
            />
          }
        />
      }
    >
      <SideNavSection title="Mail" isHeaderHidden>
        {folders.map((folder) => (
          <SideNavItem
            key={folder.key}
            label={folder.title}
            icon={<Glyph name={folder.glyph} />}
            isSelected={selected === folder.key}
            onClick={() => onSelect(folder.key)}
            endContent={
              folder.count && byId.has(folder.count.labelId)
                ? countBadge(countFor(folder), selected === folder.key)
                : undefined
            }
          />
        ))}
      </SideNavSection>
      {tree.length > 0 ? (
        <SideNavSection title="Labels">{tree.map(renderLabel)}</SideNavSection>
      ) : null}
    </SideNav>
  );
}
