import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { whenTabLoaded, whenTabNavigated } from "../src/tab-load.ts";

type Updated = (id: number, info: chrome.tabs.TabChangeInfo) => void;
type Removed = (id: number) => void;

/** chrome.tabs as far as a load wait reads it: a tab's status, and the updated and removed events. */
class FakeTabs {
  status: "loading" | "complete" = "complete";
  missing = false;
  private readonly updated = new Set<Updated>();
  private readonly removed = new Set<Removed>();

  readonly onUpdated = {
    addListener: (fn: Updated) => this.updated.add(fn),
    removeListener: (fn: Updated) => this.updated.delete(fn),
  };

  readonly onRemoved = {
    addListener: (fn: Removed) => this.removed.add(fn),
    removeListener: (fn: Removed) => this.removed.delete(fn),
  };

  get(tabId: number): Promise<{ id: number; status: string }> {
    return this.missing
      ? Promise.reject(new Error(`No tab with id: ${tabId}.`))
      : Promise.resolve({ id: tabId, status: this.status });
  }

  update(tabId: number, info: chrome.tabs.TabChangeInfo): void {
    for (const fn of [...this.updated]) fn(tabId, info);
  }

  remove(tabId: number): void {
    for (const fn of [...this.removed]) fn(tabId);
  }

  get listeners(): number {
    return this.updated.size + this.removed.size;
  }
}

const TAB = 7;
const OTHER_TAB = 8;
const LONG = 5_000;

describe("waiting for a tab to load", () => {
  let tabs: FakeTabs;
  const realChrome = (globalThis as { chrome?: unknown }).chrome;

  beforeEach(() => {
    tabs = new FakeTabs();
    (globalThis as { chrome?: unknown }).chrome = { tabs };
  });

  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = realChrome;
  });

  it("is over at once when the page is already loaded", async () => {
    assert.equal(await whenTabLoaded(TAB, LONG), true);
    assert.equal(tabs.listeners, 0);
  });

  it("ends when the page says it finished, and listens no more", async () => {
    tabs.status = "loading";
    const wait = whenTabLoaded(TAB, LONG);
    await Promise.resolve();
    tabs.update(OTHER_TAB, { status: "complete" });
    tabs.update(TAB, { status: "complete" });
    assert.equal(await wait, true);
    assert.equal(tabs.listeners, 0);
  });

  it("says so when the tab is closed first", async () => {
    tabs.status = "loading";
    const wait = whenTabLoaded(TAB, LONG);
    await Promise.resolve();
    tabs.remove(TAB);
    assert.equal(await wait, false);
    assert.equal(tabs.listeners, 0);
  });

  it("says so when the tab is already gone", async () => {
    tabs.missing = true;
    assert.equal(await whenTabLoaded(TAB, LONG), false);
  });

  it("gives up waiting when the page never says it finished", async () => {
    tabs.status = "loading";
    assert.equal(await whenTabLoaded(TAB, 20), true);
    assert.equal(tabs.listeners, 0);
  });
});

describe("waiting for the page a navigation leads to", () => {
  let tabs: FakeTabs;
  const realChrome = (globalThis as { chrome?: unknown }).chrome;

  beforeEach(() => {
    tabs = new FakeTabs();
    (globalThis as { chrome?: unknown }).chrome = { tabs };
  });

  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = realChrome;
  });

  it("does not take the page left behind for the one ahead", async () => {
    let settled = false;
    const wait = whenTabNavigated(TAB, LONG).then((result) => {
      settled = true;
      return result;
    });
    // The old page still reports complete, and may even say so again, before the navigation begins.
    await Promise.resolve();
    tabs.update(TAB, { status: "complete" });
    await Promise.resolve();
    assert.equal(settled, false);
    tabs.update(TAB, { status: "loading", url: "https://jobs.example/verify?token=1" });
    tabs.update(TAB, { status: "complete" });
    assert.equal(await wait, true);
    assert.equal(tabs.listeners, 0);
  });

  it("takes a new address as the start of the navigation", async () => {
    const wait = whenTabNavigated(TAB, LONG);
    await Promise.resolve();
    tabs.update(TAB, { url: "https://jobs.example/verified" });
    tabs.update(TAB, { status: "complete" });
    assert.equal(await wait, true);
  });

  it("says so when the tab is closed on the way", async () => {
    const wait = whenTabNavigated(TAB, LONG);
    await Promise.resolve();
    tabs.update(TAB, { status: "loading" });
    tabs.remove(TAB);
    assert.equal(await wait, false);
    assert.equal(tabs.listeners, 0);
  });

  it("gives up waiting when the navigation never finishes", async () => {
    assert.equal(await whenTabNavigated(TAB, 20), true);
    assert.equal(tabs.listeners, 0);
  });
});
