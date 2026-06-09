(() => {
  "use strict";

  const SNAP = 128;
  const SCALE_OPTIONS = [1, 0.5, 0.25, 0.125, 0.0625];
  const els = {
    atlasSizeSelect: document.getElementById("atlasSizeSelect"),
    zoomSelect: document.getElementById("zoomSelect"),
    viewModeSelect: document.getElementById("viewModeSelect"),
    mipSelect: document.getElementById("mipSelect"),
    projectModeSelect: document.getElementById("projectModeSelect"),
    fitZoomBtn: document.getElementById("fitZoomBtn"),
    undoBtn: document.getElementById("undoBtn"),
    redoBtn: document.getElementById("redoBtn"),
    alignLeftBtn: document.getElementById("alignLeftBtn"),
    alignTopBtn: document.getElementById("alignTopBtn"),
    distributeXBtn: document.getElementById("distributeXBtn"),
    distributeYBtn: document.getElementById("distributeYBtn"),
    packBtn: document.getElementById("packBtn"),
    saveProjectBtn: document.getElementById("saveProjectBtn"),
    loadProjectBtn: document.getElementById("loadProjectBtn"),
    projectInput: document.getElementById("projectInput"),
    externalAssetInput: document.getElementById("externalAssetInput"),
    exportPngBtn: document.getElementById("exportPngBtn"),
    exportJsonBtn: document.getElementById("exportJsonBtn"),
    addImagesBtn: document.getElementById("addImagesBtn"),
    fileInput: document.getElementById("fileInput"),
    assetDropZone: document.getElementById("assetDropZone"),
    assetList: document.getElementById("assetList"),
    inspector: document.getElementById("inspector"),
    canvas: document.getElementById("atlasCanvas"),
    canvasWrap: document.getElementById("canvasWrap"),
    stageViewport: document.getElementById("stageViewport"),
    atlasLabel: document.getElementById("atlasLabel"),
    atlasMeta: document.getElementById("atlasMeta"),
    stageStats: document.getElementById("stageStats"),
    validationList: document.getElementById("validationList"),
    statusBar: document.getElementById("statusBar"),
  };

  const ctx = els.canvas.getContext("2d");
  const state = {
    atlasSize: 2048,
    zoom: 0.5,
    viewMode: "normal",
    mipLevel: 1,
    projectMode: "embed",
    pendingExternalProject: null,
    assets: [],
    placements: [],
    selected: null,
    selectedPlacementIds: [],
    pointerDrag: null,
    panDrag: null,
    history: [],
    future: [],
    restoring: false,
  };

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function isPowerOfTwo(value) {
    return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
  }

  function formatScale(scale) {
    return `${Number((scale * 100).toFixed(3))}%`;
  }

  function sameScale(a, b) {
    return Math.abs(a - b) < 0.0001;
  }

  function normalizePixels(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.round(number));
  }

  function assetPadding(asset) {
    return normalizePixels(asset?.padding, 0);
  }

  function assetBleed(asset) {
    return normalizePixels(asset?.bleed, 0);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("File read failed."));
      reader.readAsDataURL(file);
    });
  }

  async function bytesFromDataUrl(dataUrl) {
    const response = await fetch(dataUrl);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function inflateZlib(bytes) {
    if (!("DecompressionStream" in window)) throw new Error("PNG raw decode is not available in this browser.");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function deflateZlib(bytes) {
    if (!("CompressionStream" in window)) throw new Error("PNG raw export is not available in this browser.");
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function readUint32(bytes, offset) {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  }

  function writeUint32(bytes, offset, value) {
    bytes[offset] = (value >>> 24) & 255;
    bytes[offset + 1] = (value >>> 16) & 255;
    bytes[offset + 2] = (value >>> 8) & 255;
    bytes[offset + 3] = value & 255;
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    parts.forEach((part) => {
      result.set(part, offset);
      offset += part.length;
    });
    return result;
  }

  function pngChannels(colorType) {
    if (colorType === 0 || colorType === 3) return 1;
    if (colorType === 2) return 3;
    if (colorType === 4) return 2;
    if (colorType === 6) return 4;
    throw new Error(`Unsupported PNG color type: ${colorType}`);
  }

  function paethPredictor(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  function unfilterPngRows(filtered, width, height, channels, bytesPerSample) {
    const bpp = channels * bytesPerSample;
    const stride = width * bpp;
    const raw = new Uint8Array(stride * height);
    let src = 0;

    for (let y = 0; y < height; y += 1) {
      const filter = filtered[src];
      src += 1;
      const row = y * stride;
      const prev = row - stride;

      for (let x = 0; x < stride; x += 1) {
        const value = filtered[src];
        src += 1;
        const left = x >= bpp ? raw[row + x - bpp] : 0;
        const up = y > 0 ? raw[prev + x] : 0;
        const upLeft = y > 0 && x >= bpp ? raw[prev + x - bpp] : 0;
        let restored = value;

        if (filter === 1) restored += left;
        else if (filter === 2) restored += up;
        else if (filter === 3) restored += Math.floor((left + up) / 2);
        else if (filter === 4) restored += paethPredictor(left, up, upLeft);
        else if (filter !== 0) throw new Error(`Unsupported PNG filter: ${filter}`);

        raw[row + x] = restored & 255;
      }
    }

    return raw;
  }

  async function decodePngPixels(dataUrl) {
    const bytes = await bytesFromDataUrl(dataUrl);
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((value, index) => bytes[index] === value)) throw new Error("Not a PNG file.");

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let palette = null;
    let transparency = null;
    const idatParts = [];

    while (offset < bytes.length) {
      const length = readUint32(bytes, offset);
      offset += 4;
      const type = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      offset += 4;
      const data = bytes.slice(offset, offset + length);
      offset += length + 4;

      if (type === "IHDR") {
        width = readUint32(data, 0);
        height = readUint32(data, 4);
        bitDepth = data[8];
        colorType = data[9];
      } else if (type === "PLTE") {
        palette = data;
      } else if (type === "tRNS") {
        transparency = data;
      } else if (type === "IDAT") {
        idatParts.push(data);
      } else if (type === "IEND") {
        break;
      }
    }

    if (![8, 16].includes(bitDepth) || (colorType === 3 && bitDepth !== 8)) {
      throw new Error("Only 8-bit/16-bit PNG channels are supported for raw preservation.");
    }

    const channels = pngChannels(colorType);
    const bytesPerSample = bitDepth === 16 ? 2 : 1;
    const inflated = await inflateZlib(concatBytes(idatParts));
    const raw = unfilterPngRows(inflated, width, height, channels, bytesPerSample);
    const pixels = new Uint8Array(width * height * 4);
    const transparentGray = colorType === 0 && transparency ? (transparency[0] << 8) | transparency[1] : null;
    const transparentRgb =
      colorType === 2 && transparency
        ? [(transparency[0] << 8) | transparency[1], (transparency[2] << 8) | transparency[3], (transparency[4] << 8) | transparency[5]]
        : null;

    for (let i = 0; i < width * height; i += 1) {
      const src = i * channels * bytesPerSample;
      const dst = i * 4;
      const sample = (index) => raw[src + index * bytesPerSample];

      if (colorType === 6) {
        pixels[dst] = sample(0);
        pixels[dst + 1] = sample(1);
        pixels[dst + 2] = sample(2);
        pixels[dst + 3] = sample(3);
      } else if (colorType === 2) {
        const r = sample(0);
        const g = sample(1);
        const b = sample(2);
        pixels[dst] = r;
        pixels[dst + 1] = g;
        pixels[dst + 2] = b;
        pixels[dst + 3] = transparentRgb && r === transparentRgb[0] && g === transparentRgb[1] && b === transparentRgb[2] ? 0 : 255;
      } else if (colorType === 4) {
        const gray = sample(0);
        pixels[dst] = gray;
        pixels[dst + 1] = gray;
        pixels[dst + 2] = gray;
        pixels[dst + 3] = sample(1);
      } else if (colorType === 0) {
        const gray = sample(0);
        pixels[dst] = gray;
        pixels[dst + 1] = gray;
        pixels[dst + 2] = gray;
        pixels[dst + 3] = transparentGray !== null && gray === transparentGray ? 0 : 255;
      } else if (colorType === 3) {
        if (!palette) throw new Error("PNG palette is missing.");
        const index = raw[src];
        const paletteOffset = index * 3;
        pixels[dst] = palette[paletteOffset] || 0;
        pixels[dst + 1] = palette[paletteOffset + 1] || 0;
        pixels[dst + 2] = palette[paletteOffset + 2] || 0;
        pixels[dst + 3] = transparency?.[index] ?? 255;
      }
    }

    return { pixels, width, height, rawPreserved: colorType === 6 || colorType === 4 };
  }

  function getCanvasPixels(image) {
    const scratch = document.createElement("canvas");
    scratch.width = image.naturalWidth;
    scratch.height = image.naturalHeight;
    const scratchCtx = scratch.getContext("2d");
    scratchCtx.drawImage(image, 0, 0);
    return new Uint8Array(scratchCtx.getImageData(0, 0, scratch.width, scratch.height).data);
  }

  function analyzePixels(pixels) {
    let hasAlpha = false;
    let hasHiddenRgb = false;
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3];
      if (alpha < 255) hasAlpha = true;
      if (alpha === 0 && (pixels[i] || pixels[i + 1] || pixels[i + 2])) {
        hasHiddenRgb = true;
        hasAlpha = true;
        break;
      }
    }
    return { hasAlpha, hasHiddenRgb };
  }

  function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  }

  const crcTable = makeCrcTable();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function pngChunk(type, data) {
    const typeBytes = new TextEncoder().encode(type);
    const chunk = new Uint8Array(12 + data.length);
    writeUint32(chunk, 0, data.length);
    chunk.set(typeBytes, 4);
    chunk.set(data, 8);
    writeUint32(chunk, 8 + data.length, crc32(chunk.slice(4, 8 + data.length)));
    return chunk;
  }

  async function encodePngRgba(width, height, pixels) {
    const raw = new Uint8Array((width * 4 + 1) * height);
    let src = 0;
    let dst = 0;
    for (let y = 0; y < height; y += 1) {
      raw[dst] = 0;
      dst += 1;
      raw.set(pixels.slice(src, src + width * 4), dst);
      src += width * 4;
      dst += width * 4;
    }

    const ihdr = new Uint8Array(13);
    writeUint32(ihdr, 0, width);
    writeUint32(ihdr, 4, height);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const compressed = await deflateZlib(raw);
    return concatBytes([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array())]);
  }

  function loadImageSource(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Image load failed."));
      image.src = src;
    });
  }

  function getAsset(assetId) {
    return state.assets.find((asset) => asset.id === assetId);
  }

  function getPlacement(placementId) {
    return state.placements.find((placement) => placement.id === placementId);
  }

  function getPlacementForAsset(assetId) {
    return state.placements.find((placement) => placement.assetId === assetId);
  }

  function getSelected() {
    if (!state.selected) return null;
    if (state.selected.type === "asset") return getAsset(state.selected.id);
    if (state.selected.type === "placement") return getPlacement(state.selected.id);
    return null;
  }

  function isPlacementSelected(placementId) {
    return state.selectedPlacementIds.includes(placementId);
  }

  function selectedPlacements() {
    return state.selectedPlacementIds.map(getPlacement).filter(Boolean);
  }

  function selectionBounds() {
    const placements = selectedPlacements();
    if (!placements.length) return null;
    const rects = placements.map(placementRect);
    const left = Math.min(...rects.map((rect) => rect.x));
    const top = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function scaledSize(asset, scale) {
    return {
      width: Math.max(1, Math.round(asset.width * scale)),
      height: Math.max(1, Math.round(asset.height * scale)),
    };
  }

  function paddedSize(asset, scale) {
    const content = scaledSize(asset, scale);
    const padding = assetPadding(asset);
    return {
      width: content.width + padding * 2,
      height: content.height + padding * 2,
      contentWidth: content.width,
      contentHeight: content.height,
      padding,
    };
  }

  function setPlacementScale(placement, scale, options = {}) {
    const asset = getAsset(placement.assetId);
    if (!asset) return;
    const previousRect = placementRect(placement);
    const size = paddedSize(asset, scale);
    placement.scale = scale;
    if (placement.locked && options.keepLockedSlot !== false) {
      placement.width = previousRect.width;
      placement.height = previousRect.height;
    } else {
      placement.width = size.width;
      placement.height = size.height;
    }
  }

  function snapValue(value) {
    return Math.round(value / SNAP) * SNAP;
  }

  function snapCeil(value) {
    return Math.ceil(value / SNAP) * SNAP;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function workspaceMargin() {
    return 2048;
  }

  function workspaceSize() {
    return state.atlasSize + workspaceMargin() * 2;
  }

  function atlasOrigin() {
    const margin = workspaceMargin();
    return { x: margin, y: margin };
  }

  function resizeWorkspaceCanvas() {
    const size = workspaceSize();
    els.canvas.width = size;
    els.canvas.height = size;
  }

  function placementRect(placement) {
    const asset = getAsset(placement.assetId);
    if (!asset) return { x: 0, y: 0, width: 0, height: 0 };
    const size = paddedSize(asset, placement.scale);
    return {
      x: placement.x,
      y: placement.y,
      width: placement.width || size.width,
      height: placement.height || size.height,
    };
  }

  function placementContentRect(placement) {
    const asset = getAsset(placement.assetId);
    const rect = placementRect(placement);
    const maxPadding = Math.max(0, Math.floor(Math.min(rect.width, rect.height) / 2) - 1);
    const padding = Math.min(assetPadding(asset), maxPadding);
    return {
      x: rect.x + padding,
      y: rect.y + padding,
      width: Math.max(1, rect.width - padding * 2),
      height: Math.max(1, rect.height - padding * 2),
      padding,
    };
  }

  function rectanglesOverlap(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  function isPlacementExportable(placement) {
    const rect = placementRect(placement);
    return rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= state.atlasSize && rect.y + rect.height <= state.atlasSize;
  }

  function exportablePlacements() {
    return state.placements.filter(isPlacementExportable);
  }

  function clampPlacement(placement) {
    const rect = placementRect(placement);
    const margin = workspaceMargin();
    placement.x = clamp(snapValue(placement.x), -margin, Math.max(-margin, state.atlasSize + margin - rect.width));
    placement.y = clamp(snapValue(placement.y), -margin, Math.max(-margin, state.atlasSize + margin - rect.height));
  }

  function clampedWorkspacePosition(width, height, point) {
    const margin = workspaceMargin();
    return {
      x: clamp(snapValue(point.x), -margin, Math.max(-margin, state.atlasSize + margin - width)),
      y: clamp(snapValue(point.y), -margin, Math.max(-margin, state.atlasSize + margin - height)),
    };
  }

  function pointIsInsideAtlas(point) {
    return point.x >= 0 && point.y >= 0 && point.x <= state.atlasSize && point.y <= state.atlasSize;
  }

  function getCollisionIds(options = {}) {
    const ids = new Set();
    const placements = options.exportOnly ? exportablePlacements() : state.placements;
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const a = placements[i];
        const b = placements[j];
        if (rectanglesOverlap(placementRect(a), placementRect(b))) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    return ids;
  }

  function overlapsAny(rect, excludePlacementId = null) {
    return state.placements.some((placement) => {
      if (placement.id === excludePlacementId) return false;
      return rectanglesOverlap(rect, placementRect(placement));
    });
  }

  function findFreePosition(width, height, preferred = null, excludePlacementId = null) {
    if (width > state.atlasSize || height > state.atlasSize) return null;

    if (preferred) {
      const px = clamp(snapValue(preferred.x), 0, state.atlasSize - width);
      const py = clamp(snapValue(preferred.y), 0, state.atlasSize - height);
      const preferredRect = { x: px, y: py, width, height };
      if (!overlapsAny(preferredRect, excludePlacementId)) return { x: px, y: py };
    }

    for (let y = 0; y <= state.atlasSize - height; y += SNAP) {
      for (let x = 0; x <= state.atlasSize - width; x += SNAP) {
        const rect = { x, y, width, height };
        if (!overlapsAny(rect, excludePlacementId)) return { x, y };
      }
    }
    return null;
  }

  function findPlacementPosition(width, height, preferred = null, excludePlacementId = null) {
    if (preferred && !pointIsInsideAtlas(preferred)) {
      return clampedWorkspacePosition(width, height, preferred);
    }
    return findFreePosition(width, height, preferred, excludePlacementId);
  }

  function setStatus(message) {
    els.statusBar.textContent = message;
  }

  function makeSnapshot(options = {}) {
    const embedImages = options.embedImages !== false;
    return {
      type: "atlas-snapper-project",
      version: 3,
      atlasSize: state.atlasSize,
      assets: state.assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        externalPath: asset.externalPath || asset.name,
        dataUrl: embedImages ? asset.dataUrl || asset.url : undefined,
        width: asset.width,
        height: asset.height,
        defaultScale: asset.defaultScale,
        padding: assetPadding(asset),
        bleed: assetBleed(asset),
        rawPreserved: Boolean(asset.rawPreserved),
      })),
      placements: state.placements.map((placement) => ({
        id: placement.id,
        assetId: placement.assetId,
        x: placement.x,
        y: placement.y,
        scale: placement.scale,
        width: placement.width,
        height: placement.height,
        locked: Boolean(placement.locked),
      })),
      selected: state.selected ? { ...state.selected } : null,
      selectedPlacementIds: [...state.selectedPlacementIds],
      projectMode: embedImages ? "embed" : "external",
    };
  }

  function updateHistoryButtons() {
    if (!els.undoBtn || !els.redoBtn) return;
    els.undoBtn.disabled = state.history.length <= 1;
    els.redoBtn.disabled = state.future.length === 0;
  }

  function pushHistory() {
    if (state.restoring) return;
    state.history.push(makeSnapshot());
    if (state.history.length > 40) state.history.shift();
    state.future = [];
    updateHistoryButtons();
  }

  function normalizeSnapshot(payload) {
    const atlasSize = Number(payload.atlasSize || payload.atlas?.width || 2048);
    const selected = payload.selected || null;
    return {
      atlasSize,
      assets: Array.isArray(payload.assets) ? payload.assets : [],
      placements: Array.isArray(payload.placements) ? payload.placements : [],
      selected,
      selectedPlacementIds: Array.isArray(payload.selectedPlacementIds)
        ? payload.selectedPlacementIds
        : selected?.type === "placement"
          ? [selected.id]
          : [],
      projectMode: payload.projectMode || "embed",
    };
  }

  async function restoreSnapshot(payload) {
    const snapshot = normalizeSnapshot(payload);
    state.restoring = true;
    try {
      const assets = await Promise.all(
        snapshot.assets.map((asset) => {
          const dataUrl = asset.dataUrl || asset.url;
          if (!dataUrl) throw new Error(`${asset.name || asset.externalPath || "image"} の参照画像が必要です。`);
          return createAssetFromDataUrl(dataUrl, asset.name || asset.externalPath || "image.png", {
            id: asset.id,
            externalPath: asset.externalPath,
            defaultScale: asset.defaultScale,
            padding: asset.padding,
            bleed: asset.bleed,
          });
        }),
      );

      state.atlasSize = snapshot.atlasSize;
      els.atlasSizeSelect.value = String(snapshot.atlasSize);
      state.projectMode = snapshot.projectMode === "external" ? "external" : "embed";
      els.projectModeSelect.value = state.projectMode;
      resizeWorkspaceCanvas();
      state.assets = assets;
      state.placements = snapshot.placements.map((placement) => ({
        id: placement.id || uid("placement"),
        assetId: placement.assetId,
        x: Number(placement.x) || 0,
        y: Number(placement.y) || 0,
        scale: Number(placement.scale) || 1,
        width: Number(placement.width) || undefined,
        height: Number(placement.height) || undefined,
        locked: Boolean(placement.locked),
      }));
      state.selected = snapshot.selected;
      state.selectedPlacementIds = snapshot.selectedPlacementIds.filter((id) => state.placements.some((placement) => placement.id === id));
      state.placements.forEach(clampPlacement);
      applyZoom();
      renderAll();
      queueCenterAtlas();
    } finally {
      state.restoring = false;
      updateHistoryButtons();
    }
  }

  async function undo() {
    if (state.history.length <= 1) return;
    const current = state.history.pop();
    state.future.push(current);
    await restoreSnapshot(state.history[state.history.length - 1]);
    setStatus("元に戻しました。");
  }

  async function redo() {
    if (!state.future.length) return;
    const next = state.future.pop();
    state.history.push(next);
    await restoreSnapshot(next);
    setStatus("やり直しました。");
  }

  function setSelected(type, id, options = {}) {
    if (type === "placement" && id) {
      if (options.toggle) {
        if (isPlacementSelected(id)) {
          state.selectedPlacementIds = state.selectedPlacementIds.filter((placementId) => placementId !== id);
          const nextId = state.selectedPlacementIds[state.selectedPlacementIds.length - 1];
          state.selected = nextId ? { type: "placement", id: nextId } : null;
        } else {
          state.selectedPlacementIds.push(id);
          state.selected = { type, id };
        }
      } else if (options.add) {
        if (!isPlacementSelected(id)) state.selectedPlacementIds.push(id);
        state.selected = { type, id };
      } else {
        state.selectedPlacementIds = [id];
        state.selected = { type, id };
      }
    } else {
      state.selectedPlacementIds = [];
      state.selected = type && id ? { type, id } : null;
    }
    renderAssetList();
    renderInspector();
    renderCanvas();
    renderValidation();
  }

  function setAtlasSize(size, recordHistory = true) {
    state.atlasSize = size;
    resizeWorkspaceCanvas();
    state.placements.forEach(clampPlacement);
    applyZoom();
    renderAll();
    queueCenterAtlas();
    if (recordHistory) pushHistory();
  }

  function applyZoom() {
    const cssSize = Math.max(64, Math.round(workspaceSize() * state.zoom));
    els.canvasWrap.style.width = `${cssSize}px`;
    els.canvasWrap.style.height = `${cssSize}px`;
  }

  function viewportCenterWorldPoint() {
    if (!els.stageViewport.clientWidth || !els.stageViewport.clientHeight) return null;
    return {
      x: (els.stageViewport.scrollLeft + els.stageViewport.clientWidth / 2) / state.zoom,
      y: (els.stageViewport.scrollTop + els.stageViewport.clientHeight / 2) / state.zoom,
    };
  }

  function scrollToWorldPoint(point) {
    if (!point) return;
    els.stageViewport.scrollLeft = Math.max(0, point.x * state.zoom - els.stageViewport.clientWidth / 2);
    els.stageViewport.scrollTop = Math.max(0, point.y * state.zoom - els.stageViewport.clientHeight / 2);
  }

  function centerAtlasInViewport() {
    const origin = atlasOrigin();
    scrollToWorldPoint({ x: origin.x + state.atlasSize / 2, y: origin.y + state.atlasSize / 2 });
  }

  function queueCenterAtlas() {
    window.requestAnimationFrame(centerAtlasInViewport);
  }

  function fitZoomToViewport() {
    const bounds = els.stageViewport.getBoundingClientRect();
    const target = Math.max(220, Math.min(bounds.width - 36, bounds.height - 36));
    const zoomPercent = clamp((target / state.atlasSize) * 100, 6.25, 100);
    const rounded = zoomPercent < 16 ? 12.5 : zoomPercent < 38 ? 25 : zoomPercent < 63 ? 50 : zoomPercent < 88 ? 75 : 100;
    state.zoom = rounded / 100;
    els.zoomSelect.value = String(rounded);
    applyZoom();
    queueCenterAtlas();
  }

  function worldPointFromEvent(event) {
    const rect = els.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * els.canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * els.canvas.height;
    return { x, y };
  }

  function canvasPointFromEvent(event) {
    const worldPoint = worldPointFromEvent(event);
    const origin = atlasOrigin();
    return { x: worldPoint.x - origin.x, y: worldPoint.y - origin.y };
  }

  function hitTestPlacement(point) {
    for (let i = state.placements.length - 1; i >= 0; i -= 1) {
      const placement = state.placements[i];
      const rect = placementRect(placement);
      if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) {
        return placement;
      }
    }
    return null;
  }

  async function createAssetFromDataUrl(dataUrl, name, options = {}) {
    const image = await loadImageSource(dataUrl);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const padding = normalizePixels(options.padding, 0);
    let pixelSource = null;

    try {
      if (dataUrl.startsWith("data:image/png")) {
        pixelSource = await decodePngPixels(dataUrl);
      }
    } catch {
      pixelSource = null;
    }

    if (!pixelSource || pixelSource.width !== width || pixelSource.height !== height) {
      pixelSource = {
        pixels: getCanvasPixels(image),
        width,
        height,
        rawPreserved: false,
      };
    }
    const pixelInfo = analyzePixels(pixelSource.pixels);

    return {
      id: options.id || uid("asset"),
      name,
      externalPath: options.externalPath || options.path || name,
      url: dataUrl,
      dataUrl,
      image,
      pixels: pixelSource.pixels,
      rawPreserved: pixelSource.rawPreserved,
      hasAlpha: pixelInfo.hasAlpha,
      hasHiddenRgb: pixelInfo.hasHiddenRgb,
      width,
      height,
      defaultScale: Number(options.defaultScale) || 1,
      padding,
      bleed: Math.min(normalizePixels(options.bleed, 0), padding),
      powerOfTwo: isPowerOfTwo(width) && isPowerOfTwo(height),
    };
  }

  async function loadImageFile(file) {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      return createAssetFromDataUrl(dataUrl, file.name, {
        externalPath: file.webkitRelativePath || file.name,
      });
    } catch {
      throw new Error(`${file.name} を読み込めませんでした。`);
    }
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    if (!files.length) {
      setStatus("画像ファイルが見つかりませんでした。");
      return [];
    }

    const results = await Promise.allSettled(files.map(loadImageFile));
    const added = [];
    const failed = [];

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        state.assets.push(result.value);
        added.push(result.value);
      } else {
        failed.push(result.reason.message);
      }
    });

    renderAll();

    if (added.length) {
      setSelected("asset", added[0].id);
    }

    const warningCount = added.filter((asset) => !asset.powerOfTwo).length;
    const parts = [`${added.length}枚を追加しました。`];
    if (warningCount) parts.push(`${warningCount}枚は2のべき乗サイズではありません。`);
    if (failed.length) parts.push(`${failed.length}枚は読み込めませんでした。`);
    setStatus(parts.join(" "));
    if (added.length) pushHistory();
    return added;
  }

  function createPlacement(assetId, preferredPoint = null) {
    const asset = getAsset(assetId);
    if (!asset) return null;

    const existing = getPlacementForAsset(assetId);
    const size = paddedSize(asset, existing ? existing.scale : asset.defaultScale);
    const position = findPlacementPosition(size.width, size.height, preferredPoint, existing ? existing.id : null);
    if (!position) {
      setStatus(`${asset.name} を置ける空き領域がありません。縮小倍率か最終サイズを変更してください。`);
      return null;
    }

    if (existing) {
      if (existing.locked) {
        setSelected("placement", existing.id);
        setStatus(`${asset.name} のスロットは固定されています。`);
        return existing;
      }
      existing.x = position.x;
      existing.y = position.y;
      clampPlacement(existing);
      setSelected("placement", existing.id);
      setStatus(isPlacementExportable(existing) ? `${asset.name} を ${existing.x}, ${existing.y} に移動しました。` : `${asset.name} を退避スペースに移動しました。`);
      pushHistory();
      return existing;
    }

    const placement = {
      id: uid("placement"),
      assetId,
      x: position.x,
      y: position.y,
      scale: asset.defaultScale,
      width: size.width,
      height: size.height,
      locked: false,
    };
    clampPlacement(placement);
    state.placements.push(placement);
    setSelected("placement", placement.id);
    setStatus(isPlacementExportable(placement) ? `${asset.name} を ${placement.x}, ${placement.y} に配置しました。` : `${asset.name} を退避スペースに配置しました。`);
    pushHistory();
    return placement;
  }

  function inferScaleForSlot(asset, rect, fallbackScale) {
    const padding = assetPadding(asset);
    const scaleX = Math.max(1, rect.width - padding * 2) / asset.width;
    const scaleY = Math.max(1, rect.height - padding * 2) / asset.height;
    if (sameScale(scaleX, scaleY)) return scaleX;
    return fallbackScale;
  }

  function replacePlacementAsset(placementId, assetId) {
    const placement = getPlacement(placementId);
    const asset = getAsset(assetId);
    if (!placement || !asset) return null;

    if (placement.assetId === assetId) {
      setSelected("placement", placement.id);
      setStatus(`${asset.name} はすでにこの枠に配置されています。`);
      return placement;
    }

    const existingPlacement = getPlacementForAsset(assetId);
    if (existingPlacement && existingPlacement.id !== placement.id) {
      if (existingPlacement.locked) {
        setSelected("placement", existingPlacement.id);
        setStatus(`${asset.name} は固定スロットで使用中です。`);
        return null;
      }
      state.placements = state.placements.filter((item) => item.id !== existingPlacement.id);
    }

    const oldRect = placementRect(placement);
    const oldAsset = getAsset(placement.assetId);
    placement.assetId = assetId;
    placement.width = oldRect.width;
    placement.height = oldRect.height;
    placement.scale = inferScaleForSlot(asset, oldRect, placement.scale);
    clampPlacement(placement);
    setSelected("placement", placement.id);
    setStatus(`${oldAsset ? oldAsset.name : "画像"} の枠をそのまま ${asset.name} に差し替えました。`);
    pushHistory();
    return placement;
  }

  function removePlacement(placementId) {
    const placement = getPlacement(placementId);
    if (!placement) return;
    const asset = getAsset(placement.assetId);
    state.placements = state.placements.filter((item) => item.id !== placementId);
    setSelected("asset", placement.assetId);
    setStatus(`${asset ? asset.name : "画像"} をアトラスから外しました。`);
    pushHistory();
  }

  function deleteAsset(assetId) {
    const asset = getAsset(assetId);
    if (!asset) return;
    if (asset.url?.startsWith("blob:")) URL.revokeObjectURL(asset.url);
    state.assets = state.assets.filter((item) => item.id !== assetId);
    state.placements = state.placements.filter((item) => item.assetId !== assetId);
    setSelected(null, null);
    setStatus(`${asset.name} をリストから削除しました。`);
    pushHistory();
  }

  function autoPackUnplaced() {
    const candidates = state.assets
      .filter((asset) => !getPlacementForAsset(asset.id))
      .slice()
      .sort((a, b) => {
        const aSize = paddedSize(a, a.defaultScale);
        const bSize = paddedSize(b, b.defaultScale);
        return Math.max(bSize.width, bSize.height) - Math.max(aSize.width, aSize.height);
      });

    let placedCount = 0;
    let failedCount = 0;

    candidates.forEach((asset) => {
      const size = paddedSize(asset, asset.defaultScale);
      const position = findFreePosition(snapCeil(size.width), snapCeil(size.height));
      if (!position) {
        failedCount += 1;
        return;
      }
      state.placements.push({
        id: uid("placement"),
        assetId: asset.id,
        x: position.x,
        y: position.y,
        scale: asset.defaultScale,
        width: size.width,
        height: size.height,
        locked: false,
      });
      placedCount += 1;
    });

    renderAll();
    if (placedCount) {
      const last = state.placements[state.placements.length - 1];
      setSelected("placement", last.id);
    }
    setStatus(`未配置画像を${placedCount}枚配置しました。${failedCount ? `${failedCount}枚は空き領域不足です。` : ""}`);
    if (placedCount) pushHistory();
  }

  function clearAtlas() {
    state.placements = [];
    setSelected(null, null);
    setStatus("アトラス上の配置をすべて外しました。画像リストは残っています。");
    pushHistory();
  }

  function drawPlacementImage(targetCtx, placement) {
    const asset = getAsset(placement.assetId);
    if (!asset) return;
    const content = placementContentRect(placement);
    const bleed = Math.min(assetBleed(asset), content.padding);
    const sourceWidth = asset.image.naturalWidth;
    const sourceHeight = asset.image.naturalHeight;

    targetCtx.save();
    targetCtx.imageSmoothingEnabled = true;

    if (bleed > 0) {
      targetCtx.drawImage(asset.image, 0, 0, 1, sourceHeight, content.x - bleed, content.y, bleed, content.height);
      targetCtx.drawImage(asset.image, sourceWidth - 1, 0, 1, sourceHeight, content.x + content.width, content.y, bleed, content.height);
      targetCtx.drawImage(asset.image, 0, 0, sourceWidth, 1, content.x, content.y - bleed, content.width, bleed);
      targetCtx.drawImage(asset.image, 0, sourceHeight - 1, sourceWidth, 1, content.x, content.y + content.height, content.width, bleed);
      targetCtx.drawImage(asset.image, 0, 0, 1, 1, content.x - bleed, content.y - bleed, bleed, bleed);
      targetCtx.drawImage(asset.image, sourceWidth - 1, 0, 1, 1, content.x + content.width, content.y - bleed, bleed, bleed);
      targetCtx.drawImage(asset.image, 0, sourceHeight - 1, 1, 1, content.x - bleed, content.y + content.height, bleed, bleed);
      targetCtx.drawImage(
        asset.image,
        sourceWidth - 1,
        sourceHeight - 1,
        1,
        1,
        content.x + content.width,
        content.y + content.height,
        bleed,
        bleed,
      );
    }

    targetCtx.drawImage(asset.image, content.x, content.y, content.width, content.height);
    targetCtx.restore();
  }

  function renderCanvas() {
    const origin = atlasOrigin();
    const world = workspaceSize();
    ctx.clearRect(0, 0, world, world);
    drawWorkspaceGrid();

    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.fillStyle = "#273949";
    ctx.fillRect(0, 0, state.atlasSize, state.atlasSize);
    ctx.restore();

    const collisionIds = getCollisionIds({ exportOnly: true });
    const previewActive = state.placements.length && (state.viewMode !== "normal" || state.mipLevel !== 1);
    const placementsToDraw = previewActive ? state.placements.filter((placement) => !isPlacementExportable(placement)) : state.placements;

    ctx.save();
    ctx.translate(origin.x, origin.y);
    if (previewActive) {
      drawPreviewPixels(ctx);
    }
    placementsToDraw.forEach((placement) => {
      const asset = getAsset(placement.assetId);
      if (!asset) return;
      drawPlacementImage(ctx, placement);
    });
    ctx.restore();

    ctx.save();
    ctx.translate(origin.x, origin.y);
    drawGrid();
    ctx.restore();
    drawAtlasFrame();

    if (!state.placements.length) drawEmptyHint();

    ctx.save();
    ctx.translate(origin.x, origin.y);
    state.placements.forEach((placement) => {
      const rect = placementRect(placement);
      ctx.save();
      ctx.lineWidth = placement.locked ? 10 : 8;
      ctx.strokeStyle = collisionIds.has(placement.id)
        ? "#e25469"
        : !isPlacementExportable(placement)
          ? "#f0b44d"
          : placement.locked
            ? "#80c6d0"
            : "rgba(255, 255, 255, 0.78)";
      if (placement.locked) ctx.setLineDash([22, 14]);
      ctx.strokeRect(rect.x + 4, rect.y + 4, rect.width - 8, rect.height - 8);
      ctx.restore();
    });

    selectedPlacements().forEach((placement) => {
      const rect = placementRect(placement);
      ctx.save();
      ctx.lineWidth = placement.id === state.selected?.id ? 12 : 8;
      ctx.strokeStyle = placement.id === state.selected?.id ? "#f0b44d" : "#ffe0a1";
      ctx.setLineDash([28, 16]);
      ctx.strokeRect(rect.x + 6, rect.y + 6, rect.width - 12, rect.height - 12);
      ctx.restore();
    });

    if (state.selectedPlacementIds.length > 1) {
      const rect = selectionBounds();
      if (rect) {
        ctx.save();
        ctx.lineWidth = 6;
        ctx.strokeStyle = "rgba(240, 180, 77, 0.82)";
        ctx.setLineDash([12, 10]);
        ctx.strokeRect(rect.x + 3, rect.y + 3, rect.width - 6, rect.height - 6);
        ctx.restore();
      }
    }
    ctx.restore();

    updateStats(collisionIds);
  }

  function drawWorkspaceGrid() {
    const world = workspaceSize();
    const origin = atlasOrigin();
    ctx.save();
    ctx.fillStyle = "#eef3f6";
    ctx.fillRect(0, 0, world, world);
    ctx.strokeStyle = "rgba(39, 57, 73, 0.08)";
    ctx.lineWidth = 1;
    const firstX = origin.x % SNAP;
    const firstY = origin.y % SNAP;
    for (let x = firstX; x <= world; x += SNAP) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, world);
      ctx.stroke();
    }
    for (let y = firstY; y <= world; y += SNAP) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(world, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 2;
    for (let value = 0; value <= state.atlasSize; value += SNAP) {
      const strong = value % 512 === 0;
      ctx.strokeStyle = strong ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)";
      ctx.lineWidth = strong ? 3 : 1;
      ctx.beginPath();
      ctx.moveTo(value, 0);
      ctx.lineTo(value, state.atlasSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, value);
      ctx.lineTo(state.atlasSize, value);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAtlasFrame() {
    const origin = atlasOrigin();
    ctx.save();
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#162534";
    ctx.strokeRect(origin.x + 4, origin.y + 4, state.atlasSize - 8, state.atlasSize - 8);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.strokeRect(origin.x + 1, origin.y + 1, state.atlasSize - 2, state.atlasSize - 2);
    ctx.restore();
  }

  function drawEmptyHint() {
    const origin = atlasOrigin();
    ctx.save();
    ctx.translate(origin.x, origin.y);
    const fontSize = state.atlasSize >= 2048 ? 96 : 52;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = `700 ${fontSize}px "Yu Gothic UI", sans-serif`;
    ctx.textBaseline = "top";
    const lines = ["詰める先", "ここにドラッグアンドドロップ", "128pxスナップ"];
    lines.forEach((line, index) => {
      ctx.fillText(line, SNAP * 1.2, SNAP * 1.2 + index * fontSize * 1.55);
    });
    ctx.restore();
  }

  function updateStats(collisionIds = getCollisionIds()) {
    const total = state.assets.length;
    const placed = state.placements.length;
    const exportPlacements = exportablePlacements();
    const exportCount = exportPlacements.length;
    const stagedCount = placed - exportCount;
    const usedArea = exportPlacements.reduce((sum, placement) => {
      const rect = placementRect(placement);
      return sum + rect.width * rect.height;
    }, 0);
    const percent = total ? ((usedArea / (state.atlasSize * state.atlasSize)) * 100).toFixed(1) : "0.0";
    const placementLabel = stagedCount ? `${exportCount} / ${total} 出力・退避 ${stagedCount}` : `${placed} / ${total} 配置`;
    els.stageStats.textContent = `${placementLabel}・${percent}% 使用${state.selectedPlacementIds.length > 1 ? `・選択 ${state.selectedPlacementIds.length}` : ""}${collisionIds.size ? `・重なり ${collisionIds.size}` : ""}`;
    els.atlasLabel.textContent = `${state.atlasSize} x ${state.atlasSize}`;
    const modeLabel = state.viewMode === "alpha" ? "Alpha" : state.viewMode === "hiddenRgb" ? "透明RGB" : "通常";
    const mipLabel = state.mipLevel === 1 ? "原寸" : `Mip 1/${state.mipLevel}`;
    els.atlasMeta.textContent = `${SNAP}px グリッド / ${modeLabel} / ${mipLabel} / 周囲に退避可`;
  }

  function renderAssetList() {
    els.assetList.innerHTML = "";

    if (!state.assets.length) {
      const empty = document.createElement("div");
      empty.className = "emptyState";
      empty.textContent = "まだ画像がありません。追加ボタン、またはこのパネルへのドロップで読み込めます。";
      els.assetList.append(empty);
      return;
    }

    state.assets.forEach((asset) => {
      const placement = getPlacementForAsset(asset.id);
      const item = document.createElement("div");
      item.className = "assetItem";
      item.dataset.assetId = asset.id;
      item.draggable = true;
      item.tabIndex = 0;
      if (state.selected?.type === "asset" && state.selected.id === asset.id) item.classList.add("selected");
      if (placement && isPlacementSelected(placement.id)) item.classList.add("selected");

      const image = document.createElement("img");
      image.src = asset.url;
      image.alt = asset.name;

      const meta = document.createElement("div");
      meta.className = "assetMeta";

      const name = document.createElement("strong");
      name.textContent = asset.name;
      name.title = asset.name;

      const size = document.createElement("span");
      size.textContent = `${asset.width} x ${asset.height} / 初期 ${formatScale(asset.defaultScale)}`;

      const badges = document.createElement("div");
      badges.className = "badges";
      const potBadge = document.createElement("span");
      potBadge.className = `badge ${asset.powerOfTwo ? "ok" : "warn"}`;
      potBadge.textContent = asset.powerOfTwo ? "2のべき乗" : "要確認";
      const placedBadge = document.createElement("span");
      const placedExportable = placement && isPlacementExportable(placement);
      placedBadge.className = `badge ${placement ? (placedExportable ? "ok" : "warn") : ""}`;
      placedBadge.textContent = placement ? (placedExportable ? "出力対象" : "退避中") : "未配置";
      const alphaBadge = document.createElement("span");
      alphaBadge.className = `badge ${asset.rawPreserved ? "ok" : ""}`;
      alphaBadge.textContent = asset.rawPreserved ? "透明RGB保持" : "通常RGBA";
      badges.append(potBadge, placedBadge, alphaBadge);

      meta.append(name, size, badges);
      item.append(image, meta);

      item.addEventListener("click", (event) => {
        if (placement) {
          setSelected("placement", placement.id, { toggle: event.shiftKey || event.ctrlKey || event.metaKey });
        } else {
          setSelected("asset", asset.id);
        }
      });
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (placement) setSelected("placement", placement.id);
          else createPlacement(asset.id);
        }
      });
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "copyMove";
        event.dataTransfer.setData("application/x-atlas-asset", asset.id);
        event.dataTransfer.setData("text/plain", asset.id);
      });

      els.assetList.append(item);
    });
  }

  function clearInspector() {
    els.inspector.innerHTML = "";
  }

  function createControlRow(labelText, control) {
    const row = document.createElement("div");
    row.className = "controlRow";
    const label = document.createElement("label");
    label.textContent = labelText;
    row.append(label, control);
    return row;
  }

  function createReadout(labelText, valueText) {
    const row = document.createElement("div");
    row.className = "controlRow";
    const label = document.createElement("div");
    label.className = "readoutLabel";
    label.textContent = labelText;
    const value = document.createElement("div");
    value.className = "readout";
    value.textContent = valueText;
    row.append(label, value);
    return row;
  }

  function createScaleSelect(value, onChange, options = {}) {
    const select = document.createElement("select");
    const scaleOptions = SCALE_OPTIONS.some((scale) => sameScale(scale, value)) ? SCALE_OPTIONS : [value, ...SCALE_OPTIONS];
    scaleOptions.forEach((scale) => {
      const option = document.createElement("option");
      option.value = String(scale);
      option.textContent = `${formatScale(scale)} (${scale})`;
      if (sameScale(scale, value)) option.selected = true;
      select.append(option);
    });
    select.disabled = Boolean(options.disabled);
    select.addEventListener("change", () => onChange(Number(select.value)));
    return select;
  }

  function createNumberInput(value, onChange, options = {}) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = String(options.step ?? SNAP);
    if (options.min !== null) input.min = String(options.min ?? 0);
    if (options.max !== undefined) input.max = String(options.max);
    input.disabled = Boolean(options.disabled);
    input.value = String(value);
    input.addEventListener("change", () => onChange(Number(input.value)));
    return input;
  }

  function updateAssetSpacing(assetId, nextValues) {
    const asset = getAsset(assetId);
    if (!asset) return;
    if (nextValues.padding !== undefined) asset.padding = normalizePixels(nextValues.padding, assetPadding(asset));
    if (nextValues.bleed !== undefined) asset.bleed = normalizePixels(nextValues.bleed, assetBleed(asset));
    asset.bleed = Math.min(assetBleed(asset), assetPadding(asset));

    const placement = getPlacementForAsset(assetId);
    if (placement) {
      setPlacementScale(placement, placement.scale);
      clampPlacement(placement);
    }

    renderAll();
    if (placement) setSelected("placement", placement.id);
    else setSelected("asset", asset.id);
    pushHistory();
  }

  function renderInspector() {
    clearInspector();
    const selected = getSelected();

    if (!selected) {
      const empty = document.createElement("div");
      empty.className = "emptyState";
      empty.textContent = "右の画像を選ぶと初期縮小倍率、アトラス上の画像を選ぶと座標と縮小倍率を編集できます。";
      els.inspector.append(empty);
      return;
    }

    if (state.selected.type === "asset") {
      renderAssetInspector(selected);
    } else {
      renderPlacementInspector(selected);
    }
  }

  function renderAssetInspector(asset) {
    const title = document.createElement("div");
    title.className = "inspectorTitle";
    const name = document.createElement("strong");
    name.textContent = asset.name;
    const subtitle = document.createElement("span");
    subtitle.textContent = "画像リスト";
    title.append(name, subtitle);

    const grid = document.createElement("div");
    grid.className = "inspectorGrid";
    grid.append(createReadout("元サイズ", `${asset.width} x ${asset.height}`));
    grid.append(createReadout("α/RGB", asset.rawPreserved ? "PNGの透明ピクセル内RGBを保持します。" : "通常デコードです。透明RGB保持は保証されません。"));
    grid.append(createReadout("判定", asset.powerOfTwo ? "幅・高さとも2のべき乗です。" : "幅または高さが2のべき乗ではありません。"));
    grid.append(
      createControlRow(
        "初期倍率",
        createScaleSelect(asset.defaultScale, (scale) => {
          asset.defaultScale = scale;
          renderAll();
          setSelected("asset", asset.id);
          pushHistory();
        }),
      ),
    );
    const spacingPair = document.createElement("div");
    spacingPair.className = "pair";
    spacingPair.append(
      createControlRow(
        "Padding",
        createNumberInput(assetPadding(asset), (value) => updateAssetSpacing(asset.id, { padding: value }), { step: 1 }),
      ),
      createControlRow(
        "Bleed",
        createNumberInput(assetBleed(asset), (value) => updateAssetSpacing(asset.id, { bleed: value }), { step: 1 }),
      ),
    );
    grid.append(spacingPair);

    const previewSize = paddedSize(asset, asset.defaultScale);
    grid.append(createReadout("配置サイズ", `${previewSize.width} x ${previewSize.height}`));

    const actions = document.createElement("div");
    actions.className = "actionRow";
    const placeButton = document.createElement("button");
    placeButton.type = "button";
    placeButton.className = "primary";
    placeButton.textContent = getPlacementForAsset(asset.id) ? "配置済みを選択" : "空きに追加";
    placeButton.addEventListener("click", () => {
      const existing = getPlacementForAsset(asset.id);
      if (existing) setSelected("placement", existing.id);
      else createPlacement(asset.id);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.textContent = "削除";
    deleteButton.addEventListener("click", () => deleteAsset(asset.id));
    actions.append(placeButton, deleteButton);

    els.inspector.append(title, grid, actions);
  }

  function renderPlacementInspector(placement) {
    const asset = getAsset(placement.assetId);
    if (!asset) return;
    const rect = placementRect(placement);
    const content = placementContentRect(placement);
    const collisions = getCollisionIds({ exportOnly: true });
    const exportable = isPlacementExportable(placement);

    const title = document.createElement("div");
    title.className = "inspectorTitle";
    const name = document.createElement("strong");
    name.textContent = asset.name;
    const subtitle = document.createElement("span");
    subtitle.textContent = exportable ? "アトラス上の配置" : "退避スペース";
    title.append(name, subtitle);

    const grid = document.createElement("div");
    grid.className = "inspectorGrid";
    grid.append(createReadout("元サイズ", `${asset.width} x ${asset.height}`));
    grid.append(createReadout("α/RGB", asset.rawPreserved ? "PNGの透明ピクセル内RGBを保持します。" : "通常デコードです。透明RGB保持は保証されません。"));
    grid.append(createReadout("配置サイズ", `${rect.width} x ${rect.height}`));
    grid.append(createReadout("画像領域", `${content.width} x ${content.height}`));
    grid.append(createReadout("状態", collisions.has(placement.id) ? "ほかの画像と重なっています。" : "重なりはありません。"));
    grid.append(createReadout("出力", exportable ? "PNG/JSONに含めます。" : "アトラス外のためPNG/JSONには含めません。"));

    const lockInput = document.createElement("input");
    lockInput.type = "checkbox";
    lockInput.checked = Boolean(placement.locked);
    lockInput.addEventListener("change", () => {
      placement.locked = lockInput.checked;
      renderAll();
      setSelected("placement", placement.id);
      pushHistory();
      setStatus(placement.locked ? "スロットを固定しました。" : "スロット固定を解除しました。");
    });
    grid.append(createControlRow("固定", lockInput));

    const pair = document.createElement("div");
    pair.className = "pair";
    const xInput = createNumberInput(placement.x, (value) => {
      if (placement.locked) return;
      placement.x = value;
      clampPlacement(placement);
      renderAll();
      setSelected("placement", placement.id);
      pushHistory();
    }, { disabled: placement.locked, min: -workspaceMargin(), max: state.atlasSize + workspaceMargin() });
    const yInput = createNumberInput(placement.y, (value) => {
      if (placement.locked) return;
      placement.y = value;
      clampPlacement(placement);
      renderAll();
      setSelected("placement", placement.id);
      pushHistory();
    }, { disabled: placement.locked, min: -workspaceMargin(), max: state.atlasSize + workspaceMargin() });
    pair.append(createControlRow("X", xInput), createControlRow("Y", yInput));
    grid.append(pair);

    const spacingPair = document.createElement("div");
    spacingPair.className = "pair";
    spacingPair.append(
      createControlRow(
        "Padding",
        createNumberInput(assetPadding(asset), (value) => updateAssetSpacing(asset.id, { padding: value }), { step: 1 }),
      ),
      createControlRow(
        "Bleed",
        createNumberInput(assetBleed(asset), (value) => updateAssetSpacing(asset.id, { bleed: value }), { step: 1 }),
      ),
    );
    grid.append(spacingPair);

    grid.append(
      createControlRow(
        "縮小倍率",
        createScaleSelect(placement.scale, (scale) => {
          if (placement.locked) return;
          setPlacementScale(placement, scale);
          clampPlacement(placement);
          renderAll();
          setSelected("placement", placement.id);
          pushHistory();
        }, { disabled: placement.locked }),
      ),
    );

    const actions = document.createElement("div");
    actions.className = "actionRow";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "danger";
    removeButton.textContent = "アトラスから外す";
    removeButton.addEventListener("click", () => removePlacement(placement.id));

    const sendBackButton = document.createElement("button");
    sendBackButton.type = "button";
    sendBackButton.textContent = "背面へ";
    sendBackButton.addEventListener("click", () => {
      state.placements = state.placements.filter((item) => item.id !== placement.id);
      state.placements.unshift(placement);
      renderAll();
      setSelected("placement", placement.id);
      pushHistory();
    });

    const bringFrontButton = document.createElement("button");
    bringFrontButton.type = "button";
    bringFrontButton.textContent = "前面へ";
    bringFrontButton.addEventListener("click", () => {
      state.placements = state.placements.filter((item) => item.id !== placement.id);
      state.placements.push(placement);
      renderAll();
      setSelected("placement", placement.id);
      pushHistory();
    });

    actions.append(removeButton, sendBackButton, bringFrontButton);
    els.inspector.append(title, grid, actions);
  }

  function renderAll() {
    renderAssetList();
    renderInspector();
    renderCanvas();
    renderValidation();
  }

  function validationItems() {
    const items = [];
    const collisionIds = getCollisionIds({ exportOnly: true });

    if (!state.assets.length) {
      items.push({ level: "warn", title: "画像なし", detail: "画像を追加すると検証が始まります。" });
      return items;
    }

    if (!state.placements.length) {
      items.push({ level: "warn", title: "未配置", detail: "まだアトラス上に配置された画像がありません。" });
    }

    state.assets.forEach((asset) => {
      if (!asset.powerOfTwo) {
        items.push({ level: "warn", title: `${asset.name}: 2のべき乗ではありません`, detail: `${asset.width} x ${asset.height}` });
      }
      if (asset.hasAlpha && !asset.rawPreserved) {
        items.push({ level: "warn", title: `${asset.name}: 透明RGB保持なし`, detail: "PNG以外、または通常デコードのため透明部RGB保持は保証されません。" });
      }
      if (asset.hasHiddenRgb && asset.rawPreserved) {
        items.push({ level: "ok", title: `${asset.name}: 透明RGB保持`, detail: "α=0ピクセル内のRGBを保持しています。" });
      }
      if (assetPadding(asset) > 0 && assetBleed(asset) === 0) {
        items.push({ level: "warn", title: `${asset.name}: bleedなし`, detail: "mipmapでにじみが出る場合はbleedを2px以上にします。" });
      }
      if (assetBleed(asset) > 0 && assetBleed(asset) < 2) {
        items.push({ level: "warn", title: `${asset.name}: bleedが小さい`, detail: "mipmap向けには2px以上が目安です。" });
      }
      if (state.projectMode === "external" && !asset.externalPath) {
        items.push({ level: "error", title: `${asset.name}: 外部参照名なし`, detail: "外部参照保存には画像ファイル名が必要です。" });
      }
    });

    state.placements.forEach((placement) => {
      const asset = getAsset(placement.assetId);
      const rect = placementRect(placement);
      if (!isPlacementExportable(placement)) {
        items.push({ level: "warn", title: `${asset?.name || "配置"}: 退避中`, detail: "アトラス外にあるためPNG/JSON出力から外れます。" });
      }
      if (collisionIds.has(placement.id)) {
        items.push({ level: "error", title: `${asset?.name || "配置"}: 重なり`, detail: "ほかの配置と矩形が重なっています。" });
      }
      if (placement.locked) {
        items.push({ level: "ok", title: `${asset?.name || "配置"}: スロット固定`, detail: "位置と枠サイズを固定しています。" });
      }
    });

    if (!items.some((item) => item.level === "error" || item.level === "warn")) {
      items.push({ level: "ok", title: "問題なし", detail: "現在の配置に大きな警告はありません。" });
    }

    return items;
  }

  function renderValidation() {
    if (!els.validationList) return;
    els.validationList.innerHTML = "";
    validationItems().forEach((item) => {
      const row = document.createElement("div");
      row.className = `validationItem ${item.level}`;
      const title = document.createElement("strong");
      title.textContent = item.title;
      const detail = document.createElement("span");
      detail.textContent = item.detail;
      row.append(title, detail);
      els.validationList.append(row);
    });
  }

  function movePlacementTo(placement, x, y) {
    if (placement.locked) return false;
    const beforeX = placement.x;
    const beforeY = placement.y;
    placement.x = x;
    placement.y = y;
    clampPlacement(placement);
    return beforeX !== placement.x || beforeY !== placement.y;
  }

  function alignSelected(axis) {
    const placements = selectedPlacements();
    if (placements.length < 2) {
      setStatus("整列するには2つ以上の配置を選択してください。");
      return;
    }
    const rects = placements.map((placement) => ({ placement, rect: placementRect(placement) }));
    const target = axis === "x" ? Math.min(...rects.map((item) => item.rect.x)) : Math.min(...rects.map((item) => item.rect.y));
    let changed = false;
    rects.forEach(({ placement }) => {
      if (axis === "x") changed = movePlacementTo(placement, target, placement.y) || changed;
      else changed = movePlacementTo(placement, placement.x, target) || changed;
    });
    if (changed) {
      renderAll();
      pushHistory();
      setStatus(axis === "x" ? "左揃えしました。" : "上揃えしました。");
    }
  }

  function distributeSelected(axis) {
    const placements = selectedPlacements();
    if (placements.length < 3) {
      setStatus("分布するには3つ以上の配置を選択してください。");
      return;
    }

    const items = placements
      .map((placement) => ({ placement, rect: placementRect(placement) }))
      .sort((a, b) => (axis === "x" ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));
    const first = items[0].rect;
    const last = items[items.length - 1].rect;
    const totalSize = items.reduce((sum, item) => sum + (axis === "x" ? item.rect.width : item.rect.height), 0);
    const span = axis === "x" ? last.x + last.width - first.x : last.y + last.height - first.y;
    const gap = (span - totalSize) / (items.length - 1);

    let cursor = axis === "x" ? first.x : first.y;
    let changed = false;
    items.forEach(({ placement, rect }) => {
      if (axis === "x") changed = movePlacementTo(placement, snapValue(cursor), placement.y) || changed;
      else changed = movePlacementTo(placement, placement.x, snapValue(cursor)) || changed;
      cursor += (axis === "x" ? rect.width : rect.height) + gap;
    });

    if (changed) {
      renderAll();
      pushHistory();
      setStatus(axis === "x" ? "横方向に分布しました。" : "縦方向に分布しました。");
    }
  }

  function copyAtlasPixel(pixels, atlasWidth, fromX, fromY, toX, toY) {
    if (fromX < 0 || fromY < 0 || toX < 0 || toY < 0 || fromX >= atlasWidth || toX >= atlasWidth) return;
    if (fromY >= state.atlasSize || toY >= state.atlasSize) return;
    const from = (fromY * atlasWidth + fromX) * 4;
    const to = (toY * atlasWidth + toX) * 4;
    pixels[to] = pixels[from];
    pixels[to + 1] = pixels[from + 1];
    pixels[to + 2] = pixels[from + 2];
    pixels[to + 3] = pixels[from + 3];
  }

  function sampleSourcePixel(asset, sx, sy, channel) {
    const x = clamp(sx, 0, asset.width - 1);
    const y = clamp(sy, 0, asset.height - 1);
    return asset.pixels[(y * asset.width + x) * 4 + channel];
  }

  function drawScaledPixels(pixels, atlasWidth, asset, x, y, width, height) {
    const scaleX = asset.width / width;
    const scaleY = asset.height / height;

    for (let py = 0; py < height; py += 1) {
      const sy = (py + 0.5) * scaleY - 0.5;
      const y0 = clamp(Math.floor(sy), 0, asset.height - 1);
      const y1 = clamp(y0 + 1, 0, asset.height - 1);
      const wy = clamp(sy - y0, 0, 1);

      for (let px = 0; px < width; px += 1) {
        const dx = x + px;
        const dy = y + py;
        if (dx < 0 || dy < 0 || dx >= atlasWidth || dy >= state.atlasSize) continue;

        const sx = (px + 0.5) * scaleX - 0.5;
        const x0 = clamp(Math.floor(sx), 0, asset.width - 1);
        const x1 = clamp(x0 + 1, 0, asset.width - 1);
        const wx = clamp(sx - x0, 0, 1);
        const dst = (dy * atlasWidth + dx) * 4;

        for (let channel = 0; channel < 4; channel += 1) {
          const p00 = sampleSourcePixel(asset, x0, y0, channel);
          const p10 = sampleSourcePixel(asset, x1, y0, channel);
          const p01 = sampleSourcePixel(asset, x0, y1, channel);
          const p11 = sampleSourcePixel(asset, x1, y1, channel);
          const top = p00 * (1 - wx) + p10 * wx;
          const bottom = p01 * (1 - wx) + p11 * wx;
          pixels[dst + channel] = Math.round(top * (1 - wy) + bottom * wy);
        }
      }
    }
  }

  function applyBleedPixels(pixels, atlasWidth, content, bleed) {
    if (bleed <= 0) return;
    const left = content.x;
    const top = content.y;
    const right = content.x + content.width - 1;
    const bottom = content.y + content.height - 1;

    for (let offset = 1; offset <= bleed; offset += 1) {
      for (let x = left; x <= right; x += 1) {
        copyAtlasPixel(pixels, atlasWidth, x, top, x, top - offset);
        copyAtlasPixel(pixels, atlasWidth, x, bottom, x, bottom + offset);
      }

      for (let y = top; y <= bottom; y += 1) {
        copyAtlasPixel(pixels, atlasWidth, left, y, left - offset, y);
        copyAtlasPixel(pixels, atlasWidth, right, y, right + offset, y);
      }

      for (let cornerY = 1; cornerY <= bleed; cornerY += 1) {
        copyAtlasPixel(pixels, atlasWidth, left, top, left - offset, top - cornerY);
        copyAtlasPixel(pixels, atlasWidth, right, top, right + offset, top - cornerY);
        copyAtlasPixel(pixels, atlasWidth, left, bottom, left - offset, bottom + cornerY);
        copyAtlasPixel(pixels, atlasWidth, right, bottom, right + offset, bottom + cornerY);
      }
    }
  }

  function drawPlacementPixels(pixels, placement) {
    const asset = getAsset(placement.assetId);
    if (!asset?.pixels) return;
    const content = placementContentRect(placement);
    drawScaledPixels(pixels, state.atlasSize, asset, content.x, content.y, content.width, content.height);
    applyBleedPixels(pixels, state.atlasSize, content, Math.min(assetBleed(asset), content.padding));
  }

  function buildAtlasPixels() {
    const pixels = new Uint8Array(state.atlasSize * state.atlasSize * 4);
    exportablePlacements().forEach((placement) => drawPlacementPixels(pixels, placement));
    return pixels;
  }

  function downsamplePixels(source, width, height, factor) {
    if (factor === 1) return { pixels: source, width, height };
    const nextWidth = Math.max(1, Math.floor(width / factor));
    const nextHeight = Math.max(1, Math.floor(height / factor));
    const next = new Uint8Array(nextWidth * nextHeight * 4);

    for (let y = 0; y < nextHeight; y += 1) {
      for (let x = 0; x < nextWidth; x += 1) {
        const sum = [0, 0, 0, 0];
        let count = 0;
        for (let oy = 0; oy < factor; oy += 1) {
          for (let ox = 0; ox < factor; ox += 1) {
            const sx = x * factor + ox;
            const sy = y * factor + oy;
            if (sx >= width || sy >= height) continue;
            const offset = (sy * width + sx) * 4;
            sum[0] += source[offset];
            sum[1] += source[offset + 1];
            sum[2] += source[offset + 2];
            sum[3] += source[offset + 3];
            count += 1;
          }
        }
        const dst = (y * nextWidth + x) * 4;
        next[dst] = Math.round(sum[0] / count);
        next[dst + 1] = Math.round(sum[1] / count);
        next[dst + 2] = Math.round(sum[2] / count);
        next[dst + 3] = Math.round(sum[3] / count);
      }
    }

    return { pixels: next, width: nextWidth, height: nextHeight };
  }

  function pixelsForViewMode(source) {
    if (state.viewMode === "normal") return source;
    const output = new Uint8ClampedArray(source.length);

    for (let i = 0; i < source.length; i += 4) {
      const alpha = source[i + 3];
      if (state.viewMode === "alpha") {
        output[i] = alpha;
        output[i + 1] = alpha;
        output[i + 2] = alpha;
        output[i + 3] = 255;
      } else if (state.viewMode === "hiddenRgb") {
        if (alpha === 0 && (source[i] || source[i + 1] || source[i + 2])) {
          output[i] = source[i];
          output[i + 1] = source[i + 1];
          output[i + 2] = source[i + 2];
          output[i + 3] = 255;
        } else {
          const dim = Math.max(32, Math.round(alpha * 0.35));
          output[i] = dim;
          output[i + 1] = dim;
          output[i + 2] = dim;
          output[i + 3] = 255;
        }
      }
    }

    return output;
  }

  function drawPreviewPixels(targetCtx) {
    const source = buildAtlasPixels();
    const mip = downsamplePixels(source, state.atlasSize, state.atlasSize, state.mipLevel);
    const viewPixels = pixelsForViewMode(mip.pixels);
    const preview = document.createElement("canvas");
    preview.width = mip.width;
    preview.height = mip.height;
    const previewCtx = preview.getContext("2d");
    previewCtx.putImageData(new ImageData(new Uint8ClampedArray(viewPixels), mip.width, mip.height), 0, 0);
    targetCtx.save();
    targetCtx.imageSmoothingEnabled = false;
    targetCtx.drawImage(preview, 0, 0, state.atlasSize, state.atlasSize);
    targetCtx.restore();
  }

  function drawExportCanvas() {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = state.atlasSize;
    exportCanvas.height = state.atlasSize;
    const exportCtx = exportCanvas.getContext("2d");
    exportCtx.clearRect(0, 0, state.atlasSize, state.atlasSize);

    exportablePlacements().forEach((placement) => {
      const asset = getAsset(placement.assetId);
      if (!asset) return;
      drawPlacementImage(exportCtx, placement);
    });

    return exportCanvas;
  }

  function downloadBlob(blob, filename) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  async function exportPng() {
    const placements = exportablePlacements();
    const stagedCount = state.placements.length - placements.length;
    if (!placements.length) {
      setStatus("PNG出力する配置がありません。退避中の画像はアトラス内へ移動してください。");
      return;
    }
    const collisions = getCollisionIds({ exportOnly: true });
    try {
      const pixels = buildAtlasPixels();
      const pngBytes = await encodePngRgba(state.atlasSize, state.atlasSize, pixels);
      downloadBlob(new Blob([pngBytes], { type: "image/png" }), `atlas_${state.atlasSize}.png`);
      setStatus(`PNGを書き出しました。透明ピクセル内のRGBも保持します。${stagedCount ? `退避中の${stagedCount}件は除外しました。` : ""}${collisions.size ? "重なりがあるため内容を確認してください。" : ""}`);
    } catch {
      const canvas = drawExportCanvas();
      canvas.toBlob((blob) => {
        if (!blob) {
          setStatus("PNG出力に失敗しました。");
          return;
        }
        downloadBlob(blob, `atlas_${state.atlasSize}.png`);
        setStatus(`PNGを書き出しました。このブラウザでは透明ピクセル内RGBの完全保持は保証されません。${stagedCount ? `退避中の${stagedCount}件は除外しました。` : ""}`);
      }, "image/png");
    }
  }

  function exportJson() {
    const placements = exportablePlacements();
    const stagedCount = state.placements.length - placements.length;
    if (!placements.length) {
      setStatus("JSON出力する配置がありません。退避中の画像はアトラス内へ移動してください。");
      return;
    }
    const payload = {
      atlas: {
        width: state.atlasSize,
        height: state.atlasSize,
        snap: SNAP,
        exportedAt: new Date().toISOString(),
      },
      images: placements.map((placement) => {
        const asset = getAsset(placement.assetId);
        const rect = placementRect(placement);
        const content = placementContentRect(placement);
        return {
          name: asset.name,
          x: placement.x,
          y: placement.y,
          width: rect.width,
          height: rect.height,
          contentX: content.x,
          contentY: content.y,
          contentWidth: content.width,
          contentHeight: content.height,
          scale: placement.scale,
          padding: assetPadding(asset),
          bleed: assetBleed(asset),
          alphaRgbPreserved: Boolean(asset.rawPreserved),
          sourceWidth: asset.width,
          sourceHeight: asset.height,
          uv: {
            u0: content.x / state.atlasSize,
            v0: content.y / state.atlasSize,
            u1: (content.x + content.width) / state.atlasSize,
            v1: (content.y + content.height) / state.atlasSize,
          },
          slotUv: {
            u0: placement.x / state.atlasSize,
            v0: placement.y / state.atlasSize,
            u1: (placement.x + rect.width) / state.atlasSize,
            v1: (placement.y + rect.height) / state.atlasSize,
          },
        };
      }),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(blob, `atlas_${state.atlasSize}.json`);
    setStatus(`JSONを書き出しました。${stagedCount ? `退避中の${stagedCount}件は除外しました。` : ""}`);
  }

  function saveProject() {
    const embedImages = state.projectMode !== "external";
    const snapshot = makeSnapshot({ embedImages });
    snapshot.savedAt = new Date().toISOString();
    snapshot.note = embedImages
      ? "Images are embedded as data URLs."
      : "Images are externally referenced. Select the referenced image files when loading this project.";
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    downloadBlob(blob, embedImages ? `atlas_project_${state.atlasSize}.json` : `atlas_project_external_${state.atlasSize}.json`);
    setStatus(embedImages ? "配置プロジェクトを書き出しました。" : "外部参照プロジェクトを書き出しました。");
  }

  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("File read failed."));
      reader.readAsText(file, "utf-8");
    });
  }

  async function loadProjectFile(file) {
    if (!file) return;
    try {
      const text = await readTextFile(file);
      const payload = JSON.parse(text);
      const needsExternalAssets = (payload.assets || []).some((asset) => !asset.dataUrl && !asset.url);
      if (needsExternalAssets) {
        state.pendingExternalProject = payload;
        els.loadProjectBtn.textContent = "参照画像選択";
        setStatus("外部参照プロジェクトです。参照画像ファイルを選択してください。");
        window.setTimeout(() => els.externalAssetInput.click(), 0);
        return;
      }
      await restoreSnapshot(payload);
      state.history = [makeSnapshot()];
      state.future = [];
      updateHistoryButtons();
      setStatus(`${file.name} を読み込みました。`);
    } catch (error) {
      setStatus(`プロジェクトを読み込めませんでした: ${error.message}`);
    }
  }

  function referenceKey(value) {
    return String(value || "")
      .split(/[\\/]/)
      .pop()
      .toLowerCase();
  }

  async function loadExternalProjectAssets(fileList) {
    if (!state.pendingExternalProject) return;
    const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
    const fileMap = new Map();
    files.forEach((file) => {
      fileMap.set(referenceKey(file.name), file);
      if (file.webkitRelativePath) fileMap.set(referenceKey(file.webkitRelativePath), file);
    });

    try {
      const payload = JSON.parse(JSON.stringify(state.pendingExternalProject));
      const missing = [];
      for (const asset of payload.assets || []) {
        if (asset.dataUrl || asset.url) continue;
        const file = fileMap.get(referenceKey(asset.externalPath)) || fileMap.get(referenceKey(asset.name));
        if (!file) {
          missing.push(asset.externalPath || asset.name);
          continue;
        }
        asset.dataUrl = await readFileAsDataUrl(file);
        asset.name = asset.name || file.name;
        asset.externalPath = file.webkitRelativePath || file.name;
      }

      if (missing.length) throw new Error(`参照画像が見つかりません: ${missing.join(", ")}`);

      await restoreSnapshot(payload);
      state.history = [makeSnapshot()];
      state.future = [];
      state.pendingExternalProject = null;
      els.loadProjectBtn.textContent = "プロジェクト読込";
      updateHistoryButtons();
      setStatus("外部参照プロジェクトを読み込みました。");
    } catch (error) {
      setStatus(`外部参照プロジェクトを読み込めませんでした: ${error.message}`);
    }
  }

  function onCanvasDrop(event) {
    event.preventDefault();
    els.canvasWrap.classList.remove("dragActive");
    const point = canvasPointFromEvent(event);
    const targetPlacement = hitTestPlacement(point);
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) {
      importFiles(files).then((added) => {
        let cursor = { x: point.x, y: point.y };
        added.forEach((asset, index) => {
          const placement =
            index === 0 && targetPlacement ? replacePlacementAsset(targetPlacement.id, asset.id) : createPlacement(asset.id, cursor);
          if (placement) {
            const rect = placementRect(placement);
            cursor = { x: placement.x + snapCeil(rect.width), y: placement.y };
          }
        });
      });
      return;
    }

    const assetId = event.dataTransfer.getData("application/x-atlas-asset") || event.dataTransfer.getData("text/plain");
    if (assetId) {
      if (targetPlacement) {
        replacePlacementAsset(targetPlacement.id, assetId);
      } else {
        createPlacement(assetId, point);
      }
    }
  }

  function bindEvents() {
    els.addImagesBtn.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", () => {
      importFiles(els.fileInput.files);
      els.fileInput.value = "";
    });

    els.atlasSizeSelect.addEventListener("change", () => setAtlasSize(Number(els.atlasSizeSelect.value)));
    els.zoomSelect.addEventListener("change", () => {
      const center = viewportCenterWorldPoint();
      state.zoom = Number(els.zoomSelect.value) / 100;
      applyZoom();
      window.requestAnimationFrame(() => scrollToWorldPoint(center));
    });
    els.viewModeSelect.addEventListener("change", () => {
      state.viewMode = els.viewModeSelect.value;
      renderCanvas();
      renderValidation();
    });
    els.mipSelect.addEventListener("change", () => {
      state.mipLevel = Number(els.mipSelect.value);
      renderCanvas();
      renderValidation();
    });
    els.projectModeSelect.addEventListener("change", () => {
      state.projectMode = els.projectModeSelect.value;
      renderValidation();
      setStatus(state.projectMode === "external" ? "外部参照モードで保存します。" : "画像埋め込みモードで保存します。");
    });
    els.fitZoomBtn.addEventListener("click", fitZoomToViewport);
    els.undoBtn.addEventListener("click", undo);
    els.redoBtn.addEventListener("click", redo);
    els.alignLeftBtn.addEventListener("click", () => alignSelected("x"));
    els.alignTopBtn.addEventListener("click", () => alignSelected("y"));
    els.distributeXBtn.addEventListener("click", () => distributeSelected("x"));
    els.distributeYBtn.addEventListener("click", () => distributeSelected("y"));
    els.packBtn.addEventListener("click", autoPackUnplaced);
    els.saveProjectBtn.addEventListener("click", saveProject);
    els.loadProjectBtn.addEventListener("click", () => {
      if (state.pendingExternalProject) els.externalAssetInput.click();
      else els.projectInput.click();
    });
    els.projectInput.addEventListener("change", () => {
      loadProjectFile(els.projectInput.files[0]);
      els.projectInput.value = "";
    });
    els.externalAssetInput.addEventListener("change", () => {
      loadExternalProjectAssets(els.externalAssetInput.files);
      els.externalAssetInput.value = "";
    });
    els.exportPngBtn.addEventListener("click", exportPng);
    els.exportJsonBtn.addEventListener("click", exportJson);

    els.assetDropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      els.assetDropZone.classList.add("dragActive");
    });
    els.assetDropZone.addEventListener("dragleave", () => els.assetDropZone.classList.remove("dragActive"));
    els.assetDropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      els.assetDropZone.classList.remove("dragActive");
      importFiles(event.dataTransfer.files);
    });

    els.canvas.addEventListener("dragover", (event) => {
      event.preventDefault();
      els.canvasWrap.classList.add("dragActive");
    });
    els.canvas.addEventListener("dragleave", () => els.canvasWrap.classList.remove("dragActive"));
    els.canvas.addEventListener("drop", onCanvasDrop);

    els.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const point = canvasPointFromEvent(event);
      const placement = hitTestPlacement(point);
      if (!placement) {
        setSelected(null, null);
        state.panDrag = {
          startClientX: event.clientX,
          startClientY: event.clientY,
          startScrollLeft: els.stageViewport.scrollLeft,
          startScrollTop: els.stageViewport.scrollTop,
          moved: false,
        };
        els.canvasWrap.classList.add("panning");
        els.canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
      const rect = placementRect(placement);
      setSelected("placement", placement.id, { toggle: event.shiftKey || event.ctrlKey || event.metaKey });
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (placement.locked) {
        setStatus("このスロットは固定されています。");
        return;
      }
      state.pointerDrag = {
        placementId: placement.id,
        offsetX: point.x - rect.x,
        offsetY: point.y - rect.y,
        startX: placement.x,
        startY: placement.y,
      };
      els.canvasWrap.classList.add("dragging");
      els.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    els.canvas.addEventListener("pointermove", (event) => {
      if (state.panDrag) {
        const dx = event.clientX - state.panDrag.startClientX;
        const dy = event.clientY - state.panDrag.startClientY;
        els.stageViewport.scrollLeft = state.panDrag.startScrollLeft - dx;
        els.stageViewport.scrollTop = state.panDrag.startScrollTop - dy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.panDrag.moved = true;
        return;
      }
      if (!state.pointerDrag) return;
      const placement = getPlacement(state.pointerDrag.placementId);
      if (!placement) return;
      const point = canvasPointFromEvent(event);
      placement.x = point.x - state.pointerDrag.offsetX;
      placement.y = point.y - state.pointerDrag.offsetY;
      clampPlacement(placement);
      renderCanvas();
      renderInspector();
      renderAssetList();
    });

    els.canvas.addEventListener("pointerup", (event) => {
      if (state.panDrag) {
        const moved = state.panDrag.moved;
        state.panDrag = null;
        els.canvasWrap.classList.remove("panning");
        try {
          els.canvas.releasePointerCapture(event.pointerId);
        } catch {
          // The pointer may already be released by the browser.
        }
        if (moved) setStatus("視点を移動しました。");
        return;
      }
      if (!state.pointerDrag) return;
      const drag = state.pointerDrag;
      const placement = getPlacement(drag.placementId);
      state.pointerDrag = null;
      els.canvasWrap.classList.remove("dragging");
      try {
        els.canvas.releasePointerCapture(event.pointerId);
      } catch {
        // The pointer may already be released by the browser.
      }
      if (placement) {
        setSelected("placement", placement.id);
        setStatus(isPlacementExportable(placement) ? `配置を ${placement.x}, ${placement.y} に移動しました。` : "配置を退避スペースに移動しました。");
        if (drag.startX !== placement.x || drag.startY !== placement.y) pushHistory();
      }
    });

    els.canvas.addEventListener("pointercancel", (event) => {
      state.panDrag = null;
      state.pointerDrag = null;
      els.canvasWrap.classList.remove("panning", "dragging");
      try {
        els.canvas.releasePointerCapture(event.pointerId);
      } catch {
        // The pointer may already be released by the browser.
      }
    });

    window.addEventListener("keydown", (event) => {
      const activeTag = document.activeElement?.tagName;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && activeTag !== "INPUT" && activeTag !== "SELECT") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y" && activeTag !== "INPUT" && activeTag !== "SELECT") {
        event.preventDefault();
        redo();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && state.selected?.type === "placement") {
        if (activeTag === "INPUT" || activeTag === "SELECT") return;
        removePlacement(state.selected.id);
      }
    });
  }

  bindEvents();
  setAtlasSize(2048, false);
  pushHistory();
  window.requestAnimationFrame(fitZoomToViewport);
})();
