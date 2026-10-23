// Marching squares: finds where a grid of values crosses zero, as lines.
// Grid positions are (col, row) with (0, 0) at the centre of the top-left cell.
// Pure functions only: no browser code.

// Each square has corners tl (top-left), tr, br, bl. A corner is "inside" when its value ≥ 0.
// Case number = tl·8 + tr·4 + br·2 + bl·1. Edges: T(op), R(ight), B(ottom), L(eft).
// For each case, pairs of edges joined by a segment. Cases 5 and 10 are saddles,
// decided by the average of the four corners (see below).
const CASES = {
  0: [], 15: [],
  1: [['L', 'B']], 2: [['B', 'R']], 3: [['L', 'R']], 4: [['T', 'R']],
  6: [['T', 'B']], 7: [['L', 'T']], 8: [['L', 'T']], 9: [['T', 'B']],
  11: [['T', 'R']], 12: [['L', 'R']], 13: [['B', 'R']], 14: [['L', 'B']],
};
const SADDLE = {
  5: { inside: [['L', 'T'], ['B', 'R']], outside: [['T', 'R'], ['L', 'B']] },
  10: { inside: [['T', 'R'], ['L', 'B']], outside: [['L', 'T'], ['B', 'R']] },
};

// Where zero falls between two corner values. Always measured from the top/left corner,
// so the two squares that share an edge get exactly the same point (lines join up exactly).
const cross = (a, b) => a / (a - b);

/**
 * Segments for one band of squares between grid rows r and r + 1.
 * top, bottom: values along rows r and r + 1 (NaN = no data; squares touching NaN are skipped).
 * Calls emit(x1, y1, x2, y2) for each segment.
 */
export function contourBand(top, bottom, r, width, emit) {
  for (let c = 0; c < width - 1; c++) {
    const tl = top[c];
    const tr = top[c + 1];
    const bl = bottom[c];
    const br = bottom[c + 1];
    if (Number.isNaN(tl) || Number.isNaN(tr) || Number.isNaN(bl) || Number.isNaN(br)) continue;
    const k = (tl >= 0 ? 8 : 0) | (tr >= 0 ? 4 : 0) | (br >= 0 ? 2 : 0) | (bl >= 0 ? 1 : 0);
    let pairs = CASES[k];
    if (!pairs) pairs = (tl + tr + br + bl) / 4 >= 0 ? SADDLE[k].inside : SADDLE[k].outside;
    for (const [e1, e2] of pairs) {
      const p = edgePoint(e1, c, r, tl, tr, br, bl);
      const q = edgePoint(e2, c, r, tl, tr, br, bl);
      emit(p[0], p[1], q[0], q[1]);
    }
  }
}

function edgePoint(edge, c, r, tl, tr, br, bl) {
  switch (edge) {
    case 'T': return [c + cross(tl, tr), r];
    case 'B': return [c + cross(bl, br), r + 1];
    case 'L': return [c, r + cross(tl, bl)];
    default: return [c + 1, r + cross(tr, br)]; // 'R'
  }
}

/** All zero-crossing segments of a whole grid (row-major Float32Array/Float64Array/Array). */
export function contourSegments(values, width, height) {
  const segments = [];
  const emit = (x1, y1, x2, y2) => segments.push([x1, y1, x2, y2]);
  const row = (r) => (values.subarray ? values.subarray(r * width, (r + 1) * width) : values.slice(r * width, (r + 1) * width));
  for (let r = 0; r < height - 1; r++) contourBand(row(r), row(r + 1), r, width, emit);
  return segments;
}

/**
 * Joins segments that share end points into lines.
 * Returns an array of lines; each line is an array of [x, y] points.
 * Closed loops end with the same point they start with.
 */
export function joinSegments(segments) {
  const key = (x, y) => `${x},${y}`;
  const ends = new Map(); // point key → indexes of segments touching it
  const addEnd = (k, i) => {
    const list = ends.get(k);
    if (list) list.push(i); else ends.set(k, [i]);
  };
  segments.forEach(([x1, y1, x2, y2], i) => {
    addEnd(key(x1, y1), i);
    addEnd(key(x2, y2), i);
  });
  const used = new Uint8Array(segments.length);

  // From point (x, y), keep stepping to an unused segment that touches it.
  function walk(x, y, line) {
    for (;;) {
      const list = ends.get(key(x, y));
      const next = list && list.find((i) => !used[i]);
      if (next === undefined) return;
      used[next] = 1;
      const [x1, y1, x2, y2] = segments[next];
      if (x1 === x && y1 === y) { x = x2; y = y2; } else { x = x1; y = y1; }
      line.push([x, y]);
    }
  }

  const lines = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const [x1, y1, x2, y2] = segments[i];
    const forward = [[x1, y1], [x2, y2]];
    walk(x2, y2, forward);
    const backward = [];
    walk(x1, y1, backward);
    lines.push([...backward.reverse(), ...forward]);
  }
  return lines;
}
