import assert from "node:assert/strict";
import test from "node:test";

import {
  configExecution,
  menuDefault,
  menuLeaves,
  parseConfig,
} from "../public/lib/config.js";
import { buildProgram, resolveBatchTarget } from "../public/lib/flow.js";

const source = (path, text) => ({ key: path.toLowerCase(), path, text });

const nestedConfig = source(
  "CONFIG.SYS",
  [
    "[menu]",
    "submenu=network,Network choices",
    "menudefault=network,5",
    "menucolor=15,1",
    "numlock=on",
    "[network]",
    "menuitem=full,Full network",
    "menuitem=minimal,Minimal network",
    "menudefault=full,3",
    "[common]",
    "device=HIMEM.SYS",
    "[full]",
    "include=base",
    "files=40",
    "[minimal]",
    "files=20",
    "[base]",
    "device=NET.SYS",
    "[common]",
    "lastdrive=Z",
  ].join("\n"),
);

test("nested DOS menus retain defaults, metadata, and every leaf", () => {
  const config = parseConfig(nestedConfig);
  assert.equal(config.diagnostics.length, 0);
  assert.equal(menuDefault(config), "full");
  assert.deepEqual(
    menuLeaves(config).map((choice) => choice.key),
    ["full", "minimal"],
  );
  assert.equal(config.menus.get("menu").color, "15,1");
  assert.equal(config.menus.get("menu").numlock, "on");
  assert.equal(config.menus.get("network").timeout, 3);
});

test("COMMON blocks run in file order and INCLUDE expands at its command", () => {
  const config = parseConfig(nestedConfig);
  assert.deepEqual(
    configExecution(config, "full").lines.map((line) => line.raw),
    ["device=HIMEM.SYS", "device=NET.SYS", "files=40", "lastdrive=Z"],
  );
});

test("invalid menu and INCLUDE graphs report missing targets and cycles", () => {
  const config = parseConfig(
    source(
      "CONFIG.SYS",
      [
        "[menu]",
        "submenu=other,Other",
        "[other]",
        "submenu=menu,Back",
        "menuitem=missing,Missing",
        "[one]",
        "include=two",
        "[two]",
        "include=one",
      ].join("\n"),
    ),
  );
  assert.deepEqual(
    config.diagnostics.map((item) => item.message),
    [
      "MENUITEM section not found: [missing]",
      "SUBMENU cycle: menu → other → menu",
      "INCLUDE cycle: one → two → one",
    ],
  );
});

test("DOS target resolution respects explicit paths and caller directories", () => {
  const sources = new Map([
    ["boot/autoexec.bat", source("boot/AUTOEXEC.BAT", "")],
    ["boot/tools/net.bat", source("boot/tools/NET.BAT", "")],
    ["other/net.bat", source("other/NET.BAT", "")],
  ]);
  assert.equal(
    resolveBatchTarget("tools\\NET.BAT", "boot/AUTOEXEC.BAT", sources),
    "boot/tools/net.bat",
  );
  assert.equal(
    resolveBatchTarget("missing/NET.BAT", "boot/AUTOEXEC.BAT", sources),
    "",
  );
  assert.equal(resolveBatchTarget("NET.BAT", "boot/AUTOEXEC.BAT", sources), "");
});

test("the program links CONFIG to AUTOEXEC and only reachable called files", () => {
  const sources = new Map(
    [
      nestedConfig,
      source(
        "AUTOEXEC.BAT",
        [
          "goto %CONFIG%",
          ":full",
          "call tools\\NET.BAT one",
          "goto end",
          ":minimal",
          "echo minimal",
          ":end",
          "exit",
        ].join("\n"),
      ),
      source("tools/NET.BAT", "echo network\nexit"),
      source("OTHER.BAT", "echo unreachable"),
    ].map((item) => [item.key, item]),
  );
  const program = buildProgram(sources);
  assert.match(program.entryId, /^menu:/);
  assert.equal(program.defaultConfig, "full");
  assert.deepEqual(
    [...new Set(program.nodes.map((node) => node.file))].sort(),
    ["AUTOEXEC.BAT", "CONFIG.SYS", "tools/NET.BAT"],
  );
  assert.ok(program.edges.some((item) => item.role === "boot"));
  assert.ok(program.edges.some((item) => item.role === "call"));
  assert.ok(program.edges.some((item) => item.role === "return"));
});
