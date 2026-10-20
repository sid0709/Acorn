import { usageTabKey } from "../tab-usage-key";

/** Every Run group's title starts with this, so a group of ours is told from one the person made. */
const RUN_GROUP_TITLE_PREFIX = "Acorn";
/** Characters of the tab's Acorn key shown in the group's title. */
const RUN_GROUP_HASH_LENGTH = 6;
const RUN_GROUP_COLORS: chrome.tabGroups.Color[] = [
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

const NO_GROUP = -1;

async function isRunGroup(groupId: number): Promise<boolean> {
  if (groupId === NO_GROUP) return false;
  const group = await chrome.tabGroups.get(groupId).catch(() => null);
  return Boolean(group?.title?.startsWith(RUN_GROUP_TITLE_PREFIX));
}

/**
 * Puts a tab a Run works on in a Chrome tab group with a random color, titled with the short
 * hash of the tab's Acorn key. A tab already in a Run group stays in it. Grouping is only
 * cosmetic, so a tab Chrome cannot group (a pinned tab, a closed one) is left as it is.
 */
export async function groupRunTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (await isRunGroup(tab.groupId)) return;
    const hash = (await usageTabKey(tabId)).replace(/-/g, "").slice(0, RUN_GROUP_HASH_LENGTH);
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, {
      title: `${RUN_GROUP_TITLE_PREFIX} ${hash}`,
      color: RUN_GROUP_COLORS[Math.floor(Math.random() * RUN_GROUP_COLORS.length)],
    });
  } catch {
    // Not groupable.
  }
}

/** A tab opened from a tab in a Run group joins that group, whether or not the run follows it. */
export function bindRunTabGrouping(): void {
  chrome.tabs.onCreated.addListener((tab) => {
    const { id, openerTabId } = tab;
    if (id == null || openerTabId == null) return;
    void (async () => {
      try {
        const opener = await chrome.tabs.get(openerTabId);
        if (!(await isRunGroup(opener.groupId))) return;
        await chrome.tabs.group({ tabIds: [id], groupId: opener.groupId });
      } catch {
        // Not groupable.
      }
    })();
  });
}
