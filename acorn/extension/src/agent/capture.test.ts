import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SHOT_MAX_WIDTH, captureShot, jpegSize } from "./capture.ts";
import { fakeCdp } from "./fake-cdp.ts";

const metrics = (clientWidth: number, clientHeight: number, pageX = 0, pageY = 0) => ({
  cssVisualViewport: { pageX, pageY, clientWidth, clientHeight },
  cssContentSize: { width: clientWidth, height: clientHeight * 3 },
});

/** The header of a JPEG of this size: enough for its dimensions to be read, as base64. */
function jpegOf(width: number, height: number): string {
  const bytes = [
    0xff,
    0xd8, // start of image
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00, // JFIF
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01, // frame
    0xff,
    0xd9,
  ];
  return btoa(String.fromCharCode(...bytes));
}

describe("jpegSize", () => {
  it("reads the pixels from the frame header", () => {
    assert.deepEqual(jpegSize(jpegOf(2516, 1426)), { width: 2516, height: 1426 });
    assert.deepEqual(jpegSize(jpegOf(640, 480)), { width: 640, height: 480 });
  });

  it("says nothing about what is not a JPEG", () => {
    assert.equal(jpegSize("QUJD"), null);
    assert.equal(jpegSize("not base64 !!"), null);
  });
});

describe("captureShot on a screen with more device pixels than CSS pixels", () => {
  it("asks for an image that size and reports the size the image really has", async () => {
    // A Retina screen: a 1258 px wide page is 2516 device pixels. Asked for at scale 1 per
    // CSS pixel the clip would come out twice as large; dividing the ratio out gives 1258.
    const cdp = fakeCdp({
      "Page.getLayoutMetrics": metrics(1258, 713),
      "Runtime.evaluate": { result: { value: 2 } },
      "Page.captureScreenshot": (params) => {
        const clip = params?.clip as { width: number; height: number; scale: number };
        // What the browser does: device pixels = CSS pixels x scale x device ratio.
        return {
          data: jpegOf(
            Math.round(clip.width * clip.scale * 2),
            Math.round(clip.height * clip.scale * 2),
          ),
        };
      },
    });
    const shot = await captureShot(cdp);
    assert.equal(
      (cdp.of("Page.captureScreenshot")[0].params?.clip as { scale: number }).scale,
      0.5,
    );
    assert.deepEqual([shot.viewport.width, shot.viewport.height], [1258, 713]);
    assert.equal(shot.scale, 1);
  });

  it("trusts the image when it is not the size that was asked for", async () => {
    const cdp = fakeCdp({
      "Page.getLayoutMetrics": metrics(1000, 600, 0, 200),
      "Page.captureScreenshot": { data: jpegOf(2000, 1200) },
    });
    const shot = await captureShot(cdp);
    assert.deepEqual([shot.viewport.width, shot.viewport.height], [2000, 1200]);
    assert.equal(shot.scale, 2);
    assert.equal(shot.viewport.scrollY, 400);
    // A point in the image is a point on the page, whatever the image's size.
    assert.equal(500 / shot.scale, 250);
  });
});

describe("captureShot", () => {
  it("captures the visible page at its own size when it is narrow enough", async () => {
    const cdp = fakeCdp({
      "Page.getLayoutMetrics": metrics(1000, 700, 0, 300),
      "Page.captureScreenshot": { data: "QUJD" },
    });
    const shot = await captureShot(cdp);
    assert.equal(shot.dataUrl, "data:image/jpeg;base64,QUJD");
    assert.equal(shot.scale, 1);
    assert.deepEqual(shot.viewport, {
      width: 1000,
      height: 700,
      scrollX: 0,
      scrollY: 300,
      pageWidth: 1000,
      pageHeight: 2100,
    });
    const clip = cdp.of("Page.captureScreenshot")[0].params?.clip as Record<string, number>;
    assert.deepEqual([clip.x, clip.y, clip.width, clip.height, clip.scale], [0, 300, 1000, 700, 1]);
  });

  it("shrinks a wide page and reports every size in screenshot pixels", async () => {
    const cdp = fakeCdp({
      "Page.getLayoutMetrics": metrics(2560, 1280, 0, 640),
      "Page.captureScreenshot": { data: "QQ==" },
    });
    const shot = await captureShot(cdp);
    assert.equal(shot.scale, SHOT_MAX_WIDTH / 2560);
    assert.deepEqual([shot.viewport.width, shot.viewport.height], [1280, 640]);
    assert.equal(shot.viewport.scrollY, 320);
    assert.equal(shot.viewport.pageHeight, 1920);
    // A point in the screenshot divided by the scale is the point on the page.
    assert.equal(640 / shot.scale, 1280);
  });

  it("refuses a page with no visible area", async () => {
    const cdp = fakeCdp({ "Page.getLayoutMetrics": metrics(0, 0) });
    await assert.rejects(captureShot(cdp), /no visible area/);
  });

  it("asks again with the tab in front when the first shot fails", async () => {
    let calls = 0;
    const cdp = fakeCdp({
      "Page.getLayoutMetrics": metrics(800, 600),
      "Page.captureScreenshot": () => {
        calls += 1;
        if (calls === 1) throw new Error("no frame");
        return { data: "QQ==" };
      },
    });
    const shot = await captureShot(cdp);
    assert.equal(shot.dataUrl, "data:image/jpeg;base64,QQ==");
    assert.equal(cdp.of("Page.bringToFront").length, 1);
  });

  it("reports the first failure when the second also fails", async () => {
    const cdp = fakeCdp({
      "Page.getLayoutMetrics": metrics(800, 600),
      "Page.captureScreenshot": () => {
        throw new Error("no frame at all");
      },
    });
    await assert.rejects(captureShot(cdp), /no frame at all/);
  });
});
