import { createRequire } from "node:module";

import { expect, test } from "@playwright/test";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

test("loads, simulates, edits, and keeps actions fixed", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "BATFlow" })).toBeVisible();
  await expect(page.getByText("0.6.3", { exact: true })).toBeVisible();

  await page.locator("#fileInput").setInputFiles([
    {
      name: "AUTOEXEC.BAT",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "@echo off\r\nif exist C:\\NET goto network\r\necho Local\r\ngoto end\r\n:network\r\necho Network\r\n:end\r\necho Done\r\n",
      ),
    },
    {
      name: "CONFIG.SYS",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "[menu]\r\nmenuitem=network,Network\r\n[network]\r\ndos=high\r\n",
      ),
    },
  ]);

  await expect(page.locator(".file-item")).toHaveCount(2);
  await expect(page.locator("#currentPath")).toContainText("entry");
  await expect(page.locator(".flow-node")).not.toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fit graph" })).toBeVisible();
  await page.addScriptTag({ path: axePath });
  const graphViolations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(globalThis.document, {
      runOnly: ["wcag2a", "wcag2aa"],
    });
    return result.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact),
    );
  });
  expect(graphViolations).toEqual([]);
  if (testInfo.project.name === "firefox") {
    await expect(page).toHaveScreenshot("flow.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
  }
  await page.locator(".flow-node.decision select").selectOption("yes");
  await page.getByRole("button", { name: "Executed code" }).click();
  await expect(page.locator(".executed-code")).toContainText("echo Network");
  await expect(page.locator(".executed-code")).not.toContainText("echo Local");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.locator("#sourceEditor").fill("@echo off\nset MODE=TEST\n");
  await expect(page.locator("#currentPath")).toContainText("modified");
  await expect(page.locator("#sourceHighlight")).toContainText("MODE=TEST");
  await expect(page.locator("#downloadCurrent")).toBeEnabled();

  const pane = await page.locator(".command-pane").boundingBox();
  const actions = await page.locator(".session-actions").boundingBox();
  expect(actions.y + actions.height).toBeLessThanOrEqual(pane.y + pane.height);

  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(globalThis.document, {
      runOnly: ["wcag2a", "wcag2aa"],
    });
    return result.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact),
    );
  });
  expect(violations).toEqual([]);
});

