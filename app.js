const STORAGE_KEY = "knowledge-map-canvas-state-v1";
const MAPS_KEY = "knowledge-map-canvas-maps-v1";
const WORLD = { width: 3200, height: 2200, cx: 1600, cy: 1100 };
const NODE_WIDTH = 238;
const ROOT_WIDTH = 250;
const DEFAULT_VERTICAL_GAP = 26;
const DEFAULT_HORIZONTAL_GAP = 452;
const DEFAULT_SNAP_STEP = 32;
const LEGACY_DEFAULT_VERTICAL_GAP = 28;
const LEGACY_DEFAULT_HORIZONTAL_GAP = 260;
const ANIMATION_MS = 80;
const COLLISION_GAP = 18;
const PNG_EXPORT_PADDING = 160;
const PNG_EXPORT_MAX_SIDE = 16384;
const PNG_EXPORT_MAX_PIXELS = 90000000;
const LAYER_Y_AXIS_GAP = 500;
const VIEW_PERSPECTIVE = 4200;
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
const NODE_TYPES = {
  idea: { label: "要点", icon: "●" },
  task: { label: "タスク", icon: "✓" },
  decision: { label: "決定", icon: "◆" },
  risk: { label: "注意", icon: "!" },
  question: { label: "問い", icon: "?" },
};
const RELATION_TYPES = {
  normal: { label: "通常" },
  note: { label: "補足" },
  dependency: { label: "依存" },
  risk: { label: "注意" },
};

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
  snapStep: initialSettings.snapStep,
  search: "",
  flashId: null,
  removingId: null,
  isDraggingNode: false,
  isLayer3d: false,
  view3d: { yaw: -8, pitch: 58 },
  focusLayerDepth: 0,
  layerFilterDepth: 0,
  focusNodeId: "",
  dragGuide: { x: null, y: null },
  undoStack: [],
  redoStack: [],
  positions: new Map(),
  visibleIds: new Set(),
  renderedIds: new Set(),
  edgeList: [],
};

let removeTimer = null;
let activeNodeDrag = null;
let viewBeforeMapMaximize = null;

const els = {
  viewport: document.getElementById("canvasViewport"),
  world: document.getElementById("canvasWorld"),
  view: document.getElementById("canvasView"),
  floorLayer: document.getElementById("floorLayer"),
  edgeLayer: document.getElementById("edgeLayer"),
  edge3dLayer: document.getElementById("edge3dLayer"),
  nodeLayer: document.getElementById("nodeLayer"),
  outlineInput: document.getElementById("outlineInput"),
  exportOutput: document.getElementById("exportOutput"),
  selectionLabel: document.getElementById("selectionLabel"),
  statusText: document.getElementById("statusText"),
  searchInput: document.getElementById("searchInput"),
  depthSlider: document.getElementById("depthSlider"),
  horizontalSpacingSlider: document.getElementById("horizontalSpacingSlider"),
  verticalSpacingSlider: document.getElementById("verticalSpacingSlider"),
  snapStepSlider: document.getElementById("snapStepSlider"),
  snapStepValue: document.getElementById("snapStepValue"),
  mapSelect: document.getElementById("mapSelect"),
  markdownFileInput: document.getElementById("markdownFileInput"),
  nodeDetailTitle: document.getElementById("nodeDetailTitle"),
  nodeNoteInput: document.getElementById("nodeNoteInput"),
  nodeTypeSelect: document.getElementById("nodeTypeSelect"),
  relationTypeSelect: document.getElementById("relationTypeSelect"),
  focusNodeButton: document.getElementById("focusNodeButton"),
  jumpSourceButton: document.getElementById("jumpSourceButton"),
  layerList: document.getElementById("layerList"),
  nodeContextMenu: document.getElementById("nodeContextMenu"),
  guideLayer: document.getElementById("guideLayer"),
  guideVertical: document.getElementById("guideVertical"),
  guideHorizontal: document.getElementById("guideHorizontal"),
  summaryOutput: document.getElementById("summaryOutput"),
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
    type: normalizeNodeType(node.type),
    relationType: normalizeRelationType(node.relationType),
    layer: normalizeLayer(node.layer),
    parallelOf: typeof node.parallelOf === "string" ? node.parallelOf : "",
    offset: normalizeOffset(node.offset),
    collapsed: Boolean(node.collapsed),
    children: Array.isArray(node.children) ? node.children.map(normalizeNode) : [],
  };
}

function normalizeLayer(layer) {
  const value = Number(layer);
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function getNodeLayer(node) {
  return normalizeLayer(node?.layer);
}

function normalizeNodeType(type) {
  return Object.prototype.hasOwnProperty.call(NODE_TYPES, type) ? type : "idea";
}

function normalizeRelationType(type) {
  return Object.prototype.hasOwnProperty.call(RELATION_TYPES, type) ? type : "normal";
}

function normalizeOffset(offset) {
  return {
    x: Number(offset?.x) || 0,
    y: Number(offset?.y) || 0,
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
    snapStep: DEFAULT_SNAP_STEP,
  };
}

function normalizeSettings(settings = {}) {
  settings = settings || {};
  const horizontalSpacing = Number(settings.horizontalSpacing);
  const verticalSpacing = Number(settings.verticalSpacing);
  const snapStep = Number(settings.snapStep);
  const shouldMigrateLegacySpacing =
    horizontalSpacing === LEGACY_DEFAULT_HORIZONTAL_GAP && verticalSpacing === LEGACY_DEFAULT_VERTICAL_GAP;
  return {
    maxDepth: Number(settings.maxDepth) || 8,
    horizontalSpacing:
      shouldMigrateLegacySpacing || !Number.isFinite(horizontalSpacing) ? DEFAULT_HORIZONTAL_GAP : horizontalSpacing,
    verticalSpacing:
      shouldMigrateLegacySpacing || !Number.isFinite(verticalSpacing) ? DEFAULT_VERTICAL_GAP : verticalSpacing,
    snapStep: Number.isFinite(snapStep) ? clamp(Math.round(snapStep), 8, 96) : DEFAULT_SNAP_STEP,
  };
}

function currentSettings() {
  return {
    maxDepth: state.maxDepth,
    horizontalSpacing: state.horizontalSpacing,
    verticalSpacing: state.verticalSpacing,
    snapStep: state.snapStep,
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
    snapStep: state.snapStep,
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
  const settings = normalizeSettings(snapshot);
  state.maxDepth = settings.maxDepth;
  state.horizontalSpacing = settings.horizontalSpacing;
  state.verticalSpacing = settings.verticalSpacing;
  state.snapStep = settings.snapStep;
  state.search = snapshot.search || "";
  state.flashId = null;
  state.removingId = null;
  state.isLayer3d = false;
  state.layerFilterDepth = 0;
  state.focusLayerDepth = 0;
  state.focusNodeId = "";
  state.dragGuide = { x: null, y: null };
  document.body.classList.remove("layer-3d");
  els.viewport.classList.remove("is-layer-3d");
  ensureSelectedNodeVisible();
  els.searchInput.value = state.search;
  els.depthSlider.value = state.maxDepth;
  els.horizontalSpacingSlider.value = state.horizontalSpacing;
  els.verticalSpacingSlider.value = state.verticalSpacing;
  els.snapStepSlider.value = state.snapStep;
  updateSnapStepValue();
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
  if (state.isLayer3d || state.layerFilterDepth === null) return node.children;
  const currentLayer = getNodeLayer(node);
  if (currentLayer !== state.layerFilterDepth) return node.children;
  return node.children.filter((child) => getNodeLayer(child) === state.layerFilterDepth);
}

function measureSubtree(node, depth = 0) {
  const children = getLayoutChildren(node, depth);
  if (!children.length) return 86;
  return children.reduce((sum, child) => sum + measureSubtree(child, depth + 1), 0) + Math.max(0, children.length - 1) * state.verticalSpacing;
}

function getLayoutChildren(node, depth) {
  return getVisibleChildren(node, depth).filter((child) => !isParallelLayerChild(node, child));
}

function getParallelLayerChildren(node, depth) {
  return getVisibleChildren(node, depth).filter((child) => isParallelLayerChild(node, child));
}

function isParallelLayerChild(parent, child) {
  return Boolean(child.parallelOf === parent.id || getNodeLayer(parent) !== getNodeLayer(child));
}

function layoutTree() {
  state.positions.clear();
  state.visibleIds.clear();
  state.edgeList = [];

  const rootSpan = measureSubtree(state.tree);
  placeNode(state.tree, WORLD.cx, WORLD.cy - rootSpan / 2 + rootSpan / 2, 0, 0, null);
  resolveLayoutCollisions();
  alignParallelLayerNodes();
  if (state.isLayer3d) {
    clampFocusLayerDepth();
    applyLayerProjection();
  }
}

function alignParallelLayerNodes() {
  walk(state.tree, (node) => {
    if (!node.parallelOf) return;
    const pos = state.positions.get(node.id);
    const anchor = state.positions.get(node.parallelOf);
    if (!pos || !anchor) return;

    const offset = normalizeOffset(node.offset);
    const targetBaseX = anchor.x;
    const targetBaseY = anchor.y;
    const targetX = targetBaseX + offset.x;
    const targetY = targetBaseY + offset.y;
    const dx = targetX - pos.x;
    const dy = targetY - pos.y;

    walkSubtree(node, (subNode) => {
      const subPos = state.positions.get(subNode.id);
      if (!subPos) return;
      subPos.x += dx;
      subPos.y += dy;
      if (subNode.id === node.id) {
        subPos.baseX = targetBaseX;
        subPos.baseY = targetBaseY;
      } else {
        subPos.baseX += dx;
        subPos.baseY += dy;
      }
    });
  });
}

function applyLayerProjection() {
  state.positions.forEach((pos) => {
    pos.layerAxisY = getLayerAxisY(pos.layer);
  });
}

function getLayerAxisY(layer) {
  return -normalizeLayer(layer) * LAYER_Y_AXIS_GAP;
}

function placeNode(node, x, y, depth, branchIndex, parent) {
  const color = depth === 0 ? "#1f2937" : BRANCH_COLORS[branchIndex % BRANCH_COLORS.length];
  const width = depth === 0 ? ROOT_WIDTH : NODE_WIDTH;
  const height = estimateNodeHeight(node, width, depth);
  const offset = normalizeOffset(node.offset);
  const layer = getNodeLayer(node);
  state.positions.set(node.id, {
    x: x + offset.x,
    y: y + offset.y,
    baseX: x,
    baseY: y,
    depth,
    layer,
    color,
    branchIndex,
    width,
    height,
  });
  state.visibleIds.add(node.id);
  if (parent) {
    state.edgeList.push({ from: parent.id, to: node.id, color, relationType: normalizeRelationType(node.relationType) });
  }

  const children = getLayoutChildren(node, depth);
  const parallelChildren = getParallelLayerChildren(node, depth);
  if (!children.length && !parallelChildren.length) return;

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

  parallelChildren.forEach((child) => {
    placeNode(child, x, y, depth + 1, branchIndex, node);
  });
}

function estimateNodeHeight(node, width, depth) {
  const actionWidth = 136;
  const textWidth = Math.max(64, width - actionWidth);
  const lineCapacity = Math.max(7, Math.floor(textWidth / 8));
  const lineCount = Math.max(1, Math.ceil([...node.text].length / lineCapacity));
  const baseHeight = depth === 0 ? 84 : 68;
  return Math.min(150, Math.max(baseHeight, 32 + lineCount * 18));
}

function resolveLayoutCollisions() {
  if (state.positions.size < 2) return;

  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const items = [...state.positions.entries()]
      .map(([id, pos]) => ({ id, pos }))
      .sort((a, b) => a.pos.y - b.pos.y || a.pos.depth - b.pos.depth || a.pos.x - b.pos.x);

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const upper = items[i];
        const lower = items[j];
        if (!hasHorizontalOverlap(upper.pos, lower.pos)) continue;

        const minLowerY = upper.pos.y + (upper.pos.height + lower.pos.height) / 2 + COLLISION_GAP;
        const overlap = minLowerY - lower.pos.y;
        if (overlap <= 0) continue;

        const shiftId = isAncestorId(lower.id, upper.id) ? upper.id : lower.id;
        shiftVisibleSubtree(shiftId, overlap);
        changed = true;
      }
    }

    if (!changed) return;
  }
}

