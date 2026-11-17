// マップの保存先はMDファイルだけ。ブラウザには「作業中の写し」を1つだけ置き、
// 保存前にブラウザを閉じても続きから再開できるようにする。
// 2026-11-17 ドパ版（演出を足した試作）を、このツールの正にした。ブラウザ内の置き場所は元版と同じ名前を引き継ぐ
// （作業中の写し・開いていたファイルの場所・以前のマップ一覧が、そのまま使える）。
// ruhmk.github.io には家族カレンダーなど別のツールのデータもあるので、localStorage.clear() や IndexedDB の丸ごと削除はしない。
const WORKING_COPY_KEY = "knowledge-map-canvas-working-v2";
// 以前の「保存」でブラウザ内に置いていたマップ一覧（廃止）。引き取り用に読むだけで、もう書き込まない。
const LEGACY_STATE_KEY = "knowledge-map-canvas-state-v1";
const LEGACY_MAPS_KEY = "knowledge-map-canvas-maps-v1";
// 「動き」の演出のオン・オフ（ドパ版で足した設定）
const MOTION_PREF_KEY = "knowledge-map-canvas-motion-v1";
// 配色（暗い／明るい／藍）。MindmapIndex.html の head でも同じ名前で読んで、画面が出る前に戻している
const THEME_PREF_KEY = "knowledge-map-canvas-theme-v1";
const THEMES = [
  { id: "dark", label: "暗い" },
  { id: "light", label: "明るい" },
  { id: "indigo", label: "藍" },
];
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
// ドパ版の動き。on は演出あり、off は元版と同じ約0.08秒の軽い動き。
// addReach / enterReach / expandReach / leaveReach は「親の方へどれだけ寄った所から出入りするか」（1 = 親の位置）
// 2026-11-17 ユーザーの希望（「動きをもうちょっと大きく派手に」）で、大きく・弾むように強めた。
// 同じ日に「ノードを足す動きをもっと早く」と言われ、add を 640 → 420 にした。
// さらに「右に動きすぎて線が途切れて見える」と言われ、位置は行き過ぎずにぴたっと着き、大きさだけぽんと弾むようにした（340）
const MOTION_TIMING = {
  on: {
    enter: 460,
    add: 340,
    move: 420,
    leave: 340,
    stagger: 50,
    staggerMax: 360,
    addReach: 1,
    enterReach: 0.42,
    expandReach: 0.85,
    leaveReach: 0.8,
    addScale: 0.3,
    addRotate: -9,
    enterScale: 0.8,
    leaveScale: 0.5,
    leaveRotate: 10,
  },
  off: {
    enter: ANIMATION_MS,
    add: ANIMATION_MS,
    move: ANIMATION_MS,
    leave: ANIMATION_MS,
    stagger: 0,
    staggerMax: 0,
    addReach: 0,
    enterReach: 0,
    expandReach: 0,
    leaveReach: 0,
    addScale: 0.96,
    addRotate: 0,
    enterScale: 0.98,
    leaveScale: 0.96,
    leaveRotate: 0,
  },
};
// 最初は速く、最後はやさしく止まる
const MOTION_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
// 足したノード用: 一瞬で飛び出して、行き過ぎずにぴたっと着く（動きの長さの約22%で9割、約39%で97%まで進む）。
// 位置を行き過ぎさせると、カードが着地点より先へ行ってしまい、線の伸び方も親の側で途切れて見えるため。
// 弾む感じは、着く直前からカードの大きさだけをぽんとふくらませて出す（playAddPop）
const MOTION_EASE_ADD = "cubic-bezier(0.06, 1, 0.12, 1)";
// 少し行き過ぎて戻る（開いた枝・押し出されたノード用）
const MOTION_EASE_ENTER = "cubic-bezier(0.3, 1.4, 0.5, 1)";
const MOTION_EASE_MOVE = "cubic-bezier(0.34, 1.32, 0.64, 1)";
// 消えるときは、ゆっくり動き出して、なめらかに消える
const MOTION_EASE_LEAVE = "cubic-bezier(0.4, 0, 0.6, 1)";
// 軽く動かすための上限。画面の外のノードには動きを付けず、画面の中でもこれより多いときは減らす
// 一度に消えるノードがこれより多いときは、消える動きを付けずにすぐ消す
const MOTION_MAX_GHOSTS = 40;
// 一度に動かすノードの上限。超えたら、押し出されるだけのノードは動かさずにすぐ移す。
// 大きいマップを開いたときは、カードごとではなく全体をまとめてふわっと出す
const MOTION_MAX_ANIMATED = 80;
// 画面の外でも、この幅（画面上のpx）までは動きを付ける（はみ出しかけのカードが急に跳ばないように）
const MOTION_SCREEN_MARGIN = 160;
// 画面（カメラ）がすっと寄る・回り込む時間と動き方。CSS の --camera-speed / --camera-ease と同じにする
const CAMERA_GLIDE_MS = 620;
const CAMERA_EASE = "cubic-bezier(0.3, 0.7, 0.2, 1)";
// 3Dで注目する階層を変えたとき、明るさが入れ替わる時間
const FOCUS_FADE_MS = 320;
// CSS の濃さと同じ値（明るさを入れ替える動きの出発点に使う）
const NODE_DIMMED_OPACITY = 0.24;
const EDGE_3D_DIMMED_OPACITY = 0.18;
const EDGE_3D_FOCUSED_OPACITY = 0.82;
const FLOOR_DIMMED_OPACITY = 0.24;
const FLOOR_FOCUSED_OPACITY = 0.62;
// 階層の床の色（階層 0, 1, 2… の順。足りなければ最初に戻る）: 青・青緑・紫・琥珀・桃
const FLOOR_TINTS = ["124, 192, 255", "94, 234, 212", "196, 167, 255", "251, 191, 36", "244, 114, 182"];
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
  text: "サンプルのマップ",
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
  isDraggingNode: false,
  isLayer3d: false,
  view3d: { yaw: -8, pitch: 58 },
  focusLayerDepth: 0,
  layerFilterDepth: 0,
  focusNodeId: "",
  dragGuide: { x: null, y: null },
  // ドパ版: 等間隔のガイド（getSpacingSnap が決める。null なら出さない）
  dragSpacing: null,
  undoStack: [],
  redoStack: [],
  positions: new Map(),
  visibleIds: new Set(),
  renderedIds: new Set(),
  edgeList: [],
};

const motion = {
  enabled: loadMotionPreference(),
  // true のとき、次の描画では出入りの動きを付けない（別のマップを開いたときなど）
  skipNext: false,
  // true のとき、次の描画では動きを何も付けない（スライダーを動かしている間など、もともと少しずつ動くとき）
  freezeNext: false,
  // マップの表示枠の大きさ。毎回測ると重いので、大きさが変わったときだけ覚え直す
  viewWidth: 0,
  viewHeight: 0,
  // 前の描画が3Dだったか・注目していた階層（3D切り替えや明るさの入れ替えの動きに使う）
  wasLayer3d: false,
  lastFocusLayer: 0,
  // 消したカードの id（deleteSelected が描き直す間だけ入れる。そのカードは割れて散る）
  shatterId: null,
};

let cameraGlideTimer = null;

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
  // 消えていくノード・線を、消え終わるまで置いておく場所（render() では消さない）
  ghostLayer: document.getElementById("ghostLayer"),
  ghostEdgeLayer: document.getElementById("ghostEdgeLayer"),
  // カードより上に重ねる演出（足したときの星）の置き場
  effectLayer: document.getElementById("effectLayer"),
  // 画面の上に重ねる演出（保存したときの星など、地図の外の部品から出るもの）の置き場
  uiEffectLayer: document.getElementById("uiEffectLayer"),
  motionToggleButton: document.getElementById("motionToggleButton"),
  backdropDots: document.getElementById("canvasBackdropDots"),
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
  unsavedDialogTitle: document.getElementById("unsavedDialogTitle"),
  unsavedDialogText: document.getElementById("unsavedDialogText"),
  unsavedDialogActions: document.getElementById("unsavedDialogActions"),
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
  evenChildrenButton: document.getElementById("evenChildrenButton"),
  minimap: document.getElementById("minimap"),
  minimapCanvas: document.getElementById("minimapCanvas"),
  minimapFrame: document.getElementById("minimapFrame"),
  minimapToggleButton: document.getElementById("minimapToggleButton"),
  leftPanelToggle: document.getElementById("leftPanelToggle"),
  rightPanelToggle: document.getElementById("rightPanelToggle"),
  sidebarPanel: document.getElementById("sidebarPanel"),
  inspectorPanel: document.getElementById("inspectorPanel"),
  layerList: document.getElementById("layerList"),
  nodeContextMenu: document.getElementById("nodeContextMenu"),
  guideLayer: document.getElementById("guideLayer"),
  guideVertical: document.getElementById("guideVertical"),
  guideHorizontal: document.getElementById("guideHorizontal"),
  spacingGuides: document.getElementById("spacingGuides"),
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
  state.tree = normalizeNode(snapshot.tree);
  state.selectedId = snapshot.selectedId || state.tree.id;
  const settings = normalizeSettings(snapshot);
  state.maxDepth = settings.maxDepth;
  state.horizontalSpacing = settings.horizontalSpacing;
  state.verticalSpacing = settings.verticalSpacing;
  state.snapStep = settings.snapStep;
  state.search = snapshot.search || "";
  state.flashId = null;
  state.isLayer3d = false;
  state.layerFilterDepth = 0;
  state.focusLayerDepth = 0;
  state.focusNodeId = "";
  state.dragGuide = { x: null, y: null };
  state.dragSpacing = null;
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
let heightCheckHandle = null;

// ドパ版: 高さの確かめは、描いた直後ではなく、ブラウザが画面を描き終えて手が空いたときに行う。
// 描いた直後に高さを読むと、その場でページ全体の計算が走り（259ノードで1回 約75ms）、
// そのあと動きを付けたぶん、次の画面でもう一度同じ計算が走っていたため。手が空いたときなら計算済みの値を読むだけで済む
function scheduleHeightCheck() {
  if (heightCheckHandle !== null) return;
  const run = () => {
    heightCheckHandle = null;
    if (state.isDraggingNode) return;
    verifyRenderedHeights();
  };
  heightCheckHandle =
    typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(run, { timeout: 600 })
      : window.setTimeout(run, 120);
}