test("anchors zoom and pans from graph blocks without trapping inputs", async ({
  page,
}) => {
  const center = (box) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  const expectSamePoint = (before, after) => {
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  };

  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "AUTOEXEC.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from(
      [
        "@echo off",
        'if "%MODE%"=="A_VERY_LONG_CONFIGURATION_NAME" goto end',
        ...Array.from(
          { length: 20 },
          (_, index) => `echo line ${String(index + 1).padStart(2, "0")}`,
        ),
        "mouse.com",
        ":end",
        "exit",
        "",
      ].join("\r\n"),
    ),
  });
  await expect(page.locator(".graph-controls output")).toHaveText("75%");

  const viewport = await page.locator(".graph-viewport").boundingBox();
  await page.mouse.move(viewport.x + 20, viewport.y + 20);
  await page.mouse.wheel(0, -100);
  await expect(page.locator(".graph-controls output")).toHaveText("85%");

  const endpoints = await page.locator(".flow-edge").evaluateAll((paths) =>
    paths.map((path) => {
      const coordinates = path
        .getAttribute("d")
        .match(/-?\d+(?:\.\d+)?/g)
        .map(Number);
      const length = path.getTotalLength();
      const start = path.getPointAtLength(0);
      const afterStart = path.getPointAtLength(8);
      const beforeEnd = path.getPointAtLength(length - 8);
      const end = path.getPointAtLength(length);
      return {
        start: { x: start.x, y: start.y },
        afterStart: { x: afterStart.x, y: afterStart.y },
        beforeEnd: { x: beforeEnd.x, y: beforeEnd.y },
        end: { x: end.x, y: end.y },
        startTail: coordinates[3] - coordinates[1],
        endTail: coordinates.at(-1) - coordinates.at(-3),
      };
    }),
  );
  for (const {
    start,
    afterStart,
    beforeEnd,
    end,
    startTail,
    endTail,
  } of endpoints) {
    expect(startTail).toBe(10);
    expect(endTail).toBe(10);
    expect(afterStart.x).toBeCloseTo(start.x, 1);
    expect(afterStart.y).toBeGreaterThan(start.y);
    expect(beforeEnd.x).toBeCloseTo(end.x, 1);
    expect(beforeEnd.y).toBeLessThan(end.y);
  }

  const node = page.locator(".flow-node.decision");
  let before = center(await node.boundingBox());
  await page.mouse.move(before.x, before.y);
  await page.mouse.wheel(0, -100);
  expectSamePoint(before, center(await node.boundingBox()));

  await node.click({ position: { x: 20, y: 20 } });
  before = center(await node.boundingBox());
  await page.getByRole("button", { name: "Zoom out" }).click();
  expectSamePoint(before, center(await node.boundingBox()));
  before = center(await node.boundingBox());
  await page.getByRole("button", { name: "Zoom in" }).click();
  expectSamePoint(before, center(await node.boundingBox()));
  before = center(await node.boundingBox());
  await page.getByRole("button", { name: "Actual size" }).click();
  expectSamePoint(before, center(await node.boundingBox()));

  const dragStart = await node.boundingBox();
  await page.mouse.move(dragStart.x + 20, dragStart.y + 20);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 100, dragStart.y + 60);
  await page.mouse.up();
  const dragged = await node.boundingBox();
  expect(dragged.x - dragStart.x).toBeCloseTo(80, 0);
  expect(dragged.y - dragStart.y).toBeCloseTo(40, 0);
  expect(await page.evaluate(() => globalThis.getSelection().toString())).toBe(
    "",
  );

  const cancelledTransform = await page
    .locator(".graph-scene")
    .getAttribute("style");
  await page.mouse.move(dragged.x + 20, dragged.y + 20);
  await page.mouse.down();
  await page.locator(".graph-viewport").dispatchEvent("pointercancel");
  await page.mouse.move(dragged.x + 60, dragged.y + 60);
  await page.mouse.up();
  expect(await page.locator(".graph-scene").getAttribute("style")).toBe(
    cancelledTransform,
  );

  const input = page.locator(".flow-node.decision input");
  const nodeBounds = await node.boundingBox();
  let inputBounds = await input.boundingBox();
  expect(inputBounds.y + inputBounds.height).toBeLessThanOrEqual(
    nodeBounds.y + nodeBounds.height,
  );
  await input.fill("abcdef");
  await input.selectText();
  expect(await input.evaluate((control) => control.selectionEnd)).toBe(6);
  const transform = await page.locator(".graph-scene").getAttribute("style");
  inputBounds = await input.boundingBox();
  await page.mouse.move(
    inputBounds.x + 5,
    inputBounds.y + inputBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    inputBounds.x + 50,
    inputBounds.y + inputBounds.height / 2,
  );
  await page.mouse.up();
  expect(await page.locator(".graph-scene").getAttribute("style")).toBe(
    transform,
  );

  await page.getByRole("button", { name: "Fit graph" }).click();
  const process = page
    .locator(".flow-node.process")
    .filter({ hasText: "echo line 01" });
  const processBounds = await process.boundingBox();
  const processInputBounds = await process.locator("input").boundingBox();
  expect(processInputBounds.y + processInputBounds.height).toBeLessThanOrEqual(
    processBounds.y + processBounds.height,
  );
  const source = process.locator(".node-source");
  expect(
    await source.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  const zoom = await page.locator(".graph-controls output").textContent();
  const sourceBounds = await source.boundingBox();
  await page.mouse.move(
    sourceBounds.x + sourceBounds.width / 2,
    sourceBounds.y + sourceBounds.height / 2,
  );
  await page.mouse.wheel(0, 200);
  await expect
    .poll(() => source.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await page.locator(".graph-controls output").textContent()).toBe(zoom);
  await source.evaluate(
    (element) => (element.scrollTop = element.scrollHeight),
  );
  await page.mouse.wheel(0, 200);
  await expect(page.locator(".graph-controls output")).not.toHaveText(zoom);

  await page.locator("#fileInput").setInputFiles({
    name: "AUTOEXEC.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from(`echo ${"X".repeat(500)}\r\n`),
  });
  const wideSource = page.locator(".flow-node.process .node-source");
  expect(
    await wideSource.evaluate(
      (element) =>
        element.scrollWidth > element.clientWidth &&
        element.scrollHeight === element.clientHeight,
    ),
  ).toBe(true);
  await expect(page.locator(".graph-controls output")).toHaveText("75%");
  const wideZoom = await page.locator(".graph-controls output").textContent();
  const wideBounds = await wideSource.boundingBox();
  await page.mouse.move(
    wideBounds.x + wideBounds.width / 2,
    wideBounds.y + wideBounds.height / 2,
  );
  const wheelAllowed = page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.addEventListener(
          "wheel",
          (event) => resolve(!event.defaultPrevented),
          { once: true },
        ),
      ),
  );
  await page.mouse.wheel(200, 0);
  expect(await wheelAllowed).toBe(true);
  expect(await page.locator(".graph-controls output").textContent()).toBe(
    wideZoom,
  );
  await page.mouse.wheel(0, -100);
  await expect(page.locator(".graph-controls output")).not.toHaveText(wideZoom);
});

