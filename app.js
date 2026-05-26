const STORAGE_KEY = "knowledge-map-canvas-state-v1";
const MAPS_KEY = "knowledge-map-canvas-maps-v1";
const WORLD = { width: 3200, height: 2200, cx: 1600, cy: 1100 };
const NODE_WIDTH = 238;
const ROOT_WIDTH = 250;
const DEFAULT_VERTICAL_GAP = 26;
const DEFAULT_HORIZONTAL_GAP = 452;
const LEGACY_DEFAULT_VERTICAL_GAP = 28;
const LEGACY_DEFAULT_HORIZONTAL_GAP = 260;
const ANIMATION_MS = 80;
const BRANCH_COLORS = [
  "#2f80ed",
  "#e24a68",
  "#0e9f6e",
  "#b7791f",
  "#7c3aed",
  "#008a9a",
  "#d14375",
  "#3f7f2d",
];

const sampleTree = {
  id: "root",
  text: "Knowledge Map Canvas",
  collapsed: false,
  children: [
    {
      id: "capture",
      text: "情報を取り込む",
      collapsed: false,
      children: [
        { id: "capture-text", text: "文章やメモを貼り付ける", children: [] },
        { id: "capture-outline", text: "アウトライン形式で整理", children: [] },
        { id: "capture-json", text: "JSONとして保存できる", children: [] },
      ],
    },
    {
      id: "explore",
      text: "動的に読む",
      collapsed: false,
      children: [
        { id: "explore-collapse", text: "枝を開閉して粒度を変える", children: [] },
        { id: "explore-search", text: "検索で関係ノードを強調", children: [] },
        { id: "explore-zoom", text: "ズームとパンで全体を見る", children: [] },
      ],
    },
    {
      id: "edit",
      text: "その場で編集",
      collapsed: false,
      children: [
        { id: "edit-title", text: "ノード内の文字を直接変更", children: [] },
        { id: "edit-add", text: "子ノードや隣ノードを追加", children: [] },
        { id: "edit-color", text: "枝ごとに色を自動設定", children: [] },
      ],
    },
  ],
};

const initialLibrary = loadLibrary();
const initialSettings = normalizeSettings(initialLibrary.active.settings);

const state = {
  tree: clone(initialLibrary.active.tree),
  mapId: initialLibrary.active.id,
  mapName: initialLibrary.active.name,
  maps: initialLibrary.maps,
  selectedId: "root",
  zoom: 0.86,
  pan: { x: 0, y: 0 },
  maxDepth: initialSettings.maxDepth,
  horizontalSpacing: initialSettings.horizontalSpacing,
  verticalSpacing: initialSettings.verticalSpacing,
  search: "",
  flashId: null,
  removingId: null,
  undoStack: [],
  redoStack: [],
  positions: new Map(),
  visibleIds: new Set(),
  edgeList: [],
};

let removeTimer = null;

const els = {
  viewport: document.getElementById("canvasViewport"),
  world: document.getElementById("canvasWorld"),
  edgeLayer: document.getElementById("edgeLayer"),
  nodeLayer: document.getElementById("nodeLayer"),
  outlineInput: document.getElementById("outlineInput"),
  exportOutput: document.getElementById("exportOutput"),
  selectionLabel: document.getElementById("selectionLabel"),
  statusText: document.getElementById("statusText"),
  searchInput: document.getElementById("searchInput"),
  depthSlider: document.getElementById("depthSlider"),
  horizontalSpacingSlider: document.getElementById("horizontalSpacingSlider"),
  verticalSpacingSlider: document.getElementById("verticalSpacingSlider"),
  mapSelect: document.getElementById("mapSelect"),
  markdownFileInput: document.getElementById("markdownFileInput"),
  nodeDetailTitle: document.getElementById("nodeDetailTitle"),
  nodeNoteInput: document.getElementById("nodeNoteInput"),
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix = "node") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeNode(node) {
  return {
    id: node.id || makeId(),
    text: String(node.text || "新しいノード"),
    memo: String(node.memo || ""),
    collapsed: Boolean(node.collapsed),
    children: Array.isArray(node.children) ? node.children.map(normalizeNode) : [],
  };
}

function loadLibrary() {
  try {
    const savedMaps = localStorage.getItem(MAPS_KEY);
    if (savedMaps) {
      const parsed = JSON.parse(savedMaps);
      const maps = Array.isArray(parsed.maps) ? parsed.maps.map(normalizeMapItem) : [];
      if (maps.length) {
        const active = maps.find((map) => map.id === parsed.activeId) || maps[0];
        return { active, maps };
      }
    }

    const legacy = localStorage.getItem(STORAGE_KEY);
    const tree = legacy ? normalizeNode(JSON.parse(legacy)) : clone(sampleTree);
    const active = makeMapItem("最初のマップ", tree);
    return { active, maps: [active] };
  } catch {
    const active = makeMapItem("最初のマップ", clone(sampleTree));
    return { active, maps: [active] };
  }
}

