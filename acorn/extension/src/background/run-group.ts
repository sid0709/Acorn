import { usageTabKey } from "../tab-usage-key";

/** Every Run group's title starts with this, so a group of ours is told from one the person made. */
const RUN_GROUP_TITLE_PREFIX = "Acorn";
/** Characters of the tab's Acorn key shown in the group's title. */
const RUN_GROUP_HASH_LENGTH = 6;
const RUN_GROUP_COLORS: chrome.tabGroups.ColorEnum[] = [
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

/** How long a new tab waits for Chrome to say a page opened it before it counts as the person's own. */
const DERIVED_GRACE_MS = 1000;
/** How long the person's own new tab is watched for Chrome adding it to a Run group. */
const OWN_TAB_WATCH_MS = 3000;

/** Tabs a page opened (a link, window.open), by the signal only such tabs raise. */
const derivedTabs = new Set<number>();
/** The person's own new tabs (Cmd+T, +), kept out of Run groups while they are watched. */
const ownTabs = new Set<number>();

async function leaveRunGroup(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab && (await isRunGroup(tab.groupId)))
    await chrome.tabs.ungroup(tabId).catch(() => undefined);
}

/**
 * Only a tab a page of a Run group opened joins that group. A new tab the person opens raises no
 * navigation-target event, and Chrome still puts it beside the tab it was opened from, so it is
 * taken out of the group again.
 */
export function bindRunTabGrouping(): void {
  chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
    derivedTabs.add(details.tabId);
    void (async () => {
      try {
        const source = await chrome.tabs.get(details.sourceTabId);
        if (!(await isRunGroup(source.groupId))) return;
        await chrome.tabs.group({ tabIds: [details.tabId], groupId: source.groupId });
      } catch {
        // Not groupable.
      }
    })();
  });

  chrome.tabs.onCreated.addListener((tab) => {
    const { id } = tab;
    if (id == null) return;
    setTimeout(() => {
      if (derivedTabs.has(id)) return;
      ownTabs.add(id);
      void leaveRunGroup(id);
      setTimeout(() => ownTabs.delete(id), OWN_TAB_WATCH_MS);
    }, DERIVED_GRACE_MS);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.groupId != null && ownTabs.has(tabId)) void leaveRunGroup(tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    derivedTabs.delete(tabId);
    ownTabs.delete(tabId);
  });
}
