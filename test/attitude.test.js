import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAzimuth, dipDirectionFromStrike, strikeFromDipDirection, parseNumber,
  checkStrike, checkDip, formatAzimuth, formatAttitude, strikeDipSymbol, checkTrend, checkPlunge, lineationSymbol,
} from '../js/geo/attitude.js';

test('right-hand rule: dip direction = strike + 90°', () => {
  assert.equal(dipDirectionFromStrike(0), 90);
  assert.equal(dipDirectionFromStrike(45), 135);
  assert.equal(dipDirectionFromStrike(270), 0); // wraps past north
  assert.equal(dipDirectionFromStrike(300), 30);
  assert.equal(dipDirectionFromStrike(359.5), 89.5);
});

test('strike from dip direction is the reverse', () => {
  assert.equal(strikeFromDipDirection(90), 0);
  assert.equal(strikeFromDipDirection(30), 300);
  for (let s = 0; s < 360; s += 7.5) assert.equal(strikeFromDipDirection(dipDirectionFromStrike(s)), s);
});

test('azimuths wrap into 0–360', () => {
  assert.equal(normalizeAzimuth(360), 0);
  assert.equal(normalizeAzimuth(-90), 270);
  assert.equal(normalizeAzimuth(725), 5);
});

test('reading typed numbers', () => {
  assert.equal(parseNumber(' 045 '), 45);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('-3.25'), -3.25);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber(undefined), null);
  assert.ok(Number.isNaN(parseNumber('4o')));
  assert.ok(Number.isNaN(parseNumber('1e3')));
  assert.ok(Number.isNaN(parseNumber('30°')));
});

test('strike checks', () => {
  assert.deepEqual(checkStrike('045'), { ok: true, value: 45 });
  assert.deepEqual(checkStrike('360'), { ok: true, value: 0 });
  assert.deepEqual(checkStrike('0'), { ok: true, value: 0 });
  const tooBig = checkStrike('400');
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.message, /400° is not possible/);
  assert.equal(checkStrike('-5').ok, false);
  assert.match(checkStrike('').message, /missing/);
  assert.match(checkStrike('abc').message, /not a number/);
});

test('dip checks', () => {
  assert.deepEqual(checkDip('35'), { ok: true, value: 35 });
  assert.deepEqual(checkDip('0'), { ok: true, value: 0 });
  assert.deepEqual(checkDip('90'), { ok: true, value: 90 });
  const tooSteep = checkDip('95');
  assert.equal(tooSteep.ok, false);
  assert.match(tooSteep.message, /95° is not possible/);
  assert.equal(checkDip('-1').ok, false);
  assert.match(checkDip(' ').message, /missing/);
});

test('formatting', () => {
  assert.equal(formatAzimuth(45), '045');
  assert.equal(formatAzimuth(7.5), '007.5');
  assert.equal(formatAzimuth(300), '300');
  assert.equal(formatAttitude(45, 30), '045/30 (dip direction 135)');
});

const near = (a, b) => Math.abs(a - b) < 0.02;

test('symbol for strike 000: N–S strike line, tick pointing east', () => {
  const sym = strikeDipSymbol(0, 30, { size: 40, strikeLength: 30, tickLength: 10 });
  assert.equal(sym.kind, 'inclined');
  const [strikeLine, tick] = sym.lines;
  assert.ok(near(strikeLine[0], 20) && near(strikeLine[1], 35), 'south end of strike line');
  assert.ok(near(strikeLine[2], 20) && near(strikeLine[3], 5), 'north end (up on screen)');
  assert.deepEqual(tick.slice(0, 2), [20, 20]);
  assert.ok(near(tick[2], 30) && near(tick[3], 20), 'tick goes right = east');
});

test('symbol for strike 090: E–W strike line, tick pointing south (down)', () => {
  const [strikeLine, tick] = strikeDipSymbol(90, 45, { size: 40, strikeLength: 30, tickLength: 10 }).lines;
  assert.ok(near(strikeLine[1], 20) && near(strikeLine[3], 20), 'horizontal on screen');
  assert.ok(near(tick[2], 20) && near(tick[3], 30), 'tick goes down = south');
});

test('symbol for strike 315: tick points NE (dip direction 045)', () => {
  const [, tick] = strikeDipSymbol(315, 20, { size: 40, tickLength: 10 }).lines;
  const r = 10 * Math.SQRT1_2;
  assert.ok(near(tick[2], 20 + r) && near(tick[3], 20 - r));
});

test('vertical and horizontal planes', () => {
  const v = strikeDipSymbol(0, 90, { size: 40, tickLength: 10 });
  assert.equal(v.kind, 'vertical');
  assert.equal(v.lines.length, 3);
  assert.ok(near(v.lines[2][2], 10), 'second tick points west');
  const h = strikeDipSymbol(123, 0, { size: 40, tickLength: 10 });
  assert.equal(h.kind, 'horizontal');
  assert.deepEqual(h.circle, { cx: 20, cy: 20, r: 10 });
});

test('trend and plunge checks', () => {
  assert.deepEqual(checkTrend('040'), { ok: true, value: 40 });
  assert.deepEqual(checkTrend('360'), { ok: true, value: 0 });
  assert.deepEqual(checkTrend('0'), { ok: true, value: 0 });
  assert.match(checkTrend('361').message, /361° is not possible/);
  assert.match(checkTrend('-1').message, /not possible/);
  assert.match(checkTrend('').message, /missing/);
  assert.match(checkTrend('NE').message, /not a number/);
  assert.deepEqual(checkPlunge('0'), { ok: true, value: 0 });
  assert.deepEqual(checkPlunge('90'), { ok: true, value: 90 });
  assert.deepEqual(checkPlunge('15,5'), { ok: true, value: 15.5 });
  assert.match(checkPlunge('91').message, /91° is not possible/);
  assert.match(checkPlunge('-3').message, /not possible/);
  assert.match(checkPlunge('').message, /missing/);
  assert.match(checkPlunge('x').message, /not a number/);
});

test('lineation arrow points along the trend', () => {
  const east = lineationSymbol(90, 20, { size: 40, length: 15, headLength: 5 });
  assert.equal(east.kind, 'arrow');
  assert.ok(near(east.head[0][0], 35) && near(east.head[0][1], 20), 'tip to the east');
  const north = lineationSymbol(0, 20, { size: 40, length: 15, headLength: 5 });
  assert.ok(near(north.head[0][0], 20) && near(north.head[0][1], 5), 'tip up = north');
  const sw = lineationSymbol(225, 10, { size: 40, length: 10, headLength: 4 });
  assert.ok(sw.head[0][0] < 20 && sw.head[0][1] > 20, 'tip to the south-west');
  assert.equal(lineationSymbol(123, 90).kind, 'vertical');
});