function defaultSettings() {
  return {
    maxDepth: 8,
    horizontalSpacing: DEFAULT_HORIZONTAL_GAP,
    verticalSpacing: DEFAULT_VERTICAL_GAP,
  };
}

function normalizeSettings(settings = {}) {
  settings = settings || {};
  const horizontalSpacing = Number(settings.horizontalSpacing);
  const verticalSpacing = Number(settings.verticalSpacing);
  const shouldMigrateLegacySpacing =
    horizontalSpacing === LEGACY_DEFAULT_HORIZONTAL_GAP && verticalSpacing === LEGACY_DEFAULT_VERTICAL_GAP;
  return {
    maxDepth: Number(settings.maxDepth) || 8,
    horizontalSpacing:
      shouldMigrateLegacySpacing || !Number.isFinite(horizontalSpacing) ? DEFAULT_HORIZONTAL_GAP : horizontalSpacing,
    verticalSpacing:
      shouldMigrateLegacySpacing || !Number.isFinite(verticalSpacing) ? DEFAULT_VERTICAL_GAP : verticalSpacing,
  };
}

function currentSettings() {
  return {
    maxDepth: state.maxDepth,
    horizontalSpacing: state.horizontalSpacing,
    verticalSpacing: state.verticalSpacing,
  };
}

