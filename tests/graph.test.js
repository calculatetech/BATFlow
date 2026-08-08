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
