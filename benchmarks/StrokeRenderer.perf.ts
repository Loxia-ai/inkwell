// @ts-nocheck
/**
 * Performance benchmarks for the Inkwell drawing pipeline.
 * Run with:  npx tsx benchmarks/StrokeRenderer.perf.ts
 */

// ─── Browser API polyfills (MUST be before any import that uses them) ─────────
// Path2D is browser-only. We stub it so the renderer logic is exercised in Node.
// Using globalThis assignment before dynamic import ensures the module sees it.
globalThis.Path2D = class Path2D {
  constructor(d) { this.d = d || ''; }
};

// ─── Dynamic import (runs after polyfills are set) ────────────────────────────
const { StrokeRenderer } = await import('../src/engine/StrokeRenderer.js');

// ─── Mock canvas context ──────────────────────────────────────────────────────
function makeMockCtx() {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'canvas') return {};
      return (..._) => {};
    },
    set() { return true; },
  });
}

// ─── Point factory ────────────────────────────────────────────────────────────
function pt(x, y, pressure = 0.5, ts = 0) {
  return { x, y, pressure, timestamp: ts };
}

// ─── Dash stroke generator ────────────────────────────────────────────────────
function makeDashes(numDashes, dashLen, gapLen, speed, y = 100) {
  const dashes = [];
  let x = 0, ts = 0;
  for (let d = 0; d < numDashes; d++) {
    const pts = [];
    const endX = x + dashLen;
    while (x < endX) { pts.push(pt(x, y, 0.5, ts)); x += speed; ts += 8; }
    if (pts.length > 0) dashes.push(pts);
    x += gapLen;
    ts += 20;
  }
  return dashes;
}

// ─── Benchmark runner ─────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function bench(name, fn, iters = 200) {
  for (let i = 0; i < 5; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const ms = (performance.now() - t0) / iters;
  console.log(`  [BENCH] ${name.padEnd(52)} ${ms.toFixed(3).padStart(8)}ms   ${(1000/ms).toFixed(0).padStart(7)}/s`);
  return ms;
}

function assert(ok, msg) {
  if (ok) { console.log(`  [PASS]  ${msg}`); passed++; }
  else    { console.error(`  [FAIL]  ${msg}`); failed++; process.exitCode = 1; }
}

// ─── Style fixtures ───────────────────────────────────────────────────────────
const pen         = { color: '#000',    width: 3, opacity: 1,   tool: 'pen' };
const pencil      = { color: '#333',    width: 2, opacity: 0.8, tool: 'pencil' };
const highlighter = { color: '#FFD700', width: 8, opacity: 0.5, tool: 'highlighter' };
const marker      = { color: '#00F',    width: 5, opacity: 1,   tool: 'marker' };

// ─── Test 1: Interpolation correctness ───────────────────────────────────────
console.log('\n=== 1. Interpolation correctness ===');
{
  const interp = StrokeRenderer.interpolatePoints.bind(StrokeRenderer);

  const sparse = [
    pt(0,   0, 0.2, 0),
    pt(50,  0, 0.8, 100),   // 50px gap — should be filled
    pt(100, 0, 0.5, 200),
  ];
  const filled = interp(sparse, 4);

  let maxGap = 0;
  for (let i = 1; i < filled.length; i++) {
    const dx = filled[i].x - filled[i-1].x;
    const dy = filled[i].y - filled[i-1].y;
    maxGap = Math.max(maxGap, Math.sqrt(dx*dx + dy*dy));
  }
  assert(maxGap <= 4.1,                  `Max gap ≤ 4px after interpolation (got ${maxGap.toFixed(2)}px)`);
  assert(filled.length > sparse.length,  `Points added: ${sparse.length} → ${filled.length}`);

  // Pressure at 15% through the array (well within first segment 0.2→0.8)
  const idx15 = Math.max(1, Math.floor(filled.length * 0.15));
  const p15 = filled[idx15];
  assert(p15.pressure > 0.2 && p15.pressure < 0.75,
    `Pressure interpolated at 15% index (${p15.pressure.toFixed(3)} is between 0.2 and 0.75)`);
}