function makeMapItem(name, tree = clone(sampleTree), settings = defaultSettings()) {
  return {
    id: makeId("map"),
    name,
    tree: normalizeNode(tree),
    settings: normalizeSettings(settings),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeMapItem(item) {
  return {
    id: item.id || makeId("map"),
    name: String(item.name || "無題のマップ"),
    tree: normalizeNode(item.tree || clone(sampleTree)),
    settings: normalizeSettings(item.settings),
    updatedAt: item.updatedAt || new Date().toISOString(),
  };
}

function saveTree() {
  let current = state.maps.find((map) => map.id === state.mapId);
  if (!current) {
    current = makeMapItem(state.mapName || state.tree.text || "無題のマップ", state.tree);
    current.id = state.mapId || current.id;
    state.mapId = current.id;
    state.maps.push(current);
  }
  current.name = state.mapName || state.tree.text || "無題のマップ";
  current.tree = normalizeNode(state.tree);
  current.settings = currentSettings();
  current.updatedAt = new Date().toISOString();
  localStorage.setItem(MAPS_KEY, JSON.stringify({ activeId: state.mapId, maps: state.maps }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tree));
  updateMapSelect();
}

function captureSnapshot() {
  return {
    mapId: state.mapId,
    mapName: state.mapName,
    tree: clone(state.tree),
    selectedId: state.selectedId,
    maxDepth: state.maxDepth,
    horizontalSpacing: state.horizontalSpacing,
    verticalSpacing: state.verticalSpacing,
    search: state.search,
  };
}

function pushHistory(snapshot = captureSnapshot()) {
  const last = state.undoStack[state.undoStack.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return;
  state.undoStack.push(snapshot);
  if (state.undoStack.length > 80) state.undoStack.shift();
  state.redoStack = [];
}

function restoreSnapshot(snapshot) {
  window.clearTimeout(removeTimer);
  state.mapId = snapshot.mapId;
  state.mapName = snapshot.mapName;
  state.tree = normalizeNode(snapshot.tree);
  state.selectedId = snapshot.selectedId || state.tree.id;
  state.maxDepth = snapshot.maxDepth || 8;
  state.horizontalSpacing = snapshot.horizontalSpacing || DEFAULT_HORIZONTAL_GAP;
  state.verticalSpacing = snapshot.verticalSpacing || DEFAULT_VERTICAL_GAP;
  state.search = snapshot.search || "";
  state.flashId = null;
  state.removingId = null;
  els.searchInput.value = state.search;
  els.depthSlider.value = state.maxDepth;
  els.horizontalSpacingSlider.value = state.horizontalSpacing;
  els.verticalSpacingSlider.value = state.verticalSpacing;
  els.outlineInput.value = toMarkdown(state.tree).join("\n");
  els.exportOutput.value = toMarkdown(state.tree).join("\n");
  render();
}

function undo() {
  if (!state.undoStack.length) {
    els.statusText.textContent = "戻せる操作はありません。";
    return;
  }
  const current = captureSnapshot();
  const previous = state.undoStack.pop();
  state.redoStack.push(current);
  restoreSnapshot(previous);
  els.statusText.textContent = "Undoしました。";
}

function redo() {
  if (!state.redoStack.length) {
    els.statusText.textContent = "やり直せる操作はありません。";
    return;
  }
  const current = captureSnapshot();
  const next = state.redoStack.pop();
  state.undoStack.push(current);
  restoreSnapshot(next);
  els.statusText.textContent = "Redoしました。";
}

function findNode(id, node = state.tree, parent = null) {
  if (node.id === id) return { node, parent };
  for (const child of node.children) {
    const result = findNode(id, child, node);
    if (result) return result;
  }
  return null;
}

function walk(node, visitor, depth = 0, parent = null, branchIndex = 0) {
  visitor(node, depth, parent, branchIndex);
  node.children.forEach((child, index) => walk(child, visitor, depth + 1, node, depth === 0 ? index : branchIndex));
}

function getVisibleChildren(node, depth) {
  if (node.collapsed || depth >= state.maxDepth) return [];
  return node.children;
}

function measureSubtree(node, depth = 0) {
  const children = getVisibleChildren(node, depth);
  if (!children.length) return 86;
  return children.reduce((sum, child) => sum + measureSubtree(child, depth + 1), 0) + Math.max(0, children.length - 1) * state.verticalSpacing;
}

function layoutTree() {
  state.positions.clear();
  state.visibleIds.clear();
  state.edgeList = [];

  const rootSpan = measureSubtree(state.tree);
  placeNode(state.tree, WORLD.cx, WORLD.cy - rootSpan / 2 + rootSpan / 2, 0, 0, null);
}

function placeNode(node, x, y, depth, branchIndex, parent) {
  const color = depth === 0 ? "#1f2937" : BRANCH_COLORS[branchIndex % BRANCH_COLORS.length];
  const width = depth === 0 ? ROOT_WIDTH : NODE_WIDTH;
  state.positions.set(node.id, { x, y, depth, color, branchIndex, width });
  state.visibleIds.add(node.id);
  if (parent) {
    state.edgeList.push({ from: parent.id, to: node.id, color });
  }

  const children = getVisibleChildren(node, depth);
  if (!children.length) return;

  const total = children.reduce((sum, child) => sum + measureSubtree(child, depth + 1), 0) + (children.length - 1) * state.verticalSpacing;
  let cursor = y - total / 2;
  children.forEach((child, index) => {
    const span = measureSubtree(child, depth + 1);
    const childY = cursor + span / 2;
    const direction = depth === 0 ? (index % 2 === 0 ? 1 : -1) : x >= WORLD.cx ? 1 : -1;
    const childX = depth === 0 ? WORLD.cx + direction * state.horizontalSpacing : x + direction * state.horizontalSpacing;
    const nextBranch = depth === 0 ? index : branchIndex;
    placeNode(child, childX, childY, depth + 1, nextBranch, node);
    cursor += span + state.verticalSpacing;
  });
}

function pathForEdge(from, to) {
  const fromSide = to.x >= from.x ? from.width / 2 : -from.width / 2;
  const toSide = to.x >= from.x ? -to.width / 2 : to.width / 2;
  const startX = from.x + fromSide;
  const endX = to.x + toSide;
  const curve = Math.max(82, Math.abs(endX - startX) * 0.42);
  const c1x = startX + (to.x >= from.x ? curve : -curve);
  const c2x = endX - (to.x >= from.x ? curve : -curve);
  return `M ${startX} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${endX} ${to.y}`;
}

function edgeKey(edge) {
  return `${edge.from}->${edge.to}`;
}

function render() {
  const previousPositions = new Map(state.positions);
  const previousEdges = new Set(state.edgeList.map(edgeKey));
  layoutTree();
  els.nodeLayer.textContent = "";
  els.edgeLayer.textContent = "";
  els.edgeLayer.setAttribute("viewBox", `0 0 ${WORLD.width} ${WORLD.height}`);

  const fragment = document.createDocumentFragment();
  const edgeFragment = document.createDocumentFragment();
  const matches = getSearchMatches();
  const hasSearch = state.search.trim().length > 0;

  state.edgeList.forEach((edge) => {
    const from = state.positions.get(edge.from);
    const to = state.positions.get(edge.to);
    if (!from || !to) return;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathForEdge(from, to));
    const className = edgeClass(edge, matches, hasSearch) + (previousEdges.has(edgeKey(edge)) ? "" : " is-entering");
    path.setAttribute("class", className);
    path.setAttribute("pathLength", "1");
    path.style.setProperty("--branch", edge.color);
    edgeFragment.appendChild(path);
  });

  walk(state.tree, (node) => {
    const pos = state.positions.get(node.id);
    if (!pos) return;
    const nodeEl = document.createElement("article");
    nodeEl.className = nodeClass(node, pos, matches, hasSearch);
    nodeEl.dataset.id = node.id;
    nodeEl.style.left = `${pos.x}px`;
    nodeEl.style.top = `${pos.y}px`;
    nodeEl.style.setProperty("--branch", pos.color);
    nodeEl.style.setProperty("--node-width", `${pos.depth === 0 ? ROOT_WIDTH : NODE_WIDTH}px`);
    applyNodeMotion(nodeEl, pos, previousPositions.get(node.id));

    const title = document.createElement("div");
    title.className = "node-title";
    title.contentEditable = "true";
    title.spellcheck = false;
    title.textContent = node.text;
    title.setAttribute("role", "textbox");
    title.setAttribute("aria-label", "Node text");

    const actions = document.createElement("div");
    actions.className = "node-actions";

    const addChildButton = makeNodeButton("node-add-child", "+", "子ノードを追加");
    const deleteButton = makeNodeButton("node-delete", "×", "このノードを削除");
    const toggle = makeNodeButton(
      `node-toggle${node.children.length ? "" : " is-empty"}`,
      node.collapsed ? "▸" : "▾",
      node.collapsed ? "展開" : "折りたたみ",
    );

    if (node.id === state.tree.id) {
      deleteButton.disabled = true;
    }

    actions.append(addChildButton, deleteButton, toggle);
    nodeEl.append(title, actions);
    fragment.appendChild(nodeEl);
  });

  els.edgeLayer.appendChild(edgeFragment);
  els.nodeLayer.appendChild(fragment);
  bindRenderedEvents();
  updateTransform();
  updateLabels();
  saveTree();
  clearFlashAfterAnimation();
}

function applyNodeMotion(nodeEl, pos, previous) {
  if (!previous) {
    nodeEl.classList.add("is-entering");
    return;
  }

  const dx = previous.x - pos.x;
  const dy = previous.y - pos.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 3 || nodeEl.classList.contains("is-new") || nodeEl.classList.contains("is-removing")) return;

  const rotation = Math.max(-5, Math.min(5, dx / 70));
  const stretch = Math.min(1.06, 1 + distance / 5000);
  nodeEl.classList.add("is-moving");
  nodeEl.style.setProperty("--move-x", `${dx}px`);
  nodeEl.style.setProperty("--move-y", `${dy}px`);
  nodeEl.style.setProperty("--move-rotate", `${rotation}deg`);
  nodeEl.style.setProperty("--move-scale", stretch.toFixed(3));
}

function makeNodeButton(className, label, title) {
  const button = document.createElement("button");
  button.className = `node-action ${className}`;
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.textContent = label;
  return button;
}

function nodeClass(node, pos, matches, hasSearch) {
  const classes = ["mind-node"];
  if (pos.depth === 0) classes.push("root");
  if (node.id === state.selectedId) classes.push("is-selected");
  if (node.id === state.flashId) classes.push("is-new");
  if (node.id === state.removingId) classes.push("is-removing");
  if (matches.has(node.id)) classes.push("is-match");
  if (hasSearch && !matches.has(node.id) && !isAncestorOfMatch(node, matches)) classes.push("is-muted");
  return classes.join(" ");
}

function clearFlashAfterAnimation() {
  if (!state.flashId) return;
  const id = state.flashId;
  window.setTimeout(() => {
    if (state.flashId !== id) return;
    state.flashId = null;
    const nodeEl = document.querySelector(`.mind-node[data-id="${CSS.escape(id)}"]`);
    nodeEl?.classList.remove("is-new");
  }, ANIMATION_MS);
}

function edgeClass(edge, matches, hasSearch) {
  const classes = ["edge-path"];
  if (edge.from === state.selectedId || edge.to === state.selectedId) classes.push("is-selected");
  if (hasSearch) {
    const from = findNode(edge.from)?.node;
    const to = findNode(edge.to)?.node;
    const relatedToMatch =
      matches.has(edge.from) ||
      matches.has(edge.to) ||
      (from && isAncestorOfMatch(from, matches)) ||
      (to && isAncestorOfMatch(to, matches));
    if (!relatedToMatch) classes.push("is-muted");
  }
  return classes.join(" ");
}

function getSearchMatches() {
  const matches = new Set();
  const query = state.search.trim().toLowerCase();
  if (!query) return matches;
  walk(state.tree, (node) => {
    if (node.text.toLowerCase().includes(query)) matches.add(node.id);
  });
  return matches;
}

function isAncestorOfMatch(node, matches) {
  if (matches.has(node.id)) return true;
  return node.children.some((child) => isAncestorOfMatch(child, matches));
}

function bindRenderedEvents() {
  document.querySelectorAll(".mind-node").forEach((nodeEl) => {
    const id = nodeEl.dataset.id;
    const title = nodeEl.querySelector(".node-title");
    const toggle = nodeEl.querySelector(".node-toggle");
    const addChildButton = nodeEl.querySelector(".node-add-child");
    const deleteButton = nodeEl.querySelector(".node-delete");
    let editSnapshot = null;
    let editRecorded = false;

    nodeEl.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      selectNode(id);
    });

    title.addEventListener("focus", () => {
      editSnapshot = captureSnapshot();
      editRecorded = false;
    });

    title.addEventListener("input", () => {
      const found = findNode(id);
      if (!found) return;
      if (!editRecorded) {
        pushHistory(editSnapshot || captureSnapshot());
        editRecorded = true;
      }
      found.node.text = title.textContent.trim() || "無題";
      updateLabels();
      saveTree();
    });

    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        title.blur();
      }
    });

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const found = findNode(id);
      if (!found || !found.node.children.length) return;
      pushHistory();
      found.node.collapsed = !found.node.collapsed;
      render();
    });

    addChildButton.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedId = id;
      addChild();
    });

    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (deleteButton.disabled) return;
      state.selectedId = id;
      deleteSelected();
    });
  });
}

