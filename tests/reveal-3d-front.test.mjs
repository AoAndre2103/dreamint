import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = readFileSync(new URL('../public/js/reveal-v2.js', import.meta.url), 'utf8');
test('3D drag remains on the visible face, rather than flipping to the back', () => {
  assert.match(js, /function clampViewerYaw\(yaw\)/);
  assert.match(js, /viewerSide - 65/);
  assert.match(js, /viewerSide \+ 65/);
  assert.match(js, /viewerYaw = clampViewerYaw\(drag\.yaw/);
  assert.match(js, /viewerSide = viewerSide === 180 \? 0 : 180/);
});
test('reveal completes facing front and releases flip animation', () => {
  assert.match(js, /viewerSide = 180; viewerYaw = 180; viewerPitch = 0;/);
  assert.match(js, /if \(flipper\.getAnimations\) flipper\.getAnimations\(\)\.forEach\(function \(a\) \{ a\.cancel\(\); \}\);\s*paintViewer\(\);/);
});
