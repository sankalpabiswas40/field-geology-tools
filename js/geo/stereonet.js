// Lower-hemisphere equal-area (Schmidt) stereonet: projection and SVG drawing.
// Pure functions only: no browser code. The SVG text is used both on screen and for export.

import { dipDirectionFromStrike, normalizeAzimuth, formatAzimuth } from './attitude.js';
import { lineVector } from './fold.js';

const DEG = Math.PI / 180;

/**
 * Equal-area projection of a line (trend, plunge in degrees) onto a net of radius 1.
 * Returns { x, y } with x to the east and y to the NORTH (up). Plunge 90° is the centre;
 * horizontal lines lie on the primitive circle. r = √2 · sin((90° − plunge) / 2).
 */
export function equalArea(trend, plunge) {
  const r = Math.SQRT2 * Math.sin(((90 - plunge) * DEG) / 2);
  return { x: r * Math.sin(trend * DEG), y: r * Math.cos(trend * DEG) };
}

/** Pole (normal) to a plane as a line: trend = dip direction + 180°, plunge = 90° − dip. */
export function poleOfPlane(strike, dip) {
  return { trend: normalizeAzimuth(dipDirectionFromStrike(strike) + 180), plunge: 90 - dip };
}

/** Points of a plane's great circle on the net (radius 1), from one end of strike to the other. */
export function greatCircle(strike, dip, steps = 90) {
  const s = lineVector(strike, 0);
  const d = lineVector(dipDirectionFromStrike(strike), dip);
  const pts = [];
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * Math.PI;
    const v = [Math.cos(a) * s[0] + Math.sin(a) * d[0], Math.cos(a) * s[1] + Math.sin(a) * d[1], Math.cos(a) * s[2] + Math.sin(a) * d[2]];
    const plunge = Math.asin(Math.min(1, Math.max(0, -v[2]))) / DEG;
    const trend = normalizeAzimuth(Math.atan2(v[0], v[1]) / DEG);
    pts.push(equalArea(trend, plunge));
  }
  return pts;
}

/** The plane perpendicular to a line (e.g. the π-girdle perpendicular to a fold axis), as strike/dip. */
export function planePerpendicularTo(trend, plunge) {
  const dipDirection = normalizeAzimuth(trend + 180);
  return { strike: normalizeAzimuth(dipDirection - 90), dip: 90 - plunge };
}

/** Splits text into lines of at most `max` characters, breaking between words. */
export function wrapText(text, max) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) { lines.push(line); line = word; } else { line = line ? `${line} ${word}` : word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * SVG of a stereonet.
 * data: {
 *   title, subtitle, lines of text for the notes underneath,
 *   poles: [{ trend, plunge, isTest }], planes: [{ strike, dip }] (great circles, optional),
 *   lineations: [{ trend, plunge, isTest }], axis: { trend, plunge } | null,
 *   girdle: { strike, dip } | null, meanLineation: { trend, plunge } | null
 * }
 */
export function stereonetSvg(data) {
  const R = 180;
  const cx = 220;
  const cy = 262;
  const notes = (data.notes || []).flatMap((line) => wrapText(line, 58));
  const height = cy + R + 50 + notes.length * 20;
  const P = (p) => ({ x: cx + p.x * R, y: cy - p.y * R });
  const f = (v) => v.toFixed(1);
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${f(P(p).x)},${f(P(p).y)}`).join('');
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 ${height}" width="440" height="${height}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="440" height="${height}" fill="#ffffff"/>`);
  out.push(`<text x="220" y="24" text-anchor="middle" font-size="17" font-weight="700" fill="#111">${esc(data.title || 'Stereonet')}</text>`);
  if (data.subtitle) out.push(`<text x="220" y="42" text-anchor="middle" font-size="12" fill="#444">${esc(data.subtitle)}</text>`);

  // Primitive circle, centre cross and N/E/S/W marks.
  out.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="#fff" stroke="#111" stroke-width="1.5"/>`);
  out.push(`<path d="M${cx - 6},${cy}H${cx + 6}M${cx},${cy - 6}V${cy + 6}" stroke="#888" stroke-width="1"/>`);
  for (let az = 0; az < 360; az += 10) {
    const a = az * DEG;
    const len = az % 90 === 0 ? 10 : 5;
    out.push(`<line x1="${f(cx + R * Math.sin(a))}" y1="${f(cy - R * Math.cos(a))}" x2="${f(cx + (R + len) * Math.sin(a))}" y2="${f(cy - (R + len) * Math.cos(a))}" stroke="#111" stroke-width="1"/>`);
  }
  out.push(`<text x="${cx}" y="${cy - R - 14}" text-anchor="middle" font-size="15" font-weight="700">N</text>`);
  out.push(`<text x="${cx + R + 16}" y="${cy + 5}" text-anchor="middle" font-size="15" font-weight="700">E</text>`);
  out.push(`<text x="${cx}" y="${cy + R + 26}" text-anchor="middle" font-size="15" font-weight="700">S</text>`);
  out.push(`<text x="${cx - R - 16}" y="${cy + 5}" text-anchor="middle" font-size="15" font-weight="700">W</text>`);

  for (const pl of data.planes || []) {
    out.push(`<path d="${path(greatCircle(pl.strike, pl.dip))}" fill="none" stroke="#6b7a8f" stroke-width="1"/>`);
  }
  if (data.girdle) {
    out.push(`<path d="${path(greatCircle(data.girdle.strike, data.girdle.dip))}" fill="none" stroke="#d62828" stroke-width="2" stroke-dasharray="7 5"/>`);
  }
  for (const p of data.poles || []) {
    const q = P(equalArea(p.trend, p.plunge));
    out.push(`<circle cx="${f(q.x)}" cy="${f(q.y)}" r="4.5" fill="${p.isTest ? '#ff00d4' : '#1d3557'}" stroke="#fff" stroke-width="1"/>`);
  }
  for (const l of data.lineations || []) {
    const q = P(equalArea(l.trend, l.plunge));
    out.push(`<path d="M${f(q.x)},${f(q.y - 6)}L${f(q.x + 5.5)},${f(q.y + 4)}L${f(q.x - 5.5)},${f(q.y + 4)}Z" fill="${l.isTest ? '#ff00d4' : '#2a9d8f'}" stroke="#111" stroke-width="0.8"/>`);
  }
  if (data.meanLineation) {
    const q = P(equalArea(data.meanLineation.trend, data.meanLineation.plunge));
    out.push(`<path d="M${f(q.x)},${f(q.y - 9)}L${f(q.x + 8)},${f(q.y + 6)}L${f(q.x - 8)},${f(q.y + 6)}Z" fill="none" stroke="#2a9d8f" stroke-width="2.5"/>`);
  }
  if (data.axis) {
    const q = P(equalArea(data.axis.trend, data.axis.plunge));
    out.push(`<rect x="${f(q.x - 7)}" y="${f(q.y - 7)}" width="14" height="14" fill="#d62828" stroke="#fff" stroke-width="1.5"/>`);
    out.push(`<text x="${f(q.x + 10)}" y="${f(q.y - 9)}" font-size="13" font-weight="700" fill="#d62828">${formatAzimuth(Math.round(data.axis.trend))}/${Math.round(data.axis.plunge)}</text>`);
  }
  notes.forEach((line, i) => {
    out.push(`<text x="16" y="${cy + R + 52 + i * 20}" font-size="13" fill="#111">${esc(line)}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}
