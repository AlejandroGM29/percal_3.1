// PERCAL JS Core - generador puro en JavaScript
// Enfoque:
// 1) generar números por carta
// 2) renderizar cartas individuales
// 3) renderizar pliegos / canvas grandes para imprenta
// 4) exportar individuales o ZIP
//
// IDs de imágenes: 1..54

export const IMAGE_COUNT = 54;
export const CELLS_PER_CARD = 16;
export const CARDS_PER_TETRA = 4;

// CDN de respaldo para JSZip.
// Si ya cargas JSZip por <script>, también funciona.
const JSZIP_CDN_ESM = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";
let jsZipModulePromise = null;

// Tamaños finales de carta solicitados.
export const CARD_SIZES = {
  1: { width: 212, height: 360, cm: "9.5 x 5.6" },
  2: { width: 272, height: 367, cm: "9.7 x 7.2" },
  3: { width: 316, height: 396, cm: "10.5 x 8.4" },
  4: { width: 302, height: 454, cm: "12.0 x 8.0" },
  5: { width: 332, height: 516, cm: "13.7 x 8.6" },
  6: { width: 436, height: 700, cm: "18.5 x 11.5" },
};

// Rutas configurables por tamaño.
export const IMAGE_FOLDERS = {
  1: "Loteria/Tamaño1/",
  2: "Loteria/Tamaño2/",
  3: "Loteria/Tamaño3/",
  4: "Loteria/Tamano4/",
  5: "Loteria/Tamaño5/",
  6: "Loteria/Tamaño6/",
};

// Patrones heredados del sistema C#.
// Índices 0-based dentro de una carta 4x4:
//  0  1  2  3
//  4  5  6  7
//  8  9 10 11
// 12 13 14 15
export const DOUBLE_PATTERNS = [
  [0, 15], // esquinas diagonal
  [3, 12], // esquinas diagonal
  [5, 6],
  [5, 10],
  [6, 9],
];

export const MODES = Object.freeze({
  BASICA: "basica",
  TETRA: "tetra",
  BASICA_DOBLE: "basicaDoble",
  TETRA_DOBLE: "tetraDoble",
  BASICA_DOBLE_PLUS: "basicaDoblePlus",
  TETRA_DOBLE_PLUS: "tetraDoblePlus",
});

export const EXPORT_MODES = Object.freeze({
  INDIVIDUAL: "individual",
  SHEETS: "sheets",
});

export function makeRng(seed = cryptoRandomSeed()) {
  // Mulberry32: determinista si pasas seed; útil para reproducir resultados.
  let t = seed >>> 0;
  const rng = () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  rng.seed = seed >>> 0;
  return rng;
}

function cryptoRandomSeed() {
  const arr = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(arr);
  return arr[0] || Math.floor(Math.random() * 2 ** 32);
}

function range(start, endInclusive) {
  return Array.from({ length: endInclusive - start + 1 }, (_, i) => start + i);
}

function randInt(rng, minInclusive, maxInclusive) {
  return Math.floor(rng() * (maxInclusive - minInclusive + 1)) + minInclusive;
}

