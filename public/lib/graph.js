const NODE_WIDTH = 320;
const NODE_HEIGHT = 154;
const X_GAP = 80;
const Y_GAP = 82;

export function layoutGraph(program) {
  const nodesById = new Map(program.nodes.map((node) => [node.id, node]));
  const outgoing = new Map(program.nodes.map((node) => [node.id, []]));
  for (const edge of program.edges) outgoing.get(edge.from)?.push(edge);

  const rank = new Map();
  const queue = program.entryId ? [program.entryId] : [];
  if (program.entryId) rank.set(program.entryId, 0);
  while (queue.length) {
    const id = queue.shift();
    for (const edge of outgoing.get(id) || []) {
      if (!nodesById.has(edge.to) || rank.has(edge.to)) continue;
      rank.set(edge.to, rank.get(id) + 1);
      queue.push(edge.to);
    }
  }
  let lastRank = Math.max(0, ...rank.values());
  for (const node of program.nodes) {
    if (!rank.has(node.id)) rank.set(node.id, ++lastRank);
  }

  const rows = new Map();
  for (const node of program.nodes) {
    const row = rank.get(node.id);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(node);
  }
  const widest = Math.max(1, ...[...rows.values()].map((row) => row.length));
  const width = widest * (NODE_WIDTH + X_GAP) + X_GAP;
  const positions = new Map();
  for (const [row, nodes] of [...rows].sort(
    ([left], [right]) => left - right,
  )) {
    const rowWidth = nodes.length * NODE_WIDTH + (nodes.length - 1) * X_GAP;
    const start = (width - rowWidth) / 2;
    nodes.forEach((node, column) => {
      positions.set(node.id, {
        x: start + column * (NODE_WIDTH + X_GAP),
        y: 46 + row * (NODE_HEIGHT + Y_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });
  }
  return {
    positions,
    width,
    height: 92 + rows.size * (NODE_HEIGHT + Y_GAP),
  };
}

function element(name, className, text = "") {
  const result = document.createElement(name);
  result.className = className;
  result.textContent = text;
  return result;
}

function graphNode(node, position) {
  const article = element("article", `flow-node ${node.kind}`);
  article.dataset.node = node.id;
  article.tabIndex = 0;
  article.style.left = `${position.x}px`;
  article.style.top = `${position.y}px`;
  article.style.width = `${position.width}px`;
  article.style.height = `${position.height}px`;
  const title = element("div", "node-title", node.kind.replace("-", " "));
  const location = element(
    "span",
    "node-location",
    node.startLine ? `${node.file}:${node.startLine}` : node.file,
  );
  title.append(location);
  const labels = node.labels?.length
    ? element(
        "div",
        "node-labels",
        node.labels.map((label) => `:${label}`).join("  "),
      )
    : null;
  const source = element(
    "pre",
    "node-source",
    node.lines?.join("\n") ||
      (node.kind === "start" ? "Start" : node.kind === "end" ? "End" : ""),
  );
  article.append(title);
  if (labels) article.append(labels);
  article.append(source);
  return article;
}

function edgePath(from, to) {
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height;
  const endX = to.x + to.width / 2;
  const endY = to.y;
  if (endY > startY) {
    const middle = startY + (endY - startY) / 2;
    return `M ${startX} ${startY} C ${startX} ${middle}, ${endX} ${middle}, ${endX} ${endY}`;
  }
  const side = Math.max(from.x + from.width, to.x + to.width) + 34;
  return `M ${startX} ${startY} C ${side} ${startY + 30}, ${side} ${endY - 30}, ${endX} ${endY}`;
}

export function mountGraph(root, program) {
  root.replaceChildren();
  if (!program.entryId || !program.nodes.length) {
    const empty = element("div", "placeholder");
    empty.append(
      element("strong", "", "No batch entry found"),
      element("span", "", "Open a BAT file or set one as the entry."),
    );
    root.append(empty);
    return;
  }

  const layout = layoutGraph(program);
  const viewport = element("div", "graph-viewport");
  const scene = element("div", "graph-scene");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const layer = element("div", "node-layer");
  const controls = element("div", "graph-controls");
  svg.setAttribute("class", "edge-layer");
  svg.setAttribute("width", layout.width);
  svg.setAttribute("height", layout.height);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>';
  for (const edge of program.edges) {
    const from = layout.positions.get(edge.from);
    const to = layout.positions.get(edge.to);
    if (!from || !to) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", edgePath(from, to));
    path.setAttribute("class", `flow-edge ${edge.role}`);
    path.setAttribute("marker-end", "url(#arrow)");
    path.dataset.edge = edge.id;
    svg.append(path);
  }
  for (const node of program.nodes)
    layer.append(graphNode(node, layout.positions.get(node.id)));
  scene.style.width = `${layout.width}px`;
  scene.style.height = `${layout.height}px`;
  scene.append(svg, layer);
  viewport.append(scene);

  let scale = 1;
  let x = 0;
  let y = 0;
  const apply = () => {
    scene.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    controls.querySelector("output").value = `${Math.round(scale * 100)}%`;
  };
  const fit = () => {
    scale = Math.min(
      1,
      (root.clientWidth - 48) / layout.width,
      (root.clientHeight - 48) / layout.height,
    );
    x = (root.clientWidth - layout.width * scale) / 2;
    y = 24;
    apply();
  };
  for (const [label, title, action] of [
    ["−", "Zoom out", () => (scale = Math.max(0.25, scale - 0.1))],
    ["+", "Zoom in", () => (scale = Math.min(2, scale + 0.1))],
    ["100", "Actual size", () => ((scale = 1), (x = 24), (y = 24))],
    ["Fit", "Fit graph", fit],
  ]) {
    const button = element("button", "", label);
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", () => {
      action();
      apply();
    });
    controls.append(button);
  }
  controls.append(element("output", "", "100%"));
  let drag = null;
  viewport.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".flow-node")) return;
    drag = { x: event.clientX - x, y: event.clientY - y };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!drag) return;
    x = event.clientX - drag.x;
    y = event.clientY - drag.y;
    apply();
  });
  viewport.addEventListener("pointerup", () => (drag = null));
  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      scale = Math.min(
        2,
        Math.max(0.25, scale + (event.deltaY < 0 ? 0.1 : -0.1)),
      );
      apply();
    },
    { passive: false },
  );
  root.append(viewport, controls);
  requestAnimationFrame(fit);
}