function hasHorizontalOverlap(a, b) {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + COLLISION_GAP;
}

function isAncestorId(ancestorId, nodeId) {
  const found = findNode(ancestorId);
  if (!found) return false;
  let matched = false;
  walkSubtree(found.node, (node) => {
    if (node.id !== ancestorId && node.id === nodeId) matched = true;
  });
  return matched;
}

function shiftVisibleSubtree(id, dy) {
  const found = findNode(id);
  if (!found) return;
  walkSubtree(found.node, (node) => {
    const pos = state.positions.get(node.id);
    if (pos) pos.y += dy;
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

function pathForLayerConnector(from, to) {
  const startX = from.x;
  const direction = to.y >= from.y ? 1 : -1;
  const startY = from.y + (from.height / 2) * direction;
  const endX = to.x;
  const endY = to.y - (to.height / 2) * direction;
  const midY = (startY + endY) / 2;
  return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
}

function getConnectorAxisY(from, to) {
  return ((from?.layerAxisY || 0) + (to?.layerAxisY || 0)) / 2;
}

function applyLayerDepthStyle(element, axisY) {
  if (!state.isLayer3d) {
    element.style.transform = "";
    return;
  }
  element.style.transform = `translateZ(${axisY}px)`;
  element.style.transformBox = "fill-box";
  element.style.transformOrigin = "center";
}

function make3dEdge(edge, from, to, matches, hasSearch, previousEdges) {
  const start = connectorPoint(from, to, 1);
  const end = connectorPoint(to, from, 1);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const length = Math.max(1, Math.hypot(dx, dy, dz));
  const xyLength = Math.hypot(dx, dy);
  const theta = xyLength < 0.001 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI;
  const phi = (-Math.asin(clamp(dz / length, -1, 1)) * 180) / Math.PI;
  const line = document.createElement("span");
  const className =
    edgeClass(edge, matches, hasSearch).replace("edge-path", "edge-3d-line") +
    (previousEdges.has(edgeKey(edge)) ? "" : " is-entering");
  line.className = className;
  line.dataset.from = edge.from;
  line.dataset.to = edge.to;
  line.dataset.relation = edge.relationType || "normal";
  line.style.width = `${length}px`;
  line.style.setProperty("--branch", edge.color);
  line.style.transform = `translate3d(${start.x}px, ${start.y}px, ${start.z}px) rotateZ(${theta}deg) rotateY(${phi}deg)`;
  return line;
}

function connectorPoint(pos, toward, sign) {
  const x = pos.x;
  const y = pos.y;
  const z = pos.layerAxisY || 0;
  const dx = (toward?.x || x) - x;
  const dy = (toward?.y || y) - y;
  const dz = (toward?.layerAxisY || 0) - z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 0.001) return { x, y, z };

  const inset = Math.min(42, Math.max(24, Math.min(pos.width, pos.height) * 0.42));
  return {
    x: x + (dx / length) * inset * sign,
    y: y + (dy / length) * inset * sign,
    z: z + (dz / length) * inset * sign,
  };
}

function edgeKey(edge) {
  return `${edge.from}->${edge.to}`;
}

function render() {
  const previousPositions = new Map(state.positions);
  const previousEdges = new Set(state.edgeList.map(edgeKey));
  layoutTree();
  clampFocusLayerDepth();
  ensureFocusNodeVisible();
  state.renderedIds.clear();
  els.nodeLayer.textContent = "";
  els.floorLayer.textContent = "";
  els.edgeLayer.textContent = "";
  els.edge3dLayer.textContent = "";
  els.edgeLayer.setAttribute("viewBox", `0 0 ${WORLD.width} ${WORLD.height}`);

  const fragment = document.createDocumentFragment();
  const floorFragment = document.createDocumentFragment();
  const edgeFragment = document.createDocumentFragment();
  const edge3dFragment = document.createDocumentFragment();
  const matches = getSearchMatches();
  const hasSearch = state.search.trim().length > 0;

  if (state.isLayer3d) {
    renderLayerFloors(floorFragment);
  }

  state.edgeList.forEach((edge) => {
    if (!shouldRenderEdge(edge)) return;
    const from = state.positions.get(edge.from);
    const to = state.positions.get(edge.to);
    if (!from || !to) return;
    const isConnector = isLayerConnectorEdge(edge);
    if (state.isLayer3d) {
      edge3dFragment.appendChild(make3dEdge(edge, from, to, matches, hasSearch, previousEdges));
      return;
    }

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", isConnector ? pathForLayerConnector(from, to) : pathForEdge(from, to));
    const className = edgeClass(edge, matches, hasSearch) + (previousEdges.has(edgeKey(edge)) ? "" : " is-entering");
    path.setAttribute("class", className);
    path.setAttribute("pathLength", "1");
    path.dataset.from = edge.from;
    path.dataset.to = edge.to;
    path.dataset.relation = edge.relationType || "normal";
    path.style.setProperty("--branch", edge.color);
    applyLayerDepthStyle(path, isConnector ? getConnectorAxisY(from, to) : from.layerAxisY || 0);
    edgeFragment.appendChild(path);
  });

  walk(state.tree, (node) => {
    const pos = state.positions.get(node.id);
    if (!pos) return;
    if (!shouldRenderLayer(pos.layer)) return;
    state.renderedIds.add(node.id);
    const nodeEl = document.createElement("article");
    nodeEl.className = nodeClass(node, pos, matches, hasSearch);
    nodeEl.dataset.id = node.id;
    nodeEl.dataset.type = normalizeNodeType(node.type);
    nodeEl.style.left = `${pos.x}px`;
    nodeEl.style.top = `${pos.y}px`;
    nodeEl.style.setProperty("--branch", pos.color);
    nodeEl.style.setProperty("--node-width", `${pos.depth === 0 ? ROOT_WIDTH : NODE_WIDTH}px`);
    nodeEl.style.setProperty("--layer-y", `${state.isLayer3d ? pos.layerAxisY || 0 : 0}px`);
    if (state.isLayer3d) {
      nodeEl.style.zIndex = String(100000 + Math.round(pos.layerAxisY || 0));
    }
    applyNodeMotion(nodeEl, pos, previousPositions.get(node.id));

    const title = document.createElement("div");
    title.className = "node-title";
    title.contentEditable = "true";
    title.spellcheck = false;
    title.textContent = node.text;
    title.setAttribute("role", "textbox");
    title.setAttribute("aria-label", "Node text");

    const content = document.createElement("div");
    content.className = "node-content";
    const badge = document.createElement("span");
    badge.className = "node-type-badge";
    badge.title = NODE_TYPES[normalizeNodeType(node.type)].label;
    badge.textContent = NODE_TYPES[normalizeNodeType(node.type)].icon;
    content.append(badge, title);

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
    nodeEl.append(content, actions);
    fragment.appendChild(nodeEl);
  });

  els.floorLayer.appendChild(floorFragment);
  els.edgeLayer.appendChild(edgeFragment);
  els.edge3dLayer.appendChild(edge3dFragment);
  els.nodeLayer.appendChild(fragment);
  bindRenderedEvents();
  updateTransform();
  updateLabels();
  updateLayerControls();
  updateLayerPanel();
  updateAlignmentGuides();
  saveTree();
  clearFlashAfterAnimation();
}

function renderLayerFloors(fragment) {
  const layers = [...new Set([...state.positions.values()].map((pos) => pos.layer))].sort((a, b) => a - b);
  layers.forEach((layer) => {
    const items = [...state.positions.values()].filter((pos) => pos.layer === layer);
    if (!items.length) return;
    const paddingX = layer === 0 ? 140 : 170;
    const paddingY = layer === 0 ? 100 : 120;
    const minX = Math.min(...items.map((pos) => pos.x - pos.width / 2)) - paddingX;
    const maxX = Math.max(...items.map((pos) => pos.x + pos.width / 2)) + paddingX;
    const minY = Math.min(...items.map((pos) => pos.y - pos.height / 2)) - paddingY;
    const maxY = Math.max(...items.map((pos) => pos.y + pos.height / 2)) + paddingY;
    const plate = document.createElement("div");
    plate.className = `floor-plate ${layer === state.focusLayerDepth ? "is-layer-focused" : "is-layer-dimmed"}`;
    plate.style.left = `${minX}px`;
    plate.style.top = `${minY}px`;
    plate.style.width = `${Math.max(1, maxX - minX)}px`;
    plate.style.height = `${Math.max(1, maxY - minY)}px`;
    plate.style.zIndex = String(100000 + Math.round(getLayerAxisY(layer)));
    applyLayerDepthStyle(plate, getLayerAxisY(layer));

    const label = document.createElement("span");
    label.className = "floor-label";
    const axisLabel = layer === state.focusLayerDepth ? "アクティブ" : layer < state.focusLayerDepth ? "Y+" : "Y-";
    label.textContent = `階層 ${layer} / ${axisLabel}`;
    plate.appendChild(label);
    fragment.appendChild(plate);
  });
}

function shouldRenderLayer(layer) {
  return state.layerFilterDepth === null || layer === state.layerFilterDepth;
}

function shouldRenderEdge(edge) {
  if (isLayerConnectorEdge(edge)) return state.isLayer3d;
  if (state.layerFilterDepth === null) return true;
  const from = state.positions.get(edge.from);
  const to = state.positions.get(edge.to);
  return Boolean(from && to && from.layer === state.layerFilterDepth && to.layer === state.layerFilterDepth);
}

function isLayerConnectorEdge(edge) {
  const from = findNode(edge.from)?.node;
  const to = findNode(edge.to)?.node;
  const fromPos = state.positions.get(edge.from);
  const toPos = state.positions.get(edge.to);
  return Boolean(
    (to?.parallelOf && to.parallelOf === edge.from) ||
      (from?.parallelOf && from.parallelOf === edge.to) ||
      (fromPos && toPos && fromPos.layer !== toPos.layer),
  );
}

function clampFocusLayerDepth() {
  const maxLayer = getMaxRenderedLayer();
  state.focusLayerDepth = clamp(state.focusLayerDepth, 0, maxLayer);
}

function getMaxRenderedLayer() {
  const layers = [...state.positions.values()].map((pos) => pos.layer);
  return layers.length ? Math.max(...layers) : 0;
}

function applyNodeMotion(nodeEl, pos, previous) {
  if (state.isDraggingNode) return;
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
  const classes = ["mind-node", `type-${normalizeNodeType(node.type)}`];
  if (pos.depth === 0) classes.push("root");
  if (node.parallelOf) classes.push("is-layer-ghost");
  if (state.isLayer3d) {
    classes.push(pos.layer === state.focusLayerDepth ? "is-layer-focused" : "is-layer-dimmed");
  }
  if (isNodeFocusMuted(node.id)) classes.push("is-focus-muted");
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
  const classes = ["edge-path", `relation-${normalizeRelationType(edge.relationType)}`];
  if (isLayerConnectorEdge(edge)) classes.push("is-layer-connector");
  if (state.isLayer3d) {
    const fromLayer = state.positions.get(edge.from)?.layer;
    const toLayer = state.positions.get(edge.to)?.layer;
    const touchesFocusedLayer = fromLayer === state.focusLayerDepth || toLayer === state.focusLayerDepth;
    classes.push(touchesFocusedLayer ? "is-layer-focused" : "is-layer-dimmed");
  }
  if (isEdgeFocusMuted(edge)) classes.push("is-focus-muted");
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

function getFocusScopeIds() {
  if (!state.focusNodeId) return null;
  const found = findNode(state.focusNodeId);
  if (!found) {
    state.focusNodeId = "";
    return null;
  }

  const ids = new Set(getNodePath(state.focusNodeId));
  walkSubtree(found.node, (node) => ids.add(node.id));
  return ids;
}

function getNodePath(id, node = state.tree, path = []) {
  const nextPath = [...path, node.id];
  if (node.id === id) return nextPath;
  for (const child of node.children) {
    const result = getNodePath(id, child, nextPath);
    if (result.length) return result;
  }
  return [];
}

function isNodeFocusMuted(id) {
  const scope = getFocusScopeIds();
  return Boolean(scope && !scope.has(id));
}

function isEdgeFocusMuted(edge) {
  const scope = getFocusScopeIds();
  return Boolean(scope && (!scope.has(edge.from) || !scope.has(edge.to)));
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
      if (state.isLayer3d && event.altKey) return;
      if (event.button !== 0 || event.target.closest(".node-action")) return;
      event.stopPropagation();
      selectNode(id);
      startNodeDrag(event, id);
    });

    nodeEl.addEventListener("contextmenu", (event) => {
      if (state.isLayer3d && event.altKey) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      showNodeContextMenu(event, id);
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
      if (state.isLayer3d && event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      const found = findNode(id);
      if (!found || !found.node.children.length) return;
      pushHistory();
      found.node.collapsed = !found.node.collapsed;
      render();
    });

    addChildButton.addEventListener("click", (event) => {
      if (state.isLayer3d && event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      state.selectedId = id;
      addChild();
    });

    deleteButton.addEventListener("click", (event) => {
      if (state.isLayer3d && event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      if (deleteButton.disabled) return;
      state.selectedId = id;
      deleteSelected();
    });
  });
}

function showNodeContextMenu(event, id) {
  const found = findNode(id);
  if (!found || !els.nodeContextMenu) return;
  selectNode(id);

  els.nodeContextMenu.textContent = "";

  appendContextSection([
    {
      label: "子ノードを追加",
      detail: "+",
      action: () => addChild(),
    },
    {
      label: "下層に追加",
      detail: "3D",
      action: () => addLowerLayerFromContext(id),
    },
    {
      label: state.focusNodeId === id ? "フォーカス解除" : "フォーカス",
      detail: "◎",
      action: () => toggleFocusSelected(),
    },
    {
      label: "元ノードへ",
      detail: "↖",
      disabled: !found.node.parallelOf || !findNode(found.node.parallelOf),
      action: () => jumpToSourceNode(id),
    },
  ]);

  appendContextSection(
    Object.entries(NODE_TYPES).map(([type, info]) => ({
      label: `種類: ${info.label}`,
      detail: normalizeNodeType(found.node.type) === type ? "✓" : "",
      action: () => {
        state.selectedId = id;
        setSelectedNodeType(type);
      },
    })),
  );

  if (found.parent) {
    appendContextSection(
      Object.entries(RELATION_TYPES).map(([type, info]) => ({
        label: `線: ${info.label}`,
        detail: normalizeRelationType(found.node.relationType) === type ? "✓" : "",
        action: () => {
          state.selectedId = id;
          setSelectedRelationType(type);
        },
      })),
    );
  }

  appendContextSection([
    {
      label: "削除",
      detail: "×",
      danger: true,
      disabled: id === state.tree.id,
      action: () => {
        state.selectedId = id;
        deleteSelected();
      },
    },
  ]);

  positionContextMenu(event.clientX, event.clientY);
}

function appendContextSection(items) {
  const section = document.createElement("div");
  section.className = "context-menu-section";
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    if (item.danger) button.classList.add("is-danger");
    button.disabled = Boolean(item.disabled);
    const label = document.createElement("span");
    label.textContent = item.label;
    const detail = document.createElement("span");
    detail.textContent = item.detail || "";
    button.append(label, detail);
    button.addEventListener("click", () => {
      hideNodeContextMenu();
      item.action();
    });
    section.appendChild(button);
  });
  els.nodeContextMenu.appendChild(section);
}

