import assert from "node:assert/strict";
import test from "node:test";

import { layoutGraph } from "../public/lib/graph.js";

test("branches share a row and loops route back through a complete 2D layout", () => {
  const program = {
    entryId: "start",
    nodes: ["start", "decision", "left", "right", "end"].map((id) => ({ id })),
    edges: [
      { from: "start", to: "decision" },
      { from: "decision", to: "left" },
      { from: "decision", to: "right" },
      { from: "left", to: "decision" },
      { from: "left", to: "end" },
      { from: "right", to: "end" },
    ],
  };

  const layout = layoutGraph(program);
  assert.equal(layout.positions.get("left").y, layout.positions.get("right").y);
  assert.notEqual(
    layout.positions.get("left").x,
    layout.positions.get("right").x,
  );
  assert.ok(layout.positions.get("end").y > layout.positions.get("decision").y);
});

test("a shared forward target follows its deepest same-file caller", () => {
  const nodes = [
    ["start", 0],
    ["decision", 1],
    ["next", 2],
    ["late-call", 178],
    ["exit", 179],
    ["end", 180],
  ].map(([id, startLine]) => ({ id, file: "AUTOEXEC.BAT", startLine }));
  const program = {
    entryId: "start",
    nodes,
    edges: [
      { from: "start", to: "decision" },
      { from: "decision", to: "next" },
      { from: "decision", to: "exit" },
      { from: "next", to: "late-call" },
      { from: "late-call", to: "exit" },
      { from: "exit", to: "end" },
    ],
  };

  const layout = layoutGraph(program);
  assert.ok(
    layout.positions.get("exit").y > layout.positions.get("late-call").y,
  );
});

test("fall-through stays ordered while a backward GOTO target stays above", () => {
  const nodes = [
    ["start", 0],
    ["first-jump", 1],
    ["upper", 3],
    ["lower", 5],
    ["back-jump", 6],
    ["end", 7],
  ].map(([id, startLine]) => ({ id, file: "AUTOEXEC.BAT", startLine }));
  const program = {
    entryId: "start",
    nodes,
    edges: [
      { from: "start", to: "first-jump" },
      { from: "first-jump", to: "lower" },
      { from: "upper", to: "lower" },
      { from: "lower", to: "back-jump" },
      { from: "back-jump", to: "upper" },
    ],
  };

  const layout = layoutGraph(program);
  assert.ok(layout.positions.get("upper").y < layout.positions.get("lower").y);
  assert.ok(
    layout.positions.get("upper").y < layout.positions.get("back-jump").y,
  );
  assert.equal(
    layout.positions.get("upper").y - layout.positions.get("first-jump").y,
    layout.positions.get("lower").y - layout.positions.get("upper").y,
  );
  assert.ok(
    layout.height >=
      Math.max(
        ...[...layout.positions.values()].map(
          (position) => position.y + position.height,
        ),
      ),
  );
});
