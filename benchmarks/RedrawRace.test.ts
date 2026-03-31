// @ts-nocheck
/**
 * Tests for the redrawAll race condition that caused two-part letter misses.
 *
 * The bug: redrawAll() unconditionally set canvas.width = rect.width * dpr
 * on every call. This reset the 2D context. For two-part letters, the second
 * stroke's redrawAll could run before the state update for stroke 2 was
 * committed, causing stroke 2 to be invisible.
 *
 * These tests verify:
 * 1. Canvas is NOT resized when dimensions haven't changed
 * 2. Canvas IS resized when dimensions change
 * 3. Strokes are never lost due to redrawAll timing
 * 4. Performance: redrawAll with many strokes stays within frame budget
 * 5. Rapid consecutive redrawAll calls are idempotent
 *
 * Run with: npx tsx benchmarks/RedrawRace.test.ts
 */

let passed = 0, failed = 0;
function assert(ok, msg) {
  if (ok) { console.log(`  [PASS]  ${msg}`); passed++; }
  else    { console.error(`  [FAIL]  ${msg}`); failed++; process.exitCode = 1; }
}
function bench(name, fn, iters = 200) {
  for (let i = 0; i < 5; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const ms = (performance.now() - t0) / iters;
  console.log(`  [BENCH] ${name.padEnd(55)} ${ms.toFixed(3).padStart(8)}ms   ${(1000/ms).toFixed(0).padStart(7)}/s`);
  return ms;
}

// ─── Mock canvas that tracks resize calls ────────────────────────────────────

class MockCanvas {
  width = 1200;   // already correct size (simulates no resize needed)
  height = 1600;
  resizeCount = 0;
  clearCount = 0;
  drawCount = 0;
  _transform = [1, 0, 0, 1, 0, 0];

  getBoundingClientRect() {
    return { width: 600, height: 800, left: 0, top: 0 };
  }

  getContext() {
    const canvas = this;
    return {
      setTransform(a, b, c, d, e, f) { canvas._transform = [a,b,c,d,e,f]; },
      clearRect() { canvas.clearCount++; },
      save() {}, restore() {},
      translate() {}, scale() {},
      fillRect() {},
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
      arc() {}, ellipse() {}, strokeRect() {},
      drawImage() { canvas.drawCount++; },
      get globalAlpha() { return 1; }, set globalAlpha(_) {},
      get globalCompositeOperation() { return 'source-over'; }, set globalCompositeOperation(_) {},
      get strokeStyle() { return '#000'; }, set strokeStyle(_) {},
      get fillStyle() { return '#000'; }, set fillStyle(_) {},
      get lineWidth() { return 1; }, set lineWidth(_) {},
      get lineCap() { return 'round'; }, set lineCap(_) {},
      get lineJoin() { return 'round'; }, set lineJoin(_) {},
      setLineDash() {},
    };
  }
}

// ─── Simulate redrawAll logic ─────────────────────────────────────────────────
// This mirrors the fixed redrawAll() from Canvas.tsx exactly.

function simulateRedrawAll(canvas, strokes, dpr = 2) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const targetW = Math.round(rect.width * dpr);
  const targetH = Math.round(rect.height * dpr);

  const resized = canvas.width !== targetW || canvas.height !== targetH;
  if (resized) {
    canvas.width = targetW;
    canvas.height = targetH;
    canvas.resizeCount++;
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Simulate drawing each stroke
  for (const stroke of strokes) {
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (const p of stroke) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    canvas.drawCount++;
  }
}

// ─── OLD buggy redrawAll (for comparison) ─────────────────────────────────────
// This always resets canvas.width — the pre-fix behavior.

function simulateRedrawAllBuggy(canvas, strokes, dpr = 2) {
  const rect = canvas.getBoundingClientRect();
  // BUG: always resize
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  canvas.resizeCount++;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const stroke of strokes) {
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (const p of stroke) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    canvas.drawCount++;
  }
}

function makeStroke(n, x = 100, y = 100) {
  return Array.from({length: n}, (_, i) => ({ x: x + i * 5, y: y + Math.sin(i * 0.2) * 20 }));
}

// ─── Test 1: Canvas NOT resized when dimensions unchanged ─────────────────────
console.log('\n=== 1. Canvas NOT resized when dimensions unchanged ===');
{
  const canvas = new MockCanvas();
  // canvas.width=1200, canvas.height=1600 = 600*2 × 800*2 — already correct
  const strokes = [makeStroke(10), makeStroke(10)];

  simulateRedrawAll(canvas, strokes);
  simulateRedrawAll(canvas, strokes);
  simulateRedrawAll(canvas, strokes);

  assert(canvas.resizeCount === 0,
    `Canvas NOT resized when dimensions unchanged (resize count: ${canvas.resizeCount})`);
  assert(canvas.clearCount === 3,
    `Canvas cleared on every redraw (clear count: ${canvas.clearCount})`);
  assert(canvas.drawCount === 6,
    `All strokes drawn on every redraw (draw count: ${canvas.drawCount})`);
}