function positionContextMenu(clientX, clientY) {
  if (!els.nodeContextMenu) return;
  els.nodeContextMenu.hidden = false;
  const rect = els.nodeContextMenu.getBoundingClientRect();
  const x = Math.min(clientX, window.innerWidth - rect.width - 8);
  const y = Math.min(clientY, window.innerHeight - rect.height - 8);
  els.nodeContextMenu.style.left = `${Math.max(8, x)}px`;
  els.nodeContextMenu.style.top = `${Math.max(8, y)}px`;
}

function hideNodeContextMenu() {
  if (!els.nodeContextMenu) return;
  els.nodeContextMenu.hidden = true;
}

function addLowerLayerFromContext(id) {
  state.selectedId = id;
  if (!state.isLayer3d) {
    setLayer3dMode(true);
    window.setTimeout(addLowerLayerNode, 0);
    return;
  }
  addLowerLayerNode();
}

function startNodeDrag(event, id) {
  const found = findNode(id);
  if (!found) return;
  activeNodeDrag = {
    id,
    startX: event.clientX,
    startY: event.clientY,
    started: false,
    snapshot: captureSnapshot(),
    originalOffsets: collectSubtreeOffsets(found.node),
    startPosition: clonePosition(state.positions.get(id)),
  };
  window.addEventListener("pointermove", handleNodeDragMove);
  window.addEventListener("pointerup", finishNodeDrag, { once: true });
}