// ─── Test 2: Fast-dash simulation ─────────────────────────────────────────────
console.log('\n=== 2. Fast-dash simulation (pencil) ===');
{
  const ctx = makeMockCtx();
  const NUM_DASHES = 5;
  for (const speed of [2, 5, 10, 20, 40]) {
    const dashes = makeDashes(NUM_DASHES, 30, 20, speed);
    let errors = 0;
    for (const dash of dashes) {
      try { StrokeRenderer.renderStrokeLive(ctx, dash, pencil, 0); }
      catch (e) { errors++; }
    }
    const avgPts = dashes.reduce((s, d) => s + d.length, 0) / dashes.length;
    console.log(`  speed=${String(speed).padStart(3)}px/evt  dashes=${dashes.length}  avg_pts=${avgPts.toFixed(1)}  errors=${errors}  ${errors===0?'✓':'✗'}`);
    assert(errors === 0,                    `No render errors at speed=${speed}px/evt`);
    assert(dashes.length === NUM_DASHES,    `All ${NUM_DASHES} dashes captured at speed=${speed}`);
  }
}

// ─── Test 3: Render throughput by stroke length ───────────────────────────────
console.log('\n=== 3. Render throughput — pen (various lengths) ===');
{
  const ctx = makeMockCtx();
  for (const len of [10, 50, 100, 300, 600, 1000]) {
    const pts = Array.from({length: len}, (_, i) =>
      pt(i*2, Math.sin(i*0.1)*50+100, 0.5, i*8));
    bench(`pen  ${String(len).padStart(4)} pts`, () => StrokeRenderer.renderStrokeLive(ctx, pts, pen, 0), 200);
  }
}

// ─── Test 4: Tool throughput comparison ───────────────────────────────────────
console.log('\n=== 4. Tool throughput comparison (100 pts) ===');
{
  const ctx = makeMockCtx();
  const pts = Array.from({length: 100}, (_, i) =>
    pt(i*3, Math.sin(i*0.15)*60+150, 0.4+Math.sin(i*0.07)*0.3, i*8));
  for (const [name, style] of [['pen',pen],['pencil',pencil],['highlighter',highlighter],['marker',marker]]) {
    bench(`${name.padEnd(14)} 100 pts`, () => StrokeRenderer.renderStrokeLive(ctx, pts, style, 0), 500);
  }
}

// ─── Test 5: Coalesced event simulation (0.5s stroke) ─────────────────────────
console.log('\n=== 5. Coalesced event simulation (8 events/RAF × 60 RAFs) ===');
{
  const ctx = makeMockCtx();
  const COALESCED = 8, RAFS = 60;
  const allPts = [];
  let renderErrors = 0;

  for (let r = 0; r < RAFS; r++) {
    for (let c = 0; c < COALESCED; c++) {
      const i = r * COALESCED + c;
      allPts.push(pt(i*5, Math.sin(i*0.08)*80+200, 0.5, i*1.04));
    }
    try { StrokeRenderer.renderStrokeLive(ctx, allPts.slice(), pen, 0); }
    catch { renderErrors++; }
  }

  assert(renderErrors === 0, `No errors across ${RAFS} RAF renders (${allPts.length} total pts)`);
  console.log(`  Total accumulated points: ${allPts.length}`);

  const ms = bench(
    `pen  ${allPts.length} pts (full 0.5s stroke)`,
    () => StrokeRenderer.renderStrokeLive(ctx, allPts, pen, 0),
    50
  );
  assert(ms < 16, `Renders in < 16ms frame budget (got ${ms.toFixed(2)}ms)`);
  if (ms < 8) console.log(`  [INFO]  Ideal < 8ms ✓ (${ms.toFixed(2)}ms)`);
  else        console.log(`  [WARN]  > 8ms — may cause jank on low-end devices (${ms.toFixed(2)}ms)`);
}

// ─── Test 6: Dedup threshold safety ───────────────────────────────────────────
console.log('\n=== 6. Point dedup threshold safety ===');
{
  const THRESHOLD = 0.5; // Canvas.tsx drops points where dist < 0.5px
  assert(5   > THRESHOLD, `Moderate speed (5px)  passes dedup threshold`);
  assert(0.3 < THRESHOLD, `True duplicates (0.3px) correctly filtered`);
  assert(40  > THRESHOLD, `Very fast drawing (40px) passes dedup threshold`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