function selectNode(id) {
  state.selectedId = id;
  updateLabels();
  paintSelection();
}

function paintSelection() {
  document.querySelectorAll(".mind-node").forEach((nodeEl) => {
    nodeEl.classList.toggle("is-selected", nodeEl.dataset.id === state.selectedId);
  });
  document.querySelectorAll(".edge-path").forEach((path, index) => {
    const edge = state.edgeList[index];
    path.classList.toggle("is-selected", edge && (edge.from === state.selectedId || edge.to === state.selectedId));
  });
}

function updateLabels() {
  const found = findNode(state.selectedId);
  const selectedText = found ? found.node.text : "未選択";
  els.selectionLabel.textContent = selectedText;
  els.statusText.textContent = `${state.mapName} / ${state.visibleIds.size}件を表示中。編集内容は自動保存されます。`;
  updateNodeDetailPanel(found?.node);
}

function updateNodeDetailPanel(node) {
  if (!els.nodeDetailTitle || !els.nodeNoteInput) return;
  els.nodeDetailTitle.textContent = node ? node.text : "未選択";
  els.nodeNoteInput.disabled = !node;
  if (document.activeElement !== els.nodeNoteInput) {
    els.nodeNoteInput.value = node?.memo || "";
  }
}

function updateTransform() {
  els.world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  document.getElementById("zoomResetButton").textContent = `${Math.round(state.zoom * 100)}%`;
}

