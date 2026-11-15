// v27d: ritaglio/rotazione foto più fluidi su iPhone.
// - la tela non si rialloca a ogni tick del cursore «Raddrizza» (se la misura non cambia);
// - l'anteprima in movimento usa qualità "low", l'esportazione resta "high";
// - il ritaglio non salta più quando la tela passa da W a W×1,12 al primo movimento dal punto 0°;
// - il cursore dello zoom non viene riscritto mentre lo trascini.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../public/js/photos.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const P = sandbox.GemintPhotos;
const plain = (o) => JSON.parse(JSON.stringify(o)); // gli oggetti del vm hanno un altro prototipo

function fakeCanvas(w = 300, h = 150) {
  const log = { widthSets: 0, heightSets: 0, quality: [], transforms: 0 };
  const ctx = {
    set imageSmoothingQuality(v) { log.quality.push(v); },
    set imageSmoothingEnabled(v) {}, set fillStyle(v) {},
    setTransform() { log.transforms++; }, fillRect() {}, translate() {}, rotate() {}, drawImage() {}
  };
  let _w = w, _h = h;
  return {
    log,
    get width() { return _w; }, set width(v) { log.widthSets++; _w = v; },
    get height() { return _h; }, set height(v) { log.heightSets++; _h = v; },
    getContext() { return ctx; }
  };
}

test("shiftCropForMid: il ritaglio segue il centro dell'immagine quando la tela cresce o torna alla misura iniziale", () => {
  const crop = { sx: 100, sy: 200, sw: 600, sh: 840 };
  const grown = plain(P._shiftCropForMid(crop, { width: 1000, height: 1400 }, { width: 1120, height: 1568 }));
  assert.deepEqual(grown, { sx: 160, sy: 284, sw: 600, sh: 840 });
  const back = plain(P._shiftCropForMid(grown, { width: 1120, height: 1568 }, { width: 1000, height: 1400 }));
  assert.deepEqual(back, crop, "andata e ritorno devono riportare lo stesso ritaglio");
  const same = plain(P._shiftCropForMid(crop, { width: 1000, height: 1400 }, { width: 1000, height: 1400 }));
  assert.deepEqual(same, crop);
});

test("rotatedCanvas: non rialloca la tela se la misura è uguale e rispetta la qualità richiesta", () => {
  const img = { width: 1000, height: 1400 };
  const target = fakeCanvas();
  P._rotatedCanvas(img, 0, 1.5, target, "low");
  assert.equal(target.width, 1120);
  assert.equal(target.height, 1568);
  assert.equal(target.log.widthSets, 1);
  P._rotatedCanvas(img, 0, 2.0, target, "low");
  P._rotatedCanvas(img, 0, 2.5, target, "low");
  assert.equal(target.log.widthSets, 1, "stessa misura: width non va riassegnata");
  assert.equal(target.log.heightSets, 1);
  assert.ok(target.log.transforms >= 3, "la trasformazione va azzerata a ogni disegno");
  assert.deepEqual(plain(target.log.quality), ["low", "low", "low"]);
  P._rotatedCanvas(img, 0, 2.5, target);
  assert.equal(target.log.quality[3], "high", "senza parametro resta alta qualità (esportazione)");
  P._rotatedCanvas(img, 0, 0, target, "low");
  assert.equal(target.width, 1000, "a 0° la tela torna alla misura dell'immagine");
});

test("rotatedCanvas: con rotazione di 90° scambia larghezza e altezza", () => {
  const target = fakeCanvas();
  P._rotatedCanvas({ width: 1000, height: 1400 }, 90, 0, target, "high");
  assert.equal(target.width, 1400);
  assert.equal(target.height, 1000);
});

test("cropper e pagina: livello GPU fisso, rifinitura a cursore fermo, cursore zoom non riscritto durante il trascinamento", () => {
  assert.ok(!/willChange = "auto"/.test(src), "will-change non va più tolto");
  assert.ok(/live\.style\.willChange = "transform"/.test(src));
  assert.ok(/rebuildMid\(refit === false\)/.test(src), "durante il cursore si usa l'anteprima veloce");
  assert.ok(/settleTimer = setTimeout/.test(src) && /"high"/.test(src.slice(src.indexOf("settleTimer = setTimeout"))), "manca la rifinitura finale");
  assert.ok(/getAttribute\("data-drag"\) !== "1"/.test(app), "updateRatioButtons deve saltare lo zoom mentre si trascina");
  assert.ok(/input\[data-zoom\], input\[data-angle\]/.test(app) && /touchstart/.test(app));
});
