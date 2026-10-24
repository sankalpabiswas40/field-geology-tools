import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equalArea, poleOfPlane, greatCircle, planePerpendicularTo, stereonetSvg, wrapText } from '../js/geo/stereonet.js';
import { pointInPolygonXY, makeAreaTest } from '../js/geo/area.js';
import { toUtm, fromUtm } from '../js/geo/utm.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

test('equal-area projection of known points', () => {
  let p = equalArea(123, 90); // vertical line → centre
  assert.ok(near(p.x, 0) && near(p.y, 0));
  p = equalArea(90, 0); // horizontal east → right edge
  assert.ok(near(p.x, 1) && near(p.y, 0));
  p = equalArea(0, 0); // north → top
  assert.ok(near(p.x, 0) && near(p.y, 1));
  p = equalArea(180, 0);
  assert.ok(near(p.x, 0) && near(p.y, -1));
  p = equalArea(45, 30); // r = √2·sin(30°) = 0.7071 → (0.5, 0.5)
  assert.ok(near(p.x, 0.5) && near(p.y, 0.5));
  p = equalArea(270, 45); // r = √2·sin(22.5°)
  assert.ok(near(p.x, -Math.SQRT2 * Math.sin(Math.PI / 8)) && near(p.y, 0));
});

test('equal area: equal solid angles take equal net area', () => {
  // A cone of half-angle 60° around the vertical holds half the hemisphere's area... in a Schmidt
  // net the circle radius for plunge 30° is √2·sin(30°) = 1/√2, i.e. half the net's area.
  const r = Math.hypot(equalArea(0, 30).x, equalArea(0, 30).y);
  assert.ok(near(r * r, 0.5));
});

test('poles to planes', () => {
  assert.deepEqual(poleOfPlane(0, 30), { trend: 270, plunge: 60 }); // dips east → pole points west
  assert.deepEqual(poleOfPlane(232, 52), { trend: 142, plunge: 38 });
  assert.deepEqual(poleOfPlane(90, 0), { trend: 0, plunge: 90 });
});

test('great circle runs from strike to strike + 180° through the dip direction', () => {
  const pts = greatCircle(0, 30, 90);
  assert.ok(near(pts[0].x, 0) && near(pts[0].y, 1), 'starts at strike (N)');
  assert.ok(near(pts[90].x, 0, 1e-9) && near(pts[90].y, -1), 'ends at S');
  const mid = pts[45]; // dip direction (E), plunge 30
  const want = equalArea(90, 30);
  assert.ok(near(mid.x, want.x) && near(mid.y, want.y));
  for (const p of pts) assert.ok(Math.hypot(p.x, p.y) <= 1 + 1e-9);
});

test('girdle plane is perpendicular to the fold axis', () => {
  assert.deepEqual(planePerpendicularTo(40, 15), { strike: 130, dip: 75 });
  assert.deepEqual(planePerpendicularTo(0, 90), { strike: 90, dip: 0 });
});

test('SVG has the primitive circle, N/E/S/W, poles and the axis', () => {
  const svg = stereonetSvg({
    title: 'Test', poles: [{ trend: 142, plunge: 38 }, { trend: 10, plunge: 5, isTest: true }],
    planes: [{ strike: 10, dip: 20 }], axis: { trend: 40, plunge: 15 }, girdle: { strike: 130, dip: 75 },
    lineations: [{ trend: 40, plunge: 15 }], meanLineation: { trend: 40, plunge: 15 }, notes: ['n = 2', 'a < b'],
  });
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  for (const label of ['>N<', '>E<', '>S<', '>W<']) assert.ok(svg.includes(label), label);
  assert.equal((svg.match(/<circle [^>]*r="4.5"/g) || []).length, 2, 'two poles');
  assert.ok(svg.includes('#ff00d4'), 'test pole in pink');
  assert.ok(svg.includes('>040/15<'), 'axis label');
  assert.ok(svg.includes('a &lt; b'), 'notes escaped');
});

test('point in polygon (metres) and areas drawn on the map', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(pointInPolygonXY(5, 5, square), true);
  assert.equal(pointInPolygonXY(15, 5, square), false);
  assert.equal(pointInPolygonXY(-1, -1, square), false);

  // A 1 km square drawn around 46.5°N 9°E, built in UTM metres.
  const c = toUtm(46.5, 9);
  const corner = (de, dn) => { const p = fromUtm(c.easting + de, c.northing + dn, c.zone, c.hemisphere); return { lat: p.lat, lon: p.lon }; };
  const inside = makeAreaTest([corner(-500, -500), corner(500, -500), corner(500, 500), corner(-500, 500)]);
  const at = (de, dn) => { const p = corner(de, dn); return inside(p.lat, p.lon); };
  assert.equal(at(0, 0), true);
  assert.equal(at(490, 490), true);
  assert.equal(at(510, 0), false);
  assert.equal(at(0, -600), false);
  assert.throws(() => makeAreaTest([{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }]), RangeError);
});

test('long notes under the net wrap onto extra lines instead of being cut off', () => {
  assert.deepEqual(wrapText('one two three four', 9), ['one two', 'three', 'four']);
  assert.deepEqual(wrapText('short', 58), ['short']);
  const long = 'WARNING: Only 2 poles: at least 6 are needed before a fold axis is reported.';
  const svg = stereonetSvg({ title: 't', notes: [long] });
  const texts = [...svg.matchAll(/<text x="16"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  assert.ok(texts.length >= 2, 'wrapped');
  assert.ok(texts.every((t) => t.length <= 58));
  assert.equal(texts.join(' '), long);
});