function fitToView() {
  const rect = els.viewport.getBoundingClientRect();
  const positions = [...state.positions.values()];
  if (!positions.length) return;
  const minX = Math.min(...positions.map((p) => p.x)) - 180;
  const maxX = Math.max(...positions.map((p) => p.x)) + 180;
  const minY = Math.min(...positions.map((p) => p.y)) - 120;
  const maxY = Math.max(...positions.map((p) => p.y)) + 120;
  const mapWidth = maxX - minX;
  const mapHeight = maxY - minY;
  state.zoom = Math.min(1.1, Math.max(0.35, Math.min(rect.width / mapWidth, rect.height / mapHeight) * 0.92));
  state.pan.x = (rect.width - mapWidth * state.zoom) / 2 - minX * state.zoom;
  state.pan.y = (rect.height - mapHeight * state.zoom) / 2 - minY * state.zoom;
  updateTransform();
}

function optimizeLayout() {
  pushHistory();
  const rect = els.viewport.getBoundingClientRect();
  const stats = getLayoutStats(state.tree);
  const usableWidth = Math.max(640, rect.width * 0.86);
  const usableHeight = Math.max(420, rect.height * 0.78);
  const depthSteps = Math.max(1, stats.maxDepth);
  const leafSlots = Math.max(1, stats.leafCount - 1);
  const nodeHeight = 76;

  const horizontal = clamp(Math.round(usableWidth / (depthSteps + 1.4)), 240, 420);
  const vertical = clamp(Math.round((usableHeight - stats.leafCount * nodeHeight) / leafSlots), 18, 72);

  state.horizontalSpacing = horizontal;
  state.verticalSpacing = vertical;
  els.horizontalSpacingSlider.value = horizontal;
  els.verticalSpacingSlider.value = vertical;
  render();
  requestAnimationFrame(fitToView);
  els.statusText.textContent = `レイアウトを最適化しました。横 ${horizontal} / 縦 ${vertical}`;
}