function handleNodeDragMove(event) {
  if (!activeNodeDrag) return;
  const screenDx = event.clientX - activeNodeDrag.startX;
  const screenDy = event.clientY - activeNodeDrag.startY;
  const distance = Math.hypot(screenDx, screenDy);
  if (!activeNodeDrag.started && distance < 4) return;

  event.preventDefault();
  if (!activeNodeDrag.started) {
    pushHistory(activeNodeDrag.snapshot);
    activeNodeDrag.started = true;
    state.isDraggingNode = true;
    els.viewport.classList.add("is-node-dragging");
  }

  const dx = screenDx / state.zoom;
  const dy = screenDy / state.zoom;
  applySubtreeDragOffsets(
    activeNodeDrag.id,
    activeNodeDrag.originalOffsets,
    dx,
    dy,
    activeNodeDrag.startPosition,
  );
  render();
}

function finishNodeDrag() {
  window.removeEventListener("pointermove", handleNodeDragMove);
  if (activeNodeDrag?.started) {
    saveTree();
  }
  activeNodeDrag = null;
  state.isDraggingNode = false;
  state.dragGuide = { x: null, y: null };
  updateAlignmentGuides();
  els.viewport.classList.remove("is-node-dragging");
}

function collectSubtreeOffsets(node, offsets = new Map()) {
  offsets.set(node.id, normalizeOffset(node.offset));
  node.children.forEach((child) => {
    if (child.parallelOf) return;
    collectSubtreeOffsets(child, offsets);
  });
  return offsets;
}

function clonePosition(pos) {
  if (!pos) return null;
  return {
    x: pos.x,
    y: pos.y,
    baseX: pos.baseX,
    baseY: pos.baseY,
  };
}

function applySubtreeDragOffsets(id, originalOffsets, dx, dy, startPosition = null) {
  const found = findNode(id);
  if (!found) return;
  const dragOriginal = originalOffsets.get(id) || { x: 0, y: 0 };
  const baseX = Number.isFinite(startPosition?.baseX) ? startPosition.baseX : (startPosition?.x || 0) - dragOriginal.x;
  const baseY = Number.isFinite(startPosition?.baseY) ? startPosition.baseY : (startPosition?.y || 0) - dragOriginal.y;
  const startX = Number.isFinite(startPosition?.x) ? startPosition.x : baseX + dragOriginal.x;
  const startY = Number.isFinite(startPosition?.y) ? startPosition.y : baseY + dragOriginal.y;
  const excludeIds = collectDragSubtreeIds(found.node);
  const alignedTarget = getAlignmentSnap(id, snapValue(startX + dx), snapValue(startY + dy), excludeIds);
  const targetX = alignedTarget.x;
  const targetY = alignedTarget.y;
  state.dragGuide = { x: alignedTarget.guideX, y: alignedTarget.guideY };
  const appliedDx = targetX - baseX - dragOriginal.x;
  const appliedDy = targetY - baseY - dragOriginal.y;

  walkDragSubtree(found.node, (node) => {
    const original = originalOffsets.get(node.id) || { x: 0, y: 0 };
    node.offset = {
      x: Math.round(original.x + appliedDx),
      y: Math.round(original.y + appliedDy),
    };
  });
}

function walkDragSubtree(node, visitor) {
  visitor(node);
  node.children.forEach((child) => {
    if (child.parallelOf) return;
    walkDragSubtree(child, visitor);
  });
}

function walkSubtree(node, visitor) {
  visitor(node);
  node.children.forEach((child) => walkSubtree(child, visitor));
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
  document.querySelectorAll(".edge-path, .edge-3d-line").forEach((edgeEl) => {
    const from = edgeEl.dataset.from;
    const to = edgeEl.dataset.to;
    edgeEl.classList.toggle("is-selected", from === state.selectedId || to === state.selectedId);
  });
}

function updateLabels() {
  const found = findNode(state.selectedId);
  const selectedText = found ? found.node.text : "未選択";
  const visibleCount = state.layerFilterDepth === null ? state.visibleIds.size : state.renderedIds.size;
  const layerText =
    state.layerFilterDepth === null || state.layerFilterDepth === 0 ? "" : ` / 階層 ${state.layerFilterDepth}のみ`;
  const focusText = state.focusNodeId ? " / フォーカス中" : "";
  els.selectionLabel.textContent = selectedText;
  els.statusText.textContent = `${state.mapName}${layerText}${focusText} / ${visibleCount}件を表示中。編集内容は自動保存されます。`;
  updateNodeDetailPanel(found?.node);
}

function updateNodeDetailPanel(node) {
  if (!els.nodeDetailTitle || !els.nodeNoteInput) return;
  els.nodeDetailTitle.textContent = node ? node.text : "未選択";
  els.nodeNoteInput.disabled = !node;
  if (els.nodeTypeSelect) {
    els.nodeTypeSelect.disabled = !node;
    if (node && document.activeElement !== els.nodeTypeSelect) {
      els.nodeTypeSelect.value = normalizeNodeType(node.type);
    }
  }
  if (els.relationTypeSelect) {
    els.relationTypeSelect.disabled = !node || node.id === state.tree.id;
    if (node && document.activeElement !== els.relationTypeSelect) {
      els.relationTypeSelect.value = normalizeRelationType(node.relationType);
    }
  }
  if (els.focusNodeButton) {
    els.focusNodeButton.disabled = !node;
    els.focusNodeButton.textContent = node && state.focusNodeId === node.id ? "解除" : "フォーカス";
  }
  if (els.jumpSourceButton) {
    const sourceExists = Boolean(node?.parallelOf && findNode(node.parallelOf));
    els.jumpSourceButton.disabled = !sourceExists;
  }
  if (document.activeElement !== els.nodeNoteInput) {
    els.nodeNoteInput.value = node?.memo || "";
  }
}

function updateLayerPanel() {
  if (!els.layerList) return;
  const stats = getLayerStats();
  els.layerList.textContent = "";

  stats.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layer-item";
    const isActive = state.isLayer3d
      ? item.layer === state.focusLayerDepth
      : item.layer === state.layerFilterDepth;
    if (isActive) button.classList.add("is-active");

    const label = document.createElement("strong");
    label.textContent = item.layer === 0 ? "通常階層" : `階層 ${item.layer}`;
    const count = document.createElement("span");
    count.textContent = item.ghostCount ? `${item.count}件 / ゴースト${item.ghostCount}` : `${item.count}件`;
    button.append(label, count);
    button.addEventListener("click", () => activateLayerFromPanel(item.layer));
    els.layerList.appendChild(button);
  });
}

function getLayerStats() {
  const stats = new Map();
  walk(state.tree, (node) => {
    const layer = getNodeLayer(node);
    if (!stats.has(layer)) stats.set(layer, { layer, count: 0, ghostCount: 0 });
    const item = stats.get(layer);
    item.count += 1;
    if (node.parallelOf) item.ghostCount += 1;
  });
  return [...stats.values()].sort((a, b) => a.layer - b.layer);
}

function activateLayerFromPanel(layer) {
  if (state.isLayer3d) {
    state.focusLayerDepth = layer;
    render();
    return;
  }

  if (layer === 0) {
    clearLayerFilter();
    return;
  }

  state.layerFilterDepth = layer;
  state.focusLayerDepth = layer;
  state.isLayer3d = false;
  document.body.classList.remove("layer-3d");
  els.viewport.classList.remove("is-layer-3d");
  ensureSelectedNodeVisible();
  render();
  requestAnimationFrame(fitToView);
}

function updateAlignmentGuides() {
  if (!els.guideLayer || !els.guideVertical || !els.guideHorizontal) return;
  const x = Number.isFinite(state.dragGuide.x) ? state.dragGuide.x : null;
  const y = Number.isFinite(state.dragGuide.y) ? state.dragGuide.y : null;
  els.guideLayer.classList.toggle("has-x", x !== null);
  els.guideLayer.classList.toggle("has-y", y !== null);
  if (x !== null) els.guideVertical.style.left = `${x}px`;
  if (y !== null) els.guideHorizontal.style.top = `${y}px`;
}

function setSelectedNodeType(type) {
  const found = findNode(state.selectedId);
  if (!found) return;
  const nextType = normalizeNodeType(type);
  if (normalizeNodeType(found.node.type) === nextType) return;
  pushHistory();
  found.node.type = nextType;
  render();
}

function setSelectedRelationType(type) {
  const found = findNode(state.selectedId);
  if (!found || !found.parent) return;
  const nextType = normalizeRelationType(type);
  if (normalizeRelationType(found.node.relationType) === nextType) return;
  pushHistory();
  found.node.relationType = nextType;
  render();
}

function toggleFocusSelected() {
  const found = findNode(state.selectedId);
  if (!found) return;
  state.focusNodeId = state.focusNodeId === found.node.id ? "" : found.node.id;
  render();
}

function jumpToSourceNode(id = state.selectedId) {
  const found = findNode(id);
  const sourceId = found?.node.parallelOf;
  const source = sourceId ? findNode(sourceId) : null;
  if (!source) return;

  const sourceLayer = getNodeLayer(source.node);
  if (state.isLayer3d) {
    state.focusLayerDepth = sourceLayer;
  } else if (state.layerFilterDepth !== sourceLayer) {
    state.layerFilterDepth = sourceLayer;
    state.focusLayerDepth = sourceLayer;
  }

  state.selectedId = source.node.id;
  render();
  requestAnimationFrame(() => centerNode(source.node.id));
}

function centerNode(id) {
  const pos = state.positions.get(id);
  if (!pos) return;
  const rect = els.viewport.getBoundingClientRect();
  state.pan.x = rect.width / 2 - pos.x * state.zoom;
  state.pan.y = rect.height / 2 - pos.y * state.zoom;
  updateTransform();
}

function updateTransform() {
  els.world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  const perspective = state.isLayer3d ? VIEW_PERSPECTIVE / Math.max(state.zoom, 0.0001) : VIEW_PERSPECTIVE;
  els.world.style.setProperty("--view-perspective", `${perspective}px`);
  if (els.view) {
    const viewTransform = state.isLayer3d
      ? `rotateX(${state.view3d.pitch}deg) rotateZ(${state.view3d.yaw}deg)`
      : "none";
    els.view.style.transform = viewTransform;
  }
  document.getElementById("zoomResetButton").textContent = `${Math.round(state.zoom * 100)}%`;
}

