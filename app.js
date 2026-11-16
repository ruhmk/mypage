// マップの保存先はMDファイルだけ。ブラウザには「作業中の写し」を1つだけ置き、
// 保存前にブラウザを閉じても続きから再開できるようにする。
const WORKING_COPY_KEY = "knowledge-map-canvas-working-v2";
// 以前の「保存」でブラウザ内に置いていたマップ一覧（廃止）。引き取り用に読むだけで、もう書き込まない。
const LEGACY_STATE_KEY = "knowledge-map-canvas-state-v1";
const LEGACY_MAPS_KEY = "knowledge-map-canvas-maps-v1";
const FILE_HANDLE_DB = "knowledge-map-canvas";
const FILE_HANDLE_STORE = "file-handles";
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

const initialWork = loadWorkingCopy();
const initialSettings = normalizeSettings(initialWork.settings);

const state = {
  tree: initialWork.tree,
  // ファイル名がないときに表示や保存先の候補に使う名前
  mapName: initialWork.mapName,
  fileName: initialWork.fileName,
  fileHandle: null,
  // 最後に開いた/保存した時点の内容。これと違えば「未保存の変更あり」
  savedSignature: initialWork.savedSignature,
  isDirty: false,
  selectedId: initialWork.tree.id,
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
  exportOutput: document.getElementById("exportOutput"),
  selectionLabel: document.getElementById("selectionLabel"),
  statusText: document.getElementById("statusText"),
  searchInput: document.getElementById("searchInput"),
  depthSlider: document.getElementById("depthSlider"),
  horizontalSpacingSlider: document.getElementById("horizontalSpacingSlider"),
  verticalSpacingSlider: document.getElementById("verticalSpacingSlider"),
  snapStepSlider: document.getElementById("snapStepSlider"),
  snapStepValue: document.getElementById("snapStepValue"),
  markdownFileInput: document.getElementById("markdownFileInput"),
  fileNameText: document.getElementById("fileNameText"),
  saveStateBadge: document.getElementById("saveStateBadge"),
  unsavedBanner: document.getElementById("unsavedBanner"),
  unsavedBannerText: document.getElementById("unsavedBannerText"),
  bannerDiscardButton: document.getElementById("bannerDiscardButton"),
  unsavedDialog: document.getElementById("unsavedDialog"),
  unsavedDialogText: document.getElementById("unsavedDialogText"),
  legacyMapsPanel: document.getElementById("legacyMapsPanel"),
  legacyMapList: document.getElementById("legacyMapList"),
  inspectorEmpty: document.getElementById("inspectorEmpty"),
  inspectorBody: document.getElementById("inspectorBody"),
  nodeTitleInput: document.getElementById("nodeTitleInput"),
  nodeMetaText: document.getElementById("nodeMetaText"),
  nodeDetailInput: document.getElementById("nodeDetailInput"),
  cardHeightText: document.getElementById("cardHeightText"),
  resetCardHeightButton: document.getElementById("resetCardHeightButton"),
  nodeTypeSelect: document.getElementById("nodeTypeSelect"),
  relationTypeSelect: document.getElementById("relationTypeSelect"),
  focusNodeButton: document.getElementById("focusNodeButton"),
  jumpSourceButton: document.getElementById("jumpSourceButton"),
  layerList: document.getElementById("layerList"),
  nodeContextMenu: document.getElementById("nodeContextMenu"),
  guideLayer: document.getElementById("guideLayer"),
  guideVertical: document.getElementById("guideVertical"),
  guideHorizontal: document.getElementById("guideHorizontal"),
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
    // 詳細・補足。以前の「メモ」(memo) もここへ引き継ぐ
    detail: normalizeDetail(node.detail ?? node.memo),
    // カードの縦幅を縮めたときの高さ（px）。null は「自動＝全部表示」
    cardHeight: normalizeCardHeight(node.cardHeight),
    type: normalizeNodeType(node.type),
    relationType: normalizeRelationType(node.relationType),
    layer: normalizeLayer(node.layer),
    parallelOf: typeof node.parallelOf === "string" ? node.parallelOf : "",
    offset: normalizeOffset(node.offset),
    collapsed: Boolean(node.collapsed),
    children: Array.isArray(node.children) ? node.children.map(normalizeNode) : [],
  };
}