function getLayoutStats(node, depth = 0) {
  const children = getVisibleChildren(node, depth);
  if (!children.length) {
    return { maxDepth: depth, leafCount: 1, visibleCount: 1 };
  }
  return children.reduce(
    (stats, child) => {
      const childStats = getLayoutStats(child, depth + 1);
      return {
        maxDepth: Math.max(stats.maxDepth, childStats.maxDepth),
        leafCount: stats.leafCount + childStats.leafCount,
        visibleCount: stats.visibleCount + childStats.visibleCount,
      };
    },
    { maxDepth: depth, leafCount: 0, visibleCount: 1 },
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function addChild() {
  const found = findNode(state.selectedId);
  if (!found) return;
  pushHistory();
  found.node.collapsed = false;
  const child = normalizeNode({ text: "新しいアイデア", children: [] });
  found.node.children.push(child);
  state.selectedId = child.id;
  state.flashId = child.id;
  render();
}

function addSibling() {
  const found = findNode(state.selectedId);
  if (!found || !found.parent) return;
  pushHistory();
  const sibling = normalizeNode({ text: "新しいトピック", children: [] });
  const index = found.parent.children.findIndex((child) => child.id === found.node.id);
  found.parent.children.splice(index + 1, 0, sibling);
  state.selectedId = sibling.id;
  state.flashId = sibling.id;
  render();
}

function deleteSelected() {
  const found = findNode(state.selectedId);
  if (!found || !found.parent) return;
  pushHistory();
  const targetId = state.selectedId;
  state.removingId = targetId;
  document.querySelector(`.mind-node[data-id="${CSS.escape(targetId)}"]`)?.classList.add("is-removing");
  window.clearTimeout(removeTimer);
  removeTimer = window.setTimeout(() => {
    const current = findNode(targetId);
    if (!current || !current.parent) {
      state.removingId = null;
      render();
      return;
    }
    current.parent.children = current.parent.children.filter((child) => child.id !== targetId);
    state.selectedId = current.parent.id;
    state.removingId = null;
    render();
  }, ANIMATION_MS);
}

function toggleSelected() {
  const found = findNode(state.selectedId);
  if (!found || !found.node.children.length) return;
  pushHistory();
  found.node.collapsed = !found.node.collapsed;
  render();
}

function parseOutline(text) {
  return parseMapDocument(text).tree;
}

function parseMapDocument(text) {
  const extracted = extractMarkdownState(text);
  const trimmed = extracted.text.trim();
  if (!trimmed) return { tree: clone(sampleTree), settings: extracted.settings };
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (parsed.tree) {
      return {
        tree: normalizeNode(parsed.tree),
        settings: parsed.settings ? normalizeSettings(parsed.settings) : extracted.settings,
      };
    }
    return { tree: normalizeNode(parsed), settings: extracted.settings };
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  "))
    .filter((line) => line.trim().length && !line.trim().startsWith("<!--"));

  const root = normalizeNode({ text: lines[0].replace(/^[-*#\s]+/, ""), children: [] });
  const stack = [{ indent: -1, node: root }];

  lines.slice(1).forEach((line) => {
    const indent = line.match(/^\s*/)[0].length;
    const textValue = line.trim().replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "");
    const node = normalizeNode({ text: textValue, children: [] });
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  });

  if (extracted.metadata?.nodes) applyNodeMetadata(root, extracted.metadata.nodes);
  return { tree: root, settings: extracted.metadata?.settings ? normalizeSettings(extracted.metadata.settings) : null };
}

function toMarkdown(node, options = {}) {
  const lines = toMarkdownLines(node);
  if (!options.includeMeta) return lines;
  return [makeStateComment(), "", ...lines];
}

function toMarkdownLines(node, depth = 0) {
  const prefix = depth === 0 ? "# " : `${"  ".repeat(depth - 1)}- `;
  return [prefix + node.text, ...node.children.flatMap((child) => toMarkdownLines(child, depth + 1))];
}

function prettyOutline(node, depth = 0) {
  const prefix = depth === 0 ? "" : `${"  ".repeat(depth - 1)}- `;
  return [prefix + node.text, ...node.children.flatMap((child) => prettyOutline(child, depth + 1))];
}

function makeStateComment() {
  const metadata = {
    version: 1,
    settings: currentSettings(),
    nodes: collectNodeMetadata(state.tree),
  };
  return `<!-- kmc:${encodeBase64Unicode(JSON.stringify(metadata))} -->`;
}

function collectNodeMetadata(node, path = []) {
  const key = path.join(".");
  const nodes = {
    [key]: {
      collapsed: Boolean(node.collapsed),
      memo: node.memo || "",
    },
  };
  node.children.forEach((child, index) => {
    Object.assign(nodes, collectNodeMetadata(child, [...path, index]));
  });
  return nodes;
}

function applyNodeMetadata(node, metadata, path = []) {
  const item = metadata[path.join(".")];
  if (item) {
    node.collapsed = Boolean(item.collapsed);
    node.memo = String(item.memo || "");
  }
  node.children.forEach((child, index) => applyNodeMetadata(child, metadata, [...path, index]));
}

function extractMarkdownState(text) {
  const match = text.match(/<!--\s*kmc:([A-Za-z0-9+/=_-]+)\s*-->/);
  if (!match) return { text, metadata: null, settings: null };
  try {
    const metadata = JSON.parse(decodeBase64Unicode(match[1]));
    return {
      text: text.replace(match[0], "").trim(),
      metadata,
      settings: normalizeSettings(metadata.settings),
    };
  } catch {
    return { text: text.replace(match[0], "").trim(), metadata: null, settings: null };
  }
}

function encodeBase64Unicode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeBase64Unicode(text) {
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function updateMapSelect() {
  if (!els.mapSelect) return;
  els.mapSelect.textContent = "";
  state.maps.forEach((map) => {
    const option = document.createElement("option");
    option.value = map.id;
    option.textContent = map.name;
    els.mapSelect.appendChild(option);
  });
  els.mapSelect.value = state.mapId;
  const deleteButton = document.getElementById("deleteMapButton");
  if (deleteButton) deleteButton.disabled = state.maps.length <= 1;
}

function setActiveMap(map, shouldFit = true, resetHistory = true) {
  state.mapId = map.id;
  state.mapName = map.name;
  state.tree = normalizeNode(map.tree);
  const settings = normalizeSettings(map.settings);
  state.maxDepth = settings.maxDepth;
  state.horizontalSpacing = settings.horizontalSpacing;
  state.verticalSpacing = settings.verticalSpacing;
  state.selectedId = state.tree.id;
  state.flashId = null;
  state.removingId = null;
  state.search = "";
  if (resetHistory) {
    state.undoStack = [];
    state.redoStack = [];
  }
  els.searchInput.value = "";
  els.depthSlider.value = state.maxDepth;
  els.horizontalSpacingSlider.value = state.horizontalSpacing;
  els.verticalSpacingSlider.value = state.verticalSpacing;
  els.outlineInput.value = toMarkdown(state.tree).join("\n");
  render();
  if (shouldFit) requestAnimationFrame(fitToView);
}

function createBlankTree(name) {
  return normalizeNode({
    id: makeId("root"),
    text: name || "新しいマップ",
    collapsed: false,
    children: [],
  });
}

function fileBaseName(fileName) {
  return fileName.replace(/\.[^.]+$/, "") || "読み込みマップ";
}

function safeFileName(name) {
  return String(name || "mind-map")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

async function openMarkdownFile(file) {
  if (!file) return;
  const text = await file.text();
  const parsed = parseMapDocument(text);
  const map = makeMapItem(fileBaseName(file.name), parsed.tree, parsed.settings || defaultSettings());
  state.maps.push(map);
  setActiveMap(map);
  els.exportOutput.value = toMarkdown(state.tree).join("\n");
}

async function saveMarkdownFile() {
  const markdown = toMarkdown(state.tree, { includeMeta: true }).join("\n");
  const fileName = `${safeFileName(state.mapName || state.tree.text)}.md`;
  if ("showSaveFilePicker" in window) {
    const handle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(markdown);
    await writable.close();
    els.statusText.textContent = `${fileName} を保存しました。`;
    return;
  }

  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  els.statusText.textContent = `${fileName} を保存しました。`;
}

function wireControls() {
  document.getElementById("sampleButton").addEventListener("click", () => {
    els.outlineInput.value = toMarkdown(sampleTree).join("\n");
  });

  document.getElementById("importButton").addEventListener("click", () => {
    try {
      const parsed = parseMapDocument(els.outlineInput.value);
      pushHistory();
      state.tree = parsed.tree;
      const settings = parsed.settings ? normalizeSettings(parsed.settings) : currentSettings();
      state.maxDepth = settings.maxDepth;
      state.horizontalSpacing = settings.horizontalSpacing;
      state.verticalSpacing = settings.verticalSpacing;
      els.depthSlider.value = state.maxDepth;
      els.horizontalSpacingSlider.value = state.horizontalSpacing;
      els.verticalSpacingSlider.value = state.verticalSpacing;
      state.selectedId = state.tree.id;
      state.mapName = state.mapName || state.tree.text;
      render();
      fitToView();
    } catch (error) {
      els.statusText.textContent = `反映に失敗しました: ${error.message}`;
    }
  });

  document.getElementById("formatButton").addEventListener("click", () => {
    const markdown = toMarkdown(state.tree, { includeMeta: true }).join("\n");
    els.outlineInput.value = markdown;
    els.exportOutput.value = markdown;
  });

  let noteSnapshot = null;
  let noteRecorded = false;
  els.nodeNoteInput.addEventListener("focus", () => {
    noteSnapshot = captureSnapshot();
    noteRecorded = false;
  });

  els.nodeNoteInput.addEventListener("input", () => {
    const found = findNode(state.selectedId);
    if (!found) return;
    if (!noteRecorded) {
      pushHistory(noteSnapshot || captureSnapshot());
      noteRecorded = true;
    }
    found.node.memo = els.nodeNoteInput.value;
    saveTree();
  });

  els.mapSelect.addEventListener("change", () => {
    const selectedMapId = els.mapSelect.value;
    saveTree();
    const next = state.maps.find((map) => map.id === selectedMapId);
    if (next) setActiveMap(next);
  });

  document.getElementById("newMapButton").addEventListener("click", () => {
    saveTree();
    const name = window.prompt("新しいマップ名", "新しいマップ");
    if (name === null) return;
    const map = makeMapItem(name.trim() || "新しいマップ", createBlankTree(name.trim() || "新しいマップ"));
    state.maps.push(map);
    setActiveMap(map);
  });

  document.getElementById("saveMapButton").addEventListener("click", () => {
    const name = window.prompt("マップ名", state.mapName || state.tree.text || "無題のマップ");
    if (name === null) return;
    state.mapName = name.trim() || state.tree.text || "無題のマップ";
    saveTree();
    els.statusText.textContent = `${state.mapName} を保存しました。`;
  });

  document.getElementById("deleteMapButton").addEventListener("click", () => {
    if (state.maps.length <= 1) return;
    const ok = window.confirm(`${state.mapName} を保存済み一覧から削除しますか？`);
    if (!ok) return;
    state.maps = state.maps.filter((map) => map.id !== state.mapId);
    setActiveMap(state.maps[0]);
  });

  document.getElementById("openMarkdownButton").addEventListener("click", () => {
    els.markdownFileInput.click();
  });

  els.markdownFileInput.addEventListener("change", async () => {
    try {
      await openMarkdownFile(els.markdownFileInput.files[0]);
      els.markdownFileInput.value = "";
    } catch (error) {
      els.statusText.textContent = `Markdownを開けませんでした: ${error.message}`;
    }
  });

  document.getElementById("saveMarkdownButton").addEventListener("click", async () => {
    try {
      await saveMarkdownFile();
    } catch (error) {
      els.statusText.textContent = `Markdown保存を中止しました。`;
    }
  });

  document.getElementById("optimizeLayoutButton").addEventListener("click", optimizeLayout);
  document.getElementById("fitButton").addEventListener("click", fitToView);
  document.getElementById("resetButton").addEventListener("click", () => {
    pushHistory();
    state.tree = clone(sampleTree);
    state.mapName = "サンプル";
    state.selectedId = state.tree.id;
    els.outlineInput.value = toMarkdown(state.tree).join("\n");
    render();
    fitToView();
  });

  document.getElementById("exportJsonButton").addEventListener("click", () => {
    els.exportOutput.value = JSON.stringify({ tree: state.tree, settings: currentSettings() }, null, 2);
  });

  document.getElementById("exportMarkdownButton").addEventListener("click", () => {
    els.exportOutput.value = toMarkdown(state.tree, { includeMeta: true }).join("\n");
  });

  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value;
    render();
  });

  els.depthSlider.addEventListener("input", () => {
    state.maxDepth = Number(els.depthSlider.value);
    render();
  });

  els.horizontalSpacingSlider.addEventListener("input", () => {
    state.horizontalSpacing = Number(els.horizontalSpacingSlider.value);
    render();
  });

  els.verticalSpacingSlider.addEventListener("input", () => {
    state.verticalSpacing = Number(els.verticalSpacingSlider.value);
    render();
  });

  document.getElementById("zoomOutButton").addEventListener("click", () => setZoom(state.zoom * 0.86));
  document.getElementById("zoomInButton").addEventListener("click", () => setZoom(state.zoom * 1.16));
  document.getElementById("zoomResetButton").addEventListener("click", () => {
    state.zoom = 1;
    centerRoot();
  });

  document.getElementById("themeToggle").addEventListener("click", () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  });
}

function wireKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const tagName = target?.tagName;
    const isTextControl =
      tagName === "TEXTAREA" ||
      tagName === "SELECT" ||
      (tagName === "INPUT" && target.type !== "range");
    if (isTextControl && !target.isContentEditable) return;

    const isUndoKey = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z";
    if (!isUndoKey) return;

    event.preventDefault();
    if (event.shiftKey) {
      redo();
    } else {
      undo();
    }
  });
}

function setZoom(nextZoom) {
  state.zoom = Math.min(1.8, Math.max(0.28, nextZoom));
  updateTransform();
}

function centerRoot() {
  const rect = els.viewport.getBoundingClientRect();
  state.pan.x = rect.width / 2 - WORLD.cx * state.zoom;
  state.pan.y = rect.height / 2 - WORLD.cy * state.zoom;
  updateTransform();
}

function wirePanZoom() {
  let panning = false;
  let last = { x: 0, y: 0 };

  els.viewport.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".mind-node")) return;
    panning = true;
    last = { x: event.clientX, y: event.clientY };
    els.viewport.classList.add("is-panning");
    els.viewport.setPointerCapture(event.pointerId);
  });

  els.viewport.addEventListener("pointermove", (event) => {
    if (!panning) return;
    state.pan.x += event.clientX - last.x;
    state.pan.y += event.clientY - last.y;
    last = { x: event.clientX, y: event.clientY };
    updateTransform();
  });

  els.viewport.addEventListener("pointerup", () => {
    panning = false;
    els.viewport.classList.remove("is-panning");
  });

  els.viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = els.viewport.getBoundingClientRect();
      const before = {
        x: (event.clientX - rect.left - state.pan.x) / state.zoom,
        y: (event.clientY - rect.top - state.pan.y) / state.zoom,
      };
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      setZoom(state.zoom * factor);
      state.pan.x = event.clientX - rect.left - before.x * state.zoom;
      state.pan.y = event.clientY - rect.top - before.y * state.zoom;
      updateTransform();
    },
    { passive: false },
  );
}

function init() {
  els.outlineInput.value = toMarkdown(state.tree).join("\n");
  els.exportOutput.value = toMarkdown(state.tree).join("\n");
  els.depthSlider.value = state.maxDepth;
  els.horizontalSpacingSlider.value = state.horizontalSpacing;
  els.verticalSpacingSlider.value = state.verticalSpacing;
  updateMapSelect();
  wireControls();
  wireKeyboardShortcuts();
  wirePanZoom();
  render();
  requestAnimationFrame(fitToView);
}

init();
