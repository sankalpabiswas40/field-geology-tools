// Planar attitudes: strike and dip using the right-hand rule (RHR).
// RHR: looking along the strike direction, the plane dips to your RIGHT,
// so dip direction = strike + 90°.
// Pure functions only: no browser code.

const DEG = Math.PI / 180;

/** Wraps any angle into 0 ≤ a < 360. */
export function normalizeAzimuth(a) {
  const r = ((a % 360) + 360) % 360;
  return r === 360 ? 0 : r; // guards against tiny negative values rounding up to 360
}

/** Dip direction (azimuth the plane dips towards) from an RHR strike. */
export function dipDirectionFromStrike(strike) {
  return normalizeAzimuth(strike + 90);
}

/** RHR strike from a dip direction. */
export function strikeFromDipDirection(dipDirection) {
  return normalizeAzimuth(dipDirection - 90);
}

/**
 * Reads a number typed by the user. Accepts a comma as decimal point (some iPad keyboards).
 * Returns null for an empty box and NaN for text that is not a number.
 */
export function parseNumber(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).trim().replace(',', '.');
  if (s === '') return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

/** Checks a typed strike. Returns { ok: true, value } (0 ≤ value < 360) or { ok: false, message }. */
export function checkStrike(text) {
  const v = parseNumber(text);
  if (v === null) return { ok: false, message: 'Strike is missing.' };
  if (Number.isNaN(v)) return { ok: false, message: `Strike "${text}" is not a number. Type it like 045.` };
  if (v < 0 || v > 360) {
    return { ok: false, message: `Strike ${v}° is not possible: it must be between 0° and 360°.` };
  }
  return { ok: true, value: normalizeAzimuth(v) }; // 360° is the same as 0°
}

/** Checks a typed dip. Returns { ok: true, value } (0–90) or { ok: false, message }. */
export function checkDip(text) {
  const v = parseNumber(text);
  if (v === null) return { ok: false, message: 'Dip is missing.' };
  if (Number.isNaN(v)) return { ok: false, message: `Dip "${text}" is not a number. Type it like 35.` };
  if (v < 0 || v > 90) {
    return {
      ok: false,
      message: `Dip ${v}° is not possible: dip must be between 0° (horizontal) and 90° (vertical).`,
    };
  }
  return { ok: true, value: v };
}

/** Formats an azimuth with three digits, e.g. 45 → "045", 7.5 → "007.5". */
export function formatAzimuth(a) {
  const text = Number.isInteger(a) ? String(a) : a.toFixed(1);
  const [whole, frac] = text.split('.');
  return whole.padStart(3, '0') + (frac ? `.${frac}` : '');
}

/** "045/30 (dip direction 135)" */
export function formatAttitude(strike, dip) {
  return `${formatAzimuth(strike)}/${dip} (dip direction ${formatAzimuth(dipDirectionFromStrike(strike))})`;
}

/**
 * Geometry of a map strike-and-dip symbol, in screen pixels (x to the right = east,
 * y downwards = south, because the map is north-up and Web Mercator keeps angles true).
 * - A long line along strike, centred on the station.
 * - A short tick from the centre towards the dip direction (to the right of strike, RHR).
 * - Vertical planes (dip 90°) get ticks on both sides.
 * - Horizontal planes (dip 0°) have no strike: shown as a circle with a cross.
 * Returns { kind, lines: [[x1, y1, x2, y2], ...], circle?, label: { x, y } }.
 */
export function strikeDipSymbol(strike, dip, { size = 44, strikeLength = 32, tickLength = 10 } = {}) {
  const c = size / 2;
  const round = (v) => Math.round(v * 100) / 100;
  const unit = (az) => ({ x: Math.sin(az * DEG), y: -Math.cos(az * DEG) });
  const seg = (x1, y1, x2, y2) => [round(x1), round(y1), round(x2), round(y2)];

  if (dip === 0) {
    const r = tickLength;
    return {
      kind: 'horizontal',
      circle: { cx: c, cy: c, r },
      lines: [seg(c, c - r, c, c + r), seg(c - r, c, c + r, c)],
      label: { x: round(c + r + 3), y: round(c - r) },
    };
  }

  const s = unit(strike);
  const d = unit(dipDirectionFromStrike(strike));
  const half = strikeLength / 2;
  const lines = [
    seg(c - s.x * half, c - s.y * half, c + s.x * half, c + s.y * half),
    seg(c, c, c + d.x * tickLength, c + d.y * tickLength),
  ];
  if (dip === 90) lines.push(seg(c, c, c - d.x * tickLength, c - d.y * tickLength));
  // Dip value is written just beyond the tick.
  const labelDist = tickLength + 7;
  return {
    kind: dip === 90 ? 'vertical' : 'inclined',
    lines,
    label: { x: round(c + d.x * labelDist), y: round(c + d.y * labelDist) },
  };
}