test("fits a very tall graph below the manual zoom floor", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "AUTOEXEC.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from(
      [
        "@echo off",
        ...Array.from(
          { length: 60 },
          (_, index) => `if "%STEP${index + 1}%"=="1" goto end`,
        ),
        ":end",
        "exit",
        "",
      ].join("\r\n"),
    ),
  });

  await page.getByRole("button", { name: "Fit graph" }).click();
  const viewport = await page.locator(".graph-viewport").boundingBox();
  const first = await page.locator(".flow-node").first().boundingBox();
  const last = await page.locator(".flow-node").last().boundingBox();
  expect(first.y).toBeGreaterThanOrEqual(viewport.y);
  expect(last.y + last.height).toBeLessThanOrEqual(
    viewport.y + viewport.height,
  );
  expect(
    Number.parseInt(await page.locator(".graph-controls output").textContent()),
  ).toBeLessThan(25);
});

test("renders 2,000 lines within the desktop budget", async ({ page }) => {
  await page.goto("/");
  const source = Array.from(
    { length: 2000 },
    (_, index) => `echo line ${index + 1}`,
  ).join("\r\n");
  const start = await page.evaluate(() => performance.now());
  await page.locator("#fileInput").setInputFiles({
    name: "AUTOEXEC.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await expect(page.locator(".flow-node.process")).toBeVisible();
  const elapsed = await page.evaluate(
    (value) => performance.now() - value,
    start,
  );
  expect(elapsed).toBeLessThan(2000);
  const measures = await page.evaluate(() =>
    Object.fromEntries(
      [
        "batflow:program",
        "batflow:layout",
        "batflow:render",
        "batflow:simulate",
      ].map((name) => [
        name,
        performance.getEntriesByName(name).at(-1)?.duration,
      ]),
    ),
  );
  for (const duration of Object.values(measures)) {
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(duration).toBeLessThan(1000);
  }
});

test("places a shared exit below its late forward caller", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "AUTOEXEC.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from(
      '@echo off\r\nif "%EARLY%"=="1" goto exit\r\necho Stage one\r\nif "%NEXT%"=="1" goto middle\r\necho Stage two\r\n:middle\r\necho Near bottom\r\ngoto exit\r\n:exit\r\nexit\r\n',
    ),
  });

  const caller = await page.locator(".flow-node.jump").boundingBox();
  const exit = await page.locator(".flow-node.exit").boundingBox();
  expect(exit.y).toBeGreaterThan(caller.y);
  if (testInfo.project.name === "firefox") {
    await page.getByRole("button", { name: "Fit graph" }).click();
    await expect(page).toHaveScreenshot("source-order-layout.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
  }
});