function fitToView() {
  const rect = els.viewport.getBoundingClientRect();
  const positions = [...state.positions.values()].filter((pos) => shouldRenderLayer(pos.layer));
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
  const snapshot = captureSnapshot();
  const resetCount = resetManualOffsets();
  if (resetCount) pushHistory(snapshot);
  render();
  requestAnimationFrame(fitToView);
  els.statusText.textContent = resetCount
    ? `自動整列しました。${resetCount}件の手動位置を初期化しました。`
    : "すでに自動レイアウトです。";
}

function resetManualOffsets() {
  let resetCount = 0;
  walk(state.tree, (node) => {
    const offset = normalizeOffset(node.offset);
    if (!offset.x && !offset.y) return;
    node.offset = { x: 0, y: 0 };
    resetCount += 1;
  });
  return resetCount;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function snapValue(value, step = state.snapStep) {
  const snapStep = clamp(Math.round(Number(step) || DEFAULT_SNAP_STEP), 8, 96);
  return Math.round(value / snapStep) * snapStep;
}

function collectDragSubtreeIds(node) {
  const ids = new Set();
  walkDragSubtree(node, (item) => ids.add(item.id));
  return ids;
}

function getAlignmentSnap(id, x, y, excludeIds) {
  const sourcePos = state.positions.get(id);
  const tolerance = clamp(18 / state.zoom, 10, 30);
  let guideX = null;
  let guideY = null;
  let bestDx = tolerance + 1;
  let bestDy = tolerance + 1;

  state.positions.forEach((pos, nodeId) => {
    if (excludeIds.has(nodeId)) return;
    if (!shouldRenderLayer(pos.layer)) return;
    if (sourcePos && pos.layer !== sourcePos.layer) return;

    const dx = Math.abs(pos.x - x);
    if (dx <= tolerance && dx < bestDx) {
      bestDx = dx;
      x = pos.x;
      guideX = pos.x;
    }

    const dy = Math.abs(pos.y - y);
    if (dy <= tolerance && dy < bestDy) {
      bestDy = dy;
      y = pos.y;
      guideY = pos.y;
    }
  });

  return { x, y, guideX, guideY };
}

function updateSnapStepValue() {
  if (!els.snapStepValue) return;
  els.snapStepValue.textContent = `${state.snapStep}px`;
}

function addChild() {
  const found = findNode(state.selectedId);
  if (!found) return;
  pushHistory();
  found.node.collapsed = false;
  const child = normalizeNode({
    text: "新しいアイデア",
    layer: getNodeLayer(found.node),
    offset: normalizeOffset(found.node.offset),
    children: [],
  });
  found.node.children.push(child);
  state.selectedId = child.id;
  state.flashId = child.id;
  render();
}

function addSibling() {
  const found = findNode(state.selectedId);
  if (!found || !found.parent) return;
  pushHistory();
  const sibling = normalizeNode({
    text: "新しいトピック",
    layer: getNodeLayer(found.node),
    offset: normalizeOffset(found.node.offset),
    children: [],
  });
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

function summarizeTree(root) {
  const summary = analyzeTree(root);
  const background = makeSummaryBackground(summary);
  const actions = makeSummaryActions(summary);

  return [
    "今の課題：",
    makeSummaryIssue(summary),
    "",
    "背景：",
    ...background,
    "",
    "まずやること：",
    ...actions.map((action, index) => `${index + 1}. ${action}`),
  ].join("\n");
}

function analyzeTree(root) {
  const children = root.children || [];
  const goalBranch = findSummaryBranch(children, ["ゴール", "目的", "目標"]);
  const handoverBranch = findSummaryBranch(children, ["引継ぎ", "引き継ぎ", "引継", "やること", "対応"]);
  const exclusionBranch = findSummaryBranch(children, ["やらない", "対象外", "しない", "除外"]);
  const goals = branchChildren(goalBranch);
  const handovers = branchChildren(handoverBranch);
  const exclusions = branchChildren(exclusionBranch);
  const allTexts = collectSummaryTexts(root);

  return {
    rootText: cleanSummaryText(root.text),
    assignee: extractAssignee(root.text),
    theme: extractTheme(root.text),
    goals,
    handovers,
    exclusions,
    topItems: children.map((child) => cleanSummaryText(child.text)).filter(Boolean),
    allTexts,
  };
}

function findSummaryBranch(children, keywords) {
  return children.find((child) => keywords.some((keyword) => cleanSummaryKey(child.text).includes(keyword)));
}

function branchChildren(node) {
  if (!node) return [];
  return (node.children || []).map((child) => cleanSummaryText(child.text)).filter(Boolean);
}

function collectSummaryTexts(node) {
  const texts = [];
  walkSummaryTree(node, (item) => {
    const text = cleanSummaryText(item.text);
    if (text) texts.push(text);
  });
  return texts;
}

function walkSummaryTree(node, visitor) {
  visitor(node);
  (node.children || []).forEach((child) => walkSummaryTree(child, visitor));
}

function makeSummaryIssue(summary) {
  const lead = makeSummaryLead(summary);
  if (summary.exclusions.length) {
    return `${lead}、任せる範囲と最終判断が必要な範囲を切り分ける。`;
  }
  if (summary.handovers.length) {
    return `${lead}、引継ぎ項目と次に進める順番を整理する。`;
  }
  return `${summary.rootText || "このマインドマップ"}について、課題と次にやることを整理する。`;
}

function makeSummaryLead(summary) {
  const goal = pickGoal(summary.goals);
  if (summary.assignee && goal) {
    return `${summary.assignee}が${goalToLead(goal)}`;
  }
  if (goal) return goalToLead(goal);
  if (summary.assignee && summary.theme) return `${summary.assignee}が${summary.theme}を進められるように`;
  return summary.rootText || "このマインドマップ";
}

function pickGoal(goals) {
  return (
    goals.find((goal) => /自走|担う|管理|把握|確認/.test(goal)) ||
    goals.find((goal) => goal.length <= 34) ||
    goals[0] ||
    ""
  );
}

function goalToLead(goal) {
  const cleanGoal = cleanSummaryText(goal).replace(/[。.]$/, "");
  if (/できる$|担う$|握れている$|進められる$|回せる$/.test(cleanGoal)) return `${cleanGoal}ように`;
  return `${cleanGoal}を進められるように`;
}

function makeSummaryBackground(summary) {
  const lines = [];
  const scopes = summarizeScopeItems(summary);
  if (scopes.length) {
    lines.push(`引継ぎ対象は、${joinJapaneseList(scopes)}など${summary.handovers.length > 4 ? "広い" : "が中心"}。`);
  } else if (summary.topItems.length) {
    lines.push(`論点は、${joinJapaneseList(summary.topItems.slice(0, 5))}が中心。`);
  } else {
    lines.push("論点がまだ分散しているため、全体像を短く整理する。");
  }

  if (summary.exclusions.length) {
    lines.push(`一方で、${joinJapaneseList(summarizeExclusions(summary.exclusions))}の判断は担当外にする。`);
  } else if (summary.goals.length) {
    lines.push(`目指す状態は、${joinJapaneseList(summary.goals.slice(0, 3))}。`);
  }

  return lines.slice(0, 2);
}

function makeSummaryActions(summary) {
  const actions = [];
  if (summary.handovers.length) {
    actions.push("引継ぎ項目を「日次運用」「定例」「判断が必要なもの」に分ける");
  } else {
    actions.push("ノードを「課題」「背景」「次にやること」に分ける");
  }

  if (summary.exclusions.length || summary.goals.length) {
    const subject = summary.assignee ? `${summary.assignee}が` : "";
    actions.push(`${subject}判断してよい範囲と、相談すべき範囲を明文化する`);
  } else {
    actions.push("優先度が高いものを1つ選ぶ");
  }

  const operatingTools = summarizeOperatingTools(summary.handovers);
  if (operatingTools.length) {
    const subject = summary.assignee ? `${summary.assignee}が` : "";
    actions.push(`${joinJapaneseList(operatingTools)}を、${subject}回せる形に整える`);
  } else {
    actions.push("次に試す小さなアクションを1つ決める");
  }

  return actions.slice(0, 3);
}

function summarizeScopeItems(summary) {
  const texts = [...summary.handovers, ...summary.goals];
  const items = [];
  addSummaryItem(items, texts, /スケジュール|ガント|進捗/, "スケジュール管理");
  addSummaryItem(items, texts, /課題/, "課題整理");
  addSummaryItem(items, texts, /スプシ|spreadsheet/i, "スプシ運用");
  addSummaryItem(items, texts, /定例/, "各定例");
  addSummaryItem(items, texts, /2D|3D/i, "2D・3D確認");
  addSummaryItem(items, texts, /ID/, "ID整理");
  summary.handovers.forEach((item) => {
    if (items.length < 5 && !items.some((existing) => item.includes(existing))) items.push(item);
  });
  return items.slice(0, 5);
}

function summarizeExclusions(exclusions) {
  const items = [];
  addSummaryItem(items, exclusions, /品質|クオリティ/, "品質");
  addSummaryItem(items, exclusions, /表現/, "表現");
  addSummaryItem(items, exclusions, /工数/, "工数増");
  addSummaryItem(items, exclusions, /レギュレーション/, "レギュレーション更新");
  exclusions.forEach((item) => {
    if (items.length < 4 && !items.includes(item)) items.push(item.replace(/判断|最終決定/g, ""));
  });
  return items.slice(0, 4);
}

function summarizeOperatingTools(handovers) {
  const tools = [];
  addSummaryItem(tools, handovers, /ガント/, "ガント");
  addSummaryItem(tools, handovers, /スプシ|spreadsheet/i, "スプシ");
  addSummaryItem(tools, handovers, /課題/, "課題一覧");
  addSummaryItem(tools, handovers, /定例/, "定例");
  return tools.slice(0, 3);
}

function addSummaryItem(items, texts, pattern, label) {
  if (texts.some((text) => pattern.test(text)) && !items.includes(label)) items.push(label);
}

function joinJapaneseList(items) {
  return items.filter(Boolean).join("、");
}

function extractAssignee(text) {
  const match = cleanSummaryText(text).match(/([^\s　#-]+さん)/);
  return match ? match[1] : "";
}

function extractTheme(text) {
  return cleanSummaryText(text)
    .replace(/^#+\s*/, "")
    .replace(/([^\s　#-]+さん)/, "")
    .replace(/オンボーディング|オンボ|onboarding/gi, "")
    .trim();
}

function cleanSummaryText(text) {
  return String(text || "").replace(/^[-*#\s　]+/, "").trim();
}

function cleanSummaryKey(text) {
  return cleanSummaryText(text).replace(/\s|　/g, "");
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
      type: normalizeNodeType(node.type),
      relationType: normalizeRelationType(node.relationType),
      layer: getNodeLayer(node),
      parallelOf: node.parallelOf || "",
      offset: normalizeOffset(node.offset),
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
    node.type = normalizeNodeType(item.type);
    node.relationType = normalizeRelationType(item.relationType);
    node.layer = normalizeLayer(item.layer);
    node.parallelOf = typeof item.parallelOf === "string" ? item.parallelOf : "";
    node.offset = normalizeOffset(item.offset);
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
}

function setActiveMap(map, shouldFit = true, resetHistory = true) {
  state.mapId = map.id;
  state.mapName = map.name;
  state.tree = normalizeNode(map.tree);
  const settings = normalizeSettings(map.settings);
  state.maxDepth = settings.maxDepth;
  state.horizontalSpacing = settings.horizontalSpacing;
  state.verticalSpacing = settings.verticalSpacing;
  state.snapStep = settings.snapStep;
  state.selectedId = state.tree.id;
  state.flashId = null;
  state.removingId = null;
  state.search = "";
  state.isLayer3d = false;
  state.layerFilterDepth = 0;
  state.focusLayerDepth = 0;
  state.focusNodeId = "";
  state.dragGuide = { x: null, y: null };
  document.body.classList.remove("layer-3d");
  els.viewport.classList.remove("is-layer-3d");
  if (resetHistory) {
    state.undoStack = [];
    state.redoStack = [];
  }
  els.searchInput.value = "";
  els.depthSlider.value = state.maxDepth;
  els.horizontalSpacingSlider.value = state.horizontalSpacing;
  els.verticalSpacingSlider.value = state.verticalSpacing;
  els.snapStepSlider.value = state.snapStep;
  updateSnapStepValue();
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

async function savePngFile() {
  const { canvas, width, height } = renderPngCanvas();
  const fileName = `${safeFileName(state.mapName || state.tree.text)}.png`;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("PNGを作成できませんでした。");

  if ("showSaveFilePicker" in window) {
    const handle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [{ description: "PNG", accept: { "image/png": [".png"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } else {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  els.statusText.textContent = `${fileName} を保存しました。${width}×${height}px / 100%`;
}

function renderPngCanvas() {
  layoutTree();
  const bounds = getPngExportBounds();
  if (!bounds) throw new Error("保存できるノードがありません。");
  if (
    bounds.width > PNG_EXPORT_MAX_SIDE ||
    bounds.height > PNG_EXPORT_MAX_SIDE ||
    bounds.width * bounds.height > PNG_EXPORT_MAX_PIXELS
  ) {
    throw new Error(`PNGが大きすぎます。現在 ${bounds.width}×${bounds.height}px です。`);
  }

  const canvas = document.createElement("canvas");
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const ctx = canvas.getContext("2d");
  const palette = getPngPalette();
  drawPngBackground(ctx, bounds, palette);
  drawPngEdges(ctx, bounds);
  drawPngNodes(ctx, bounds, palette);
  return { canvas, width: bounds.width, height: bounds.height };
}

function getPngExportBounds() {
  const positions = [...state.positions.values()].filter((pos) => shouldRenderLayer(pos.layer));
  if (!positions.length) return null;
  const minX = Math.floor(Math.min(...positions.map((pos) => pos.x - pos.width / 2)) - PNG_EXPORT_PADDING);
  const maxX = Math.ceil(Math.max(...positions.map((pos) => pos.x + pos.width / 2)) + PNG_EXPORT_PADDING);
  const minY = Math.floor(Math.min(...positions.map((pos) => pos.y - pos.height / 2)) - PNG_EXPORT_PADDING);
  const maxY = Math.ceil(Math.max(...positions.map((pos) => pos.y + pos.height / 2)) + PNG_EXPORT_PADDING);
  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function getPngPalette() {
  const style = getComputedStyle(document.documentElement);
  return {
    canvas: readCssColor(style, "--canvas", "#101820"),
    line: readCssColor(style, "--line", "#2b3948"),
    surface: readCssColor(style, "--surface", "#171f29"),
    nodeBg: readCssColor(style, "--node-bg", "#182331"),
    ink: readCssColor(style, "--ink", "#edf2f7"),
    muted: readCssColor(style, "--muted", "#a7b3c4"),
    danger: readCssColor(style, "--danger", "#ff8a80"),
    shadow: document.documentElement.dataset.theme === "dark" ? "rgba(0,0,0,0.28)" : "rgba(20,32,48,0.12)",
  };
}

function readCssColor(style, name, fallback) {
  return style.getPropertyValue(name).trim() || fallback;
}

function drawPngBackground(ctx, bounds, palette) {
  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, bounds.width, bounds.height);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.9;

  const grid = 44;
  const startX = Math.floor(bounds.minX / grid) * grid;
  const startY = Math.floor(bounds.minY / grid) * grid;
  for (let x = startX; x <= bounds.minX + bounds.width; x += grid) {
    const localX = Math.round(x - bounds.minX) - 0.5;
    ctx.beginPath();
    ctx.moveTo(localX, 0);
    ctx.lineTo(localX, bounds.height);
    ctx.stroke();
  }
  for (let y = startY; y <= bounds.minY + bounds.height; y += grid) {
    const localY = Math.round(y - bounds.minY) - 0.5;
    ctx.beginPath();
    ctx.moveTo(0, localY);
    ctx.lineTo(bounds.width, localY);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawPngEdges(ctx, bounds) {
  const matches = getSearchMatches();
  const hasSearch = state.search.trim().length > 0;
  state.edgeList.forEach((edge) => {
    if (!shouldRenderEdge(edge)) return;
    const from = state.positions.get(edge.from);
    const to = state.positions.get(edge.to);
    if (!from || !to) return;
    const isConnector = isLayerConnectorEdge(edge);
    const fromSide = isConnector ? 0 : to.x >= from.x ? from.width / 2 : -from.width / 2;
    const toSide = isConnector ? 0 : to.x >= from.x ? -to.width / 2 : to.width / 2;
    const connectorDirection = isConnector && to.y < from.y ? -1 : 1;
    const startX = from.x + fromSide - bounds.minX;
    const endX = to.x + toSide - bounds.minX;
    const startY = from.y + (isConnector ? (from.height / 2) * connectorDirection : 0) - bounds.minY;
    const endY = to.y - (isConnector ? (to.height / 2) * connectorDirection : 0) - bounds.minY;
    const curve = isConnector ? Math.abs(endY - startY) / 2 : Math.max(82, Math.abs(endX - startX) * 0.42);
    const direction = to.x >= from.x ? 1 : -1;
    const className = edgeClass(edge, matches, hasSearch);
    const relationType = normalizeRelationType(edge.relationType);
    const isMuted = className.includes("is-muted") || className.includes("is-focus-muted");
    ctx.save();
    ctx.globalAlpha = isMuted ? 0.12 : isConnector ? 0.58 : 0.72;
    ctx.strokeStyle = relationType === "risk" ? "#f59e0b" : edge.color;
    ctx.lineWidth = relationType === "risk" ? 3 : isConnector ? 2 : 2.4;
    ctx.lineCap = "round";
    if (isConnector) {
      ctx.setLineDash([8, 7]);
    } else if (relationType === "note") {
      ctx.setLineDash([4, 6]);
    } else if (relationType === "dependency") {
      ctx.setLineDash([12, 6, 3, 6]);
    } else if (relationType === "risk") {
      ctx.setLineDash([7, 5]);
    }
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    if (isConnector) {
      const midY = (startY + endY) / 2;
      ctx.bezierCurveTo(startX, midY, endX, midY, endX, endY);
    } else {
      ctx.bezierCurveTo(startX + curve * direction, startY, endX - curve * direction, endY, endX, endY);
    }
    ctx.stroke();
    ctx.restore();
  });
}

function drawPngNodes(ctx, bounds, palette) {
  const matches = getSearchMatches();
  const hasSearch = state.search.trim().length > 0;
  walk(state.tree, (node) => {
    const pos = state.positions.get(node.id);
    if (!pos) return;
    if (!shouldRenderLayer(pos.layer)) return;
    const className = nodeClass(node, pos, matches, hasSearch);
    const isMuted = className.includes("is-muted") || className.includes("is-focus-muted");
    const isMatch = className.includes("is-match");
    ctx.save();
    ctx.globalAlpha = isMuted ? 0.18 : 1;
    drawPngNode(ctx, node, pos, bounds, palette, isMatch);
    ctx.restore();
  });
}

function drawPngNode(ctx, node, pos, bounds, palette, isMatch) {
  const x = pos.x - bounds.minX - pos.width / 2;
  const y = pos.y - bounds.minY - pos.height / 2;
  const branch = pos.color;
  const isGhost = Boolean(node.parallelOf);
  const fill = isGhost ? mixColors(palette.nodeBg, branch, 0.04) : mixColors(palette.nodeBg, branch, pos.depth === 0 ? 0.16 : 0.08);
  const border = mixColors(branch, palette.line, pos.depth === 0 ? 0.2 : 0.38);

  ctx.shadowColor = palette.shadow;
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  roundedRectPath(ctx, x, y, pos.width, pos.height, 8);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = "transparent";

  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  if (isGhost) ctx.setLineDash([7, 5]);
  roundedRectPath(ctx, x, y, pos.width, pos.height, 8);
  ctx.stroke();
  ctx.setLineDash([]);

  if (pos.depth > 0) {
    roundedLeftRectPath(ctx, x, y, 6, pos.height, 8);
    ctx.fillStyle = branch;
    ctx.fill();
  }

  if (isMatch) {
    roundedRectPath(ctx, x - 4, y - 4, pos.width + 8, pos.height + 8, 10);
    ctx.strokeStyle = "rgba(255,209,102,0.72)";
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  if (isGhost) {
    roundedRectPath(ctx, x + 8, y + 8, pos.width - 16, pos.height - 16, 6);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = mixColors(branch, palette.canvas, 0.44);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawPngNodeTypeBadge(ctx, node, x, y, pos, palette);
  drawPngNodeText(ctx, node.text, x, y, pos, palette);
  drawPngNodeActions(ctx, node, x, y, pos, palette);
}

function drawPngNodeTypeBadge(ctx, node, x, y, pos, palette) {
  const type = normalizeNodeType(node.type);
  const badgeX = x + 14;
  const badgeY = y + pos.height / 2 - 12;
  roundedRectPath(ctx, badgeX, badgeY, 24, 24, 7);
  ctx.fillStyle = getPngNodeTypeFill(type, pos.color, palette);
  ctx.fill();
  ctx.strokeStyle = mixColors(pos.color, palette.line, 0.32);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = palette.ink;
  ctx.font = '800 12px "Segoe UI", "Yu Gothic UI", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(NODE_TYPES[type].icon, badgeX + 12, badgeY + 12);
}

function drawPngNodeText(ctx, text, x, y, pos, palette) {
  const isRoot = pos.depth === 0;
  const fontSize = isRoot ? 17 : 14;
  const lineHeight = isRoot ? 22 : 19;
  const textX = x + 46;
  const textWidth = Math.max(64, pos.width - 152);
  const lines = wrapCanvasText(ctx, text, textWidth, fontSize, isRoot);
  const maxLines = Math.max(1, Math.floor((pos.height - 20) / lineHeight));
  const visibleLines = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    visibleLines[visibleLines.length - 1] = trimCanvasText(ctx, `${visibleLines[visibleLines.length - 1]}...`, textWidth);
  }
  const textBlockHeight = visibleLines.length * lineHeight;
  let textY = y + (pos.height - textBlockHeight) / 2 + fontSize;

  ctx.fillStyle = palette.ink;
  ctx.font = `${isRoot ? "700 " : ""}${fontSize}px "Segoe UI", "Yu Gothic UI", "Hiragino Sans", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  visibleLines.forEach((line) => {
    ctx.fillText(line, textX, textY);
    textY += lineHeight;
  });
}

function getPngNodeTypeFill(type, branch, palette) {
  const typeColor =
    type === "task"
      ? "#0e9f6e"
      : type === "decision"
        ? "#7c3aed"
        : type === "risk"
          ? "#f59e0b"
          : type === "question"
            ? "#008a9a"
            : branch;
  return mixColors(typeColor, palette.surface, type === "idea" ? 0.76 : 0.58);
}

function wrapCanvasText(ctx, text, maxWidth, fontSize, isRoot) {
  ctx.font = `${isRoot ? "700 " : ""}${fontSize}px "Segoe UI", "Yu Gothic UI", "Hiragino Sans", sans-serif`;
  const chars = [...String(text || "無題")];
  const lines = [];
  let current = "";
  chars.forEach((char) => {
    const next = `${current}${char}`;
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current);
      current = char.trimStart();
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  return lines.length ? lines : ["無題"];
}

function trimCanvasText(ctx, text, maxWidth) {
  const ellipsis = "...";
  if (ctx.measureText(ellipsis).width > maxWidth) return "";
  let value = text;
  while (value.length > ellipsis.length && ctx.measureText(value).width > maxWidth) {
    value = `${value.slice(0, -(ellipsis.length + 1))}${ellipsis}`;
  }
  return value;
}

function drawPngNodeActions(ctx, node, x, y, pos, palette) {
  const startX = x + pos.width - 88;
  const buttonY = y + pos.height / 2 - 13;
  const labels = ["+", "×", node.children.length ? (node.collapsed ? "▸" : "▾") : ""];
  labels.forEach((label, index) => {
    if (!label) return;
    const buttonX = startX + index * 31;
    const disabled = node.id === state.tree.id && index === 1;
    ctx.save();
    ctx.globalAlpha *= disabled ? 0.32 : 0.72;
    roundedRectPath(ctx, buttonX, buttonY, 26, 26, 7);
    ctx.fillStyle = mixColors(pos.color, palette.surface, 0.78);
    ctx.fill();
    ctx.strokeStyle = mixColors(pos.color, palette.line, 0.48);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = index === 1 ? palette.danger : palette.ink;
    ctx.font = '700 14px "Segoe UI", "Yu Gothic UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, buttonX + 13, buttonY + 13);
    ctx.restore();
  });
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function roundedLeftRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + width, y);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function mixColors(first, second, secondWeight) {
  const a = parseCssColor(first);
  const b = parseCssColor(second);
  const w2 = clamp(secondWeight, 0, 1);
  const w1 = 1 - w2;
  return `rgba(${Math.round(a.r * w1 + b.r * w2)}, ${Math.round(a.g * w1 + b.g * w2)}, ${Math.round(
    a.b * w1 + b.b * w2,
  )}, ${(a.a * w1 + b.a * w2).toFixed(3)})`;
}

function parseCssColor(color) {
  const value = String(color || "").trim();
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].length === 3 ? [...hex[1]].map((char) => `${char}${char}`).join("") : hex[1];
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => Number(part.trim()));
    return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: Number.isFinite(parts[3]) ? parts[3] : 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
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
      state.snapStep = settings.snapStep;
      els.depthSlider.value = state.maxDepth;
      els.horizontalSpacingSlider.value = state.horizontalSpacing;
      els.verticalSpacingSlider.value = state.verticalSpacing;
      els.snapStepSlider.value = state.snapStep;
      updateSnapStepValue();
      state.selectedId = state.tree.id;
      state.mapName = state.mapName || state.tree.text;
      state.isLayer3d = false;
      state.layerFilterDepth = 0;
      state.focusLayerDepth = 0;
      state.focusNodeId = "";
      state.dragGuide = { x: null, y: null };
      document.body.classList.remove("layer-3d");
      els.viewport.classList.remove("is-layer-3d");
      render();
      fitToView();
    } catch (error) {
      els.statusText.textContent = `反映に失敗しました: ${error.message}`;
    }
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

  els.nodeTypeSelect.addEventListener("change", () => {
    setSelectedNodeType(els.nodeTypeSelect.value);
  });

  els.relationTypeSelect.addEventListener("change", () => {
    setSelectedRelationType(els.relationTypeSelect.value);
  });

  els.focusNodeButton.addEventListener("click", () => {
    toggleFocusSelected();
  });

  els.jumpSourceButton.addEventListener("click", () => {
    jumpToSourceNode();
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

  document.getElementById("showAllLayersButton").addEventListener("click", () => {
    setLayer3dMode(true);
  });

  document.getElementById("exportJsonButton").addEventListener("click", () => {
    els.exportOutput.value = JSON.stringify({ tree: state.tree, settings: currentSettings() }, null, 2);
  });

  document.getElementById("exportMarkdownButton").addEventListener("click", () => {
    els.exportOutput.value = toMarkdown(state.tree, { includeMeta: true }).join("\n");
  });

  document.getElementById("savePngButton").addEventListener("click", async () => {
    try {
      await savePngFile();
    } catch (error) {
      els.statusText.textContent =
        error.name === "AbortError" ? "PNG保存を中止しました。" : `PNG保存に失敗しました: ${error.message}`;
    }
  });

  document.getElementById("summaryButton").addEventListener("click", () => {
    els.summaryOutput.value = summarizeTree(state.tree);
    els.statusText.textContent = "要約を作成しました。";
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

  els.snapStepSlider.addEventListener("input", () => {
    state.snapStep = Number(els.snapStepSlider.value);
    updateSnapStepValue();
    saveTree();
  });

  document.getElementById("zoomOutButton").addEventListener("click", () => setZoom(state.zoom * 0.86));
  document.getElementById("zoomInButton").addEventListener("click", () => setZoom(state.zoom * 1.16));
  document.getElementById("zoomResetButton").addEventListener("click", () => {
    state.zoom = 1;
    centerRoot();
  });

  document.getElementById("view3dButton").addEventListener("click", () => {
    setLayer3dMode(true);
  });

  document.getElementById("clearLayerButton").addEventListener("click", () => {
    clearLayerFilter();
  });

  const layer3dControls = document.getElementById("layer3dControls");
  layer3dControls.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  document.getElementById("layerUpButton").addEventListener("click", () => {
    changeFocusLayer(-1);
  });

  document.getElementById("layerDownButton").addEventListener("click", () => {
    changeFocusLayer(1);
  });

  document.getElementById("addLowerLayerButton").addEventListener("click", () => {
    addLowerLayerNode();
  });

  document.getElementById("commitLayerButton").addEventListener("click", () => {
    commitFocusedLayerTo2d();
  });

  document.getElementById("exit3dButton").addEventListener("click", () => {
    setLayer3dMode(false);
  });

  document.getElementById("maximizeMapButton").addEventListener("click", () => {
    setMapMaximized(true);
  });

  const restoreMapButton = document.getElementById("restoreMapButton");
  restoreMapButton.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  restoreMapButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setMapMaximized(false);
  });

  document.getElementById("themeToggle").addEventListener("click", () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  });

  document.addEventListener("pointerdown", (event) => {
    if (els.nodeContextMenu?.hidden) return;
    if (els.nodeContextMenu.contains(event.target)) return;
    hideNodeContextMenu();
  });

  window.addEventListener("blur", hideNodeContextMenu);
}

function wireKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.nodeContextMenu && !els.nodeContextMenu.hidden) {
      event.preventDefault();
      hideNodeContextMenu();
      return;
    }

    if (event.key === "Escape" && state.isLayer3d) {
      event.preventDefault();
      setLayer3dMode(false);
      return;
    }

    if (event.key === "Escape" && document.body.classList.contains("map-maximized")) {
      event.preventDefault();
      setMapMaximized(false);
      return;
    }

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

function setLayer3dMode(isEnabled) {
  if (state.isLayer3d === isEnabled) return;
  if (isEnabled) {
    state.layerFilterDepth = null;
    state.focusLayerDepth = getNodeLayer(findNode(state.selectedId)?.node);
  } else {
    state.layerFilterDepth = 0;
    state.focusLayerDepth = 0;
    ensureSelectedNodeVisible();
  }

  state.isLayer3d = isEnabled;
  document.body.classList.toggle("layer-3d", isEnabled);
  els.viewport.classList.toggle("is-layer-3d", isEnabled);
  render();
  requestAnimationFrame(fitToView);
}

function changeFocusLayer(delta) {
  if (!state.isLayer3d) return;
  state.focusLayerDepth = clamp(state.focusLayerDepth + delta, 0, getMaxRenderedLayer());
  render();
}

function addLowerLayerNode() {
  if (!state.isLayer3d) return;
  const found = findNode(state.selectedId);
  if (!found) return;
  pushHistory();
  found.node.collapsed = false;
  const layer = getNodeLayer(found.node) + 1;
  const child = normalizeNode({
    text: found.node.text,
    type: normalizeNodeType(found.node.type),
    relationType: "note",
    layer,
    parallelOf: found.node.id,
    offset: { x: 0, y: 0 },
    children: [],
  });
  found.node.children.push(child);
  state.selectedId = child.id;
  state.focusLayerDepth = layer;
  state.flashId = child.id;
  render();
}

function commitFocusedLayerTo2d() {
  if (!state.isLayer3d) return;
  state.layerFilterDepth = state.focusLayerDepth;
  state.isLayer3d = false;
  document.body.classList.remove("layer-3d");
  els.viewport.classList.remove("is-layer-3d");
  render();
  requestAnimationFrame(fitToView);
  els.statusText.textContent = `階層 ${state.layerFilterDepth} のみを2D表示にしました。`;
}

function clearLayerFilter() {
  if (state.layerFilterDepth === 0 && !state.isLayer3d) return;
  state.isLayer3d = false;
  state.layerFilterDepth = 0;
  state.focusLayerDepth = 0;
  ensureSelectedNodeVisible();
  document.body.classList.remove("layer-3d");
  els.viewport.classList.remove("is-layer-3d");
  render();
  requestAnimationFrame(fitToView);
  els.statusText.textContent = "通常の2D表示に戻しました。";
}

function ensureSelectedNodeVisible() {
  const found = findNode(state.selectedId);
  if (!found || !shouldRenderLayer(getNodeLayer(found.node))) {
    state.selectedId = state.tree.id;
  }
}

function ensureFocusNodeVisible() {
  if (!state.focusNodeId) return;
  const found = findNode(state.focusNodeId);
  if (!found || !shouldRenderLayer(getNodeLayer(found.node))) {
    state.focusNodeId = "";
  }
}

function updateLayerControls() {
  const controls = document.getElementById("layer3dControls");
  const view3dButton = document.getElementById("view3dButton");
  const clearLayerButton = document.getElementById("clearLayerButton");
  const layerLabel = document.getElementById("layerLevelLabel");
  const layerUpButton = document.getElementById("layerUpButton");
  const layerDownButton = document.getElementById("layerDownButton");
  const maxLayer = getMaxRenderedLayer();

  controls.hidden = !state.isLayer3d;
  view3dButton.hidden = state.isLayer3d;
  clearLayerButton.hidden = state.isLayer3d || state.layerFilterDepth === 0;
  layerLabel.textContent = `アクティブ ${state.focusLayerDepth}`;
  layerUpButton.disabled = state.focusLayerDepth <= 0;
  layerDownButton.disabled = state.focusLayerDepth >= maxLayer;
}

function setMapMaximized(isMaximized) {
  const alreadyMaximized = document.body.classList.contains("map-maximized");
  if (isMaximized === alreadyMaximized) return;

  const maximizeButton = document.getElementById("maximizeMapButton");
  const restoreButton = document.getElementById("restoreMapButton");

  if (isMaximized) {
    viewBeforeMapMaximize = {
      zoom: state.zoom,
      pan: { ...state.pan },
    };
  }

  document.body.classList.toggle("map-maximized", isMaximized);
  maximizeButton.hidden = isMaximized;
  restoreButton.hidden = !isMaximized;

  requestAnimationFrame(() => {
    if (isMaximized) {
      fitToView();
      return;
    }

    if (viewBeforeMapMaximize) {
      state.zoom = viewBeforeMapMaximize.zoom;
      state.pan = { ...viewBeforeMapMaximize.pan };
      viewBeforeMapMaximize = null;
      updateTransform();
    } else {
      fitToView();
    }
  });
}

function setZoom(nextZoom) {
  state.zoom = Math.min(1.8, Math.max(0.28, nextZoom));
  updateTransform();
}

function setZoomAtPoint(nextZoom, clientX, clientY, options = {}) {
  const rect = els.viewport.getBoundingClientRect();
  const viewportX = clientX - rect.left;
  const viewportY = clientY - rect.top;
  const previousZoom = state.zoom;
  const zoom = options.unbounded ? Math.max(0.0001, nextZoom) : Math.min(1.8, Math.max(0.28, nextZoom));
  if (zoom === previousZoom) return;

  const factor = zoom / previousZoom;
  state.zoom = zoom;
  state.pan.x = viewportX - (viewportX - state.pan.x) * factor;
  state.pan.y = viewportY - (viewportY - state.pan.y) * factor;
  updateTransform();
}

function centerRoot() {
  const rect = els.viewport.getBoundingClientRect();
  state.pan.x = rect.width / 2 - WORLD.cx * state.zoom;
  state.pan.y = rect.height / 2 - WORLD.cy * state.zoom;
  updateTransform();
}

function wirePanZoom() {
  let viewDrag = null;
  let last = { x: 0, y: 0 };
  let suppressContextMenu = false;

  els.viewport.addEventListener("pointerdown", (event) => {
    const mayaMode = getMayaNavigationMode(event);
    if (mayaMode) {
      event.preventDefault();
      hideNodeContextMenu();
      suppressContextMenu = mayaMode === "zoom";
      viewDrag = {
        mode: mayaMode,
        className:
          mayaMode === "orbit" ? "is-orbiting" : mayaMode === "zoom" ? "is-zoom-dragging" : "is-maya-panning",
      };
      last = { x: event.clientX, y: event.clientY };
      els.viewport.classList.add(viewDrag.className);
      els.viewport.setPointerCapture(event.pointerId);
      return;
    }

    if (event.target.closest(".mind-node") || event.button !== 0) return;
    viewDrag = { mode: "pan", className: "is-panning" };
    last = { x: event.clientX, y: event.clientY };
    els.viewport.classList.add(viewDrag.className);
    els.viewport.setPointerCapture(event.pointerId);
  });

  els.viewport.addEventListener("pointermove", (event) => {
    if (!viewDrag) return;
    event.preventDefault();
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;

    if (viewDrag.mode === "orbit") {
      state.view3d.yaw -= dx * 0.22;
      state.view3d.pitch -= dy * 0.18;
      updateTransform();
    } else if (viewDrag.mode === "zoom") {
      const factor = Math.exp(dx * 0.006);
      setZoomAtPoint(state.zoom * factor, event.clientX, event.clientY, { unbounded: true });
    } else {
      state.pan.x += dx;
      state.pan.y += dy;
      updateTransform();
    }

    last = { x: event.clientX, y: event.clientY };
  });

  const finishViewDrag = () => {
    if (!viewDrag) return;
    els.viewport.classList.remove(viewDrag.className);
    viewDrag = null;
  };

  els.viewport.addEventListener("pointerup", finishViewDrag);
  els.viewport.addEventListener("pointercancel", finishViewDrag);

  els.viewport.addEventListener("contextmenu", (event) => {
    if (suppressContextMenu || (state.isLayer3d && event.altKey)) {
      event.preventDefault();
      suppressContextMenu = false;
    }
  });

  els.viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      setZoomAtPoint(state.zoom * factor, event.clientX, event.clientY);
    },
    { passive: false },
  );
}

function getMayaNavigationMode(event) {
  if (!state.isLayer3d) return "";
  const isAltNavigation = event.altKey;
  const isUiTarget = Boolean(
    event.target.closest(
      ".mind-node, .node-action, .layer-3d-controls, .context-menu, .restore-map-button, button, input, textarea, select",
    ),
  );
  if (!isAltNavigation && isUiTarget) return "";
  if (event.button === 0) return "orbit";
  if (event.button === 2) return "zoom";
  if (event.button === 1) return "pan";
  return "";
}

function init() {
  els.outlineInput.value = toMarkdown(state.tree).join("\n");
  els.exportOutput.value = toMarkdown(state.tree).join("\n");
  els.depthSlider.value = state.maxDepth;
  els.horizontalSpacingSlider.value = state.horizontalSpacing;
  els.verticalSpacingSlider.value = state.verticalSpacing;
  els.snapStepSlider.value = state.snapStep;
  updateSnapStepValue();
  updateMapSelect();
  wireControls();
  wireKeyboardShortcuts();
  wirePanZoom();
  render();
  requestAnimationFrame(fitToView);
}

init();
