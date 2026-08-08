import assert from "node:assert/strict";
import test from "node:test";

import {
  detectLineEnding,
  highlightSource,
  normalizeText,
  pathKey,
  serializeSource,
} from "../public/lib/source.js";

test("source paths and line endings are normalized without losing download style", () => {
  assert.equal(pathKey("ROOT\\DOS\\..\\AUTOEXEC.BAT"), "root/autoexec.bat");
  assert.deepEqual(detectLineEnding("one\r\ntwo\r\n"), {
    lineEnding: "CRLF",
    mixed: false,
  });
  assert.deepEqual(detectLineEnding("one\r\ntwo\n"), {
    lineEnding: "CRLF",
    mixed: true,
  });
  assert.equal(normalizeText("one\rtwo\r\nthree"), "one\ntwo\nthree");
  assert.equal(
    serializeSource({ text: "one\ntwo", lineEnding: "CR" }),
    "one\rtwo",
  );
});

test("syntax highlighting escapes source before adding a small token vocabulary", () => {
  const output = highlightSource(
    'if "%MODE%"=="TEST" goto done\n:done\nrem <unsafe>',
  );
  assert.match(output, /tok-command">if/);
  assert.match(output, /tok-variable">%MODE%/);
  assert.match(output, /tok-label">:done/);
  assert.match(output, /tok-comment">rem &lt;unsafe&gt;/);
  assert.doesNotMatch(output, /<unsafe>/);
});