test("reports and clears a confirmed infinite loop", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "AUTOEXEC.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from(":again\r\necho once\r\ngoto again\r\n"),
  });

  const warningNode = page.locator(".flow-node.infinite-loop");
  await expect(warningNode).toBeVisible();
  await expect(warningNode).toContainText("Infinite loop");
  const jumpEdge = page.locator(".flow-edge.jump");
  await expect(jumpEdge).toHaveClass(/nonlinear/);
  expect(
    await jumpEdge.evaluate((edge) => globalThis.getComputedStyle(edge).stroke),
  ).toBe("rgb(167, 139, 218)");
  const path = await page.locator(".flow-edge.jump").getAttribute("d");
  const coordinates = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const right = await page
    .locator(".flow-node")
    .evaluateAll((nodes) =>
      Math.max(
        ...nodes.map(
          (node) => Number.parseFloat(node.style.left) + node.offsetWidth,
        ),
      ),
    );
  const target = await page.locator(".flow-node.process").evaluate((node) => ({
    left: Number.parseFloat(node.style.left),
    width: node.offsetWidth,
  }));
  const pathBounds = await page.locator(".flow-edge.jump").evaluate((edge) => {
    const bounds = edge.getBBox();
    return { x: bounds.x, width: bounds.width };
  });
  expect(coordinates[2]).toBe(coordinates[0]);
  expect(coordinates[3] - coordinates[1]).toBe(10);
  expect(coordinates[6] - right).toBe(40);
  expect(coordinates[6]).toBeLessThan(
    Number(await page.locator(".edge-layer").getAttribute("width")),
  );
  expect(pathBounds.x + pathBounds.width).toBeCloseTo(coordinates[6], 1);
  expect(coordinates.at(-2)).toBe(target.left + target.width * 0.75);
  expect(coordinates.at(-1) - coordinates.at(-3)).toBe(10);
  expect(coordinates[4]).toBe(coordinates[0]);
  expect(coordinates[6]).toBe(coordinates[8]);
  expect(coordinates[8]).toBe(coordinates[10]);
  expect(coordinates[10]).toBe(coordinates[12]);
  expect(coordinates[14]).toBe(coordinates[16]);
  expect(coordinates[16]).toBe(coordinates[18]);
  expect(coordinates[5] - coordinates[1]).toBe(72);
  expect(
    await page.locator(".flow-edge.jump").evaluate((edge) => {
      const source = globalThis.document.querySelector(".flow-node.jump");
      const target = globalThis.document.querySelector(".flow-node.process");
      const rectangles = [source, target].map((node) => ({
        left: Number.parseFloat(node.style.left),
        right: Number.parseFloat(node.style.left) + node.offsetWidth,
        top: Number.parseFloat(node.style.top),
        bottom: Number.parseFloat(node.style.top) + node.offsetHeight,
      }));
      const length = edge.getTotalLength();
      for (let offset = 1; offset < length; offset += 2) {
        const point = edge.getPointAtLength(offset);
        if (
          rectangles.some(
            (box) =>
              point.x > box.left &&
              point.x < box.right &&
              point.y > box.top &&
              point.y < box.bottom,
          )
        )
          return false;
      }
      return true;
    }),
  ).toBe(true);
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(
      globalThis.document.querySelector(".flow-node.infinite-loop"),
      {
        runOnly: ["wcag2a", "wcag2aa"],
      },
    );
    return result.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact),
    );
  });
  expect(violations).toEqual([]);
  if (testInfo.project.name === "firefox") {
    await expect(page).toHaveScreenshot("infinite-loop-warning.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
  }

  await page.getByRole("button", { name: "Executed code" }).click();
  await expect(page.locator(".infinite-loop-warning")).toContainText(
    "Infinite loop detected. Simulation stopped after one cycle.",
  );
  await expect(
    page.locator(".executed-code tr").filter({ hasText: "echo once" }),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.locator("#sourceEditor").fill("echo done\n");
  await page.getByRole("button", { name: "Flow", exact: true }).click();
  await expect(page.locator(".flow-node.infinite-loop")).toHaveCount(0);
  await page.getByRole("button", { name: "Executed code" }).click();
  await expect(page.locator(".infinite-loop-warning")).toHaveCount(0);
});