function shuffle(values, rng) {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function emptyCard() {
  return Array(CELLS_PER_CARD).fill(null);
}

function imageDeck() {
  return range(1, IMAGE_COUNT);
}

function allowedPatternIds(activeCorners) {
  // Equivale al código viejo: si no hay esquinas, usa solo 2,3,4.
  return activeCorners ? [0, 1, 2, 3, 4] : [2, 3, 4];
}

function choosePatternId(activeCorners, rng) {
  const ids = allowedPatternIds(activeCorners);
  return ids[randInt(rng, 0, ids.length - 1)];
}

function placeDouble(card, imageId, patternId) {
  const [a, b] = DOUBLE_PATTERNS[patternId];
  card[a] = imageId;
  card[b] = imageId;
}

function fillCardUnique(card, rng, excluded = new Set()) {
  const pool = shuffle(
    imageDeck().filter((n) => !excluded.has(n) && !card.includes(n)),
    rng
  );

  let p = 0;
  for (let i = 0; i < card.length; i++) {
    if (card[i] === null) card[i] = pool[p++];
  }

  return card;
}

function distributeReservePositions(cards, countsByCard, rng) {
  const positions = [];

  cards.forEach((card, cardIndex) => {
    const available = card
      .map((value, cellIndex) => ({ value, cellIndex }))
      .filter((x) => x.value === null)
      .map((x) => x.cellIndex);

    const chosen = shuffle(available, rng).slice(0, countsByCard[cardIndex]);

    for (const cellIndex of chosen) {
      positions.push({ cardIndex, cellIndex });
      card[cellIndex] = "__RESERVED__";
    }
  });

  return positions;
}

function fillTetraGroup(cards, rng, doubleIds = []) {
  const doubleIdSet = new Set(doubleIds);
  const reserveCounts = shuffle([2, 2, 1, 1], rng); // 6 espacios sobrantes como Tetra Doble.
  const reserved = distributeReservePositions(cards, reserveCounts, rng);

  const basePool = shuffle(imageDeck().filter((n) => !doubleIdSet.has(n)), rng);
  let p = 0;

  // Llena 50 espacios con las imágenes restantes, una sola vez en el grupo.
  for (const card of cards) {
    for (let i = 0; i < card.length; i++) {
      if (card[i] === null) card[i] = basePool[p++];
    }
  }

  // Llena los 6 sobrantes. No duplica dentro de la misma carta.
  // Sí puede repetir una imagen que ya exista en otra carta del grupo.
  const extraUsed = new Set();
  for (const { cardIndex, cellIndex } of reserved) {
    const card = cards[cardIndex];
    const options = imageDeck().filter((n) => !card.includes(n) && !extraUsed.has(n));
    const chosen = options[randInt(rng, 0, options.length - 1)];
    card[cellIndex] = chosen;
    extraUsed.add(chosen);
  }

  return cards;
}

function fillRegularTetraGroup(cards, rng) {
  const reserveCounts = shuffle([3, 3, 2, 2], rng); // 10 sobrantes en Tetra normal.
  const reserved = distributeReservePositions(cards, reserveCounts, rng);

  const basePool = shuffle(imageDeck(), rng);
  let p = 0;

  for (const card of cards) {
    for (let i = 0; i < card.length; i++) {
      if (card[i] === null) card[i] = basePool[p++];
    }
  }

  const extraUsed = new Set();
  for (const { cardIndex, cellIndex } of reserved) {
    const card = cards[cardIndex];
    const options = imageDeck().filter((n) => !card.includes(n) && !extraUsed.has(n));
    const chosen = options[randInt(rng, 0, options.length - 1)];
    card[cellIndex] = chosen;
    extraUsed.add(chosen);
  }

  return cards;
}

// =====================
// Generadores
// =====================

export function generateBasica({ seed } = {}) {
  const rng = makeRng(seed);
  const card = emptyCard();
  const pool = shuffle(imageDeck(), rng);

  for (let i = 0; i < CELLS_PER_CARD; i++) {
    card[i] = pool[i];
  }

  return { mode: MODES.BASICA, seed: rng.seed, cards: [card] };
}

export function generateTetra({ seed } = {}) {
  const rng = makeRng(seed);
  const cards = Array.from({ length: CARDS_PER_TETRA }, emptyCard);
  fillRegularTetraGroup(cards, rng);

  return { mode: MODES.TETRA, seed: rng.seed, cards };
}

export function generateBasicaDoble({ activeCorners = false, seed } = {}) {
  const rng = makeRng(seed);
  const card = emptyCard();
  const doubleId = randInt(rng, 1, IMAGE_COUNT);
  const patternId = choosePatternId(activeCorners, rng);

  placeDouble(card, doubleId, patternId);
  fillCardUnique(card, rng, new Set([doubleId]));

  return {
    mode: MODES.BASICA_DOBLE,
    seed: rng.seed,
    cards: [card],
    meta: [{ doubleId, patternId, pattern: DOUBLE_PATTERNS[patternId] }],
  };
}

export function generateTetraDoble({ activeCorners = false, seed } = {}) {
  const rng = makeRng(seed);
  const cards = Array.from({ length: CARDS_PER_TETRA }, emptyCard);
  const doubleIds = shuffle(imageDeck(), rng).slice(0, 4);

  const patternIds = activeCorners
    ? shuffle([0, 1, 2, 3, 4], rng).slice(0, 4)
    : shuffle([2, 2, 3, 4], rng);

  cards.forEach((card, i) => placeDouble(card, doubleIds[i], patternIds[i]));
  fillTetraGroup(cards, rng, doubleIds);

  return {
    mode: MODES.TETRA_DOBLE,
    seed: rng.seed,
    cards,
    meta: cards.map((_, i) => ({
      doubleId: doubleIds[i],
      patternId: patternIds[i],
      pattern: DOUBLE_PATTERNS[patternIds[i]],
    })),
  };
}

export function generateBasicaDoblePlus({ activeCorners = false, seed } = {}) {
  const rng = makeRng(seed);
  const cards = [];
  const meta = [];

  for (const doubleId of imageDeck()) {
    const card = emptyCard();
    const patternId = choosePatternId(activeCorners, rng);
    placeDouble(card, doubleId, patternId);
    fillCardUnique(card, rng, new Set([doubleId]));
    cards.push(card);
    meta.push({ doubleId, patternId, pattern: DOUBLE_PATTERNS[patternId] });
  }

  return { mode: MODES.BASICA_DOBLE_PLUS, seed: rng.seed, cards, meta };
}

export function generateTetraDoblePlus({ activeCorners = false, seed } = {}) {
  const rng = makeRng(seed);
  const cards = [];
  const meta = [];

  const doubleIdsByCard = makeTetraDoublePlusDoubleIds(rng);

  for (let groupIndex = 0; groupIndex < 14; groupIndex++) {
    const groupCards = Array.from({ length: CARDS_PER_TETRA }, emptyCard);
    const groupDoubleIds = doubleIdsByCard.slice(groupIndex * 4, groupIndex * 4 + 4);
    const patternIds = activeCorners
      ? shuffle([0, 1, 2, 3, 4], rng).slice(0, 4)
      : shuffle([2, 2, 3, 4], rng);

    groupCards.forEach((card, i) => {
      const doubleId = groupDoubleIds[i];
      const patternId = patternIds[i];
      placeDouble(card, doubleId, patternId);
      meta.push({
        groupIndex,
        doubleId,
        patternId,
        pattern: DOUBLE_PATTERNS[patternId],
      });
    });

    fillTetraGroup(groupCards, rng, groupDoubleIds);
    cards.push(...groupCards);
  }

  return { mode: MODES.TETRA_DOBLE_PLUS, seed: rng.seed, cards, meta };
}

function makeTetraDoublePlusDoubleIds(rng) {
  // 54 dobles + 2 cartas sobrantes con doble aleatorio = 56 cartas.
  // Se reintenta hasta que cada grupo de 4 tenga dobles únicos.
  for (let attempt = 0; attempt < 2000; attempt++) {
    const extras = [randInt(rng, 1, IMAGE_COUNT), randInt(rng, 1, IMAGE_COUNT)];
    const candidate = shuffle([...imageDeck(), ...extras], rng);
    let ok = true;

    for (let i = 0; i < candidate.length; i += 4) {
      const chunk = candidate.slice(i, i + 4);
      if (new Set(chunk).size !== 4) {
        ok = false;
        break;
      }
    }

    if (ok) return candidate;
  }

  throw new Error(
    "No se pudo generar Tetra Doble Plus con grupos únicos. Reintenta con otra semilla."
  );
}

export function generatePercal(mode, options = {}) {
  switch (mode) {
    case MODES.BASICA:
      return generateBasica(options);
    case MODES.TETRA:
      return generateTetra(options);
    case MODES.BASICA_DOBLE:
      return generateBasicaDoble(options);
    case MODES.TETRA_DOBLE:
      return generateTetraDoble(options);
    case MODES.BASICA_DOBLE_PLUS:
      return generateBasicaDoblePlus(options);
    case MODES.TETRA_DOBLE_PLUS:
      return generateTetraDoblePlus(options);
    default:
      throw new Error(`Modo no soportado: ${mode}`);
  }
}

// =====================
// Rutas / archivos
// =====================

export function defaultImageUrl(imageId, sizeId, extension = "jpg") {
  const folder = IMAGE_FOLDERS[sizeId];

  if (!folder) {
    throw new Error(`Tamaño no configurado: ${sizeId}`);
  }

  const sizesWithoutLeadingZero = [2, 3];
  const fileNumber = sizesWithoutLeadingZero.includes(Number(sizeId))
    ? String(imageId)
    : String(imageId).padStart(2, "0");

  return `${folder}${fileNumber}.${extension}`;
}
function makeCardFilename(mode, index) {
  return `${mode}_${String(index).padStart(3, "0")}.png`;
}

function makeSheetFilename(mode, index) {
  return `${mode}_pliego_${String(index).padStart(3, "0")}.png`;
}

// =====================
// Carga de imágenes
// =====================

function loadImage(srcOrImage) {
  if (srcOrImage instanceof HTMLImageElement || srcOrImage instanceof ImageBitmap) {
    return Promise.resolve(srcOrImage);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar imagen: ${srcOrImage}`));
    img.src = srcOrImage;
  });
}

function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo convertir canvas a blob."));
    }, type, quality);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

// =====================
// Render individual
// =====================

export async function renderCardToCanvas({
  card,
  sizeId = 1,
  imageResolver = defaultImageUrl,
  background = "white",
}) {
  const size = CARD_SIZES[sizeId];
  if (!size) throw new Error(`Tamaño inválido: ${sizeId}`);
  if (!Array.isArray(card) || card.length !== CELLS_PER_CARD) {
    throw new Error("Una carta debe tener exactamente 16 espacios.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cellW = size.width / 4;
  const cellH = size.height / 4;

  for (let i = 0; i < card.length; i++) {
    const imageId = card[i];
    const img = await loadImage(await imageResolver(imageId, sizeId, i));
    const col = i % 4;
    const row = Math.floor(i / 4);
    ctx.drawImage(img, col * cellW, row * cellH, cellW, cellH);
  }

  return canvas;
}

export async function renderCardToBlob(args, type = "image/png", quality) {
  const canvas = await renderCardToCanvas(args);
  return await canvasToBlob(canvas, type, quality);
}

export async function renderSetToBlobs({
  result,
  sizeId = 1,
  imageResolver = defaultImageUrl,
  type = "image/png",
  quality,
}) {
  const files = [];

  for (let i = 0; i < result.cards.length; i++) {
    const blob = await renderCardToBlob(
      {
        card: result.cards[i],
        sizeId,
        imageResolver,
      },
      type,
      quality
    );

    files.push({
      index: i + 1,
      filename: makeCardFilename(result.mode, i + 1),
      blob,
      numbers: result.cards[i],
      meta: result.meta?.[i] ?? null,
    });
  }

  return files;
}

// =====================
// Render pliegos / canvas grande
// =====================

function guessBestColumns(count, cardAspectRatio) {
  if (count <= 1) return 1;

  let best = 1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const ratio = (cols * cardAspectRatio) / rows;
    const score = Math.abs(ratio - 1.4); // ligeramente horizontal para imprenta
    if (score < bestScore) {
      bestScore = score;
      best = cols;
    }
  }

  return best;
}

function normalizeSheetGrid({ count, columns, rows, cardWidth, cardHeight }) {
  if (count <= 0) throw new Error("Debe haber al menos una carta para crear un pliego.");

  const aspectRatio = cardWidth / cardHeight;

  if (!columns && !rows) {
    columns = guessBestColumns(count, aspectRatio);
    rows = Math.ceil(count / columns);
    return { columns, rows };
  }

  if (columns && !rows) {
    rows = Math.ceil(count / columns);
    return { columns, rows };
  }

  if (!columns && rows) {
    columns = Math.ceil(count / rows);
    return { columns, rows };
  }

  if (columns * rows < count) {
    throw new Error("La cuadrícula definida no alcanza para la cantidad de cartas.");
  }

  return { columns, rows };
}

function drawCutGuides(
  ctx,
  x,
  y,
  w,
  h,
  {
    length = 12,
    lineWidth = 1,
    color = "rgba(0,0,0,0.65)",
    offset = 4,
  } = {}
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  // Top-left
  ctx.beginPath();
  ctx.moveTo(x - offset - length, y - offset);
  ctx.lineTo(x - offset, y - offset);
  ctx.moveTo(x - offset, y - offset - length);
  ctx.lineTo(x - offset, y - offset);
  ctx.stroke();

  // Top-right
  ctx.beginPath();
  ctx.moveTo(x + w + offset, y - offset);
  ctx.lineTo(x + w + offset + length, y - offset);
  ctx.moveTo(x + w + offset, y - offset - length);
  ctx.lineTo(x + w + offset, y - offset);
  ctx.stroke();

  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(x - offset - length, y + h + offset);
  ctx.lineTo(x - offset, y + h + offset);
  ctx.moveTo(x - offset, y + h + offset);
  ctx.lineTo(x - offset, y + h + offset + length);
  ctx.stroke();

  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(x + w + offset, y + h + offset);
  ctx.lineTo(x + w + offset + length, y + h + offset);
  ctx.moveTo(x + w + offset, y + h + offset);
  ctx.lineTo(x + w + offset, y + h + offset + length);
  ctx.stroke();

  ctx.restore();
}

export async function renderSheetToCanvas({
  cards,
  sizeId = 1,
  imageResolver = defaultImageUrl,
  background = "white",
  cardsPerSheet = 8,
  columns,
  rows,
  gap = 16,
  padding = 20,

  // Si los pones, las cartas se escalan para caber en este tamaño.
  // Si no los pones, el pliego crece según el número de cartas.
  sheetWidth = null,
  sheetHeight = null,

  // Guías de corte
  showCutGuides = true,
  cutGuideLength = 12,
  cutGuideOffset = 4,
  cutGuideLineWidth = 1,
  cutGuideColor = "rgba(0,0,0,0.65)",
}) {
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error("Debes pasar al menos una carta para renderizar un pliego.");
  }

  const limitedCards = cards.slice(0, cardsPerSheet);
  const baseCardSize = CARD_SIZES[sizeId];
  if (!baseCardSize) throw new Error(`Tamaño inválido: ${sizeId}`);

  const grid = normalizeSheetGrid({
    count: limitedCards.length,
    columns,
    rows,
    cardWidth: baseCardSize.width,
    cardHeight: baseCardSize.height,
  });

  const sourceW = baseCardSize.width;
  const sourceH = baseCardSize.height;

  let drawW = sourceW;
  let drawH = sourceH;
  let finalSheetWidth;
  let finalSheetHeight;

  if (sheetWidth && sheetHeight) {
    const availableW = sheetWidth - padding * 2 - gap * (grid.columns - 1);
    const availableH = sheetHeight - padding * 2 - gap * (grid.rows - 1);

    if (availableW <= 0 || availableH <= 0) {
      throw new Error("El tamaño del pliego es muy pequeño para el padding/gap configurados.");
    }

    const maxCardW = availableW / grid.columns;
    const maxCardH = availableH / grid.rows;

    const scale = Math.min(maxCardW / sourceW, maxCardH / sourceH);
    if (scale <= 0) throw new Error("No se pudo calcular la escala del pliego.");

    drawW = Math.floor(sourceW * scale);
    drawH = Math.floor(sourceH * scale);

    finalSheetWidth = sheetWidth;
    finalSheetHeight = sheetHeight;
  } else {
    finalSheetWidth = Math.ceil(padding * 2 + grid.columns * drawW + (grid.columns - 1) * gap);
    finalSheetHeight = Math.ceil(padding * 2 + grid.rows * drawH + (grid.rows - 1) * gap);
  }

  const canvas = document.createElement("canvas");
  canvas.width = finalSheetWidth;
  canvas.height = finalSheetHeight;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const totalGridW = grid.columns * drawW + (grid.columns - 1) * gap;
  const totalGridH = grid.rows * drawH + (grid.rows - 1) * gap;

  const startX = Math.floor((finalSheetWidth - totalGridW) / 2);
  const startY = Math.floor((finalSheetHeight - totalGridH) / 2);

  for (let i = 0; i < limitedCards.length; i++) {
    const row = Math.floor(i / grid.columns);
    const col = i % grid.columns;

    const x = startX + col * (drawW + gap);
    const y = startY + row * (drawH + gap);

    const cardCanvas = await renderCardToCanvas({
      card: limitedCards[i],
      sizeId,
      imageResolver,
      background,
    });

    ctx.drawImage(cardCanvas, x, y, drawW, drawH);

    if (showCutGuides) {
      drawCutGuides(ctx, x, y, drawW, drawH, {
        length: cutGuideLength,
        offset: cutGuideOffset,
        lineWidth: cutGuideLineWidth,
        color: cutGuideColor,
      });
    }
  }

  return canvas;
}

export async function renderSheetToBlob(args, type = "image/png", quality) {
  const canvas = await renderSheetToCanvas(args);
  return await canvasToBlob(canvas, type, quality);
}

export async function renderSetToSheetBlobs({
  result,
  sizeId = 1,
  imageResolver = defaultImageUrl,
  cardsPerSheet = 8,
  columns,
  rows,
  gap = 16,
  padding = 20,
  sheetWidth = null,
  sheetHeight = null,
  showCutGuides = true,
  cutGuideLength = 12,
  cutGuideOffset = 4,
  cutGuideLineWidth = 1,
  cutGuideColor = "rgba(0,0,0,0.65)",
  background = "white",
  type = "image/png",
  quality,
}) {
  if (!result?.cards?.length) {
    throw new Error("No hay cartas en result para renderizar pliegos.");
  }

  if (!cardsPerSheet || cardsPerSheet < 1) {
    throw new Error("cardsPerSheet debe ser mayor o igual a 1.");
  }

  const files = [];
  const cardGroups = chunkArray(result.cards, cardsPerSheet);

  for (let i = 0; i < cardGroups.length; i++) {
    const group = cardGroups[i];

    const blob = await renderSheetToBlob(
      {
        cards: group,
        sizeId,
        imageResolver,
        cardsPerSheet,
        columns,
        rows,
        gap,
        padding,
        sheetWidth,
        sheetHeight,
        showCutGuides,
        cutGuideLength,
        cutGuideOffset,
        cutGuideLineWidth,
        cutGuideColor,
        background,
      },
      type,
      quality
    );

    files.push({
      index: i + 1,
      filename: makeSheetFilename(result.mode, i + 1),
      blob,
      cardCount: group.length,
      cards: group,
    });
  }

  return files;
}

// =====================
// ZIP
// =====================

async function getJSZip(JSZipLib) {
  if (JSZipLib) return JSZipLib;
  if (globalThis.JSZip) return globalThis.JSZip;

  if (!jsZipModulePromise) {
    jsZipModulePromise = import(JSZIP_CDN_ESM).then((m) => m.default || m.JSZip || m);
  }

  return await jsZipModulePromise;
}

export async function createZipBlobFromFiles({
  files,
  zipName = "percal_export.zip",
  folderName = "percal",
  compression = "DEFLATE",
  compressionOptions = { level: 6 },
  JSZipLib,
}) {
  if (!files || !files.length) {
    throw new Error("No hay archivos para meter al ZIP.");
  }

  const JSZipClass = await getJSZip(JSZipLib);
  const zip = new JSZipClass();

  const folder = folderName ? zip.folder(folderName) : zip;

  for (const file of files) {
    folder.file(file.filename, file.blob);
  }

  const blob = await zip.generateAsync({
    type: "blob",
    compression,
    compressionOptions,
  });

  return {
    blob,
    filename: zipName.endsWith(".zip") ? zipName : `${zipName}.zip`,
    count: files.length,
  };
}

export async function renderSetToZipBlob({
  result,
  sizeId = 1,
  imageResolver = defaultImageUrl,
  exportMode = EXPORT_MODES.INDIVIDUAL,

  // Opciones para pliegos
  cardsPerSheet = 8,
  columns,
  rows,
  gap = 16,
  padding = 20,
  sheetWidth = null,
  sheetHeight = null,
  showCutGuides = true,
  cutGuideLength = 12,
  cutGuideOffset = 4,
  cutGuideLineWidth = 1,
  cutGuideColor = "rgba(0,0,0,0.65)",

  background = "white",
  type = "image/png",
  quality,

  zipName = null,
  folderName = "percal",
  JSZipLib,
}) {
  let files;

  if (exportMode === EXPORT_MODES.SHEETS) {
    files = await renderSetToSheetBlobs({
      result,
      sizeId,
      imageResolver,
      cardsPerSheet,
      columns,
      rows,
      gap,
      padding,
      sheetWidth,
      sheetHeight,
      showCutGuides,
      cutGuideLength,
      cutGuideOffset,
      cutGuideLineWidth,
      cutGuideColor,
      background,
      type,
      quality,
    });
  } else {
    files = await renderSetToBlobs({
      result,
      sizeId,
      imageResolver,
      type,
      quality,
    });
  }

  const safeZipName =
    zipName ||
    `${result.mode}_${exportMode === EXPORT_MODES.SHEETS ? "pliegos" : "cartas"}.zip`;

  return await createZipBlobFromFiles({
    files,
    zipName: safeZipName,
    folderName,
    JSZipLib,
  });
}

export async function downloadRenderSetAsZip(options) {
  const { blob, filename } = await renderSetToZipBlob(options);
  downloadBlob(blob, filename);
  return { blob, filename };
}

// =====================
// Exportador inteligente
// =====================
//
// Si hay 1 archivo => descarga PNG directo
// Si hay varios => ZIP
//
// exportMode:
// - "individual" => cartas individuales
// - "sheets" => pliegos
//
export async function exportRenderSet({
  result,
  sizeId = 1,
  imageResolver = defaultImageUrl,
  exportMode = EXPORT_MODES.INDIVIDUAL,

  // Para pliegos
  cardsPerSheet = 8,
  columns,
  rows,
  gap = 16,
  padding = 20,
  sheetWidth = null,
  sheetHeight = null,
  showCutGuides = true,
  cutGuideLength = 12,
  cutGuideOffset = 4,
  cutGuideLineWidth = 1,
  cutGuideColor = "rgba(0,0,0,0.65)",

  background = "white",
  type = "image/png",
  quality,

  zipName = null,
  folderName = "percal",
  autoDownload = true,
  JSZipLib,
}) {
  let files;

  if (exportMode === EXPORT_MODES.SHEETS) {
    files = await renderSetToSheetBlobs({
      result,
      sizeId,
      imageResolver,
      cardsPerSheet,
      columns,
      rows,
      gap,
      padding,
      sheetWidth,
      sheetHeight,
      showCutGuides,
      cutGuideLength,
      cutGuideOffset,
      cutGuideLineWidth,
      cutGuideColor,
      background,
      type,
      quality,
    });
  } else {
    files = await renderSetToBlobs({
      result,
      sizeId,
      imageResolver,
      type,
      quality,
    });
  }

  if (files.length === 1) {
    if (autoDownload) {
      downloadBlob(files[0].blob, files[0].filename);
    }

    return {
      kind: "single",
      file: files[0],
      files,
    };
  }

  const zip = await createZipBlobFromFiles({
    files,
    zipName:
      zipName ||
      `${result.mode}_${exportMode === EXPORT_MODES.SHEETS ? "pliegos" : "cartas"}.zip`,
    folderName,
    JSZipLib,
  });

  if (autoDownload) {
    downloadBlob(zip.blob, zip.filename);
  }

  return {
    kind: "zip",
    zip,
    files,
  };
}

// =====================
// Ejemplos de uso
// =====================
//
// 1) Generar cartas:
//
// const result = generatePercal(MODES.TETRA_DOBLE_PLUS, {
//   activeCorners: false,
//   seed: 12345,
// });
//
// 2) Exportar individuales:
// await exportRenderSet({
//   result,
//   sizeId: 6,
//   exportMode: EXPORT_MODES.INDIVIDUAL,
// });
//
// 3) Exportar pliegos de 8 cartas:
// await exportRenderSet({
//   result,
//   sizeId: 6,
//   exportMode: EXPORT_MODES.SHEETS,
//   cardsPerSheet: 8,
//   columns: 2,
//   gap: 20,
//   padding: 30,
// });
//
// 4) Exportar pliegos ajustados a un canvas fijo:
// await exportRenderSet({
//   result,
//   sizeId: 6,
//   exportMode: EXPORT_MODES.SHEETS,
//   cardsPerSheet: 12,
//   columns: 3,
//   sheetWidth: 3000,
//   sheetHeight: 4200,
//   gap: 25,
//   padding: 40,
//   showCutGuides: true,
// });
//
// 5) Generar ZIP manualmente:
// const zip = await renderSetToZipBlob({
//   result,
//   sizeId: 6,
//   exportMode: EXPORT_MODES.INDIVIDUAL,
// });
// downloadBlob(zip.blob, zip.filename);