function verifyRenderedHeights() {
  let changed = false;
  // ノードを1つずつ探すと数が多いとき重いので、先に一覧を作る
  const nodesById = new Map();
  walk(state.tree, (node) => nodesById.set(node.id, node));
  els.nodeLayer.querySelectorAll(".mind-node").forEach((nodeEl) => {
    if (nodeEl.contains(document.activeElement)) return;
    // 縦幅を縮めたカードは高さを指定しているので、計測の確かめには使えない
    if (nodeEl.classList.contains("has-fixed-height")) return;
    const pos = state.positions.get(nodeEl.dataset.id);
    const node = nodesById.get(nodeEl.dataset.id);
    if (!pos || !node) return;
    const actual = nodeEl.offsetHeight;
    if (actual && Math.abs(actual - pos.height) > 1) {
      nodeHeightCache.set(getNodeHeightKey(node, pos.depth === 0), actual);
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

function make3dEdge(edge, from, to, matches, hasSearch) {
  const line = document.createElement("span");
  line.dataset.from = edge.from;
  line.dataset.to = edge.to;
  update3dEdge(line, edge, from, to, matches, hasSearch);
  return line;
}

// 3D表示の線の見た目と位置を書き換える（render() で線を使い回すときにも使う）
function update3dEdge(line, edge, from, to, matches, hasSearch) {
  const geometry = edge3dGeometry(from, to);
  const className = edgeClass(edge, matches, hasSearch).replace("edge-path", "edge-3d-line");
  if (line.className !== className) line.className = className;
  line.dataset.relation = edge.relationType || "normal";
  setStyleIfChanged(line, "width", `${geometry.length}px`);
  setStyleIfChanged(line, "--branch", edge.color);
  setStyleIfChanged(line, "transform", geometry.transform);
}

// 使い回すカード・線の、前の描画で付けた動きを止める
function cancelNodeMotion(nodeEl) {
  nodeEl._dopaMotion?.animation?.cancel();
  nodeEl._dopaMotion = null;
}

function cancelEdgeMotion(edgeEl) {
  edgeEl._dopaEdgeAnimation?.cancel();
  edgeEl._dopaGrow?.animation?.cancel();
  edgeEl._dopaEdgeAnimation = null;
  edgeEl._dopaGrow = null;
}

// 同じ値なら書かない（使い回したカード・線で、変わっていない所の画面の計算を増やさないため）
function setStyleIfChanged(element, name, value) {
  if (element.style.getPropertyValue(name) === value) return false;
  if (value === "") element.style.removeProperty(name);
  else element.style.setProperty(name, value);
  return true;
}

function setAttributeIfChanged(element, name, value) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

// カードの中身を作り直す必要があるかを見分ける印（createNodeShell が使う値だけ）
function nodeContentKey(node, pos) {
  return [
    pos.depth === 0 ? 1 : 0,
    normalizeNodeType(node.type),
    node.text,
    node.detail || "",
    node.collapsed ? 1 : 0,
    node.children.length ? 1 : 0,
  ].join("\u0001");
}

// 3D表示の線（細長い span）の長さと向き。動きの途中の形を作るときにも使う
function edge3dGeometry(from, to) {
  const start = connectorPoint(from, to, 1);
  const end = connectorPoint(to, from, 1);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const length = Math.max(1, Math.hypot(dx, dy, dz));
  const xyLength = Math.hypot(dx, dy);
  const theta = xyLength < 0.001 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI;
  const phi = (-Math.asin(clamp(dz / length, -1, 1)) * 180) / Math.PI;
  return {
    length,
    transform: `translate3d(${start.x}px, ${start.y}px, ${start.z}px) rotateZ(${theta}deg) rotateY(${phi}deg)`,
  };
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
  // 描き直す前の画面（どのノードがどこに見えていたか）を覚えておき、動きの出発点にする
  const motionBefore = captureMotionBefore(previousPositions);
  // 線が描き直されると、流れている光の位置がずれるので消す
  clearSparks();
  layoutTree();
  clampFocusLayerDepth();
  ensureFocusNodeVisible();
  state.renderedIds.clear();
  // ドパ版: カードと線は作り直さずに使い回す（2026-11-17 ユーザーの「軽量化」の希望で。259ノードで1回 約40ms かかっていた）。
  // 中身（タイトル・詳細・種類・開閉・子の有無）が変わったカードだけ作り直し、ほかは位置とクラスだけ書き換える。
  // 前の画面にあって今は無いカード・線は、ここで外す（消えていく動き playLeaving が、外したものを ghostLayer へ移す）
  const existingNodes = new Map();
  for (const nodeEl of els.nodeLayer.children) existingNodes.set(nodeEl.dataset.id, nodeEl);
  const existingPaths = new Map();
  for (const path of els.edgeLayer.children) existingPaths.set(`${path.dataset.from}->${path.dataset.to}`, path);
  const existingLines = new Map();
  for (const line of els.edge3dLayer.children) existingLines.set(`${line.dataset.from}->${line.dataset.to}`, line);
  els.floorLayer.textContent = "";
  els.edgeLayer.setAttribute("viewBox", `0 0 ${WORLD.width} ${WORLD.height}`);
  els.ghostEdgeLayer?.setAttribute("viewBox", `0 0 ${WORLD.width} ${WORLD.height}`);

  const fragment = document.createDocumentFragment();
  const floorFragment = document.createDocumentFragment();
  const edgeFragment = document.createDocumentFragment();
  const edge3dFragment = document.createDocumentFragment();
  const matches = getSearchMatches();
  const hasSearch = state.search.trim().length > 0;
  const nodePlans = planNodeMotions(motionBefore);
  const edgeMotions = [];
  const nodeMotions = [];
  const clampTargets = [];

  if (state.isLayer3d) {
    renderLayerFloors(floorFragment);
  }

  state.edgeList.forEach((edge) => {
    if (!shouldRenderEdge(edge)) return;
    const from = state.positions.get(edge.from);
    const to = state.positions.get(edge.to);
    if (!from || !to) return;
    const isConnector = isLayerConnectorEdge(edge);
    const key = edgeKey(edge);
    if (state.isLayer3d) {
      let line = existingLines.get(key);
      if (line) {
        existingLines.delete(key);
        cancelEdgeMotion(line);
      } else {
        line = document.createElement("span");
        line.dataset.from = edge.from;
        line.dataset.to = edge.to;
        edge3dFragment.appendChild(line);
      }
      update3dEdge(line, edge, from, to, matches, hasSearch);
      edgeMotions.push({ el: line, edge, from, to, isConnector, is3d: true });
      return;
    }

    let path = existingPaths.get(key);
    if (path) {
      existingPaths.delete(key);
      cancelEdgeMotion(path);
    } else {
      path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("pathLength", "1");
      path.dataset.from = edge.from;
      path.dataset.to = edge.to;
      edgeFragment.appendChild(path);
    }
    setAttributeIfChanged(path, "d", isConnector ? pathForLayerConnector(from, to) : pathForEdge(from, to));
    setAttributeIfChanged(path, "class", edgeClass(edge, matches, hasSearch));
    path.dataset.relation = edge.relationType || "normal";
    setStyleIfChanged(path, "--branch", edge.color);
    applyLayerDepthStyle(path, isConnector ? getConnectorAxisY(from, to) : from.layerAxisY || 0);
    edgeMotions.push({ el: path, edge, from, to, isConnector, is3d: false });
  });

  walk(state.tree, (node) => {
    const pos = state.positions.get(node.id);
    if (!pos) return;
    if (!shouldRenderLayer(pos.layer)) return;
    state.renderedIds.add(node.id);
    const contentKey = nodeContentKey(node, pos);
    let nodeEl = existingNodes.get(node.id);
    if (nodeEl) {
      existingNodes.delete(node.id);
      // 前の動きは止める（続きは、描き直す前に覚えた見え方から planNodeMotions が付け直す）
      cancelNodeMotion(nodeEl);
    }
    if (!nodeEl || nodeEl._dopaContentKey !== contentKey) {
      // 中身が変わったカードだけ作り直す（前のカードは外す。動きは前のカードの見え方から続ける）
      nodeEl?.remove();
      nodeEl = createNodeShell(node, pos.depth === 0);
      nodeEl._dopaContentKey = contentKey;
      nodeEl.dataset.id = node.id;
      fragment.appendChild(nodeEl);
    }
    const shortened = isCardShortened(node, pos);
    const wasShortened = nodeEl.classList.contains("has-fixed-height");
    const className = nodeClass(node, pos, matches, hasSearch) + (shortened ? " has-fixed-height" : "");
    if (nodeEl.className !== className) nodeEl.className = className;
    const heightChanged = setStyleIfChanged(nodeEl, "height", shortened ? `${Math.round(pos.height)}px` : "");
    if (shortened && (heightChanged || !wasShortened || !nodeEl.isConnected)) clampTargets.push(nodeEl);
    if (wasShortened && !shortened) updateDetailLineClamp(nodeEl);
    nodeEl.dataset.type = normalizeNodeType(node.type);
    setStyleIfChanged(nodeEl, "left", `${pos.x}px`);
    setStyleIfChanged(nodeEl, "top", `${pos.y}px`);
    setStyleIfChanged(nodeEl, "--branch", pos.color);
    setStyleIfChanged(nodeEl, "--layer-y", `${state.isLayer3d ? pos.layerAxisY || 0 : 0}px`);
    setStyleIfChanged(nodeEl, "z-index", state.isLayer3d ? String(100000 + Math.round(pos.layerAxisY || 0)) : "");
    const plan = nodePlans.get(node.id);
    if (plan) nodeMotions.push({ el: nodeEl, pos, plan });
  });

  // 今は見えないカード・線を外す
  existingNodes.forEach((nodeEl) => nodeEl.remove());
  existingPaths.forEach((path) => path.remove());
  existingLines.forEach((line) => line.remove());

  els.floorLayer.appendChild(floorFragment);
  els.edgeLayer.appendChild(edgeFragment);
  els.edge3dLayer.appendChild(edge3dFragment);
  els.nodeLayer.appendChild(fragment);
  // 縦幅を縮めたカードの「…」の行数は、新しく作ったカードと、高さが変わったカードだけ数え直す（数えるたびに画面の計算が走るため）
  clampTargets.forEach(updateDetailLineClamp);
  if (!state.isDraggingNode) scheduleHeightCheck();
  bindRenderedEvents();
  updateTransform();
  updateLabels();
  updateLayerControls();
  updateLayerPanel();
  updateAlignmentGuides();
  saveTree();
  // 動きは最後に付ける（カードの高さを測るなどの処理を、動きの計算で重くしないため）
  playMotions(motionBefore, nodePlans, nodeMotions, edgeMotions);
  motion.wasLayer3d = state.isLayer3d;
  motion.lastFocusLayer = state.focusLayerDepth;
  clearFlashAfterAnimation();
  scheduleMinimapDraw();
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
    // ドパ版: 階層ごとに床の色を変える。dataset.layer は床の動き（playFloorMotion）で使う
    plate.dataset.layer = String(layer);
    plate.style.setProperty("--floor-rgb", FLOOR_TINTS[Math.abs(layer) % FLOOR_TINTS.length]);
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

// ===== ドパ版の動き（ノードの出入り・線が伸びる） =====
// render() は毎回カードと線を作り直すので、描き直す前に「いまどこに見えているか」を読み取り、
// そこから新しい位置へ element.animate（Web Animations）で動かす。
// 動いている途中でまた描き直されたとき（文字の入力、スライダー、続けての追加など）は、
// 見えている所から続きを動かすので、カードや線が跳ばない。
// 消えたノード・線は ghostLayer / ghostEdgeLayer に移して、親の方へしまわれてから消す。
// 画面の CSS の動きなので、PNG保存には出ない。

function loadMotionPreference() {
  try {
    const saved = localStorage.getItem(MOTION_PREF_KEY);
    if (saved === "on") return true;
    if (saved === "off") return false;
  } catch {
    // 読めないときは下の既定値にする
  }
  // パソコンで「動きを減らす」設定にしているときは、最初はオフ
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function setMotionEnabled(isEnabled) {
  motion.enabled = isEnabled;
  try {
    localStorage.setItem(MOTION_PREF_KEY, isEnabled ? "on" : "off");
  } catch {
    // 覚えられなくても、開いている間は切り替わる
  }
  updateMotionToggle();
}

function updateMotionToggle() {
  // CSS 側の演出（選んだノードが光るまでの時間など）も、オフのときは元版と同じ速さにする
  document.body.classList.toggle("dopa-motion-off", !motion.enabled);
  const button = els.motionToggleButton;
  if (!button) return;
  button.textContent = motion.enabled ? "オン" : "オフ";
  button.setAttribute("aria-pressed", String(motion.enabled));
  button.title = motion.enabled ? "動きを止める（元版と同じ軽い動きにする）" : "ノードや線に動きを付ける";
}

function motionTiming() {
  return motion.enabled ? MOTION_TIMING.on : MOTION_TIMING.off;
}

// ===== ドパ版の配色（暗い／明るい／藍） =====
// 最後に選んだ配色。ふわっと入れ替わる途中にもう一度選ばれても、最後に選んだものが必ず残るようにする
let requestedTheme = null;
let themeTransition = null;

function currentTheme() {
  const theme = requestedTheme || document.documentElement.dataset.theme;
  return THEMES.some((item) => item.id === theme) ? theme : "dark";
}

function setTheme(themeId) {
  const nextTheme = THEMES.some((item) => item.id === themeId) ? themeId : "dark";
  if (nextTheme === currentTheme()) return;
  requestedTheme = nextTheme;
  const apply = () => {
    document.documentElement.dataset.theme = requestedTheme;
    updateThemeControls();
    minimap.colors = null;
    scheduleMinimapDraw();
  };
  // 動きの演出がオンなら、画面全体がふわっと入れ替わる（ブラウザの View Transitions。1回だけの動き）。
  // 入れ替わっている途中なら、新しく始めずにすぐ変える（途中で打ち切られて元に戻るのを防ぐ）
  if (motion.enabled && typeof document.startViewTransition === "function" && !themeTransition) {
    const transition = document.startViewTransition(apply);
    themeTransition = transition;
    // 打ち切られたときの知らせを、エラーとして残さない
    transition.ready.catch(() => {});
    transition.updateCallbackDone.catch(() => {});
    transition.finished
      .catch(() => {})
      .finally(() => {
        if (themeTransition === transition) themeTransition = null;
      });
  } else {
    apply();
  }
  try {
    localStorage.setItem(THEME_PREF_KEY, nextTheme);
  } catch {
    // 覚えられなくても、開いている間は切り替わる
  }
  const label = THEMES.find((item) => item.id === nextTheme)?.label;
  els.statusText.textContent = `配色を「${label}」にしました。`;
}

function updateThemeControls() {
  const theme = currentTheme();
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme));
  });
  const index = THEMES.findIndex((item) => item.id === theme);
  const next = THEMES[(index + 1) % THEMES.length];
  const toggle = document.getElementById("themeToggle");
  if (toggle) toggle.title = `配色: ${THEMES[index].label}（押すと「${next.label}」）`;
}

// ===== ドパ版のごほうびの演出（一瞬だけ。演出がオフのときは出さない） =====
// 2026-11-17 ユーザーの希望で2回強めた。
//  1回目:「星をもっと派手に」「ノード追加時に爆ぜるエフェクト」「詳細書き込みでもちょっとした反応」
//  2回目:「足す動きをもっと早く」「星の弾け方はタメツメを素早く、弾けるように」「反応は詳細ではなくタイトルを書いているときに」「もう少し派手に」
// どれも小さな部品を一瞬だけ動かして消す（transform と opacity だけなので軽い）。
// 部品が増えすぎないよう、置き場の中が EFFECT_MAX_ELEMENTS を超えたら新しく出さない。
const EFFECT_MAX_ELEMENTS = 200;
// 弾ける瞬間の動き方（ほんの一瞬で大きく飛び、あとはゆっくり）
const BURST_EASE = "cubic-bezier(0.05, 0.85, 0.2, 1)";

// 光の粒（丸い粒と星）を、ある点のまわりから外へ飛ばす。
// layer: 置き場（地図の上は effectLayer、画面の上は uiEffectLayer）。x, y はその置き場の中の位置
function emitParticles({
  layer = els.effectLayer,
  x,
  y,
  z = 0,
  color,
  count,
  minDistance,
  maxDistance,
  duration,
  delay = 0,
  angleFrom = 0,
  angleTo = Math.PI * 2,
  // 出発点を楕円の縁にする（カードの縁から飛び出すように）
  radiusX = 0,
  radiusY = 0,
  // 上へ浮かせる量（rise）と、最後に少し落ちる量（fall。花火のように）
  rise = 0,
  fall = 0,
  sizeMin = 5,
  sizeMax = 11,
  starRatio = 0.5,
  // 白く光る粒の割合
  whiteRatio = 0.2,
}) {
  if (!motion.enabled || !layer || layer.childElementCount > EFFECT_MAX_ELEMENTS) return;
  for (let index = 0; index < count; index += 1) {
    const particle = document.createElement("span");
    if (!canAnimate(particle)) return;
    const angle = angleFrom + (angleTo - angleFrom) * ((index + Math.random() * 0.7) / count);
    const distance = minDistance + Math.random() * (maxDistance - minDistance);
    const size = sizeMin + Math.random() * (sizeMax - sizeMin);
    const startX = Math.cos(angle) * radiusX;
    const startY = Math.sin(angle) * radiusY;
    const endX = startX + Math.cos(angle) * distance;
    const endY = startY + Math.sin(angle) * distance - rise;
    const isStar = Math.random() < starRatio;
    const isWhite = Math.random() < whiteRatio;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 160);
    particle.className = `dopa-particle${isStar ? " is-star" : ""}${isWhite ? " is-white" : ""}`;
    particle.style.left = `${x}px`;
    particle.style.top = `${y}px`;
    particle.style.width = `${size.toFixed(1)}px`;
    particle.style.height = `${size.toFixed(1)}px`;
    particle.style.margin = `${(-size / 2).toFixed(1)}px 0 0 ${(-size / 2).toFixed(1)}px`;
    particle.style.setProperty("--branch", color);
    layer.appendChild(particle);
    // タメ（出てすぐ、少し内側へぐっと縮む）→ ツメ（一気に道のりの7割を飛び、大きく光る）
    // → あとはゆっくり漂い、少し落ちながら縮んで消える
    const midX = startX + (endX - startX) * 0.72;
    const midY = startY + (endY - startY) * 0.72;
    const transformAt = (px, py, scale, rotate) =>
      `translateZ(${z}px) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) scale(${scale}) rotate(${rotate.toFixed(0)}deg)`;
    const animation = particle.animate(
      [
        { offset: 0, opacity: 0, transform: transformAt(startX, startY, 0.4, 0), easing: "ease-in" },
        { offset: 0.07, opacity: 1, transform: transformAt(startX * 0.86, startY * 0.86, 0.55, 0), easing: BURST_EASE },
        { offset: 0.22, transform: transformAt(midX, midY, 1.35, spin * 0.4), easing: "cubic-bezier(0.25, 0.6, 0.5, 1)" },
        { offset: 0.66, opacity: 1 },
        { offset: 1, opacity: 0, transform: transformAt(endX, endY + fall, 0.3, spin) },
      ],
      {
        duration: Math.round(duration * (0.8 + Math.random() * 0.45)),
        delay,
        fill: "both",
      },
    );
    animation.onfinish = () => particle.remove();
    animation.oncancel = () => particle.remove();
  }
}

// 光の筋: 縁から外へ、細い光がしゅっと伸びて消える（爆ぜる勢いを出す）
function emitRays({
  layer = els.effectLayer,
  x,
  y,
  z = 0,
  color,
  count,
  radiusX = 0,
  radiusY = 0,
  length = 26,
  distance = 60,
  duration = 380,
  delay = 0,
}) {
  if (!motion.enabled || !layer || layer.childElementCount > EFFECT_MAX_ELEMENTS) return;
  const turn = Math.random() * Math.PI * 2;
  for (let index = 0; index < count; index += 1) {
    const ray = document.createElement("span");
    if (!canAnimate(ray)) return;
    const angle = turn + (Math.PI * 2 * index) / count + (Math.random() - 0.5) * 0.35;
    const startX = Math.cos(angle) * radiusX;
    const startY = Math.sin(angle) * radiusY;
    const reach = distance * (0.75 + Math.random() * 0.5);
    const degrees = ((angle * 180) / Math.PI).toFixed(1);
    ray.className = "dopa-ray";
    ray.style.left = `${x}px`;
    ray.style.top = `${y}px`;
    ray.style.width = `${length}px`;
    ray.style.setProperty("--branch", color);
    layer.appendChild(ray);
    const transformAt = (along, stretch) =>
      `translateZ(${z}px) translate(${startX.toFixed(1)}px, ${startY.toFixed(1)}px) rotate(${degrees}deg) translateX(${along.toFixed(1)}px) scaleX(${stretch})`;
    const animation = ray.animate(
      [
        { offset: 0, opacity: 0, transform: transformAt(-6, 0.1), easing: BURST_EASE },
        { offset: 0.1, opacity: 1 },
        { offset: 0.38, opacity: 1, transform: transformAt(reach * 0.62, 1.3), easing: "cubic-bezier(0.3, 0.6, 0.6, 1)" },
        { offset: 1, opacity: 0, transform: transformAt(reach, 0.12) },
      ],
      { duration, delay, fill: "both" },
    );
    animation.onfinish = () => ray.remove();
    animation.oncancel = () => ray.remove();
  }
}

// キラッと光る星（4つの角を持つ星。外側にほのかな光）。
// タメ（小さく出て、一瞬ぐっと縮む）→ ツメ（一気に大きく弾ける）→ ぷるっと揺れて、くるっと回りながら消える。
// GLINT_SNAP は、出してから弾けきるまでの割合（ほかの演出と弾ける瞬間を合わせるのに使う）
const GLINT_SNAP = 0.34;

function emitGlint({ layer = els.effectLayer, x, y, z = 0, color, size, delay = 0, duration = 520 }) {
  if (!motion.enabled || !layer || layer.childElementCount > EFFECT_MAX_ELEMENTS) return;
  const glint = document.createElement("span");
  if (!canAnimate(glint)) return;
  glint.className = "node-glint";
  glint.style.left = `${x}px`;
  glint.style.top = `${y}px`;
  glint.style.width = `${size}px`;
  glint.style.height = `${size}px`;
  glint.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
  glint.style.setProperty("--branch", color);
  layer.appendChild(glint);
  const at = (scale, rotate) => `translateZ(${z}px) scale(${scale}) rotate(${rotate}deg)`;
  const animation = glint.animate(
    [
      { offset: 0, opacity: 0, transform: at(0, -70), easing: "ease-out" },
      { offset: 0.1, opacity: 1, transform: at(0.42, -40), easing: "ease-in-out" },
      // タメ: ぐっと縮む
      { offset: 0.2, transform: at(0.26, -48), easing: BURST_EASE },
      // ツメ: 一気に大きく
      { offset: GLINT_SNAP, transform: at(1.6, 14), easing: "cubic-bezier(0.3, 0, 0.5, 1)" },
      { offset: 0.48, transform: at(0.92, 32), easing: "ease-in-out" },
      { offset: 0.6, opacity: 1, transform: at(1.12, 40), easing: "cubic-bezier(0.5, 0, 0.8, 0.6)" },
      { offset: 1, opacity: 0, transform: at(0, 130) },
    ],
    { duration, delay, fill: "both" },
  );
  animation.onfinish = () => glint.remove();
  animation.oncancel = () => glint.remove();
}

// 星が弾けきる瞬間を、ある時刻に合わせるための出しはじめ（負にはしない）
function glintDelayFor(burstAt, duration = 520) {
  return Math.max(0, Math.round(burstAt - duration * GLINT_SNAP));
}

// ノードを足したとき: 着地してぽんと弾む瞬間（addBurstDelay）に、まず角の星がタメてから弾け、
// 同時にカードの縁から光の粒と光の筋がぱっと爆ぜ、光の輪が二重に広がり、カードの後ろが一瞬光る
function playAddCelebration(pos, plan) {
  if (!motion.enabled || !els.effectLayer) return;
  const z = state.isLayer3d ? pos.layerAxisY || 0 : 0;
  const landing = addBurstDelay(plan);
  playBurstFlash(pos, z, Math.max(0, landing - 40));
  playBurstRing(pos, z, landing, { to: 1.5, duration: 460 });
  playBurstRing(pos, z, landing + 70, { to: 1.95, duration: 620, thin: true });
  emitParticles({
    x: pos.x,
    y: pos.y,
    z,
    color: pos.color,
    count: 26,
    radiusX: pos.width * 0.45,
    radiusY: pos.height * 0.45,
    minDistance: 50,
    maxDistance: 165,
    fall: 26,
    duration: 820,
    delay: landing,
    sizeMin: 6,
    sizeMax: 14,
    whiteRatio: 0.25,
  });
  emitRays({
    x: pos.x,
    y: pos.y,
    z,
    color: pos.color,
    count: 10,
    radiusX: pos.width * 0.5,
    radiusY: pos.height * 0.5,
    length: 30,
    distance: 74,
    duration: 380,
    delay: landing,
  });
  const right = pos.x + pos.width / 2;
  const left = pos.x - pos.width / 2;
  const top = pos.y - pos.height / 2;
  const bottom = pos.y + pos.height / 2;
  emitGlint({ x: right - 8, y: top + 2, z, color: pos.color, size: 58, delay: glintDelayFor(landing) });
  emitGlint({ x: left + 14, y: bottom - 2, z, color: pos.color, size: 36, delay: glintDelayFor(landing + 90) });
  emitGlint({ x: left + 34, y: top - 6, z, color: pos.color, size: 26, delay: glintDelayFor(landing + 170) });
  emitGlint({ x: right - 30, y: bottom + 4, z, color: pos.color, size: 22, delay: glintDelayFor(landing + 240) });
}

// カードの形の光の輪が、外へ広がって消える（thin は細い2つ目の輪）
function playBurstRing(pos, z, delay, { to = 1.5, duration = 460, thin = false } = {}) {
  const ring = document.createElement("span");
  if (!canAnimate(ring) || els.effectLayer.childElementCount > EFFECT_MAX_ELEMENTS) return;
  ring.className = thin ? "dopa-burst-ring is-thin" : "dopa-burst-ring";
  ring.style.left = `${pos.x}px`;
  ring.style.top = `${pos.y}px`;
  ring.style.width = `${pos.width}px`;
  ring.style.height = `${pos.height}px`;
  ring.style.margin = `${-pos.height / 2}px 0 0 ${-pos.width / 2}px`;
  ring.style.setProperty("--branch", pos.color);
  els.effectLayer.appendChild(ring);
  // 待っている間は見せない（fill を backwards にしない。CSS の opacity: 0 のまま）
  const animation = ring.animate(
    [
      { offset: 0, opacity: 1, transform: `translateZ(${z}px) scale(0.94)`, easing: BURST_EASE },
      { offset: 1, opacity: 0, transform: `translateZ(${z}px) scale(${to})` },
    ],
    { duration, delay, fill: "forwards" },
  );
  animation.onfinish = () => ring.remove();
  animation.oncancel = () => ring.remove();
}

// カードの後ろが一瞬ぱっと光る（カードより下の置き場 ghostLayer に置くので、文字は隠れない）
function playBurstFlash(pos, z, delay) {
  const layer = els.ghostLayer;
  const flash = document.createElement("span");
  if (!layer || !canAnimate(flash)) return;
  const width = pos.width * 1.7;
  const height = pos.height * 2.4;
  flash.className = "dopa-burst-flash";
  flash.style.left = `${pos.x}px`;
  flash.style.top = `${pos.y}px`;
  flash.style.width = `${width.toFixed(0)}px`;
  flash.style.height = `${height.toFixed(0)}px`;
  flash.style.margin = `${(-height / 2).toFixed(0)}px 0 0 ${(-width / 2).toFixed(0)}px`;
  flash.style.setProperty("--branch", pos.color);
  layer.appendChild(flash);
  const animation = flash.animate(
    [
      { offset: 0, opacity: 0, transform: `translateZ(${z}px) scale(0.45)`, easing: BURST_EASE },
      { offset: 0.2, opacity: 1, transform: `translateZ(${z}px) scale(1.05)`, easing: "ease-out" },
      { offset: 1, opacity: 0, transform: `translateZ(${z}px) scale(1.4)` },
    ],
    { duration: 520, delay, fill: "both" },
  );
  animation.onfinish = () => flash.remove();
  animation.oncancel = () => flash.remove();
}

// 保存できたとき: 「保存済み」の札がタメてから弾むようにふくらみ、光がさっと横切り（CSS の .save-state.is-celebrating）、
// 札のまわりから星と光の筋がぱっと飛び散る（画面の上の置き場 uiEffectLayer）
let saveRewardTimer = null;

function playSaveReward() {
  const badge = els.saveStateBadge;
  if (!motion.enabled || !badge) return;
  window.clearTimeout(saveRewardTimer);
  badge.classList.remove("is-celebrating");
  // 続けて保存したときも、もう一度はじめから光るようにする（保存のときだけなので、ここで画面を測っても軽い）
  void badge.offsetWidth;
  badge.classList.add("is-celebrating");
  saveRewardTimer = window.setTimeout(() => badge.classList.remove("is-celebrating"), 1000);
  const box = badge.getBoundingClientRect();
  if (!box.width) return;
  const focus = getComputedStyle(document.documentElement).getPropertyValue("--focus").trim() || "#7cc0ff";
  const centerX = box.left + box.width / 2;
  const centerY = box.top + box.height / 2;
  // 札がタメから弾ける瞬間（CSS の save-pop の 30%）に合わせる
  const burstAt = 250;
  emitParticles({
    layer: els.uiEffectLayer,
    x: centerX,
    y: centerY,
    color: focus,
    count: 22,
    radiusX: box.width / 2,
    radiusY: box.height / 2,
    minDistance: 24,
    maxDistance: 96,
    fall: 14,
    duration: 860,
    delay: burstAt,
    starRatio: 0.75,
    whiteRatio: 0.3,
    sizeMin: 6,
    sizeMax: 13,
  });
  emitRays({
    layer: els.uiEffectLayer,
    x: centerX,
    y: centerY,
    color: focus,
    count: 10,
    radiusX: box.width / 2,
    radiusY: box.height / 2,
    length: 20,
    distance: 44,
    duration: 360,
    delay: burstAt,
  });
  emitGlint({ layer: els.uiEffectLayer, x: box.right - 2, y: box.top, color: focus, size: 36, delay: glintDelayFor(burstAt) });
  emitGlint({ layer: els.uiEffectLayer, x: box.left + 4, y: box.bottom, color: focus, size: 24, delay: glintDelayFor(burstAt + 110) });
  emitGlint({ layer: els.uiEffectLayer, x: box.left + box.width * 0.6, y: box.top - 4, color: focus, size: 18, delay: glintDelayFor(burstAt + 200) });
}

// カードがタメてから（一瞬ぐっと縮んでから）、ぽんとふくらむ。動いている途中のカードには付けない
function popCard(id, { peak = 1.08, squash = 0.965, duration = 300 } = {}) {
  if (!motion.enabled) return;
  const card = els.nodeLayer.querySelector(`.mind-node[data-id="${CSS.escape(id)}"]`);
  if (!card || !canAnimate(card)) return;
  if (card._dopaMotion?.animation?.playState === "running") return;
  const z = parseFloat(card.style.getPropertyValue("--layer-y")) || 0;
  const base = `translate(-50%, -50%) translateZ(${z}px)`;
  card.animate(
    [
      { offset: 0, transform: `${base} scale(1)`, easing: "ease-in" },
      { offset: 0.2, transform: `${base} scale(${squash})`, easing: BURST_EASE },
      { offset: 0.48, transform: `${base} scale(${peak})`, easing: "cubic-bezier(0.3, 1.4, 0.5, 1)" },
      { offset: 1, transform: `${base} scale(1)` },
    ],
    { duration },
  );
}

// ノードを選んだとき
function popSelectedCard(id) {
  popCard(id, { peak: 1.08, squash: 0.965, duration: 300 });
}

// ===== タイトルを書いているときの反応 =====
// 2026-11-17 ユーザーの希望で、詳細ではなくタイトルを書いているときに出す。
// ・打つたびに: 打っている文字のあたりから、光の粒と小さな星がぴょんと弾ける（間引いて出す）
// ・日本語の変換を確定したとき: 星がキラッと弾け、粒が飛び、カードが小さく弾む
// ・書き終えたとき（Enter・ほかを押して入力を終え、タイトルが変わっていたとき）: カードのまわりで粒と光の筋が爆ぜる
// 打っている文字の位置は、画面から測らずに、文字数とカードの大きさからおおよそを計算する（軽くするため）
const TITLE_SPARK_INTERVAL = 70;
const titleTyping = { id: "", text: "", lastAt: 0 };

function beginTitleTyping(id, text) {
  titleTyping.id = id;
  titleTyping.text = text;
}

// タイトルの最後の文字のあたり（地図の上の位置）。カードの作り（CSS の .mind-node / .node-content / .node-title）から計算する
function titleCaretPoint(id, text) {
  const pos = state.positions.get(id);
  if (!pos || !state.renderedIds.has(id)) return null;
  const isRoot = pos.depth === 0;
  const fontSize = isRoot ? 17 : 14;
  const lineHeight = fontSize * 1.35;
  // 左の線と余白と種類の印（24px＋すき間8px）の右から、右のボタンの列（88px＋すき間8px）の手前まで
  const titleLeft = pos.x - pos.width / 2 + (isRoot ? 46 : 52);
  const lineWidth = Math.max(30, pos.width - (isRoot ? 154 : 159));
  // 1文字ずつ並べて、入りきらなければ次の行へ（日本語は1文字が文字の大きさ、英数字はその半分ほど）
  let lineIndex = 0;
  let inLine = 0;
  for (const char of text) {
    const charWidth = char.charCodeAt(0) > 0x2e7f ? fontSize : fontSize * 0.56;
    if (inLine > 0 && inLine + charWidth > lineWidth) {
      lineIndex += 1;
      inLine = 0;
    }
    inLine += charWidth;
  }
  const lines = lineIndex + 1;
  const blockHeight = lines * lineHeight;
  const hasDetail = Boolean(findNode(id)?.node.detail);
  // 詳細があるときはタイトルの行がカードの上に寄る。ないときはカードの真ん中
  const rowCenter = hasDetail ? pos.y - pos.height / 2 + 11 + Math.max(26, blockHeight) / 2 : pos.y;
  return {
    x: titleLeft + Math.max(0, inLine),
    y: rowCenter - blockHeight / 2 + lineIndex * lineHeight + lineHeight / 2,
    z: state.isLayer3d ? pos.layerAxisY || 0 : 0,
    color: pos.color,
    pos,
  };
}

function reactToTitleTyping(id, text) {
  if (!motion.enabled || !els.effectLayer || !id) return;
  const previous = titleTyping.id === id ? titleTyping.text : text.slice(0, -1);
  beginTitleTyping(id, text);
  // 消したとき・変換で短くなったときは出さない
  if (text.length <= previous.length) return;
  const now = performance.now();
  if (now - titleTyping.lastAt < TITLE_SPARK_INTERVAL) return;
  titleTyping.lastAt = now;
  const point = titleCaretPoint(id, text);
  if (!point) return;
  emitParticles({
    x: point.x,
    y: point.y,
    z: point.z,
    color: point.color,
    count: 5,
    minDistance: 14,
    maxDistance: 36,
    angleFrom: Math.PI * 1.05,
    angleTo: Math.PI * 1.95,
    rise: 8,
    fall: 10,
    duration: 560,
    sizeMin: 4,
    sizeMax: 9,
    starRatio: 0.55,
    whiteRatio: 0.3,
  });
  // 星は、打った文字を隠さないよう、文字の右上に出す
  emitGlint({ x: point.x + 7, y: point.y - 11, z: point.z, color: point.color, size: 20, duration: 380 });
}

// 日本語の変換を確定したとき（compositionend）
function reactToTitleCommit(id, text, committed) {
  if (!motion.enabled || !els.effectLayer || !id || !committed) return;
  beginTitleTyping(id, text);
  const point = titleCaretPoint(id, text);
  if (!point) return;
  emitParticles({
    x: point.x,
    y: point.y,
    z: point.z,
    color: point.color,
    count: 10,
    minDistance: 18,
    maxDistance: 52,
    fall: 12,
    duration: 640,
    sizeMin: 5,
    sizeMax: 11,
    starRatio: 0.65,
    whiteRatio: 0.3,
  });
  emitRays({ x: point.x, y: point.y, z: point.z, color: point.color, count: 6, length: 14, distance: 30, duration: 300 });
  emitGlint({ x: point.x + 8, y: point.y - 12, z: point.z, color: point.color, size: 34, duration: 460 });
  popCard(id, { peak: 1.045, squash: 0.985, duration: 240 });
}

// タイトルを書き終えたとき（入力を終えて、タイトルが変わっていたとき）
function celebrateTitleDone(id) {
  if (!motion.enabled || !els.effectLayer || !id) return;
  const pos = state.positions.get(id);
  if (!pos || !state.renderedIds.has(id)) return;
  const z = state.isLayer3d ? pos.layerAxisY || 0 : 0;
  // カードがタメから弾ける瞬間（popCard の 0.48 ≒ 145ms）に合わせる
  const burstAt = 140;
  popCard(id, { peak: 1.08, squash: 0.95, duration: 300 });
  emitParticles({
    x: pos.x,
    y: pos.y,
    z,
    color: pos.color,
    count: 18,
    radiusX: pos.width * 0.47,
    radiusY: pos.height * 0.47,
    minDistance: 30,
    maxDistance: 100,
    fall: 18,
    duration: 720,
    delay: burstAt,
    sizeMin: 5,
    sizeMax: 12,
    whiteRatio: 0.25,
  });
  emitRays({
    x: pos.x,
    y: pos.y,
    z,
    color: pos.color,
    count: 8,
    radiusX: pos.width * 0.5,
    radiusY: pos.height * 0.5,
    length: 22,
    distance: 50,
    duration: 340,
    delay: burstAt,
  });
  const top = pos.y - pos.height / 2;
  emitGlint({ x: pos.x + pos.width / 2 - 10, y: top, z, color: pos.color, size: 42, delay: glintDelayFor(burstAt) });
  emitGlint({ x: pos.x - pos.width / 2 + 16, y: pos.y + pos.height / 2, z, color: pos.color, size: 26, delay: glintDelayFor(burstAt + 100) });
}

function canAnimate(element) {
  return typeof element?.animate === "function";
}

function captureMotionBefore(previousPositions) {
  const before = {
    // ノードをドラッグしている間・スライダーを動かしている間は、動きを付けない
    frozen: state.isDraggingNode || motion.freezeNext,
    // 別のマップを開いたときは、前の画面を無かったことにする（新しいマップが広がる動きだけ）
    reset: motion.skipNext,
    // 動かすものが多すぎて、減らしたとき true
    limited: false,
    // 大きいマップを開いたとき true（カードごとではなく、全体をまとめてふわっと出す）
    layerFade: false,
    // 前の描画が3Dだったか・注目していた階層。2D⇔3Dが切り替わったとき layerSwitch が true
    was3d: motion.wasLayer3d,
    prevFocusLayer: motion.lastFocusLayer,
    layerSwitch: motion.wasLayer3d !== state.isLayer3d,
    floors: [],
    nodes: new Map(),
    visual: new Map(),
    edges: new Map(),
  };
  motion.skipNext = false;
  motion.freezeNext = false;
  if (before.frozen || before.reset) return before;

  before.floors = [...els.floorLayer.children];
  els.nodeLayer.querySelectorAll(".mind-node[data-id]").forEach((el) => {
    const pos = previousPositions.get(el.dataset.id);
    if (!pos) return;
    before.nodes.set(el.dataset.id, el);
    before.visual.set(el.dataset.id, readNodeVisual(el, pos, before.was3d));
  });
  [...els.edgeLayer.children, ...els.edge3dLayer.children].forEach((el) => {
    const from = el.dataset?.from;
    const to = el.dataset?.to;
    // 線は使い回すので、描き直す前の暗さ（3Dで注目していない階層か）と伸びている途中の量を、ここで覚えておく
    if (from && to) {
      before.edges.set(`${from}->${to}`, { el, from, to, dimmed: el.classList.contains("is-layer-dimmed"), grow: readEdgeGrow(el) });
    }
  });
  return before;
}

// 前の画面のカードが、いまどこに・どの大きさで見えているか（動きの途中なら途中の位置）。
// layerAxisY は見えている高さ（3Dで階層ごとに上下に積んだ量。2Dなら0）
function readNodeVisual(el, pos, was3d) {
  const visual = {
    x: pos.x,
    y: pos.y,
    baseX: pos.x,
    baseY: pos.y,
    width: pos.width,
    height: pos.height,
    layerAxisY: was3d ? pos.layerAxisY || 0 : 0,
    // クラスを見るだけなので軽い（画面の計算は走らない）
    dimmed: el.classList.contains("is-layer-dimmed"),
    scale: 1,
    rotate: 0,
    opacity: null,
    active: false,
  };
  const current = el._dopaMotion;
  const animation = current?.animation;
  if (!animation || animation.playState === "finished" || animation.playState === "idle") return visual;
  // 進み具合（ゆっくり止まる曲線をかけたあとの値）
  const progress = animation.effect?.getComputedTiming().progress;
  if (progress == null) return visual;
  const rest = 1 - progress;
  const elapsed = Number(animation.currentTime) || 0;
  visual.x += current.dx * rest;
  visual.y += current.dy * rest;
  visual.layerAxisY += (current.dz || 0) * rest;
  visual.scale = 1 + (current.scale - 1) * rest;
  visual.rotate = current.rotate * rest;
  // 濃さは計算で出す（画面から読み取ると、そのたびに画面全体の計算が走って重いため）
  if (current.opacity != null) visual.opacity = clamp(current.opacity + (1 - current.opacity) * progress, 0, 1);
  visual.active = true;
  visual.pendingDelay = Math.max(0, current.delay - elapsed);
  visual.remaining = Math.max(0, current.delay + current.duration - elapsed);
  visual.duration = current.duration;
  visual.easing = current.easing;
  return visual;
}

function planNodeMotions(before) {
  const plans = new Map();
  if (before.frozen || !canAnimate(els.nodeLayer)) return plans;
  const timing = motionTiming();
  const parentById = new Map();
  walk(state.tree, (node) => node.children.forEach((child) => parentById.set(child.id, node.id)));
  // 前の画面がない（マップを開いた直後）ときは、このあと全体表示に合わせるので、画面の外かどうかは見ない
  const isFirstScreen = before.nodes.size === 0;
  walk(state.tree, (node) => {
    const pos = state.positions.get(node.id);
    if (!pos || !shouldRenderLayer(pos.layer)) return;
    const plan = planNodeMotion(node, pos, before, parentById, timing);
    if (!plan) return;
    // 画面の外で動くノードは、見えないので動きを付けない（途中のものは跳ばないよう続ける）。
    // 2D⇔3Dの切り替えでは、このあと画面ごと回り込むので、いまの画面で外かどうかは見ない
    if (!isFirstScreen && !before.layerSwitch && plan.kind !== "continue" && !isMotionOnScreen(pos, plan)) return;
    plans.set(node.id, plan);
  });
  if (plans.size <= MOTION_MAX_ANIMATED) return plans;

  // 動かすものが多すぎるときは、軽くする
  before.limited = true;
  if (isFirstScreen) {
    // 大きいマップを開いた: カードごとに動かさず、全体をまとめてふわっと出す
    before.layerFade = !state.isLayer3d;
    return new Map();
  }
  // 押し出されて動くだけ・明るさが変わるだけのノードは、動かさずにすぐ変える（足した・開いたノードの動きは残す）
  plans.forEach((plan, id) => {
    if (plan.kind === "move" || plan.kind === "fade") plans.delete(id);
  });
  if (plans.size <= MOTION_MAX_ANIMATED) return plans;
  // それでも多いときは、先に動き出すもの（開いた所に近いもの）から上限まで
  const keep = [...plans].filter(([, plan]) => plan.kind !== "enter");
  const enters = [...plans].filter(([, plan]) => plan.kind === "enter").sort((a, b) => a[1].delay - b[1].delay);
  return new Map([...keep, ...enters.slice(0, Math.max(0, MOTION_MAX_ANIMATED - keep.length))]);
}

// 出発点か着く所が、画面の中（少し外まで含む）にあるか
function isMotionOnScreen(pos, plan) {
  return isWorldPointNearScreen(pos.x, pos.y, pos.layerAxisY) || isWorldPointNearScreen(pos.x + plan.dx, pos.y + plan.dy, pos.layerAxisY);
}

function isWorldPointNearScreen(x, y, layerAxisY = 0) {
  // 表示枠の大きさがまだ分からないときは、画面の中として扱う
  if (!motion.viewWidth || !motion.viewHeight) return true;
  const point = projectWorldPoint(x, y, state.isLayer3d ? layerAxisY || 0 : 0);
  const screenX = state.pan.x + point.x * state.zoom;
  const screenY = state.pan.y + point.y * state.zoom;
  // カードの大きさの分も足す
  const margin = MOTION_SCREEN_MARGIN + NODE_WIDTH * state.zoom;
  return (
    screenX > -margin &&
    screenX < motion.viewWidth + margin &&
    screenY > -margin &&
    screenY < motion.viewHeight + margin
  );
}

function watchViewportSize() {
  if (typeof ResizeObserver !== "function") return;
  new ResizeObserver((entries) => {
    const box = entries[entries.length - 1]?.contentRect;
    if (!box) return;
    motion.viewWidth = box.width;
    motion.viewHeight = box.height;
    followPanelSlide();
    if (minimap.view) updateMinimapFrame();
  }).observe(els.viewport);
}

// dx, dy, dz は「出発点 − 新しい位置」（dz は3Dの高さ）。scale / rotate / opacity は出発点での値（opacity が null なら変えない）
function planNodeMotion(node, pos, before, parentById, timing) {
  const visual = before.visual.get(node.id);
  const newZ = state.isLayer3d ? pos.layerAxisY || 0 : 0;
  // 2D⇔3Dの切り替えでは、画面が回り込むのと同じ時間・同じ動き方で、階層が浮かぶ・沈む
  const switchTiming = before.layerSwitch && motion.enabled ? { duration: CAMERA_GLIDE_MS, easing: CAMERA_EASE } : null;
  if (visual) {
    const dx = visual.x - pos.x;
    const dy = visual.y - pos.y;
    const dz = visual.layerAxisY - newZ;
    // 3Dで注目する階層を変えた: 暗かったノードは明るく、明るかったノードは暗く、ふわっと入れ替える
    const isDimmedNow = state.isLayer3d && pos.layer !== state.focusLayerDepth;
    const fadeFrom =
      before.was3d && state.isLayer3d && visual.dimmed !== isDimmedNow ? (visual.dimmed ? NODE_DIMMED_OPACITY : 1) : null;
    if (visual.active) {
      // 動いている途中で描き直された: いま見えている所から続きを動かす
      const isWaiting = visual.pendingDelay > 0;
      return {
        kind: "continue",
        dx,
        dy,
        dz,
        scale: visual.scale,
        rotate: visual.rotate,
        opacity: visual.opacity ?? fadeFrom,
        delay: visual.pendingDelay,
        duration: isWaiting ? visual.duration : Math.max(140, visual.remaining),
        easing: visual.easing,
      };
    }
    if (Math.hypot(dx, dy) >= 1.5 || Math.abs(dz) >= 1.5) {
      // 並びが変わって押し出されたノード・3Dで浮かぶ／沈むノード: 前の位置からすっと移る
      return {
        kind: "move",
        dx,
        dy,
        dz,
        scale: 1,
        rotate: 0,
        opacity: fadeFrom,
        delay: 0,
        duration: switchTiming?.duration ?? timing.move,
        easing: switchTiming?.easing ?? (motion.enabled ? MOTION_EASE_MOVE : MOTION_EASE),
      };
    }
    if (fadeFrom != null && motion.enabled) {
      return { kind: "fade", dx: 0, dy: 0, dz: 0, scale: 1, rotate: 0, opacity: fadeFrom, delay: 0, duration: FOCUS_FADE_MS, easing: MOTION_EASE };
    }
    return null;
  }

  const zOf = (anchor) => (anchor ? anchor.layerAxisY || 0 : newZ);
  const parentId = parentById.get(node.id);
  if (node.id === state.flashId) {
    // 足したノード: 親の所から生まれて、自分の場所へ（下の階層に足したときは、親の階層から降りてくる）
    const anchor = parentId ? before.visual.get(parentId) || state.positions.get(parentId) : null;
    return {
      kind: "add",
      dx: anchor ? (anchor.x - pos.x) * timing.addReach : 0,
      dy: anchor ? (anchor.y - pos.y) * timing.addReach : 0,
      dz: state.isLayer3d ? (zOf(anchor) - newZ) * timing.addReach : 0,
      scale: timing.addScale,
      rotate: timing.addRotate,
      opacity: 0,
      delay: 0,
      duration: timing.add,
      easing: MOTION_EASE_ADD,
    };
  }

  // 開いた枝・元に戻したノード: 見えていた祖先の方から、親→子→孫の順に広がる
  let anchorId = parentId;
  let steps = 1;
  while (anchorId && !before.visual.has(anchorId)) {
    anchorId = parentById.get(anchorId);
    steps += 1;
  }
  let anchor = anchorId ? before.visual.get(anchorId) : null;
  let reach = timing.expandReach;
  let order = steps - 1;
  if (!anchor) {
    // 開いたばかりのマップ: 中心から外へ、少しずつ現れる
    anchor = parentId ? state.positions.get(parentId) : null;
    reach = timing.enterReach;
    order = pos.depth;
  }
  // 3Dにしたときに現れる、ほかの階層のノード: 下の面から浮かび上がる
  const zReach = switchTiming ? 1 : reach;
  return {
    kind: "enter",
    dx: anchor ? (anchor.x - pos.x) * reach : 0,
    dy: anchor ? (anchor.y - pos.y) * reach : 0,
    dz: state.isLayer3d ? (zOf(anchor) - newZ) * zReach : 0,
    scale: timing.enterScale,
    rotate: 0,
    opacity: 0,
    delay: Math.min(order * timing.stagger, timing.staggerMax),
    duration: switchTiming?.duration ?? timing.enter,
    easing: switchTiming?.easing ?? (motion.enabled ? MOTION_EASE_ENTER : MOTION_EASE),
  };
}

function playMotions(before, plans, nodeMotions, edgeMotions) {
  if (before.reset) clearGhosts();
  if (before.frozen) return;
  if (before.layerFade) {
    fadeInLayers();
    return;
  }
  nodeMotions.forEach(({ el, pos, plan }) => {
    playNodeMotion(el, pos, plan);
    if (plan.kind === "add") playAddCelebration(pos, plan);
  });
  edgeMotions.forEach((item) => playEdgeMotion(item, before, plans));
  playLeaving(before);
  playFloorMotion(before);
}

// 3Dの階層の床: 3Dにしたら下から浮かび上がる／2Dに戻したら沈みながら消える／注目する階層を変えたら明るさが入れ替わる
function playFloorMotion(before) {
  if (!motion.enabled || !canAnimate(els.floorLayer)) return;
  const plates = [...els.floorLayer.children];
  if (state.isLayer3d && !before.was3d) {
    plates.forEach((plate) => {
      const layer = Number(plate.dataset.layer) || 0;
      plate.animate([{ offset: 0, opacity: 0, transform: "translateZ(0px)" }, { offset: 1 }], {
        duration: CAMERA_GLIDE_MS,
        delay: Math.min(layer * 70, 280),
        easing: CAMERA_EASE,
        fill: "backwards",
      });
    });
    return;
  }
  if (!state.isLayer3d && before.was3d) {
    // 消えた床を置き場に戻して、沈めてから消す（床の置き場は次の描き直しで空になる）
    before.floors.forEach((plate) => {
      if (!canAnimate(plate)) return;
      els.floorLayer.appendChild(plate);
      const animation = plate.animate([{ offset: 0 }, { offset: 1, opacity: 0, transform: "translateZ(0px)" }], {
        duration: CAMERA_GLIDE_MS,
        easing: CAMERA_EASE,
        fill: "forwards",
      });
      animation.onfinish = () => plate.remove();
    });
    return;
  }
  if (state.isLayer3d && before.prevFocusLayer !== state.focusLayerDepth) {
    plates.forEach((plate) => {
      const layer = Number(plate.dataset.layer) || 0;
      const wasFocused = layer === before.prevFocusLayer;
      if (wasFocused === (layer === state.focusLayerDepth)) return;
      plate.animate([{ offset: 0, opacity: wasFocused ? FLOOR_FOCUSED_OPACITY : FLOOR_DIMMED_OPACITY }, { offset: 1 }], {
        duration: FOCUS_FADE_MS,
        easing: MOTION_EASE,
      });
    });
  }
}

// 大きいマップを開いたとき: カードと線の置き場ごと、まとめてふわっと出す（動かすのは2つだけなので軽い）
function fadeInLayers() {
  const timing = motionTiming();
  [els.edgeLayer, els.nodeLayer].forEach((layer) => {
    if (!canAnimate(layer)) return;
    layer.animate([{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }], {
      duration: timing.enter,
      easing: MOTION_EASE,
    });
  });
}

function playNodeMotion(el, pos, plan) {
  if (!canAnimate(el)) return;
  // CSS の .mind-node と同じ並びにする（translate(-50%, -50%) translateZ(階層の高さ)）
  const z = state.isLayer3d ? pos.layerAxisY || 0 : 0;
  const base = `translate(-50%, -50%) translateZ(${z}px)`;
  const first = {
    offset: 0,
    transform: `translate(-50%, -50%) translateZ(${z + (plan.dz || 0)}px) translate(${plan.dx}px, ${plan.dy}px) scale(${plan.scale}) rotate(${plan.rotate}deg)`,
  };
  // 終わりの濃さは書かない（薄く表示するノードは、その薄さで止まる）
  if (plan.opacity != null) first.opacity = plan.opacity;
  const last = { offset: 1, transform: `${base} translate(0px, 0px) scale(1) rotate(0deg)` };
  const animation = el.animate([first, last], {
    duration: plan.duration,
    delay: plan.delay,
    easing: plan.easing,
    fill: "backwards",
  });
  el._dopaMotion = { ...plan, animation };
  if (plan.kind === "add") playAddPop(el, plan);
}

// 足したノードが着く直前から、カードの大きさだけがぽんと弾む（位置は動かさないので、線は途切れない）。
// 上の動きに「足し算」で重ねる（composite: "add"）。重ねられないブラウザでは弾ませない
const ADD_POP_START = 0.2;
const ADD_POP_MS = 260;
const ADD_POP_PEAK = 0.3;
const CAN_ADD_TRANSFORMS = (() => {
  try {
    return new KeyframeEffect(null, [{ transform: "none" }], { composite: "add" }).composite === "add";
  } catch {
    return false;
  }
})();

function playAddPop(el, plan) {
  if (!motion.enabled || !CAN_ADD_TRANSFORMS) return;
  el.animate(
    [
      { offset: 0, transform: "scale(1)", easing: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
      { offset: ADD_POP_PEAK, transform: "scale(1.14)", easing: "ease-in-out" },
      // 1より小さくしすぎると、カードの左の縁と線の端の間にすき間が見えるので、ほんの少しだけ
      { offset: 0.62, transform: "scale(0.995)", easing: "ease-in-out" },
      { offset: 1, transform: "scale(1)" },
    ],
    { duration: ADD_POP_MS, delay: plan.delay + Math.round(plan.duration * ADD_POP_START), composite: "add" },
  );
}

// 足したノードがいちばん大きく弾む瞬間（ごほうびの演出を合わせる）
function addBurstDelay(plan) {
  return plan.delay + Math.round(plan.duration * ADD_POP_START + ADD_POP_MS * ADD_POP_PEAK);
}

// 実線の線だけ、端から伸ばす（点線は線の模様がずれるので、ふわっと出す）
function isSolidEdgeElement(el) {
  return el.classList.contains("relation-normal") && !el.classList.contains("is-layer-connector");
}

function playEdgeMotion({ el, edge, from, to, isConnector, is3d }, before, plans) {
  if (!canAnimate(el)) return;
  const old = before.edges.get(edgeKey(edge));
  const fromPlan = plans.get(edge.from);
  const toPlan = plans.get(edge.to);
  // 線は、つながるノード（子の方を優先）と同じ速さ・同じタイミングで動かす
  const driver = toPlan || fromPlan;
  // 伸びている量（0 = まだ見えない、1 = 全部）。前の画面で伸びている途中なら、その続きから
  let growFrom = 1;
  let oldGrow = null;
  if (!old) {
    growFrom = 0;
  } else {
    // 線は使い回すので、描き直す前に覚えた量を使う（render() で前の動きは止めてある）
    oldGrow = old.grow;
    if (oldGrow) growFrom = oldGrow.value;
  }
  // 3Dで注目する階層を変えた: 線の明るさも、ノードと一緒にふわっと入れ替える（クラスを見るだけなので軽い）
  let fadeFrom = null;
  if (old && is3d && before.was3d && motion.enabled) {
    const wasDimmed = old.dimmed;
    if (wasDimmed !== el.classList.contains("is-layer-dimmed")) {
      fadeFrom = wasDimmed ? EDGE_3D_DIMMED_OPACITY : EDGE_3D_FOCUSED_OPACITY;
    }
  }
  if (!driver && growFrom >= 1 && fadeFrom == null) return;
  // 動かすものを減らしたときは、つながるノードが動かない新しい線は、伸ばさずにそのまま出す
  if (!driver && !oldGrow && before.limited) return;

  let timing;
  if (driver) {
    timing = { duration: driver.duration, delay: driver.delay, easing: driver.easing };
  } else if (!oldGrow && fadeFrom != null) {
    timing = { duration: FOCUS_FADE_MS, delay: 0, easing: MOTION_EASE };
  } else if (oldGrow) {
    const isWaiting = oldGrow.pendingDelay > 0;
    timing = {
      duration: isWaiting ? oldGrow.duration : Math.max(140, oldGrow.remaining),
      delay: oldGrow.pendingDelay,
      easing: oldGrow.easing,
    };
  } else {
    timing = { duration: motionTiming().enter, delay: 0, easing: MOTION_EASE };
  }

  const first = { offset: 0 };
  const last = { offset: 1 };
  if (driver) {
    // 両端のノードの出発点を結んだ形から、いまの形へ（ノードと一緒に伸び縮みする）
    const a = motionStartPosition(from, fromPlan);
    const b = motionStartPosition(to, toPlan);
    if (is3d) {
      const geometry = edge3dGeometry(a, b);
      first.transform = geometry.transform;
      first.width = `${geometry.length}px`;
    } else {
      first.d = `path("${isConnector ? pathForLayerConnector(a, b) : pathForEdge(a, b)}")`;
    }
  }
  // 実線が端から伸びる量（stroke-dashoffset）は、別の動きにして行き過ぎさせない。
  // 行き過ぎると値が負になり、親の側にすき間ができて線が途切れて見えるため（形の変化 d は、ノードと同じく弾ませてよい）
  const growsByDash = growFrom < 1 && !is3d && isSolidEdgeElement(el);
  if (growFrom < 1) {
    if (is3d) {
      first.clipPath = `inset(0 ${((1 - growFrom) * 100).toFixed(2)}% 0 0)`;
      last.clipPath = "inset(0 0% 0 0)";
    } else if (!growsByDash) {
      first.opacity = String(0.72 * growFrom);
    }
  }
  if (fadeFrom != null && first.opacity == null) first.opacity = String(fadeFrom);
  const keyframes = [first, last];
  // 3Dから2Dに戻すとき: 平らな線（SVG）は高さを持てないので、ノードが降りてくるまで隠しておき、降りたらふわっと出す
  const isLanding = !is3d && Boolean(driver) && (Math.abs(fromPlan?.dz || 0) >= 1.5 || Math.abs(toPlan?.dz || 0) >= 1.5);
  if (isLanding) {
    first.opacity = "0";
    keyframes.splice(1, 0, { offset: 0.6, opacity: "0" });
  }
  const animation = Object.keys(first).length > 1 ? el.animate(keyframes, { ...timing, fill: "backwards" }) : null;
  el._dopaEdgeAnimation = animation;
  if (growsByDash) {
    const growTiming = { ...timing, easing: withoutOvershoot(timing.easing) };
    const growAnimation = el.animate(
      [
        { offset: 0, strokeDashoffset: String(1 - growFrom) },
        { offset: 1, strokeDashoffset: "0" },
      ],
      { ...growTiming, fill: "backwards" },
    );
    el._dopaGrow = { animation: growAnimation, from: growFrom, ...growTiming };
  } else if (growFrom < 1 && animation) {
    el._dopaGrow = { animation, from: growFrom, ...timing };
  }
}

// 行き過ぎる動き方（cubic-bezier の y が 1 を超えるもの）なら、行き過ぎない動き方に替える
function withoutOvershoot(easing) {
  const match = /cubic-bezier\(([^)]+)\)/.exec(easing || "");
  if (!match) return easing;
  const [, y1, , y2] = match[1].split(",").map(Number);
  return y1 > 1 || y2 > 1 ? MOTION_EASE : easing;
}

function motionStartPosition(pos, plan) {
  if (!plan) return pos;
  return {
    ...pos,
    x: pos.x + plan.dx,
    y: pos.y + plan.dy,
    layerAxisY: (pos.layerAxisY || 0) + (plan.dz || 0),
    width: pos.width * plan.scale,
    height: pos.height * plan.scale,
  };
}

function readEdgeGrow(el) {
  const grow = el._dopaGrow;
  const animation = grow?.animation;
  if (!animation || animation.playState === "finished" || animation.playState === "idle") return null;
  const progress = animation.effect?.getComputedTiming().progress;
  if (progress == null) return null;
  const elapsed = Number(animation.currentTime) || 0;
  return {
    value: grow.from + (1 - grow.from) * progress,
    pendingDelay: Math.max(0, grow.delay - elapsed),
    remaining: Math.max(0, grow.delay + grow.duration - elapsed),
    duration: grow.duration,
    easing: grow.easing,
  };
}

// 消えたノードと線: 親（まだ見えている一番近い祖先）の方へしまわれてから消える
function playLeaving(before) {
  if (!els.ghostLayer || !els.ghostEdgeLayer) return;
  // 画面の外で消えるものは見えないので、動きを付けずにそのまま消す
  let leavingNodes = [...before.nodes].filter(([id]) => {
    if (state.renderedIds.has(id)) return false;
    const visual = before.visual.get(id);
    return isWorldPointNearScreen(visual.x, visual.y, visual.layerAxisY);
  });
  // ドパ版: 消したカードそのものは、割れて散る（ほかに消えるものが多くても、この1枚だけは割る）
  const shattered = leavingNodes.find(([id]) => id === motion.shatterId);
  if (shattered && motion.enabled) {
    playShatter(shattered[1], before.visual.get(shattered[0]));
    leavingNodes = leavingNodes.filter((item) => item !== shattered);
  }
  const renderedEdgeKeys = new Set(
    [...els.edgeLayer.children, ...els.edge3dLayer.children].map((el) => `${el.dataset.from}->${el.dataset.to}`),
  );
  const leavingEdges = [...before.edges.values()].filter((item) => {
    if (renderedEdgeKeys.has(`${item.from}->${item.to}`)) return false;
    const a = before.visual.get(item.from);
    const b = before.visual.get(item.to);
    return Boolean(
      (a && isWorldPointNearScreen(a.x, a.y, a.layerAxisY)) || (b && isWorldPointNearScreen(b.x, b.y, b.layerAxisY)),
    );
  });
  if (!leavingNodes.length && !leavingEdges.length) return;
  if (leavingNodes.length > MOTION_MAX_GHOSTS || leavingEdges.length > MOTION_MAX_GHOSTS) return;

  const timing = motionTiming();
  const oldParent = new Map();
  before.edges.forEach((item) => oldParent.set(item.to, item.from));

  // ここでは画面から値を読み取らない（getComputedStyle や getAnimations は、1回ごとに画面全体の計算が走って重い）
  leavingNodes.forEach(([id, el]) => {
    if (!canAnimate(el)) return;
    const visual = before.visual.get(id);
    let anchorId = oldParent.get(id);
    while (anchorId && !state.renderedIds.has(anchorId)) anchorId = oldParent.get(anchorId);
    const anchor = anchorId ? state.positions.get(anchorId) : null;
    const startX = visual.x - visual.baseX;
    const startY = visual.y - visual.baseY;
    const endX = anchor ? (anchor.x - visual.baseX) * timing.leaveReach : startX;
    const endY = anchor ? (anchor.y - visual.baseY) * timing.leaveReach : startY;
    const z = parseFloat(el.style.getPropertyValue("--layer-y")) || 0;
    const base = `translate(-50%, -50%) translateZ(${z}px)`;
    el._dopaMotion?.animation.cancel();
    el._dopaMotion = null;
    el.removeAttribute("data-id");
    el.classList.add("is-ghost");
    els.ghostLayer.appendChild(el);
    const first = {
      offset: 0,
      transform: `${base} translate(${startX}px, ${startY}px) scale(${visual.scale}) rotate(${visual.rotate}deg)`,
    };
    // 出てくる途中だったときだけ、その濃さから。ふだんは今の濃さのまま（書かなければ今の濃さから始まる）
    if (visual.opacity != null) first.opacity = visual.opacity;
    const animation = el.animate(
      [
        first,
        {
          offset: 1,
          opacity: 0,
          // 親の方へ吸い込まれながら、少しひねって小さくなる（左へ消えるときは左回り）
          transform: `${base} translate(${endX}px, ${endY}px) scale(${timing.leaveScale}) rotate(${endX < startX ? -timing.leaveRotate : timing.leaveRotate}deg)`,
        },
      ],
      { duration: timing.leave, easing: MOTION_EASE_LEAVE, fill: "forwards" },
    );
    animation.onfinish = () => el.remove();
    animation.oncancel = () => el.remove();
  });

  leavingEdges.forEach(({ el }) => {
    if (!canAnimate(el)) return;
    const grow = readEdgeGrow(el);
    const value = grow ? Math.min(1, grow.value) : 1;
    const is3d = !(el instanceof SVGElement);
    el._dopaEdgeAnimation?.cancel();
    el._dopaGrow?.animation?.cancel();
    el._dopaEdgeAnimation = null;
    el._dopaGrow = null;
    el.removeAttribute("data-from");
    el.removeAttribute("data-to");
    el.classList.add("is-ghost");
    const first = { offset: 0 };
    const last = { offset: 1 };
    if (is3d) {
      els.ghostLayer.appendChild(el);
      first.clipPath = `inset(0 ${((1 - value) * 100).toFixed(2)}% 0 0)`;
      last.clipPath = "inset(0 100% 0 0)";
    } else {
      els.ghostEdgeLayer.appendChild(el);
      if (isSolidEdgeElement(el)) {
        // 子の端から親の方へ縮む
        first.strokeDashoffset = String(1 - value);
        last.strokeDashoffset = "1";
      } else {
        last.opacity = "0";
      }
    }
    const animation = el.animate([first, last], { duration: timing.leave, easing: MOTION_EASE_LEAVE, fill: "forwards" });
    animation.onfinish = () => el.remove();
    animation.oncancel = () => el.remove();
  });
}

// ===== ドパ版: 消したカードが割れて散る（2026-11-17 ユーザーが選んだ案「消すときの演出」） =====
// カードを写した破片（cloneNode）を SHATTER_PIECES 枚作り、それぞれ扇の形に切り抜いて（clip-path）、
// タメ（ひびが入って少しだけ離れる）→ ツメ（一気に外へ飛ぶ）→ 回りながら落ちて消える。粒（ほこり）と光の筋も少し出す。
// 破片はカードより上の置き場（effectLayer）に置き、約0.75秒で消す。演出がオフのときは呼ばない（これまでどおり、しまわれて消える）
const SHATTER_PIECES = 9;
const SHATTER_MS = 760;

function playShatter(el, visual) {
  if (!el || !visual || !els.effectLayer || !canAnimate(el)) return;
  el._dopaMotion?.animation?.cancel();
  el._dopaMotion = null;
  const width = visual.width;
  const height = visual.height;
  const z = parseFloat(el.style.getPropertyValue("--layer-y")) || 0;
  const color = el.style.getPropertyValue("--branch") || "#9aa4b2";
  // カードの見えている位置（動きの途中なら途中の位置）
  const left = visual.x;
  const top = visual.y;
  const shapes = shatterShapes(width, height, SHATTER_PIECES);
  const template = el.cloneNode(true);
  template.removeAttribute("data-id");
  template.classList.remove("is-selected", "is-new");
  template.classList.add("dopa-shard");
  template.setAttribute("inert", "");
  template.setAttribute("aria-hidden", "true");
  template.style.left = `${left}px`;
  template.style.top = `${top}px`;
  shapes.forEach((shape) => {
    if (els.effectLayer.childElementCount > EFFECT_MAX_ELEMENTS) return;
    const shard = template.cloneNode(true);
    shard.style.clipPath = `polygon(${shape.points.map(([px, py]) => `${px.toFixed(1)}% ${py.toFixed(1)}%`).join(", ")})`;
    shard.style.transformOrigin = `${shape.cx.toFixed(1)}% ${shape.cy.toFixed(1)}%`;
    els.effectLayer.appendChild(shard);
    // 破片の重心から外へ向かう向き（カードの真ん中から見て）
    const dirX = (shape.cx - 50) / 50;
    const dirY = (shape.cy - 50) / 50;
    const length = Math.hypot(dirX, dirY) || 1;
    const ux = dirX / length;
    const uy = dirY / length;
    const distance = 46 + Math.random() * 60;
    const spin = (ux >= 0 ? 1 : -1) * (40 + Math.random() * 150);
    const base = `translate(-50%, -50%) translateZ(${z}px)`;
    const at = (tx, ty, rotate, scale) =>
      `${base} translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${rotate.toFixed(0)}deg) scale(${scale})`;
    const start = `${base} translate(0px, 0px) rotate(${visual.rotate || 0}deg) scale(${visual.scale || 1})`;
    const animation = shard.animate(
      [
        { offset: 0, transform: start, opacity: 1, easing: "ease-out" },
        // タメ: ひびが入って、ほんの少しだけ離れる
        { offset: 0.14, transform: at(ux * 4, uy * 4, spin * 0.03, 1), opacity: 1, easing: BURST_EASE },
        // ツメ: 一気に外へ
        { offset: 0.42, transform: at(ux * distance * 0.75, uy * distance * 0.75 - 10, spin * 0.6, 0.92), opacity: 1, easing: "cubic-bezier(0.4, 0, 0.7, 1)" },
        // 回りながら落ちて消える
        { offset: 1, transform: at(ux * distance, uy * distance + 70, spin, 0.7), opacity: 0 },
      ],
      { duration: Math.round(SHATTER_MS * (0.85 + Math.random() * 0.3)), fill: "forwards" },
    );
    animation.onfinish = () => shard.remove();
    animation.oncancel = () => shard.remove();
  });
  el.remove();
  // 割れた瞬間（タメが終わるころ）に、ほこりの粒と短い光の筋
  const burstAt = Math.round(SHATTER_MS * 0.12);
  emitParticles({
    x: left,
    y: top,
    z,
    color,
    count: 14,
    radiusX: width * 0.4,
    radiusY: height * 0.4,
    minDistance: 20,
    maxDistance: 70,
    fall: 34,
    duration: 700,
    delay: burstAt,
    sizeMin: 3,
    sizeMax: 8,
    starRatio: 0.3,
    whiteRatio: 0.35,
  });
  emitRays({ x: left, y: top, z, color, count: 7, radiusX: width * 0.42, radiusY: height * 0.42, length: 18, distance: 40, duration: 300, delay: burstAt });
}

// カードを扇の形の破片に分ける。真ん中あたり（少しずらす）から、カードの縁の上の点までを結んで切る。
// 返す値は、各破片の角の点（カードの幅・高さに対する %）と重心
function shatterShapes(width, height, count) {
  const perimeter = 2 * (width + height);
  // 縁の上の位置 t（0〜perimeter）を、カードの中の座標（%）にする。上の辺 → 右 → 下 → 左 の順
  const pointAt = (t) => {
    const d = ((t % perimeter) + perimeter) % perimeter;
    if (d < width) return [(d / width) * 100, 0];
    if (d < width + height) return [100, ((d - width) / height) * 100];
    if (d < 2 * width + height) return [100 - ((d - width - height) / width) * 100, 100];
    return [0, 100 - ((d - 2 * width - height) / height) * 100];
  };
  const corners = [width, width + height, 2 * width + height, perimeter];
  const center = [50 + (Math.random() - 0.5) * 24, 50 + (Math.random() - 0.5) * 30];
  const offset = Math.random() * perimeter;
  const cuts = Array.from({ length: count }, (_, index) => offset + ((index + 0.25 + Math.random() * 0.5) * perimeter) / count);
  return cuts.map((from, index) => {
    const to = index + 1 < count ? cuts[index + 1] : cuts[0] + perimeter;
    const points = [center, pointAt(from)];
    // 間にある角も入れる（入れないと、角の部分が欠ける）
    for (let lap = 0; lap <= 2; lap += 1) {
      corners.forEach((corner) => {
        const c = corner + lap * perimeter;
        if (c > from && c < to) points.push(pointAt(c));
      });
    }
    points.push(pointAt(to));
    const cx = points.reduce((sum, [px]) => sum + px, 0) / points.length;
    const cy = points.reduce((sum, [, py]) => sum + py, 0) / points.length;
    return { points, cx, cy };
  });
}

function clearGhosts() {
  if (els.ghostLayer) els.ghostLayer.textContent = "";
  if (els.ghostEdgeLayer) els.ghostEdgeLayer.textContent = "";
  if (els.effectLayer) els.effectLayer.textContent = "";
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
  }, motionTiming().add);
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
  // 消えていく途中のカード（ghostLayer）は対象にしない。
  // ドパ版: カードを使い回すので、まだつないでいない（新しく作った）カードだけにつなぐ
  els.nodeLayer.querySelectorAll(".mind-node").forEach((nodeEl) => {
    if (nodeEl._dopaBound) return;
    nodeEl._dopaBound = true;
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
      beginTitleTyping(id, title.textContent);
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
      // ドパ版: タイトルを書いているときの反応
      reactToTitleTyping(id, title.textContent);
    });

    title.addEventListener("compositionend", (event) => {
      reactToTitleCommit(id, title.textContent, event.data);
    });

    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        title.blur();
      }
    });

    title.addEventListener("blur", () => {
      // 行数が変わるとカードの高さも変わるので、並びを計算し直す
      if ((findNode(id)?.node.text || "") !== textBeforeEdit) {
        scheduleRelayout();
        // ドパ版: 書き終えたら、カードのまわりで弾ける（並べ直したあとの位置で出す。並べ直しより後に動く）
        window.setTimeout(() => celebrateTitleDone(id), 0);
      }
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
    {
      label: "子を等間隔にそろえる",
      detail: "☰",
      disabled: !canSpaceChildrenEvenly(id),
      action: () => spaceChildrenEvenly(id),
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
    // 線の上を流れている光は、線が動くとずれるので消す
    clearSparks();
    // ドパ版: カードを使い回すので、ドラッグを始めたら、カードの中の入力（タイトル・詳細）を終えて、文字の選択を外す
    // （作り直していたころは、カードが入れ替わって自然に外れていた）
    const active = document.activeElement;
    if (active && els.nodeLayer.contains(active)) active.blur();
    // 「子を等間隔に」のあとに少しの間出している印は、ドラッグの印に入れ替える
    window.clearTimeout(spacingFlashTimer);
    els.spacingGuides?.classList.remove("is-flash");
  }
  // タイトルの文字の上から引っ張ると、文字が選ばれていくことがあるので外す
  const selection = window.getSelection?.();
  if (selection && !selection.isCollapsed) selection.removeAllRanges();

  const dx = screenDx / state.zoom;
  const dy = screenDy / state.zoom;
  applySubtreeDragOffsets(
    activeNodeDrag.id,
    activeNodeDrag.originalOffsets,
    dx,
    dy,
    activeNodeDrag.startPosition,
  );
  // ドパ版: ドラッグ中は作り直さずに、位置だけ動かす（軽くするため）。離したときに1回だけ全部を描き直す
  renderPositionsOnly();
}

function finishNodeDrag() {
  window.removeEventListener("pointermove", handleNodeDragMove);
  const wasDragged = Boolean(activeNodeDrag?.started);
  activeNodeDrag = null;
  state.isDraggingNode = false;
  state.dragGuide = { x: null, y: null };
  state.dragSpacing = null;
  els.viewport.classList.remove("is-node-dragging");
  // 離したときに1回だけ全部を描き直す（ブラウザへの作業中の写しの保存 saveTree も、この中で1回だけ）。
  // ドラッグ中は位置しか変えていないので、カードの高さの確かめ直しなども、ここでまとめて行う
  if (wasDragged) {
    motion.freezeNext = true;
    render();
    motion.freezeNext = false;
  } else {
    updateAlignmentGuides();
  }
}

// ドパ版: 位置だけを描き直す（ノードのドラッグ中と、「横の距離」「縦の距離」のつまみを動かしている間）。
// 並びだけ計算し直し、動いたカードと、それにつながる線の位置だけを書き換える。
// render() のようにカード・線を作り直したり、ブラウザに保存したりはしない（毎回だと重いため。2026-11-17 測ったとき、
// 259ノードのマップで1コマ 約47ms → 約6ms）。終わったとき（手を離したとき）に render() を1回だけ呼ぶ。
function renderPositionsOnly() {
  // layoutTree は位置を新しく作り直すので、前の位置を写しておく
  const previous = new Map(state.positions);
  layoutTree();
  const moved = new Set();
  for (const nodeEl of els.nodeLayer.children) {
    const id = nodeEl.dataset.id;
    const pos = state.positions.get(id);
    // 見えるカードの顔ぶれが変わった（ふつうは起きない）ときは、全部を描き直す
    if (!pos) {
      motion.freezeNext = true;
      render();
      motion.freezeNext = false;
      return;
    }
    const old = previous.get(id);
    if (old && old.x === pos.x && old.y === pos.y) continue;
    moved.add(id);
    // 前に付けた動き（足したときの動きなど）が残っていると、新しい位置からずれて見えるので止める
    cancelNodeMotion(nodeEl);
    nodeEl.style.left = `${pos.x}px`;
    nodeEl.style.top = `${pos.y}px`;
  }
  if (moved.size) {
    // 線の上を流れている光は、線が動くとずれるので消す
    clearSparks();
    for (const path of els.edgeLayer.children) {
      const fromId = path.dataset.from;
      const toId = path.dataset.to;
      if (!moved.has(fromId) && !moved.has(toId)) continue;
      const from = state.positions.get(fromId);
      const to = state.positions.get(toId);
      if (!from || !to) continue;
      cancelEdgeMotion(path);
      path.setAttribute("d", path.classList.contains("is-layer-connector") ? pathForLayerConnector(from, to) : pathForEdge(from, to));
    }
    for (const line of els.edge3dLayer.children) {
      const fromId = line.dataset.from;
      const toId = line.dataset.to;
      if (!moved.has(fromId) && !moved.has(toId)) continue;
      const from = state.positions.get(fromId);
      const to = state.positions.get(toId);
      if (!from || !to) continue;
      cancelEdgeMotion(line);
      const geometry = edge3dGeometry(from, to);
      line.style.width = `${geometry.length}px`;
      line.style.transform = geometry.transform;
    }
    if (state.isLayer3d) {
      // 階層の床は、乗っているカードの範囲で大きさが決まるので作り直す（数枚だけなので軽い）
      const floorFragment = document.createDocumentFragment();
      renderLayerFloors(floorFragment);
      els.floorLayer.textContent = "";
      els.floorLayer.appendChild(floorFragment);
    }
    scheduleMinimapDraw();
  }
  updateAlignmentGuides();
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
  // ドパ版: 上下のカードと等間隔になる所に近ければ、そこへぴたっと合わせる（横の位置合わせより近いときだけ）
  const rawY = startY + dy;
  const spacing = getSpacingSnap(id, alignedTarget.x, rawY, excludeIds);
  if (spacing && (alignedTarget.guideY === null || spacing.distance <= Math.abs(alignedTarget.y - rawY))) {
    alignedTarget.y = spacing.y;
    alignedTarget.guideY = null;
    state.dragSpacing = spacing.guide;
  } else {
    state.dragSpacing = null;
  }
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
  const isNewSelection = id !== state.selectedId;
  state.selectedId = id;
  updateLabels();
  paintSelection();
  if (isNewSelection) {
    scheduleMinimapDraw();
    playSelectionSpark(id);
    popSelectedCard(id);
  }
}

// 選んだとき、つながる線の上を光が一度だけすっと流れる（親 → 選んだノード → 子 の向き）。
// 0.8秒ほどで消え、光り続けはしない。2D表示で、動きの演出がオンのときだけ。
const SPARK_DURATION = 760;
const SPARK_OUTGOING_DELAY = 240;

function playSelectionSpark(id) {
  clearSparks();
  if (!motion.enabled || state.isLayer3d || !els.ghostEdgeLayer) return;
  [...els.edgeLayer.children].forEach((path) => {
    const isIncoming = path.dataset.to === id;
    if (!isIncoming && path.dataset.from !== id) return;
    const spark = document.createElementNS("http://www.w3.org/2000/svg", "path");
    if (!canAnimate(spark)) return;
    spark.setAttribute("d", path.getAttribute("d"));
    spark.setAttribute("pathLength", "1");
    spark.setAttribute("class", "edge-spark");
    spark.style.setProperty("--branch", path.style.getPropertyValue("--branch"));
    els.ghostEdgeLayer.appendChild(spark);
    // 光の粒を、線の始まり（親の側）の手前から終わり（子の側）の先まで動かす
    const animation = spark.animate(
      [
        { offset: 0, strokeDashoffset: "0.16", opacity: 0 },
        { offset: 0.18, opacity: 1 },
        { offset: 0.72, opacity: 1 },
        { offset: 1, strokeDashoffset: "-1", opacity: 0 },
      ],
      {
        duration: SPARK_DURATION,
        delay: isIncoming ? 0 : SPARK_OUTGOING_DELAY,
        easing: "cubic-bezier(0.45, 0, 0.25, 1)",
        fill: "both",
      },
    );
    animation.onfinish = () => spark.remove();
    animation.oncancel = () => spark.remove();
  });
}

function clearSparks() {
  els.ghostEdgeLayer?.querySelectorAll(".edge-spark").forEach((spark) => spark.remove());
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
  if (els.evenChildrenButton) els.evenChildrenButton.disabled = !canSpaceChildrenEvenly(node.id);
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
  requestAnimationFrame(() => glideCamera(fitToView));
}

function updateAlignmentGuides() {
  if (!els.guideLayer || !els.guideVertical || !els.guideHorizontal) return;
  const x = Number.isFinite(state.dragGuide.x) ? state.dragGuide.x : null;
  const y = Number.isFinite(state.dragGuide.y) ? state.dragGuide.y : null;
  els.guideLayer.classList.toggle("has-x", x !== null);
  els.guideLayer.classList.toggle("has-y", y !== null);
  if (x !== null) els.guideVertical.style.left = `${x}px`;
  if (y !== null) els.guideHorizontal.style.top = `${y}px`;
  updateSpacingGuides();
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
  requestAnimationFrame(() => glideCamera(() => centerNode(source.node.id)));
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

// ===== ドパ版: ミニマップ（2026-11-17 ユーザーが選んだ案） =====
// マップの右下に、全体を縮めた小さな地図を出す。枠（.minimap-frame）が今見ている範囲。
// 押すとそこへ画面がすっと動き（glideCamera）、引っ張るとそのまま動かせる。3D表示では出さない。
// 描くのは <canvas> に四角と線だけ。描き直しは次の画面の前に1回にまとめる（scheduleMinimapDraw）。
// 地図を動かしたときは枠の位置だけ書き換える（updateMinimapFrame。軽い）。オン・オフは knowledge-map-canvas-minimap-v1 に覚える
const MINIMAP_PREF_KEY = "knowledge-map-canvas-minimap-v1";
const MINIMAP_WIDTH = 208;
const MINIMAP_HEIGHT = 136;
// 地図のまわりに空ける余白（地図の上の px）
const MINIMAP_PADDING = 140;
const minimap = {
  enabled: loadMinimapPreference(),
  drawHandle: null,
  // 地図の上の位置 → ミニマップの上の位置: x * scale + ox
  view: null,
  colors: null,
  drag: null,
};

function loadMinimapPreference() {
  try {
    return localStorage.getItem(MINIMAP_PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

function setMinimapEnabled(isEnabled) {
  minimap.enabled = isEnabled;
  try {
    localStorage.setItem(MINIMAP_PREF_KEY, isEnabled ? "on" : "off");
  } catch {
    // 覚えられなくても、開いている間は切り替わる
  }
  updateMinimapToggle();
  scheduleMinimapDraw();
}

function updateMinimapToggle() {
  const button = els.minimapToggleButton;
  if (!button) return;
  button.textContent = minimap.enabled ? "オン" : "オフ";
  button.setAttribute("aria-pressed", String(minimap.enabled));
  button.title = minimap.enabled ? "ミニマップを隠す" : "マップの右下に、全体を縮めた小さな地図を出す";
}

function isMinimapVisible() {
  return Boolean(minimap.enabled && !state.isLayer3d && state.renderedIds.size && els.minimap);
}

function scheduleMinimapDraw() {
  if (minimap.drawHandle !== null) return;
  minimap.drawHandle = window.requestAnimationFrame(() => {
    minimap.drawHandle = null;
    drawMinimap();
  });
}

function drawMinimap() {
  const box = els.minimap;
  const canvas = els.minimapCanvas;
  if (!box || !canvas) return;
  const visible = isMinimapVisible();
  box.hidden = !visible;
  if (!visible) {
    minimap.view = null;
    return;
  }
  // 配色の色は、配色を変えたときだけ読み直す（毎回読むと画面の計算が走るため）
  if (!minimap.colors) {
    const style = getComputedStyle(document.documentElement);
    minimap.colors = {
      focus: style.getPropertyValue("--focus").trim() || "#7cc0ff",
      ink: style.getPropertyValue("--ink").trim() || "#e5e7eb",
    };
  }
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(MINIMAP_WIDTH * ratio);
  const pixelHeight = Math.round(MINIMAP_HEIGHT * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  state.renderedIds.forEach((id) => {
    const pos = state.positions.get(id);
    if (!pos) return;
    minX = Math.min(minX, pos.x - pos.width / 2);
    maxX = Math.max(maxX, pos.x + pos.width / 2);
    minY = Math.min(minY, pos.y - pos.height / 2);
    maxY = Math.max(maxY, pos.y + pos.height / 2);
  });
  if (!Number.isFinite(minX)) return;
  minX -= MINIMAP_PADDING;
  minY -= MINIMAP_PADDING;
  maxX += MINIMAP_PADDING;
  maxY += MINIMAP_PADDING;
  const scale = Math.min(MINIMAP_WIDTH / (maxX - minX), MINIMAP_HEIGHT / (maxY - minY));
  const ox = (MINIMAP_WIDTH - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (MINIMAP_HEIGHT - (maxY - minY) * scale) / 2 - minY * scale;
  minimap.view = { scale, ox, oy };

  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);
  const hasSearch = state.search.trim().length > 0;
  const matches = hasSearch ? getSearchMatches() : null;
  // 線（まっすぐな線で十分）
  context.lineWidth = 1;
  context.globalAlpha = 0.5;
  state.edgeList.forEach((edge) => {
    if (!state.renderedIds.has(edge.from) || !state.renderedIds.has(edge.to)) return;
    const from = state.positions.get(edge.from);
    const to = state.positions.get(edge.to);
    if (!from || !to) return;
    context.strokeStyle = edge.color;
    context.beginPath();
    context.moveTo(from.x * scale + ox, from.y * scale + oy);
    context.lineTo(to.x * scale + ox, to.y * scale + oy);
    context.stroke();
  });
  // カード（検索中は、当たらないカードを薄くする）
  state.renderedIds.forEach((id) => {
    const pos = state.positions.get(id);
    if (!pos) return;
    context.globalAlpha = matches && !matches.has(id) ? 0.25 : 0.95;
    context.fillStyle = pos.depth === 0 ? minimap.colors.focus : pos.color;
    const width = Math.max(2, pos.width * scale);
    const height = Math.max(1.5, pos.height * scale);
    context.fillRect(pos.x * scale + ox - width / 2, pos.y * scale + oy - height / 2, width, height);
  });
  // 選んでいるカードは縁どりする
  const selected = state.renderedIds.has(state.selectedId) ? state.positions.get(state.selectedId) : null;
  if (selected) {
    context.globalAlpha = 1;
    context.strokeStyle = minimap.colors.ink;
    context.lineWidth = 1.5;
    const width = Math.max(4, selected.width * scale) + 3;
    const height = Math.max(3, selected.height * scale) + 3;
    context.strokeRect(selected.x * scale + ox - width / 2, selected.y * scale + oy - height / 2, width, height);
  }
  context.globalAlpha = 1;
  updateMinimapFrame();
}

// 今見ている範囲の枠（地図を動かすたびに呼ばれる。位置と大きさを書き換えるだけ）
function updateMinimapFrame() {
  const view = minimap.view;
  const frame = els.minimapFrame;
  if (!view || !frame || !motion.viewWidth) return;
  const left = (-state.pan.x / state.zoom) * view.scale + view.ox;
  const top = (-state.pan.y / state.zoom) * view.scale + view.oy;
  frame.style.left = `${left.toFixed(1)}px`;
  frame.style.top = `${top.toFixed(1)}px`;
  frame.style.width = `${((motion.viewWidth / state.zoom) * view.scale).toFixed(1)}px`;
  frame.style.height = `${((motion.viewHeight / state.zoom) * view.scale).toFixed(1)}px`;
}

function wireMinimap() {
  const box = els.minimap;
  if (!box) return;
  const toWorld = (event) => {
    const rect = box.getBoundingClientRect();
    const view = minimap.view;
    return { x: (event.clientX - rect.left - view.ox) / view.scale, y: (event.clientY - rect.top - view.oy) / view.scale };
  };
  const centerOn = (point) => {
    if (!motion.viewWidth) return;
    state.pan.x = motion.viewWidth / 2 - point.x * state.zoom;
    state.pan.y = motion.viewHeight / 2 - point.y * state.zoom;
    updateTransform();
  };
  box.addEventListener("pointerdown", (event) => {
    // マップの方の「引っ張って動かす」が始まらないようにする
    event.stopPropagation();
    if (event.button !== 0 || !minimap.view) return;
    event.preventDefault();
    box.setPointerCapture?.(event.pointerId);
    minimap.drag = { x: event.clientX, y: event.clientY, moved: false };
    playMinimapRipple(event);
    const point = toWorld(event);
    glideCamera(() => centerOn(point));
  });
  box.addEventListener("pointermove", (event) => {
    const drag = minimap.drag;
    if (!drag || !minimap.view) return;
    event.stopPropagation();
    // 押したときの小さな手ぶれでは、すっと動く途中を止めない
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    drag.moved = true;
    stopCameraGlide();
    centerOn(toWorld(event));
  });
  const finish = () => {
    minimap.drag = null;
  };
  box.addEventListener("pointerup", finish);
  box.addEventListener("pointercancel", finish);
  box.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
    { passive: false },
  );
  box.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}

// 押した所に、小さな光の輪が広がる（演出がオフなら出さない）
function playMinimapRipple(event) {
  if (!motion.enabled || !els.minimap) return;
  const rect = els.minimap.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "minimap-ripple";
  ripple.style.left = `${event.clientX - rect.left}px`;
  ripple.style.top = `${event.clientY - rect.top}px`;
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  els.minimap.appendChild(ripple);
}

// ===== ドパ版: 左右の欄の開け閉め（2026-11-17 ユーザーの希望「左右のカラムをそれぞれ開閉できるようにしたい」） =====
// マップの上の帯の左端・右端のボタン（‹ ›）で、左の欄（ファイル・階層・表示・出力）と右の欄（ノード詳細）を別々に開け閉めする。
// 形は :root の data-left-panel / data-right-panel="closed" で決め（CSS）、欄は --panel-speed（300ms）ですっとすべる。
// 欄がすべっている間は、マップの表示枠の左の端が動いた分だけ地図を逆に動かして、地図が画面の上で跳ばないようにする（followPanelSlide）。
// 開け閉めの形は knowledge-map-canvas-panels-v1 に覚え、MindmapIndex.html の head の小さなスクリプトで、画面が出る前に戻す
const PANELS_PREF_KEY = "knowledge-map-canvas-panels-v1";
const PANEL_SLIDE_MS = 300;
const panelSlide = { active: false, left: 0, timer: null };

function panelDatasetKey(side) {
  return side === "left" ? "leftPanel" : "rightPanel";
}

function isPanelOpen(side) {
  return document.documentElement.dataset[panelDatasetKey(side)] !== "closed";
}

function setPanelOpen(side, isOpen) {
  if (isPanelOpen(side) === isOpen) return;
  // 動き出す前の、表示枠の左の端（押したときに1回だけ測る）
  panelSlide.left = els.viewport.getBoundingClientRect().left;
  panelSlide.active = true;
  els.viewport.classList.add("is-panel-sliding");
  if (isOpen) delete document.documentElement.dataset[panelDatasetKey(side)];
  else document.documentElement.dataset[panelDatasetKey(side)] = "closed";
  window.clearTimeout(panelSlide.timer);
  panelSlide.timer = window.setTimeout(() => {
    followPanelSlide();
    panelSlide.active = false;
    els.viewport.classList.remove("is-panel-sliding");
  }, (motion.enabled ? PANEL_SLIDE_MS : ANIMATION_MS) + 120);
  try {
    localStorage.setItem(PANELS_PREF_KEY, JSON.stringify({ left: isPanelOpen("left"), right: isPanelOpen("right") }));
  } catch {
    // 覚えられなくても、開いている間は切り替わる
  }
  updatePanelToggles();
  // 閉じた欄の中で入力していたら、入力を終える（見えない所に文字が入らないように）
  const active = document.activeElement;
  const panel = side === "left" ? els.sidebarPanel : els.inspectorPanel;
  if (!isOpen && active && panel?.contains(active)) active.blur();
}

// 表示枠の大きさが変わるたびに呼ばれる（watchViewportSize）。欄がすべっている間だけ、左の端が動いた分を打ち消す
function followPanelSlide() {
  if (!panelSlide.active) return;
  const left = els.viewport.getBoundingClientRect().left;
  if (left === panelSlide.left) return;
  state.pan.x -= left - panelSlide.left;
  panelSlide.left = left;
  updateTransform();
}

function updatePanelToggles() {
  const sides = [
    ["left", els.leftPanelToggle, "左の欄", "‹", "›"],
    ["right", els.rightPanelToggle, "右の欄", "›", "‹"],
  ];
  sides.forEach(([side, button, name, closeMark, openMark]) => {
    if (!button) return;
    const open = isPanelOpen(side);
    button.textContent = open ? closeMark : openMark;
    button.title = open ? `${name}を閉じる` : `${name}を開く`;
    button.setAttribute("aria-expanded", String(open));
  });
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
  updateBackdrop();
  if (minimap.view) updateMinimapFrame();
  document.getElementById("zoomResetButton").textContent = `${Math.round(state.zoom * 100)}%`;
}

// ドパ版の背景: 点の模様を、地図の動きの一部（BACKDROP_PARALLAX）だけずらす。
// 地図よりゆっくり動くので、奥にあるように見える。模様は112pxごとに同じなので、その幅の中でだけずらす。
const BACKDROP_TILE = 112;
const BACKDROP_PARALLAX = 0.22;

function updateBackdrop() {
  if (!els.backdropDots) return;
  const wrap = (value) => (((value % BACKDROP_TILE) + BACKDROP_TILE) % BACKDROP_TILE) - BACKDROP_TILE;
  const x = wrap(state.pan.x * BACKDROP_PARALLAX);
  const y = wrap(state.pan.y * BACKDROP_PARALLAX);
  els.backdropDots.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
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

// ===== ドパ版: 枝ごとに等間隔へ戻す（2026-11-17 ユーザーが選んだ案） =====
// 選んだノードの子（見えているもの）を、上から順に、カードとカードのすき間が同じになるように並べ直す。
// ・いちばん上といちばん下の子はそのままの所に置き、その間を等しく分ける（すき間が EVEN_MIN_GAP より狭くなるときは、
//   「縦の距離」のすき間で、今の真ん中を中心に並べ直す）
// ・横の位置は、子たちの横の位置の真ん中の値（中央値）にそろえる（1つだけ横にずれた子を列に戻す）
// ・子の下の孫なども、その子と一緒に動く。中心のノードの子は、左右に分かれているので、左右それぞれで等間隔にする
// 並べ直したあと、そろったすき間にピンクの印を少しの間だけ出す（flashSpacingGuides）
const EVEN_MIN_GAP = 12;
const SPACING_FLASH_MS = 1500;
let spacingFlashTimer = null;

function getEvenSpacingGroups(node) {
  const parentPos = state.positions.get(node.id);
  if (!parentPos) return [];
  const items = node.children
    .filter((child) => !child.parallelOf && state.renderedIds.has(child.id))
    .map((child) => ({ node: child, pos: state.positions.get(child.id) }))
    .filter(({ pos }) => pos && pos.layer === parentPos.layer);
  const left = items.filter(({ pos }) => pos.x < parentPos.x);
  const right = items.filter(({ pos }) => pos.x >= parentPos.x);
  return [left, right]
    .filter((group) => group.length >= 2)
    .map((group) => group.sort((a, b) => a.pos.y - b.pos.y));
}

function canSpaceChildrenEvenly(id) {
  const found = findNode(id);
  return Boolean(found && getEvenSpacingGroups(found.node).length);
}

function spaceChildrenEvenly(id = state.selectedId) {
  const found = findNode(id);
  if (!found) return;
  const groups = getEvenSpacingGroups(found.node);
  if (!groups.length) {
    els.statusText.textContent = "見えている子ノードが2つ以上あるときに使えます。";
    return;
  }
  const snapshot = captureSnapshot();
  let moved = 0;
  let count = 0;
  const gaps = [];
  groups.forEach((group) => {
    const xs = group.map(({ pos }) => pos.x).sort((a, b) => a - b);
    const targetX = xs[Math.floor(xs.length / 2)];
    const firstTop = group[0].pos.y - group[0].pos.height / 2;
    const last = group[group.length - 1];
    const lastBottom = last.pos.y + last.pos.height / 2;
    const totalHeight = group.reduce((sum, { pos }) => sum + pos.height, 0);
    let gap = (lastBottom - firstTop - totalHeight) / (group.length - 1);
    let cursor = firstTop;
    if (gap < EVEN_MIN_GAP) {
      gap = Math.max(EVEN_MIN_GAP, state.verticalSpacing);
      cursor = (firstTop + lastBottom) / 2 - (totalHeight + gap * (group.length - 1)) / 2;
    }
    gaps.push(gap);
    group.forEach(({ node, pos }) => {
      const targetY = cursor + pos.height / 2;
      cursor += pos.height + gap;
      const dx = Math.round(targetX - pos.x);
      const dy = Math.round(targetY - pos.y);
      count += 1;
      if (!dx && !dy) return;
      moved += 1;
      walkDragSubtree(node, (item) => {
        const offset = normalizeOffset(item.offset);
        item.offset = { x: offset.x + dx, y: offset.y + dy };
      });
    });
  });
  if (moved) {
    pushHistory(snapshot);
    render();
  }
  const sameGap = gaps.every((gap) => Math.round(gap) === Math.round(gaps[0]));
  els.statusText.textContent = moved
    ? `子ノード${count}個を、${sameGap ? `すき間${Math.round(gaps[0])}pxの` : ""}等間隔にそろえました。`
    : "子ノードは、すでに等間隔です。";
  flashSpacingGuides(groups.map((group) => group.map(({ node }) => node.id)));
}

// 並べ直した子のすき間に、ピンクの印（等間隔のガイドと同じもの）を少しの間だけ出す。3D表示では出さない
function flashSpacingGuides(idGroups) {
  if (state.isLayer3d || !els.spacingGuides || state.isDraggingNode) return;
  const segments = [];
  idGroups.forEach((ids) => {
    const items = ids
      .map((id) => state.positions.get(id))
      .filter(Boolean)
      .sort((a, b) => a.y - b.y);
    for (let index = 1; index < items.length; index += 1) {
      const upper = items[index - 1];
      const lower = items[index];
      segments.push({
        x: (upper.x + lower.x) / 2 - Math.min(upper.width, lower.width) / 4,
        top: upper.y + upper.height / 2,
        bottom: lower.y - lower.height / 2,
        gap: Math.round(lower.y - lower.height / 2 - (upper.y + upper.height / 2)),
      });
    }
  });
  if (!segments.length) return;
  window.clearTimeout(spacingFlashTimer);
  state.dragSpacing = { segments, gap: segments[0].gap };
  els.spacingGuides.classList.add("is-flash");
  updateSpacingGuides();
  spacingFlashTimer = window.setTimeout(() => {
    els.spacingGuides.classList.remove("is-flash");
    if (state.isDraggingNode) return;
    state.dragSpacing = null;
    updateSpacingGuides();
  }, SPACING_FLASH_MS);
}

function optimizeLayout() {
  const snapshot = captureSnapshot();
  const resetCount = resetManualOffsets();
  if (resetCount) pushHistory(snapshot);
  render();
  requestAnimationFrame(() => glideCamera(fitToView));
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

// ===== ドパ版: 等間隔のガイド（ノードを動かしているとき） =====
// 2026-11-17 ユーザーの希望（「上下のノードの間隔ガイドを出してほしい。等間隔に並べたい時用」）。
// 動かしているカードと横の位置が重なるカード（同じ列）のうち、すぐ上とすぐ下を見て、次の所に近づいたら、ぴたっと合わせる。
//  ・上のすき間と下のすき間が同じになる所（上下のカードのちょうど真ん中）
//  ・すぐ上の2枚のすき間と同じだけ、上のカードから空けた所（下の2枚も同じ）
// 合わせたときは、同じすき間であることを、ピンクの線とすき間の大きさ（px）で見せる（updateSpacingGuides）。
// 3D表示では使わない（印を階層の高さに合わせて描けないため）。
const SPACING_MIN_GAP = 4;

function getSpacingSnap(id, x, y, excludeIds) {
  if (state.isLayer3d) return null;
  const source = state.positions.get(id);
  if (!source) return null;
  const tolerance = clamp(18 / state.zoom, 10, 30);
  const half = source.height / 2;
  const above = [];
  const below = [];
  state.positions.forEach((pos, nodeId) => {
    if (excludeIds.has(nodeId) || !state.renderedIds.has(nodeId) || pos.layer !== source.layer) return;
    // 横に重なっていないカードは、同じ列ではない
    if (Math.abs(pos.x - x) >= (source.width + pos.width) / 2 - 8) return;
    const item = { x: pos.x, width: pos.width, top: pos.y - pos.height / 2, bottom: pos.y + pos.height / 2, y: pos.y };
    (pos.y < y ? above : below).push(item);
  });
  above.sort((a, b) => b.y - a.y);
  below.sort((a, b) => a.y - b.y);
  const [up1, up2] = above;
  const [down1, down2] = below;
  const self = (centerY) => ({ x, width: source.width, top: centerY - half, bottom: centerY + half });
  const candidates = [];
  // 上下のカードのちょうど真ん中
  if (up1 && down1) {
    const centerY = (up1.bottom + down1.top) / 2;
    const gap = centerY - half - up1.bottom;
    if (gap >= SPACING_MIN_GAP) candidates.push({ y: centerY, gap, pairs: [[up1, null], [null, down1]] });
  }
  // すぐ上の2枚と同じすき間（下のカードに重ならないときだけ）
  if (up1 && up2) {
    const gap = up1.top - up2.bottom;
    const centerY = up1.bottom + gap + half;
    if (gap >= SPACING_MIN_GAP && (!down1 || centerY + half <= down1.top - SPACING_MIN_GAP)) {
      candidates.push({ y: centerY, gap, pairs: [[up2, up1], [up1, null]] });
    }
  }
  // すぐ下の2枚と同じすき間（上のカードに重ならないときだけ）
  if (down1 && down2) {
    const gap = down2.top - down1.bottom;
    const centerY = down1.top - gap - half;
    if (gap >= SPACING_MIN_GAP && (!up1 || centerY - half >= up1.bottom + SPACING_MIN_GAP)) {
      candidates.push({ y: centerY, gap, pairs: [[null, down1], [down1, down2]] });
    }
  }
  let best = null;
  candidates.forEach((candidate) => {
    const distance = Math.abs(candidate.y - y);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { ...candidate, distance };
  });
  if (!best) return null;
  const me = self(best.y);
  const segments = best.pairs.map(([upper, lower]) => {
    const top = upper || me;
    const bottom = lower || me;
    // 真ん中には横の位置合わせの線（青）が重なりやすいので、カードの幅の1/4だけ左に寄せて描く
    const x = (top.x + bottom.x) / 2 - Math.min(top.width, bottom.width) / 4;
    return { x, top: top.bottom, bottom: bottom.top };
  });
  return { y: best.y, distance: best.distance, guide: { segments, gap: Math.round(best.gap) } };
}

// 等間隔の印を描く（多くても2本。前と同じなら書き換えない）
function updateSpacingGuides() {
  const layer = els.spacingGuides;
  if (!layer) return;
  const guide = state.dragSpacing;
  const key = guide
    ? `${state.zoom}|${guide.gap}|${guide.segments.map((s) => `${s.x.toFixed(1)},${s.top.toFixed(1)},${s.bottom.toFixed(1)},${s.gap ?? ""}`).join("|")}`
    : "";
  if (layer.dataset.key === key) return;
  layer.dataset.key = key;
  layer.textContent = "";
  if (!guide) return;
  // 地図を縮めても印と数が小さくなりすぎないよう、倍率の逆数で大きさを補う
  layer.style.setProperty("--guide-scale", String(1 / state.zoom));
  guide.segments.forEach((segment) => {
    const mark = document.createElement("span");
    mark.className = "spacing-guide";
    mark.style.left = `${segment.x}px`;
    mark.style.top = `${segment.top}px`;
    mark.style.height = `${Math.max(0, segment.bottom - segment.top)}px`;
    const label = document.createElement("span");
    label.className = "spacing-label";
    label.textContent = `${segment.gap ?? guide.gap}px`;
    mark.appendChild(label);
    layer.appendChild(mark);
  });
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
  // すぐに消す。消えていく動きは render() が前の画面と比べて付ける（親の方へしまわれる）。
  // ドパ版: 消したカードそのものは、ぱりんと割れて散る（playShatter）。その下の子・孫は、これまでどおり親の方へしまわれる
  found.parent.children = found.parent.children.filter((child) => child.id !== targetId);
  state.selectedId = found.parent.id;
  motion.shatterId = targetId;
  render();
  motion.shatterId = null;
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
  state.search = "";
  state.isLayer3d = false;
  state.layerFilterDepth = 0;
  state.focusLayerDepth = 0;
  state.focusNodeId = "";
  state.dragGuide = { x: null, y: null };
  state.dragSpacing = null;
  state.undoStack = [];
  state.redoStack = [];
  state.savedSignature = markSaved ? currentSignature() : null;
  // 前のマップのノードがしまわれていく動きは付けない（新しいマップが広がる動きだけ）
  motion.skipNext = true;
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

// ファイル選択の画面を出せない環境（アプリの中のブラウザなど）では、選択画面の命令が画面を出さずに
// すぐ「キャンセル」で返ってくる。人が画面を見て閉じるには時間がかかるので、すぐ返ってきたものは
// 「出せなかった」とみなし、どのブラウザでも使える昔ながらの方法（開く=ファイル選択、保存=ダウンロード）に切り替える。
const PICKER_INSTANT_FAIL_MS = 400;
let filePickerUnavailable = false;

function canUseFilePicker(name) {
  return !filePickerUnavailable && typeof window[name] === "function";
}

function isPickerUnavailableError(error, startedAt) {
  if (error?.name === "SecurityError") return true;
  return error?.name === "AbortError" && performance.now() - startedAt < PICKER_INSTANT_FAIL_MS;
}

// 「開く」を押した流れの中で呼ぶ（ブラウザは操作の直後でないと選択画面を出さないため、未保存がなければ待たずに出す）
function openMapFile() {
  const run = () =>
    startFileOpen().catch((error) => {
      els.statusText.textContent = `ファイルを開けませんでした: ${error.message}`;
    });
  if (state.isDirty) {
    resolveUnsavedChanges("ほかのファイルを開く").then(async (ok) => {
      if (!ok) return;
      // 保存先を選ぶ画面を挟むと「押した直後」ではなくなり、ブラウザがファイル選択の画面を出さない。
      // そのときは、もう一度押してもらってから選択画面を出す
      if (navigator.userActivation && !navigator.userActivation.isActive) {
        const choice = await askChoice({
          title: "保存しました",
          message: "続けて、開くMDファイルを選んでください。",
          buttons: [
            { value: "open", label: "ファイルを選ぶ", primary: true },
            { value: "cancel", label: "やめる" },
          ],
        });
        if (choice !== "open") return;
      }
      run();
    });
    return;
  }
  run();
}

async function startFileOpen() {
  if (!canUseFilePicker("showOpenFilePicker")) {
    els.markdownFileInput.click();
    return;
  }
  const startedAt = performance.now();
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({ multiple: false, types: MARKDOWN_FILE_TYPES });
  } catch (error) {
    if (isPickerUnavailableError(error, startedAt)) {
      filePickerUnavailable = true;
      els.markdownFileInput.click();
      return;
    }
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
  let handle = null;
  if (canUseFilePicker("showSaveFilePicker")) {
    handle = saveAs ? null : state.fileHandle;
    if (handle && !(await ensureWritePermission(handle))) handle = null;
    if (!handle) {
      const startedAt = performance.now();
      try {
        handle = await window.showSaveFilePicker({ suggestedName, types: MARKDOWN_FILE_TYPES });
      } catch (error) {
        if (isPickerUnavailableError(error, startedAt)) {
          filePickerUnavailable = true;
          handle = null;
        } else if (error.name === "AbortError") {
          return false;
        } else {
          throw error;
        }
      }
    }
  }

  let message;
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(markdown);
    await writable.close();
    state.fileHandle = handle;
    state.fileName = handle.name;
    rememberFileHandle(handle);
    message = `${state.fileName} に保存しました。`;
  } else {
    // ファイルへ直接書けないブラウザでは、ダウンロードとして保存する
    const fileName = (!saveAs && state.fileName) || suggestedName;
    downloadText(markdown, fileName, "text/markdown;charset=utf-8");
    state.fileName = fileName;
    state.fileHandle = null;
    message = `${fileName} をダウンロードとして保存しました（このブラウザではファイルへ直接上書きできないため、ダウンロード先に保存されます）。`;
  }
  state.savedSignature = currentSignature();
  saveTree();
  hideUnsavedBanner();
  els.statusText.textContent = message;
  playSaveReward();
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
  return askChoice({
    title: "保存していない変更があります",
    message,
    buttons: [
      { value: "save", label: "保存して続ける", primary: true },
      { value: "discard", label: "保存しないで続ける" },
      { value: "cancel", label: "やめる" },
    ],
  });
}

// 小窓で選んでもらう。押したボタンの value を返す（Esc で閉じたら "cancel"）
function askChoice({ title, message, buttons }) {
  const dialog = els.unsavedDialog;
  els.unsavedDialogTitle.textContent = title;
  els.unsavedDialogText.textContent = message;
  els.unsavedDialogActions.textContent = "";
  buttons.forEach((item) => {
    const button = document.createElement("button");
    button.value = item.value;
    button.textContent = item.label;
    if (item.primary) button.className = "primary-button";
    els.unsavedDialogActions.appendChild(button);
  });
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
  document.title = `${state.isDirty ? "● " : ""}${currentMapName()} - マインドマップ`;
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

  let handle = null;
  if (canUseFilePicker("showSaveFilePicker")) {
    const startedAt = performance.now();
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: "PNG", accept: { "image/png": [".png"] } }],
      });
    } catch (error) {
      // 保存先の画面を出せない環境では、ダウンロードに切り替える（自分で閉じたときは中止）
      if (!isPickerUnavailableError(error, startedAt)) throw error;
      filePickerUnavailable = true;
    }
  }

  if (handle) {
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
    // 暗い配色の仲間（暗い・藍）は影を濃く、明るい配色は薄く
    shadow: currentTheme() === "light" ? "rgba(20,32,48,0.12)" : "rgba(0,0,0,0.28)",
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
  // ドパ版: 右の欄でタイトルを書いているときも、カードに反応を出す（書いている文字のあたりから弾ける）
  let inspectorTitleId = "";
  let inspectorTitleBefore = "";
  els.nodeTitleInput.addEventListener("focus", () => {
    inspectorTitleId = state.selectedId;
    inspectorTitleBefore = findNode(inspectorTitleId)?.node.text || "";
    beginTitleTyping(inspectorTitleId, els.nodeTitleInput.value);
  });
  els.nodeTitleInput.addEventListener("input", () => {
    reactToTitleTyping(inspectorTitleId || state.selectedId, els.nodeTitleInput.value);
  });
  els.nodeTitleInput.addEventListener("compositionend", (event) => {
    reactToTitleCommit(inspectorTitleId || state.selectedId, els.nodeTitleInput.value, event.data);
  });
  els.nodeTitleInput.addEventListener("blur", () => {
    const id = inspectorTitleId;
    inspectorTitleId = "";
    if (id && (findNode(id)?.node.text || "") !== inspectorTitleBefore) celebrateTitleDone(id);
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

  els.evenChildrenButton?.addEventListener("click", () => spaceChildrenEvenly(state.selectedId));
  els.minimapToggleButton?.addEventListener("click", () => setMinimapEnabled(!minimap.enabled));
  els.leftPanelToggle?.addEventListener("click", () => setPanelOpen("left", !isPanelOpen("left")));
  els.rightPanelToggle?.addEventListener("click", () => setPanelOpen("right", !isPanelOpen("right")));
  els.jumpSourceButton.addEventListener("click", () => {
    jumpToSourceNode();
  });

  document.getElementById("newMapButton").addEventListener("click", () => {
    newMap();
  });

  document.getElementById("openMarkdownButton").addEventListener("click", () => {
    openMapFile();
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
  document.getElementById("fitButton").addEventListener("click", () => glideCamera(fitToView));

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

  // スライダーはつまみに合わせて少しずつ描き直されるので、動きは付けない（軽くするため）
  els.depthSlider.addEventListener("input", () => {
    state.maxDepth = Number(els.depthSlider.value);
    motion.freezeNext = true;
    render();
  });

  // ドパ版: 距離のつまみを動かしている間は、位置だけ動かす（カードを作り直さないので軽い）。
  // 離したとき（change）に1回だけ全部を描き直す（ブラウザへの作業中の写しの保存も、そのとき）
  const redrawAfterSpacingSlider = () => {
    motion.freezeNext = true;
    render();
    motion.freezeNext = false;
  };
  els.horizontalSpacingSlider.addEventListener("input", () => {
    state.horizontalSpacing = Number(els.horizontalSpacingSlider.value);
    renderPositionsOnly();
  });
  els.horizontalSpacingSlider.addEventListener("change", redrawAfterSpacingSlider);

  els.verticalSpacingSlider.addEventListener("input", () => {
    state.verticalSpacing = Number(els.verticalSpacingSlider.value);
    renderPositionsOnly();
  });
  els.verticalSpacingSlider.addEventListener("change", redrawAfterSpacingSlider);

  els.snapStepSlider.addEventListener("input", () => {
    state.snapStep = Number(els.snapStepSlider.value);
    updateSnapStepValue();
    saveTree();
  });

  document.getElementById("zoomOutButton").addEventListener("click", () => glideCamera(() => setZoom(state.zoom * 0.86)));
  document.getElementById("zoomInButton").addEventListener("click", () => glideCamera(() => setZoom(state.zoom * 1.16)));
  document.getElementById("zoomResetButton").addEventListener("click", () => {
    glideCamera(() => {
      state.zoom = 1;
      centerRoot();
    });
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

  els.motionToggleButton?.addEventListener("click", () => {
    setMotionEnabled(!motion.enabled);
    els.statusText.textContent = motion.enabled
      ? "動きの演出をオンにしました。"
      : "動きの演出をオフにしました（元版と同じ軽い動きになります）。";
  });

  // 配色: ◐ は 暗い → 明るい → 藍 の順に回る。「表示」の配色ボタンでは直接選べる
  document.getElementById("themeToggle").addEventListener("click", () => {
    const index = THEMES.findIndex((theme) => theme.id === currentTheme());
    setTheme(THEMES[(index + 1) % THEMES.length].id);
  });
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => setTheme(button.dataset.themeChoice));
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

  // ドパ版: 画面が回り込みながら（3Dへ）／平らに戻りながら（2Dへ）、全体が見える位置へすっと動く
  glideCamera(
    () => {
      state.isLayer3d = isEnabled;
      document.body.classList.toggle("layer-3d", isEnabled);
      els.viewport.classList.toggle("is-layer-3d", isEnabled);
      render();
    },
    { leaving3d: !isEnabled },
  );
  requestAnimationFrame(() => glideCamera(fitToView));
}

// ドパ版: 画面（カメラ）をすっと動かす。apply の中で変えた位置・倍率・角度へ、CSS の transition で動く。
// 動きの演出がオフのときは、元版と同じ約0.08秒。ドラッグやホイールが始まったら止める（stopCameraGlide）。
function glideCamera(apply, options = {}) {
  if (motion.enabled) {
    els.viewport.classList.add("is-camera-gliding");
    if (options.leaving3d) els.viewport.classList.add("is-leaving-3d");
    window.clearTimeout(cameraGlideTimer);
    // 少し余裕をもって外す（重いときに、動き終わる前に遠近が外れて形が跳ばないように）
    cameraGlideTimer = window.setTimeout(stopCameraGlide, CAMERA_GLIDE_MS + 200);
  }
  apply();
}

function stopCameraGlide() {
  window.clearTimeout(cameraGlideTimer);
  cameraGlideTimer = null;
  els.viewport.classList.remove("is-camera-gliding", "is-leaving-3d");
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
  glideCamera(
    () => {
      state.isLayer3d = false;
      document.body.classList.remove("layer-3d");
      els.viewport.classList.remove("is-layer-3d");
      render();
    },
    { leaving3d: true },
  );
  requestAnimationFrame(() => glideCamera(fitToView));
  els.statusText.textContent = `階層 ${state.layerFilterDepth} のみを2D表示にしました。`;
}

function clearLayerFilter() {
  if (state.layerFilterDepth === 0 && !state.isLayer3d) return;
  const wasLayer3d = state.isLayer3d;
  state.layerFilterDepth = 0;
  state.focusLayerDepth = 0;
  ensureSelectedNodeVisible();
  glideCamera(
    () => {
      state.isLayer3d = false;
      document.body.classList.remove("layer-3d");
      els.viewport.classList.remove("is-layer-3d");
      render();
    },
    { leaving3d: wasLayer3d },
  );
  requestAnimationFrame(() => glideCamera(fitToView));
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
      stopCameraGlide();
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
    stopCameraGlide();
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
      // ホイールはすぐ反応させる（すっと動いている途中なら止める）
      stopCameraGlide();
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
  updateMotionToggle();
  updateThemeControls();
  watchViewportSize();
  wireMinimap();
  updateMinimapToggle();
  updatePanelToggles();
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

// 起動の途中で止まったら、ボタンが黙って反応しない状態にせず、画面に知らせる。
// （公開ページでは、更新直後に古いHTMLと新しいプログラムが混ざって読まれると起こる）
function showStartupError(error) {
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.style.cssText =
    "position:fixed;left:50%;top:16px;z-index:2147483647;transform:translateX(-50%);max-width:min(640px,calc(100vw - 32px));" +
    "padding:12px 16px;border-radius:10px;border:1px solid #f59e0b;background:#3a2a10;color:#fff;" +
    "font:14px/1.6 'Segoe UI','Yu Gothic UI',sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.35);";
  box.textContent =
    "起動できませんでした。古い表示が残っている可能性があります。Ctrl + Shift + R（キャッシュを使わずに読み込み直す）を押してください。" +
    `（${error?.message || error}）`;
  document.body.appendChild(box);
}

try {
  init();
} catch (error) {
  console.error(error);
  showStartupError(error);
}