test("routes returns through clear lanes and separates opposing flow", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "AUTOEXEC.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from(
      '@echo off\r\nif "%SIDE%"=="1" goto neighbor\r\n:again\r\necho once\r\ngoto again\r\n:neighbor\r\necho beside\r\ngoto again\r\n:done\r\nexit\r\n',
    ),
  });

  const paths = await page.locator(".flow-edge.jump").evaluateAll((edges) =>
    edges.map((edge) =>
      edge
        .getAttribute("d")
        .match(/-?\d+(?:\.\d+)?/g)
        .map(Number),
    ),
  );
  const target = await page
    .locator(".flow-node.process")
    .filter({ hasText: "echo once" })
    .evaluate((node) => ({
      left: Number.parseFloat(node.style.left),
      width: node.offsetWidth,
    }));
  const neighbor = await page
    .locator(".flow-node.process")
    .filter({ hasText: "echo beside" })
    .evaluate((node) => ({
      left: Number.parseFloat(node.style.left),
      width: node.offsetWidth,
    }));
  const sameColumn = paths.find(
    (coordinates) => coordinates[0] === target.left + target.width / 2,
  );
  const offset = paths.find(
    (coordinates) => coordinates[0] === neighbor.left + neighbor.width / 2,
  );
  expect(sameColumn[6]).toBe(target.left - 40);
  expect(sameColumn.at(-2)).toBe(target.left + target.width * 0.25);
  expect(offset[6]).toBe((target.left + target.width + neighbor.left) / 2);
  expect(offset.at(-2)).toBe(target.left + target.width * 0.75);

  await page.locator("#fileInput").setInputFiles({
    name: "AUTOEXEC.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from(
      ":target\r\necho target\r\n:middle\r\necho middle\r\n:source\r\ngoto %DEST%\r\n:g\r\nexit\r\n:f\r\nexit\r\n",
    ),
  });
  const sharedTarget = page
    .locator(".flow-node.process")
    .filter({ hasText: "echo target" });
  const targetId = await sharedTarget.getAttribute("data-node");
  const targetBox = await sharedTarget.evaluate((node) => ({
    left: Number.parseFloat(node.style.left),
    width: node.offsetWidth,
  }));
  const separated = await page
    .locator(`.flow-edge.case[data-edge*="->${targetId}:case"]`)
    .getAttribute("d");
  expect(separated.match(/-?\d+(?:\.\d+)?/g).map(Number)[6]).toBe(
    targetBox.left + targetBox.width + 52,
  );

  await page.locator("#fileInput").setInputFiles({
    name: "AUTOEXEC.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from(
      '@echo off\r\n:again\r\necho once\r\nif "%SIDE%"=="1" goto neighbor\r\ngoto again\r\n:neighbor\r\ngoto again\r\n',
    ),
  });
  expect(
    await page.locator(".flow-edge.jump").evaluateAll((edges) => {
      const blocks = [
        ...globalThis.document.querySelectorAll(".flow-node"),
      ].map((node) => ({
        left: Number.parseFloat(node.style.left),
        right: Number.parseFloat(node.style.left) + node.offsetWidth,
        top: Number.parseFloat(node.style.top),
        bottom: Number.parseFloat(node.style.top) + node.offsetHeight,
      }));
      return edges.every((edge) => {
        const length = edge.getTotalLength();
        for (let offset = 1; offset < length; offset += 2) {
          const point = edge.getPointAtLength(offset);
          if (
            blocks.some(
              (block) =>
                point.x > block.left &&
                point.x < block.right &&
                point.y > block.top &&
                point.y < block.bottom,
            )
          )
            return false;
        }
        return true;
      });
    }),
  ).toBe(true);

  await page.locator("#fileInput").setInputFiles({
    name: "AUTOEXEC.BAT",
    mimeType: "text/plain",
    buffer: Buffer.from("AUTOEXEC.BAT\r\n"),
  });
  expect(
    await page
      .locator(".flow-edge.transfer")
      .evaluate((edge) => edge.getBBox().y),
  ).toBeGreaterThanOrEqual(0);
});

test("shows a warning when a cycle executes no source rows", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles([
    {
      name: "AUTOEXEC.BAT",
      mimeType: "text/plain",
      buffer: Buffer.from(""),
    },
    {
      name: "CONFIG.SYS",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "[menu]\r\nsubmenu=other,Other\r\n[other]\r\nsubmenu=menu,Back\r\n",
      ),
    },
  ]);

  await expect(page.locator(".flow-node.infinite-loop")).toBeVisible();
  await page.getByRole("button", { name: "Executed code" }).click();
  await expect(page.locator(".infinite-loop-warning")).toContainText(
    "Infinite loop detected. Simulation stopped after one cycle.",
  );
  await expect(page.getByText("No execution yet")).toHaveCount(0);
});