function normalizeCardHeight(height) {
  const value = Number(height);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function normalizeDetail(detail) {
  return String(detail || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+$/, "");
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

// 起動時に何を表示するか。
// 1) 作業中の写しがあれば、それを復元（保存していない変更があればお知らせを出す）
// 2) なければ、以前ブラウザ内に保存していたマップ（最後に使っていたもの）を表示し、MDへの保存を促す
// 3) どちらもなければサンプル
function loadWorkingCopy() {
  try {
    const saved = JSON.parse(localStorage.getItem(WORKING_COPY_KEY) || "null");
    if (saved?.tree) {
      return {
        tree: normalizeNode(saved.tree),
        settings: saved.settings,
        mapName: String(saved.mapName || ""),
        fileName: String(saved.fileName || ""),
        savedSignature: typeof saved.savedSignature === "string" ? saved.savedSignature : null,
        source: "working",
      };
    }
  } catch {
    // 壊れていれば読み飛ばす
  }

  const legacy = readLegacyMaps();
  if (legacy.maps.length) {
    const active = legacy.maps.find((map) => map.id === legacy.activeId) || legacy.maps[0];
    return {
      tree: active.tree,
      settings: active.settings,
      mapName: active.name,
      fileName: "",
      savedSignature: null,
      source: "legacy",
    };
  }

  const tree = normalizeNode(clone(sampleTree));
  const settings = defaultSettings();
  return {
    tree,
    settings,
    mapName: "",
    fileName: "",
    savedSignature: makeDocumentSignature(tree, settings),
    source: "sample",
  };
}

function readLegacyMaps() {
  try {
    const savedMaps = JSON.parse(localStorage.getItem(LEGACY_MAPS_KEY) || "null");
    const maps = Array.isArray(savedMaps?.maps) ? savedMaps.maps.map(normalizeMapItem) : [];
    if (maps.length) return { maps, activeId: savedMaps.activeId };
    const single = localStorage.getItem(LEGACY_STATE_KEY);
    if (single) return { maps: [makeMapItem("最初のマップ", normalizeNode(JSON.parse(single)))], activeId: "" };
  } catch {
    // 読めないものは引き取らない
  }
  return { maps: [], activeId: "" };
}

function makeDocumentSignature(tree, settings) {
  return JSON.stringify({ tree: normalizeNode(tree), settings: normalizeSettings(settings) });
}

function currentSignature() {
  return makeDocumentSignature(state.tree, currentSettings());
}

function currentMapName() {
  if (state.fileName) return fileBaseName(state.fileName);
  return state.mapName || state.tree.text || "新しいマップ";
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

// 編集のたびに呼ばれる。ブラウザ内の「作業中の写し」を更新し、未保存かどうかを表示に反映する。
// （マップそのものの保存はMDファイルへの「保存」だけ）
function saveTree() {
  const signature = currentSignature();
  state.isDirty = signature !== state.savedSignature;
  try {
    localStorage.setItem(
      WORKING_COPY_KEY,
      JSON.stringify({
        version: 2,
        tree: state.tree,
        settings: currentSettings(),
        mapName: state.mapName,
        fileName: state.fileName,
        savedSignature: state.savedSignature,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // ブラウザの保存領域が使えなくても編集は続けられる
  }
  updateFileStatus();
}

function captureSnapshot() {
  return {
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
  // カードの高さは詳細の量で変わるので、自分の高さより狭い枠にはしない
  const ownSpan = Math.max(86, getNodeHeight(node, depth) + 18);
  const children = getLayoutChildren(node, depth);
  if (!children.length) return ownSpan;
  const childrenSpan =
    children.reduce((sum, child) => sum + measureSubtree(child, depth + 1), 0) +
    Math.max(0, children.length - 1) * state.verticalSpacing;
  return Math.max(ownSpan, childrenSpan);
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
  measureNodeHeights();

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
  const height = getNodeHeight(node, depth);
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

// カードの高さは、画面外に同じ作りのカードを置いて実際に測る（詳細の行数で縦が伸びるため）。
// 同じ内容なら測り直さないよう覚えておく。
const nodeHeightCache = new Map();
let nodeMeasureLayer = null;

function getNodeHeightKey(node, isRoot) {
  return [isRoot ? 1 : 0, node.text, node.detail || ""].join("\u0000");
}

// 詳細を全部見せたときの高さ
function getNaturalNodeHeight(node, depth) {
  const isRoot = depth === 0;
  return nodeHeightCache.get(getNodeHeightKey(node, isRoot)) || estimateNodeHeight(node, isRoot ? ROOT_WIDTH : NODE_WIDTH, depth);
}

// 詳細がないときの高さ（縦幅を縮められる下限。タイトルは必ず全部見せる）
function getBaseNodeHeight(node, depth) {
  return getNaturalNodeHeight({ text: node.text, detail: "" }, depth);
}

// 実際に使う高さ。縦幅を縮めていれば、その高さ（下限〜全部表示の範囲）
function getNodeHeight(node, depth) {
  const natural = getNaturalNodeHeight(node, depth);
  if (!node.cardHeight || !node.detail) return natural;
  return clamp(node.cardHeight, Math.min(getBaseNodeHeight(node, depth), natural), natural);
}

function isCardShortened(node, pos) {
  return Boolean(node.cardHeight && node.detail && pos.height < getNaturalNodeHeight(node, pos.depth) - 0.5);
}

function measureNodeHeights() {
  const pending = [];
  const pendingKeys = new Set();
  const addPending = (node, isRoot) => {
    const key = getNodeHeightKey(node, isRoot);
    if (nodeHeightCache.has(key) || pendingKeys.has(key)) return;
    pendingKeys.add(key);
    pending.push({ node, key, isRoot });
  };
  walk(state.tree, (node, depth) => {
    const isRoot = depth === 0;
    addPending(node, isRoot);
    // 縮めたときの下限を知るため、詳細なしの高さも測っておく
    if (node.detail) addPending({ text: node.text, detail: "", type: node.type, children: node.children }, isRoot);
  });
  if (!pending.length) return;

  if (nodeHeightCache.size + pending.length > 4000) nodeHeightCache.clear();
  if (!nodeMeasureLayer) {
    nodeMeasureLayer = document.createElement("div");
    nodeMeasureLayer.className = "node-measure-layer";
    nodeMeasureLayer.setAttribute("aria-hidden", "true");
    document.body.appendChild(nodeMeasureLayer);
  }

  const fragment = document.createDocumentFragment();
  const elements = pending.map((item) => {
    const nodeEl = createNodeShell(item.node, item.isRoot, { editable: false });
    // 枠線は枝の色を使うので、色がないと枠線ごと消えて幅が変わる。仮の色を入れて測る
    nodeEl.style.setProperty("--branch", BRANCH_COLORS[0]);
    fragment.appendChild(nodeEl);
    return nodeEl;
  });
  nodeMeasureLayer.appendChild(fragment);
  elements.forEach((nodeEl, index) => {
    const height = Math.ceil(nodeEl.getBoundingClientRect().height);
    if (height > 0) nodeHeightCache.set(pending[index].key, height);
  });
  nodeMeasureLayer.textContent = "";
}

// 画面のカードと高さ計測用のカードで、同じ中身を作る
function createNodeShell(node, isRoot, options = {}) {
  const editable = options.editable !== false;
  const nodeEl = document.createElement("article");
  nodeEl.className = `mind-node type-${normalizeNodeType(node.type)}${isRoot ? " root" : ""}`;
  nodeEl.style.setProperty("--node-width", `${isRoot ? ROOT_WIDTH : NODE_WIDTH}px`);

  const title = document.createElement("div");
  title.className = "node-title";
  title.textContent = node.text;
  if (editable) {
    title.contentEditable = "true";
    title.spellcheck = false;
    title.setAttribute("role", "textbox");
    title.setAttribute("aria-label", "Node text");
  }

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
  if (isRoot) deleteButton.disabled = true;
  actions.append(addChildButton, deleteButton, toggle);

  const detail = document.createElement("div");
  detail.className = "node-detail";
  detail.textContent = node.detail || "";
  if (editable) {
    setPlainTextEditable(detail);
    detail.spellcheck = false;
    detail.setAttribute("role", "textbox");
    detail.setAttribute("aria-multiline", "true");
    detail.setAttribute("aria-label", "詳細・補足");
  }

  nodeEl.append(content, actions, detail);
  if (editable && node.detail) {
    // 下端をドラッグして縦幅を縮める取っ手
    const handle = document.createElement("div");
    handle.className = "node-resize-handle";
    handle.title = "ドラッグで縦幅を変更（ダブルクリックで全部表示）";
    nodeEl.appendChild(handle);
  }
  return nodeEl;
}

// 縦幅を縮めたカードの見た目を合わせる。入りきる行数だけ詳細を見せ、残りは「…」で省略する
function applyCardHeight(nodeEl, height, naturalHeight) {
  const shortened = height < naturalHeight - 0.5;
  nodeEl.classList.toggle("has-fixed-height", shortened);
  nodeEl.style.height = shortened ? `${Math.round(height)}px` : "";
  updateDetailLineClamp(nodeEl);
}

function updateDetailLineClamp(nodeEl) {
  const detail = nodeEl.querySelector(".node-detail");
  if (!detail) return;
  if (!nodeEl.classList.contains("has-fixed-height")) {
    detail.style.removeProperty("--detail-lines");
    detail.classList.remove("is-cut-off");
    return;
  }
  const cardStyle = getComputedStyle(nodeEl);
  const detailStyle = getComputedStyle(detail);
  const content = nodeEl.querySelector(".node-content");
  const actions = nodeEl.querySelector(".node-actions");
  const rowBottom = Math.max(content.offsetTop + content.offsetHeight, actions.offsetTop + actions.offsetHeight);
  const available =
    nodeEl.clientHeight -
    (parseFloat(cardStyle.paddingBottom) || 0) -
    rowBottom -
    (parseFloat(cardStyle.rowGap) || 0) -
    (parseFloat(detailStyle.marginTop) || 0) -
    (parseFloat(detailStyle.paddingTop) || 0) -
    (parseFloat(detailStyle.borderTopWidth) || 0);
  const lineHeight = parseFloat(detailStyle.lineHeight) || 18;
  const lines = Math.floor((available + 1) / lineHeight);
  detail.classList.toggle("is-cut-off", lines < 1);
  detail.style.setProperty("--detail-lines", String(Math.max(1, lines)));
}

// 描画後に実際のカードの高さを確かめ、計測と違えば覚え直して並べ直す（文字の読み込み待ちなどで
// 最初の計測がずれた場合の保険）。入力中のカードは対象外。繰り返しは2回まで。
let heightCorrectionCount = 0;

function verifyRenderedHeights() {
  let changed = false;
  els.nodeLayer.querySelectorAll(".mind-node").forEach((nodeEl) => {
    if (nodeEl.contains(document.activeElement)) return;
    // 縦幅を縮めたカードは高さを指定しているので、計測の確かめには使えない
    if (nodeEl.classList.contains("has-fixed-height")) return;
    const pos = state.positions.get(nodeEl.dataset.id);
    const found = findNode(nodeEl.dataset.id);
    if (!pos || !found) return;
    const actual = nodeEl.offsetHeight;
    if (actual && Math.abs(actual - pos.height) > 1) {
      nodeHeightCache.set(getNodeHeightKey(found.node, pos.depth === 0), actual);
      changed = true;
    }
  });
  if (!changed) {
    heightCorrectionCount = 0;
    return;
  }
  if (heightCorrectionCount >= 2) return;
  heightCorrectionCount += 1;
  scheduleRelayout();
}

function setPlainTextEditable(element) {
  element.contentEditable = "plaintext-only";
  if (element.contentEditable !== "plaintext-only") element.contentEditable = "true";
}

function readEditableText(element) {
  return normalizeDetail(element.innerText.replace(/ /g, " "));
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

// 文字の編集でカードの高さが変わったときに、並びを計算し直す。
// 描画し直すとカードが作り直されるので、入力中の場所（タイトル/詳細とカーソル位置）を戻す。
let relayoutTimer = null;

function scheduleRelayout(delay = 0) {
  window.clearTimeout(relayoutTimer);
  relayoutTimer = window.setTimeout(() => {
    relayoutTimer = null;
    renderKeepingFocus();
  }, delay);
}

function renderKeepingFocus() {
  const active = document.activeElement;
  const activeNode = active?.closest?.(".mind-node");
  let restore = null;
  if (activeNode && els.nodeLayer.contains(activeNode)) {
    const role = active.classList.contains("node-detail") ? "detail" : active.classList.contains("node-title") ? "title" : "";
    if (role) restore = { id: activeNode.dataset.id, role, caret: getCaretOffset(active) };
  }
  render();
  if (!restore) return;
  const next = els.nodeLayer.querySelector(`.mind-node[data-id="${CSS.escape(restore.id)}"] .node-${restore.role}`);
  if (!next) return;
  if (restore.role === "detail") next.classList.add("is-editing");
  next.focus({ preventScroll: true });
  setCaretOffset(next, restore.caret);
}

function getCaretOffset(element) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.endContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(range.endContainer, range.endOffset);
  return before.toString().length;
}

function setCaretOffset(element, offset) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  let remaining = Number.isFinite(offset) ? offset : Infinity;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  let placed = false;
  while (textNode) {
    if (remaining <= textNode.length) {
      range.setStart(textNode, remaining);
      range.collapse(true);
      placed = true;
      break;
    }
    remaining -= textNode.length;
    textNode = walker.nextNode();
  }
  if (!placed) {
    range.selectNodeContents(element);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
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
    const nodeEl = createNodeShell(node, pos.depth === 0);
    nodeEl.className = nodeClass(node, pos, matches, hasSearch);
    if (isCardShortened(node, pos)) {
      nodeEl.classList.add("has-fixed-height");
      nodeEl.style.height = `${Math.round(pos.height)}px`;
    }
    nodeEl.dataset.id = node.id;
    nodeEl.dataset.type = normalizeNodeType(node.type);
    nodeEl.style.left = `${pos.x}px`;
    nodeEl.style.top = `${pos.y}px`;
    nodeEl.style.setProperty("--branch", pos.color);
    nodeEl.style.setProperty("--layer-y", `${state.isLayer3d ? pos.layerAxisY || 0 : 0}px`);
    if (state.isLayer3d) {
      nodeEl.style.zIndex = String(100000 + Math.round(pos.layerAxisY || 0));
    }
    applyNodeMotion(nodeEl, pos, previousPositions.get(node.id));
    fragment.appendChild(nodeEl);
  });

  els.floorLayer.appendChild(floorFragment);
  els.edgeLayer.appendChild(edgeFragment);
  els.edge3dLayer.appendChild(edge3dFragment);
  els.nodeLayer.appendChild(fragment);
  els.nodeLayer.querySelectorAll(".mind-node.has-fixed-height").forEach(updateDetailLineClamp);
  if (!state.isDraggingNode) verifyRenderedHeights();
  bindRenderedEvents();
  updateTransform();
  updateLabels();
  updateLayerControls();
  updateLayerPanel();
  updateAlignmentGuides();
  saveTree();
  clearFlashAfterAnimation();
}

function getLayerFloorBounds() {
  const layers = [...new Set([...state.positions.values()].map((pos) => pos.layer))].sort((a, b) => a - b);
  return layers.map((layer) => {
    const items = [...state.positions.values()].filter((pos) => pos.layer === layer);
    const paddingX = layer === 0 ? 140 : 170;
    const paddingY = layer === 0 ? 100 : 120;
    return {
      layer,
      minX: Math.min(...items.map((pos) => pos.x - pos.width / 2)) - paddingX,
      maxX: Math.max(...items.map((pos) => pos.x + pos.width / 2)) + paddingX,
      minY: Math.min(...items.map((pos) => pos.y - pos.height / 2)) - paddingY,
      maxY: Math.max(...items.map((pos) => pos.y + pos.height / 2)) + paddingY,
    };
  });
}

function renderLayerFloors(fragment) {
  getLayerFloorBounds().forEach(({ layer, minX, maxX, minY, maxY }) => {
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
    const haystack = `${node.text}\n${node.detail || ""}`.toLowerCase();
    if (haystack.includes(query)) matches.add(node.id);
  });
  return matches;
}

function isAncestorOfMatch(node, matches) {
  if (matches.has(node.id)) return true;
  return node.children.some((child) => isAncestorOfMatch(child, matches));
}

// カード下端の取っ手で縦幅を変える。上に動かすと縮み、入りきらない詳細は「…」になる。
// 全部が見える高さまで戻すと「自動（全部表示）」に戻る。ダブルクリックでも全部表示に戻る。
function bindCardResize(nodeEl, handle, id) {
  let resize = null;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (state.isLayer3d && event.altKey)) return;
    event.preventDefault();
    event.stopPropagation();
    hideNodeContextMenu();
    selectNode(id);
    const found = findNode(id);
    const pos = state.positions.get(id);
    if (!found || !pos) return;
    const natural = getNaturalNodeHeight(found.node, pos.depth);
    resize = {
      startY: event.clientY,
      startHeight: pos.height,
      height: pos.height,
      natural,
      base: Math.min(getBaseNodeHeight(found.node, pos.depth), natural),
      snapshot: captureSnapshot(),
    };
    handle.setPointerCapture(event.pointerId);
    nodeEl.classList.add("is-resizing");
  });

  handle.addEventListener("pointermove", (event) => {
    if (!resize) return;
    const dy = (event.clientY - resize.startY) / state.zoom;
    resize.height = clamp(resize.startHeight + dy, resize.base, resize.natural);
    applyCardHeight(nodeEl, resize.height, resize.natural);
  });

  const finish = () => {
    if (!resize) return;
    const { height, natural, startHeight, snapshot } = resize;
    resize = null;
    nodeEl.classList.remove("is-resizing");
    if (Math.abs(height - startHeight) < 1) return;
    const found = findNode(id);
    if (!found) return;
    pushHistory(snapshot);
    found.node.cardHeight = height >= natural - 1 ? null : Math.round(height);
    render();
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);

  handle.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetCardHeight(id);
  });
}

function resetCardHeight(id) {
  const found = findNode(id);
  if (!found || !found.node.cardHeight) return;
  pushHistory();
  found.node.cardHeight = null;
  render();
}

function bindRenderedEvents() {
  document.querySelectorAll(".mind-node").forEach((nodeEl) => {
    const id = nodeEl.dataset.id;
    const title = nodeEl.querySelector(".node-title");
    const detail = nodeEl.querySelector(".node-detail");
    const toggle = nodeEl.querySelector(".node-toggle");
    const addChildButton = nodeEl.querySelector(".node-add-child");
    const deleteButton = nodeEl.querySelector(".node-delete");
    let editSnapshot = null;
    let editRecorded = false;
    let textBeforeEdit = "";
    let detailSnapshot = null;
    let detailRecorded = false;
    let detailBeforeEdit = "";
    const resizeHandle = nodeEl.querySelector(".node-resize-handle");
    if (resizeHandle) bindCardResize(nodeEl, resizeHandle, id);

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
      textBeforeEdit = findNode(id)?.node.text || "";
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

    title.addEventListener("blur", () => {
      // 行数が変わるとカードの高さも変わるので、並びを計算し直す
      if ((findNode(id)?.node.text || "") !== textBeforeEdit) scheduleRelayout();
    });

    detail.addEventListener("focus", () => {
      detailSnapshot = captureSnapshot();
      detailRecorded = false;
      detailBeforeEdit = findNode(id)?.node.detail || "";
      detail.classList.add("is-editing");
    });

    detail.addEventListener("input", () => {
      const found = findNode(id);
      if (!found) return;
      if (!detailRecorded) {
        pushHistory(detailSnapshot || captureSnapshot());
        detailRecorded = true;
      }
      found.node.detail = readEditableText(detail);
      if (state.selectedId === id) updateInspector(found.node);
      saveTree();
    });

    detail.addEventListener("keydown", (event) => {
      // 詳細は複数行。Enterは改行、Esc か Ctrl+Enter で入力を終える
      if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        event.stopPropagation();
        detail.blur();
      }
    });

    detail.addEventListener("blur", () => {
      detail.classList.remove("is-editing");
      if ((findNode(id)?.node.detail || "") !== detailBeforeEdit) scheduleRelayout();
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

  appendContextSection([
    {
      label: found.node.detail ? "詳細を編集" : "詳細を書く",
      detail: "✎",
      action: () => editNodeDetailOnCard(id),
    },
    {
      label: "縦幅を戻して全部表示",
      detail: "↕",
      disabled: !found.node.cardHeight,
      action: () => resetCardHeight(id),
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

function editNodeDetailOnCard(id) {
  const detail = els.nodeLayer.querySelector(`.mind-node[data-id="${CSS.escape(id)}"] .node-detail`);
  if (!detail) {
    els.nodeDetailInput?.focus();
    return;
  }
  detail.classList.add("is-editing");
  detail.focus({ preventScroll: true });
  setCaretOffset(detail, null);
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
  els.statusText.textContent = `${currentMapName()}${layerText}${focusText} / ${visibleCount}件を表示中。`;
  updateInspector(found?.node);
}

// 右側のインスペクター: 選んでいるノードの詳細だけを出す
function updateInspector(node) {
  if (!els.inspectorBody) return;
  els.inspectorBody.hidden = !node;
  if (els.inspectorEmpty) els.inspectorEmpty.hidden = Boolean(node);
  if (!node) return;

  if (document.activeElement !== els.nodeTitleInput) els.nodeTitleInput.value = node.text;
  if (document.activeElement !== els.nodeDetailInput) els.nodeDetailInput.value = node.detail || "";
  els.nodeMetaText.textContent = describeNodeForInspector(node);
  updateCardHeightInfo(node);
  if (document.activeElement !== els.nodeTypeSelect) els.nodeTypeSelect.value = normalizeNodeType(node.type);
  els.relationTypeSelect.disabled = node.id === state.tree.id;
  if (document.activeElement !== els.relationTypeSelect) {
    els.relationTypeSelect.value = normalizeRelationType(node.relationType);
  }
  els.focusNodeButton.textContent = state.focusNodeId === node.id ? "フォーカス解除" : "フォーカス";
  els.jumpSourceButton.disabled = !(node.parallelOf && findNode(node.parallelOf));
}

function updateCardHeightInfo(node) {
  if (!els.cardHeightText || !els.resetCardHeightButton) return;
  const pos = state.positions.get(node.id);
  els.resetCardHeightButton.disabled = !node.cardHeight;
  if (!node.detail) {
    els.cardHeightText.textContent = "縦幅: 自動";
  } else if (!node.cardHeight) {
    els.cardHeightText.textContent = "縦幅: 自動（全部表示）";
  } else if (pos && isCardShortened(node, pos)) {
    els.cardHeightText.textContent = `縦幅: ${Math.round(pos.height)}px（…で省略中）`;
  } else {
    els.cardHeightText.textContent = `縦幅: ${node.cardHeight}pxまで（全部入っています）`;
  }
}

function describeNodeForInspector(node) {
  const found = findNode(node.id);
  const parts = [`階層 ${getNodeLayer(node)}`];
  if (node.parallelOf) {
    const source = findNode(node.parallelOf)?.node;
    parts.push(source ? `「${source.text}」のゴースト` : "ゴースト（元ノードなし）");
  } else if (found?.parent) {
    parts.push(`親: ${found.parent.text}`);
  } else {
    parts.push("中心のノード");
  }
  const childCount = node.children.filter((child) => !child.parallelOf).length;
  if (childCount) parts.push(`子 ${childCount}件`);
  return parts.join(" ・ ");
}

// インスペクターで書いた内容を、描画し直さずに今のカードへすぐ映す
function updateCardText(id) {
  const found = findNode(id);
  const nodeEl = els.nodeLayer.querySelector(`.mind-node[data-id="${CSS.escape(id)}"]`);
  if (!found || !nodeEl) return;
  const title = nodeEl.querySelector(".node-title");
  const detail = nodeEl.querySelector(".node-detail");
  if (title && document.activeElement !== title) title.textContent = found.node.text;
  if (detail && document.activeElement !== detail) detail.textContent = found.node.detail || "";
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
  const point = projectWorldPoint(pos.x, pos.y, state.isLayer3d ? getLayerAxisY(pos.layer) : 0);
  state.pan.x = rect.width / 2 - point.x * state.zoom;
  state.pan.y = rect.height / 2 - point.y * state.zoom;
  updateTransform();
}

// 3D表示で実際に見える位置を、canvasWorld の拡縮・PANをかける前の座標で返す。
// CSSと同じ順で計算する: canvasView の rotateX(pitch) rotateZ(yaw)（基点は WORLD の中心）
// → canvasWorld の perspective（基点も WORLD の中心）。z は床に垂直な高さ（layerAxisY）。
function projectWorldPoint(x, y, z = 0) {
  if (!state.isLayer3d) return { x, y };
  const yaw = (state.view3d.yaw * Math.PI) / 180;
  const pitch = (state.view3d.pitch * Math.PI) / 180;
  const dx = x - WORLD.cx;
  const dy = y - WORLD.cy;
  const turnedX = dx * Math.cos(yaw) - dy * Math.sin(yaw);
  const turnedY = dx * Math.sin(yaw) + dy * Math.cos(yaw);
  const tiltedY = turnedY * Math.cos(pitch) - z * Math.sin(pitch);
  const tiltedZ = turnedY * Math.sin(pitch) + z * Math.cos(pitch);
  // 視点の後ろに回り込んだ点で倍率が発散しないようにする
  const depth = Math.max(VIEW_PERSPECTIVE - tiltedZ, VIEW_PERSPECTIVE * 0.1);
  const scale = VIEW_PERSPECTIVE / depth;
  return { x: WORLD.cx + turnedX * scale, y: WORLD.cy + tiltedY * scale };
}

function getFlatMapBounds() {
  const positions = [...state.positions.values()].filter((pos) => shouldRenderLayer(pos.layer));
  if (!positions.length) return null;
  return {
    minX: Math.min(...positions.map((p) => p.x)) - 180,
    maxX: Math.max(...positions.map((p) => p.x)) + 180,
    // 詳細で縦に伸びたカードも収まるよう、カードの高さを含める（通常の高さなら以前と同じ余白）
    minY: Math.min(...positions.map((p) => p.y - p.height / 2)) - 86,
    maxY: Math.max(...positions.map((p) => p.y + p.height / 2)) + 86,
  };
}

// 3Dでは各階層の床の四隅を投影し、見えている形がまるごと入る範囲を求める
function getProjectedMapBounds() {
  const floors = getLayerFloorBounds();
  if (!floors.length) return null;
  const points = floors.flatMap(({ layer, minX, maxX, minY, maxY }) => {
    const z = getLayerAxisY(layer);
    return [
      projectWorldPoint(minX, minY, z),
      projectWorldPoint(maxX, minY, z),
      projectWorldPoint(minX, maxY, z),
      projectWorldPoint(maxX, maxY, z),
    ];
  });
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

// 3Dの操作バーに隠れる上端の高さ
function getViewportTopInset(viewportRect) {
  if (!state.isLayer3d) return 0;
  const controls = document.getElementById("layer3dControls");
  if (!controls || controls.hidden) return 0;
  const controlsRect = controls.getBoundingClientRect();
  if (!controlsRect.height) return 0;
  return clamp(controlsRect.bottom - viewportRect.top, 0, viewportRect.height / 3);
}

function updateTransform() {
  els.world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  // パースは倍率で割らずに固定する。canvasWorld の scale(zoom) は投影後にかかるので、
  // これで拡縮しても床・ノード・線の比率が変わらない（倍率で割ると拡大時にパースが強まる）。
  els.world.style.setProperty("--view-perspective", `${VIEW_PERSPECTIVE}px`);
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
  const bounds = state.isLayer3d ? getProjectedMapBounds() : getFlatMapBounds();
  if (!bounds) return;
  const topInset = getViewportTopInset(rect);
  const availableHeight = Math.max(1, rect.height - topInset);
  const mapWidth = Math.max(1, bounds.maxX - bounds.minX);
  const mapHeight = Math.max(1, bounds.maxY - bounds.minY);
  // 3Dは角度によって見かけが大きくなるので、全体が収まるまで縮小を許す
  const minZoom = state.isLayer3d ? 0.05 : 0.35;
  state.zoom = Math.min(1.1, Math.max(minZoom, Math.min(rect.width / mapWidth, availableHeight / mapHeight) * 0.92));
  state.pan.x = (rect.width - mapWidth * state.zoom) / 2 - bounds.minX * state.zoom;
  state.pan.y = topInset + (availableHeight - mapHeight * state.zoom) / 2 - bounds.minY * state.zoom;
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
  const detailLines = new Map();

  lines.slice(1).forEach((line) => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith(">")) {
      // 「> 」で始まる行は、直前のノードの詳細・補足
      const owner = stack[stack.length - 1].node;
      if (!detailLines.has(owner)) detailLines.set(owner, []);
      detailLines.get(owner).push(trimmedLine.replace(/^>\s?/, ""));
      return;
    }
    const indent = line.match(/^\s*/)[0].length;
    const textValue = line.trim().replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "");
    const node = normalizeNode({ text: textValue, children: [] });
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  });
  detailLines.forEach((items, node) => {
    node.detail = normalizeDetail(items.join("\n"));
  });

  if (extracted.metadata?.nodes) applyNodeMetadata(root, extracted.metadata.nodes);
  return { tree: root, settings: extracted.metadata?.settings ? normalizeSettings(extracted.metadata.settings) : null };
}

function toMarkdown(node, options = {}) {
  const lines = toMarkdownLines(node);
  if (!options.includeMeta) return lines;
  return [makeStateComment(), "", ...lines];
}

// 見出しの下に、詳細・補足を「> 」の行で続ける（AIや人がそのまま読める形）
function toMarkdownLines(node, depth = 0) {
  const prefix = depth === 0 ? "# " : `${"  ".repeat(depth - 1)}- `;
  const detailIndent = depth === 0 ? "" : "  ".repeat(depth);
  const detailLines = node.detail
    ? node.detail.split("\n").map((line) => `${detailIndent}>${line.trim() ? ` ${line.trimEnd()}` : ""}`)
    : [];
  return [prefix + node.text, ...detailLines, ...node.children.flatMap((child) => toMarkdownLines(child, depth + 1))];
}

// AIに渡す用のJSON。見出し(text)と詳細(detail)を木構造のまま渡し、項目の意味も添える
function toAiJson() {
  const toItem = (node) => {
    const item = { id: node.id, text: node.text };
    if (node.detail) item.detail = node.detail;
    item.type = normalizeNodeType(node.type);
    if (node.id !== state.tree.id) item.relationType = normalizeRelationType(node.relationType);
    if (getNodeLayer(node)) item.layer = getNodeLayer(node);
    if (node.parallelOf) item.parallelOf = node.parallelOf;
    item.children = node.children.map(toItem);
    return item;
  };
  const legend = (types) =>
    Object.entries(types)
      .map(([key, info]) => `${key}=${info.label}`)
      .join(", ");
  return JSON.stringify(
    {
      format: "Knowledge Map Canvas mind map",
      map: currentMapName(),
      about: {
        tree: "マインドマップ全体。children が子ノード。",
        text: "ノードの見出し",
        detail: "ノードの詳細・補足（ある場合のみ）",
        type: `ノードの種類: ${legend(NODE_TYPES)}`,
        relationType: `親とのつながり方: ${legend(RELATION_TYPES)}`,
        layer: "別の観点を置く階層（省略時は0=通常のマップ）",
        parallelOf: "別の階層に複製したノードの、元ノードのid",
      },
      tree: toItem(state.tree),
    },
    null,
    2,
  );
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
      // id も残し、読み直したときに別階層のゴーストが元ノードを見失わないようにする
      id: node.id,
      collapsed: Boolean(node.collapsed),
      cardHeight: node.cardHeight || null,
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
    if (typeof item.id === "string" && item.id) node.id = item.id;
    node.collapsed = Boolean(item.collapsed);
    node.cardHeight = normalizeCardHeight(item.cardHeight);
    // 以前のファイルはメモを埋め込みにだけ持っていたので、本文に詳細がなければそれを使う
    if (!node.detail && item.memo) node.detail = normalizeDetail(item.memo);
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

// ── ファイル（MD）での保存・読み込み ─────────────────────────────
// マップの中身はMDファイルにだけ置く。ブラウザには作業中の写しと、開いているファイルの「場所」だけを覚える。

const MARKDOWN_FILE_TYPES = [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"] } }];

// 開いた（または新しく作った）内容を表示し、それを「保存済み」の基準にする
function applyDocument({ tree, settings, fileName = "", mapName = "", handle = null, markSaved = true }) {
  state.tree = normalizeNode(tree);
  const normalized = normalizeSettings(settings || defaultSettings());
  state.maxDepth = normalized.maxDepth;
  state.horizontalSpacing = normalized.horizontalSpacing;
  state.verticalSpacing = normalized.verticalSpacing;
  state.snapStep = normalized.snapStep;
  state.fileName = fileName;
  state.mapName = mapName;
  state.fileHandle = handle;
  state.selectedId = state.tree.id;
  state.flashId = null;
  state.removingId = null;
  state.search = "";
  state.isLayer3d = false;
  state.layerFilterDepth = 0;
  state.focusLayerDepth = 0;
  state.focusNodeId = "";
  state.dragGuide = { x: null, y: null };
  state.undoStack = [];
  state.redoStack = [];
  state.savedSignature = markSaved ? currentSignature() : null;
  document.body.classList.remove("layer-3d");
  els.viewport.classList.remove("is-layer-3d");
  els.searchInput.value = "";
  els.depthSlider.value = state.maxDepth;
  els.horizontalSpacingSlider.value = state.horizontalSpacing;
  els.verticalSpacingSlider.value = state.verticalSpacing;
  els.snapStepSlider.value = state.snapStep;
  updateSnapStepValue();
  hideUnsavedBanner();
  rememberFileHandle(handle);
  render();
  requestAnimationFrame(fitToView);
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

async function newMap() {
  if (!(await resolveUnsavedChanges("新しいマップを作る"))) return;
  applyDocument({ tree: createBlankTree("新しいマップ"), settings: defaultSettings() });
  els.statusText.textContent = "新しいマップを作りました。「保存」でMDファイルにできます。";
}

async function openMapFile() {
  if (!(await resolveUnsavedChanges("ほかのファイルを開く"))) return;
  if (!("showOpenFilePicker" in window)) {
    els.markdownFileInput.click();
    return;
  }
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({ multiple: false, types: MARKDOWN_FILE_TYPES });
  } catch (error) {
    if (error.name === "AbortError") return;
    throw error;
  }
  await loadMapFromFile(await handle.getFile(), handle);
}

async function loadMapFromFile(file, handle = null) {
  if (!file) return;
  const parsed = parseMapDocument(await file.text());
  applyDocument({ tree: parsed.tree, settings: parsed.settings || defaultSettings(), fileName: file.name, handle });
  els.exportOutput.value = "";
  els.statusText.textContent = `${file.name} を開きました。`;
}

// 「保存」は開いているファイルへ上書き。まだファイルがなければ（または「名前を付けて保存」なら）保存先を聞く
async function saveMap({ saveAs = false } = {}) {
  const markdown = toMarkdown(state.tree, { includeMeta: true }).join("\n");
  const suggestedName = `${safeFileName(currentMapName())}.md`;
  if ("showSaveFilePicker" in window) {
    let handle = saveAs ? null : state.fileHandle;
    if (handle && !(await ensureWritePermission(handle))) handle = null;
    if (!handle) {
      try {
        handle = await window.showSaveFilePicker({ suggestedName, types: MARKDOWN_FILE_TYPES });
      } catch (error) {
        if (error.name === "AbortError") return false;
        throw error;
      }
    }
    const writable = await handle.createWritable();
    await writable.write(markdown);
    await writable.close();
    state.fileHandle = handle;
    state.fileName = handle.name;
    rememberFileHandle(handle);
  } else {
    // ファイルへ直接書けないブラウザでは、ダウンロードとして保存する
    const fileName = (!saveAs && state.fileName) || suggestedName;
    downloadText(markdown, fileName, "text/markdown;charset=utf-8");
    state.fileName = fileName;
  }
  state.savedSignature = currentSignature();
  saveTree();
  hideUnsavedBanner();
  els.statusText.textContent = `${state.fileName} に保存しました。`;
  return true;
}

async function saveMapFromUi(options = {}) {
  try {
    return await saveMap(options);
  } catch (error) {
    els.statusText.textContent = `保存できませんでした: ${error.message}`;
    return false;
  }
}

async function ensureWritePermission(handle) {
  if (typeof handle.queryPermission !== "function") return true;
  const options = { mode: "readwrite" };
  try {
    if ((await handle.queryPermission(options)) === "granted") return true;
    return (await handle.requestPermission(options)) === "granted";
  } catch {
    return false;
  }
}

function downloadText(text, fileName, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

// 開いているファイルの「場所」だけを覚えておき、ブラウザを開き直しても同じファイルへ上書き保存できるようにする
function openFileHandleDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(FILE_HANDLE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(FILE_HANDLE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rememberFileHandle(handle) {
  try {
    const db = await openFileHandleDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(FILE_HANDLE_STORE, "readwrite");
      const store = transaction.objectStore(FILE_HANDLE_STORE);
      if (handle) store.put(handle, "current");
      else store.delete("current");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch {
    // 覚えられなくても、次の保存で保存先を聞くだけ
  }
}

async function recallFileHandle() {
  try {
    const db = await openFileHandleDb();
    const handle = await new Promise((resolve, reject) => {
      const request = db.transaction(FILE_HANDLE_STORE, "readonly").objectStore(FILE_HANDLE_STORE).get("current");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

async function restoreFileHandle() {
  if (!state.fileName) return;
  const handle = await recallFileHandle();
  if (handle && handle.name === state.fileName && !state.fileHandle) state.fileHandle = handle;
}

// ── 未保存の変更 ────────────────────────────────────────────

// 新規・開くの前に呼ぶ。保存して続ける / 保存しないで続ける / やめる を選んでもらう
async function resolveUnsavedChanges(actionLabel) {
  if (!state.isDirty) return true;
  const choice = await askUnsavedChoice(`このまま${actionLabel}と、保存していない変更は失われます。`);
  if (choice === "save") return saveMapFromUi();
  return choice === "discard";
}

function askUnsavedChoice(message) {
  const dialog = els.unsavedDialog;
  if (!dialog || typeof dialog.showModal !== "function") {
    return Promise.resolve(window.confirm(`${message}\n保存しないで続けますか？`) ? "discard" : "cancel");
  }
  els.unsavedDialogText.textContent = message;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener("click", onClick);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close(value);
      resolve(value);
    };
    // ボタンを押した時点で受け取る（閉じた合図は描き替えまで遅れることがあるため）
    const onClick = (event) => {
      const button = event.target.closest("button[value]");
      if (!button) return;
      event.preventDefault();
      finish(button.value);
    };
    // Esc で閉じたときなど。前の回に閉じた合図が遅れて届くことがあるので、開いている間の合図は無視する
    const onClose = () => {
      if (dialog.open) return;
      finish(dialog.returnValue || "cancel");
    };
    dialog.addEventListener("click", onClick);
    dialog.addEventListener("close", onClose);
    dialog.returnValue = "";
    dialog.showModal();
  });
}

function updateFileStatus() {
  if (!els.fileNameText) return;
  els.fileNameText.textContent = state.fileName || `${currentMapName()}（まだファイルに保存していません）`;
  els.fileNameText.title = state.fileName || "まだMDファイルに保存していません";
  els.saveStateBadge.textContent = state.isDirty ? "未保存の変更あり" : state.fileName ? "保存済み" : "変更なし";
  els.saveStateBadge.classList.toggle("is-dirty", state.isDirty);
  document.title = `${state.isDirty ? "● " : ""}${currentMapName()} - Knowledge Map Canvas`;
  if (!state.isDirty) hideUnsavedBanner();
}

function showUnsavedBanner(message, { allowDiscard = false } = {}) {
  if (!els.unsavedBanner) return;
  els.unsavedBannerText.textContent = message;
  els.bannerDiscardButton.hidden = !(allowDiscard && state.savedSignature);
  els.unsavedBanner.hidden = false;
}

function hideUnsavedBanner() {
  if (els.unsavedBanner) els.unsavedBanner.hidden = true;
}

// 最後に開いた/保存した状態へ戻す（保存していない変更を捨てる）
function discardUnsavedChanges() {
  if (!state.savedSignature) return;
  const saved = JSON.parse(state.savedSignature);
  applyDocument({
    tree: saved.tree,
    settings: saved.settings,
    fileName: state.fileName,
    mapName: state.mapName,
    handle: state.fileHandle,
  });
  els.statusText.textContent = "保存していない変更を捨て、保存済みの状態に戻しました。";
}

function showStartupNotice(source) {
  if (source === "legacy") {
    showUnsavedBanner(`以前ブラウザ内に保存していた「${currentMapName()}」を表示しています。「保存」でMDファイルにしてください。`);
    return;
  }
  if (source === "working" && state.isDirty) {
    showUnsavedBanner("前回、保存しないまま閉じた変更を復元しました。", { allowDiscard: true });
  }
}

// ── 以前ブラウザ内に保存していたマップの引き取り ──────────────────────

function updateLegacyMapsPanel() {
  if (!els.legacyMapsPanel) return;
  const legacy = readLegacyMaps();
  els.legacyMapsPanel.hidden = !legacy.maps.length;
  els.legacyMapList.textContent = "";
  legacy.maps.forEach((map) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layer-item";
    const name = document.createElement("strong");
    name.textContent = map.name;
    const updated = document.createElement("span");
    updated.textContent = formatShortDate(map.updatedAt);
    button.append(name, updated);
    button.title = "開いて「保存」でMDファイルにします";
    button.addEventListener("click", () => openLegacyMap(map));
    els.legacyMapList.appendChild(button);
  });
}

async function openLegacyMap(map) {
  if (!(await resolveUnsavedChanges("以前のマップを開く"))) return;
  applyDocument({ tree: map.tree, settings: map.settings, mapName: map.name, markSaved: false });
  showUnsavedBanner(`「${map.name}」はまだMDファイルになっていません。「保存」でファイルにしてください。`);
  els.statusText.textContent = `以前ブラウザ内に保存していた「${map.name}」を開きました。`;
}

function clearLegacyMaps() {
  const ok = window.confirm(
    "ブラウザに残っている以前のマップを、すべてブラウザから消します。\nMDファイルに保存していないマップは元に戻せません。消しますか？",
  );
  if (!ok) return;
  localStorage.removeItem(LEGACY_MAPS_KEY);
  localStorage.removeItem(LEGACY_STATE_KEY);
  updateLegacyMapsPanel();
  els.statusText.textContent = "以前のマップをブラウザから消しました。";
}

function formatShortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function savePngFile() {
  const { canvas, width, height } = renderPngCanvas();
  const fileName = `${safeFileName(currentMapName())}.png`;
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

  // 詳細があるときは、上の段にタイトル行、下の段に詳細（画面のカードと同じ並び）。
  // 縦幅を縮めたカードは、入りきる行だけ描いて最後を「…」にする
  let detail = getPngDetailLayout(ctx, node, pos);
  let row = detail
    ? { top: y + 10, height: Math.max(26, pos.height - 20 - detail.blockHeight - 6), inset: 0 }
    : { top: y, height: pos.height, inset: 20 };
  if (detail && isCardShortened(node, pos)) {
    const isRoot = pos.depth === 0;
    const titleLines = wrapCanvasText(ctx, node.text, Math.max(64, pos.width - 152), isRoot ? 17 : 14, isRoot);
    const titleRowHeight = Math.max(26, titleLines.length * (isRoot ? 22 : 19));
    row = { top: y + 10, height: titleRowHeight, inset: 0 };
    const available = pos.height - 10 - titleRowHeight - 6 - 5 - 10;
    detail = fitPngDetailLines(ctx, detail, Math.floor((available + 1) / detail.lineHeight));
  }
  drawPngNodeTypeBadge(ctx, node, x, row, pos, palette);
  drawPngNodeText(ctx, node.text, x, row, pos, palette);
  drawPngNodeActions(ctx, node, x, row, pos, palette);
  if (detail) drawPngNodeDetail(ctx, detail, x, row.top + row.height + 6, pos, palette);
}

function getPngDetailLayout(ctx, node, pos) {
  if (!node.detail) return null;
  const isRoot = pos.depth === 0;
  const fontSize = isRoot ? 13 : 12;
  const lineHeight = fontSize * 1.5;
  const left = isRoot ? 15 : 20;
  const width = Math.max(40, pos.width - left - 11);
  let lines = node.detail
    .split("\n")
    .flatMap((paragraph) => (paragraph.trim() ? wrapCanvasText(ctx, paragraph, width, fontSize, false) : [""]));
  return { lines, fontSize, lineHeight, left, width, blockHeight: lines.length * lineHeight + 5 };
}

function fitPngDetailLines(ctx, detail, maxLines) {
  if (maxLines < 1) return null;
  if (detail.lines.length <= maxLines) return detail;
  ctx.font = `${detail.fontSize}px "Segoe UI", "Yu Gothic UI", "Hiragino Sans", sans-serif`;
  const lines = detail.lines.slice(0, maxLines);
  lines[lines.length - 1] = trimCanvasEllipsis(ctx, lines[lines.length - 1], detail.width);
  return { ...detail, lines, blockHeight: lines.length * detail.lineHeight + 5 };
}

function trimCanvasEllipsis(ctx, text, maxWidth) {
  let value = String(text || "");
  while (value && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
  return `${value}…`;
}

function drawPngNodeDetail(ctx, detail, x, top, pos, palette) {
  ctx.save();
  ctx.globalAlpha *= 0.22;
  ctx.strokeStyle = pos.color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + detail.left, top + 0.5);
  ctx.lineTo(x + detail.left + detail.width, top + 0.5);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = mixColors(palette.ink, palette.muted, 0.45);
  ctx.font = `${detail.fontSize}px "Segoe UI", "Yu Gothic UI", "Hiragino Sans", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let lineY = top + 5 + (detail.lineHeight + detail.fontSize) / 2 - 1;
  detail.lines.forEach((line) => {
    if (line) ctx.fillText(line, x + detail.left, lineY);
    lineY += detail.lineHeight;
  });
}

function drawPngNodeTypeBadge(ctx, node, x, row, pos, palette) {
  const type = normalizeNodeType(node.type);
  const badgeX = x + 14;
  const badgeY = row.top + row.height / 2 - 12;
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

function drawPngNodeText(ctx, text, x, row, pos, palette) {
  const isRoot = pos.depth === 0;
  const fontSize = isRoot ? 17 : 14;
  const lineHeight = isRoot ? 22 : 19;
  const textX = x + 46;
  const textWidth = Math.max(64, pos.width - 152);
  const lines = wrapCanvasText(ctx, text, textWidth, fontSize, isRoot);
  const maxLines = Math.max(1, Math.floor((row.height - row.inset) / lineHeight));
  const visibleLines = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    visibleLines[visibleLines.length - 1] = trimCanvasText(ctx, `${visibleLines[visibleLines.length - 1]}...`, textWidth);
  }
  const textBlockHeight = visibleLines.length * lineHeight;
  let textY = row.top + (row.height - textBlockHeight) / 2 + fontSize;

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

function drawPngNodeActions(ctx, node, x, row, pos, palette) {
  const startX = x + pos.width - 88;
  const buttonY = row.top + row.height / 2 - 13;
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    els.exportOutput.focus();
    els.exportOutput.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

function wireInspectorTextField(input, applyValue) {
  let editId = "";
  let snapshot = null;
  let recorded = false;
  input.addEventListener("focus", () => {
    editId = state.selectedId;
    snapshot = captureSnapshot();
    recorded = false;
  });
  input.addEventListener("input", () => {
    const found = findNode(editId || state.selectedId);
    if (!found) return;
    if (!recorded) {
      pushHistory(snapshot || captureSnapshot());
      recorded = true;
    }
    applyValue(found.node, input.value);
    updateCardText(found.node.id);
    els.selectionLabel.textContent = findNode(state.selectedId)?.node.text || "未選択";
    saveTree();
    // 打ち終わるのを少し待ってから並びを計算し直す（カードの高さが変わるため）
    scheduleRelayout(300);
  });
}

function wireControls() {
  wireInspectorTextField(els.nodeTitleInput, (node, value) => {
    node.text = value.trim() || "無題";
  });
  els.nodeTitleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.nodeTitleInput.blur();
    }
  });
  wireInspectorTextField(els.nodeDetailInput, (node, value) => {
    node.detail = normalizeDetail(value);
  });
  els.resetCardHeightButton.addEventListener("click", () => {
    resetCardHeight(state.selectedId);
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

  document.getElementById("newMapButton").addEventListener("click", () => {
    newMap();
  });

  document.getElementById("openMarkdownButton").addEventListener("click", async () => {
    try {
      await openMapFile();
    } catch (error) {
      els.statusText.textContent = `ファイルを開けませんでした: ${error.message}`;
    }
  });

  // ファイルへ直接アクセスできないブラウザ用（開く場所を選ぶ画面だけ使う）
  els.markdownFileInput.addEventListener("change", async () => {
    try {
      await loadMapFromFile(els.markdownFileInput.files[0], null);
    } catch (error) {
      els.statusText.textContent = `ファイルを開けませんでした: ${error.message}`;
    } finally {
      els.markdownFileInput.value = "";
    }
  });

  document.getElementById("saveMarkdownButton").addEventListener("click", () => {
    saveMapFromUi();
  });

  document.getElementById("saveAsMarkdownButton").addEventListener("click", () => {
    saveMapFromUi({ saveAs: true });
  });

  document.getElementById("bannerSaveButton").addEventListener("click", () => {
    saveMapFromUi();
  });

  els.bannerDiscardButton.addEventListener("click", () => {
    const ok = window.confirm("保存していない変更を捨てて、最後に保存した状態に戻します。よろしいですか？");
    if (ok) discardUnsavedChanges();
  });

  document.getElementById("bannerCloseButton").addEventListener("click", () => {
    hideUnsavedBanner();
  });

  document.getElementById("clearLegacyMapsButton").addEventListener("click", () => {
    clearLegacyMaps();
  });

  // 保存していない変更があるまま閉じようとしたら、ブラウザの確認を出す。
  // 「このページに留まる」を選んだときは、すぐ保存できるようお知らせを出す（閉じた場合はここまで動かない）
  window.addEventListener("beforeunload", (event) => {
    saveTree();
    if (!state.isDirty) return;
    event.preventDefault();
    event.returnValue = "";
    window.setTimeout(() => {
      showUnsavedBanner("保存していない変更があります。ここで保存できます。");
    }, 0);
  });

  document.getElementById("optimizeLayoutButton").addEventListener("click", optimizeLayout);
  document.getElementById("fitButton").addEventListener("click", fitToView);

  document.getElementById("showAllLayersButton").addEventListener("click", () => {
    setLayer3dMode(true);
  });

  document.getElementById("exportJsonButton").addEventListener("click", () => {
    els.exportOutput.value = toAiJson();
    els.statusText.textContent = "JSONを出しました。詳細・補足も含まれます。";
  });

  document.getElementById("exportMarkdownButton").addEventListener("click", () => {
    // AIや人が読む用なので、復元用の埋め込みデータは付けない（ファイル保存は「MD保存」）
    els.exportOutput.value = toMarkdown(state.tree).join("\n");
    els.statusText.textContent = "Markdownを出しました。詳細・補足は「> 」の行です。";
  });

  document.getElementById("copyExportButton").addEventListener("click", async () => {
    if (!els.exportOutput.value) els.exportOutput.value = toAiJson();
    const copied = await copyText(els.exportOutput.value);
    els.statusText.textContent = copied ? "出力をコピーしました。" : "コピーできませんでした。枠の中を選んでコピーしてください。";
  });

  document.getElementById("savePngButton").addEventListener("click", async () => {
    try {
      await savePngFile();
    } catch (error) {
      els.statusText.textContent =
        error.name === "AbortError" ? "PNG保存を中止しました。" : `PNG保存に失敗しました: ${error.message}`;
    }
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
    // Ctrl + S で保存（上書き）、Ctrl + Shift + S で名前を付けて保存。入力中でも使える
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveMapFromUi({ saveAs: event.shiftKey });
      return;
    }

    // 確認の小窓が出ている間は、ほかのキー操作をしない
    if (els.unsavedDialog?.open) return;

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
  state.zoom = clamp(nextZoom, Math.min(0.28, state.zoom), Math.max(1.8, state.zoom));
  updateTransform();
}

function setZoomAtPoint(nextZoom, clientX, clientY, options = {}) {
  const rect = els.viewport.getBoundingClientRect();
  const viewportX = clientX - rect.left;
  const viewportY = clientY - rect.top;
  const previousZoom = state.zoom;
  // ホイールとボタンは 0.28〜1.8。ただし全体表示や右ドラッグで範囲の外にいるときは、
  // 今の倍率から跳ばないように、その位置を限度にする（さらに外へは進まない）。
  const zoom = options.unbounded
    ? Math.max(0.0001, nextZoom)
    : clamp(nextZoom, Math.min(0.28, previousZoom), Math.max(1.8, previousZoom));
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
  els.exportOutput.value = "";
  els.depthSlider.value = state.maxDepth;
  els.horizontalSpacingSlider.value = state.horizontalSpacing;
  els.verticalSpacingSlider.value = state.verticalSpacing;
  els.snapStepSlider.value = state.snapStep;
  updateSnapStepValue();
  wireControls();
  wireKeyboardShortcuts();
  wirePanZoom();
  updateLegacyMapsPanel();
  render();
  requestAnimationFrame(fitToView);
  showStartupNotice(initialWork.source);
  restoreFileHandle();
  // 文字の読み込みが後から終わると行の折り返しが変わるので、そのときは測り直す
  document.fonts?.ready.then(() => {
    nodeHeightCache.clear();
    render();
  });
}

init();