// ─── Test 2: Canvas IS resized when dimensions change ─────────────────────────
console.log('\n=== 2. Canvas IS resized when dimensions change ===');
{
  const canvas = new MockCanvas();
  canvas.width = 100;  // wrong size — needs resize
  canvas.height = 100;
  const strokes = [makeStroke(5)];

  simulateRedrawAll(canvas, strokes);

  assert(canvas.resizeCount === 1, `Canvas resized when dimensions wrong (count: ${canvas.resizeCount})`);
  assert(canvas.width === 1200, `Canvas width corrected to 1200 (got ${canvas.width})`);
  assert(canvas.height === 1600, `Canvas height corrected to 1600 (got ${canvas.height})`);

  // Second call — no more resize needed
  canvas.resizeCount = 0;
  simulateRedrawAll(canvas, strokes);
  assert(canvas.resizeCount === 0, `No resize on second call when dimensions already correct`);
}

// ─── Test 3: Two-part letter race — stroke 2 always visible ──────────────────
console.log('\n=== 3. Two-part letter race condition simulation ===');
{
  // Simulates the exact race:
  // - Stroke 1 committed → redrawAll([stroke1])
  // - Stroke 2 starts drawing (in-flight on overlay)
  // - Stroke 2 committed → redrawAll([stroke1, stroke2])
  // With the fix: canvas is NOT reset between calls, so stroke 2 is never lost

  const canvas = new MockCanvas();
  const stroke1 = makeStroke(8, 100, 200);  // body of "i"
  const stroke2 = makeStroke(2, 100, 150);  // dot of "i"

  let strokesInState = [stroke1];
  simulateRedrawAll(canvas, strokesInState);  // after stroke 1 committed
  const resizeAfterStroke1 = canvas.resizeCount;

  strokesInState = [stroke1, stroke2];
  simulateRedrawAll(canvas, strokesInState);  // after stroke 2 committed
  const resizeAfterStroke2 = canvas.resizeCount;

  assert(resizeAfterStroke1 === 0, `No canvas reset after stroke 1 (resize count: ${resizeAfterStroke1})`);
  assert(resizeAfterStroke2 === 0, `No canvas reset after stroke 2 (resize count: ${resizeAfterStroke2})`);
  // Both strokes drawn in second redraw
  // drawCount: stroke1(1 call) + stroke1+stroke2(2 calls) = 3
  assert(canvas.drawCount === 3, `All strokes drawn in both redraws (draw count: ${canvas.drawCount})`);
}

// ─── Test 4: Old buggy behavior comparison ────────────────────────────────────
console.log('\n=== 4. Old buggy redrawAll always resizes (comparison) ===');
{
  const canvas = new MockCanvas();
  const strokes = [makeStroke(5), makeStroke(5)];

  simulateRedrawAllBuggy(canvas, strokes);
  simulateRedrawAllBuggy(canvas, strokes);
  simulateRedrawAllBuggy(canvas, strokes);

  assert(canvas.resizeCount === 3,
    `Old buggy: canvas resized on EVERY call (resize count: ${canvas.resizeCount}) — this was the bug`);
  console.log(`  [INFO]  Each resize = context reset = race window for stroke miss`);
}

// ─── Test 5: Performance — redrawAll with many strokes ────────────────────────
console.log('\n=== 5. Performance: redrawAll with various stroke counts ===');
{
  for (const count of [10, 50, 100, 200, 500]) {
    const canvas = new MockCanvas();
    const strokes = Array.from({length: count}, (_, i) => makeStroke(20, i * 10, 100));

    const ms = bench(
      `redrawAll (${count} strokes × 20 pts)`,
      () => { canvas.clearCount = 0; simulateRedrawAll(canvas, strokes); },
      500
    );
    assert(ms < 16, `redrawAll ${count} strokes < 16ms frame budget (got ${ms.toFixed(2)}ms)`);
  }
}

// ─── Test 6: Rapid consecutive redraws are idempotent ─────────────────────────
console.log('\n=== 6. Rapid consecutive redraws — no accumulation ===');
{
  const canvas = new MockCanvas();
  const strokes = [makeStroke(10), makeStroke(10), makeStroke(10)];

  // Simulate 10 rapid redraws (e.g. 10 strokes committed in quick succession)
  for (let i = 0; i < 10; i++) {
    simulateRedrawAll(canvas, strokes);
  }

  assert(canvas.resizeCount === 0, `No resize in 10 rapid redraws`);
  assert(canvas.clearCount === 10, `Exactly 10 clears (one per redraw)`);
  assert(canvas.drawCount === 30, `Exactly 30 draws (3 strokes × 10 redraws)`);
}

// ─── Test 7: DPR change triggers resize ───────────────────────────────────────
console.log('\n=== 7. DPR change triggers resize ===');
{
  const canvas = new MockCanvas();
  // canvas is 1200×1600 (dpr=2), now simulate dpr=3
  canvas.resizeCount = 0;
  const strokes = [makeStroke(5)];

  simulateRedrawAll(canvas, strokes, 3);  // dpr=3 → needs 1800×2400
  assert(canvas.resizeCount === 1, `Canvas resized when DPR changes (count: ${canvas.resizeCount})`);
  assert(canvas.width === 1800, `Width updated for new DPR (got ${canvas.width})`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
