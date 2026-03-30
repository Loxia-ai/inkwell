// @ts-nocheck
/**
 * Targeted tests for the stroke-missing bug scenarios.
 * Run with:  npx tsx benchmarks/StrokeMissing.test.ts
 *
 * Tests the 5 identified root causes:
 * 1. pointercancel saves stroke (not discards)
 * 2. Two-finger touch while drawing saves in-progress stroke
 * 3. Stale activePointerId from image manipulation is cleared
 * 4. isPanning state doesn't block pen/mouse drawing
 * 5. Rapid pointer-down sequences don't lose strokes
 */

function makePoint(x, y, pressure = 0.5, ts = 0) {
  return { x, y, pressure, timestamp: ts };
}

let passed = 0, failed = 0;
function assert(ok, msg) {
  if (ok) { console.log(`  [PASS]  ${msg}`); passed++; }
  else    { console.error(`  [FAIL]  ${msg}`); failed++; process.exitCode = 1; }
}

class PointerStateMachine {
  isDrawing = false;
  activePointerId = null;
  currentPoints = [];
  isPanning = false;
  touchCache = new Map();
  imageManip = null;
  committedStrokes = [];
  palmRejection = true;

  finishStroke() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.activePointerId = null;
    const pts = this.currentPoints;
    this.currentPoints = [];
    if (pts.length >= 2) this.committedStrokes.push({ points: pts });
  }

  pointerDown(e) {
    if (this.palmRejection && e.pointerType === 'touch') {
      this.touchCache.set(e.pointerId, e);
      if (this.touchCache.size === 2) {
        if (this.isDrawing && this.currentPoints.length >= 2) this.finishStroke();
        else if (this.isDrawing) { this.isDrawing = false; this.activePointerId = null; }
        this.isPanning = false;
      } else if (this.touchCache.size === 1) {
        this.isPanning = true;
      }
      return;
    }
    if (e.pointerType !== 'touch') this.isPanning = false;
    if (this.imageManip !== null) return;
    if (this.isDrawing) {
      if (this.activePointerId !== null && this.activePointerId !== e.pointerId) return;
      this.finishStroke();
    }
    if (!this.isDrawing && this.imageManip === null && this.activePointerId !== null
        && this.activePointerId !== e.pointerId) {
      this.activePointerId = null;
    }
    this.isDrawing = true;
    this.activePointerId = e.pointerId;
    this.currentPoints = [makePoint(e.x, e.y, e.pressure || 0.5, Date.now())];
  }

  pointerMove(e) {
    if (this.palmRejection && e.pointerType === 'touch') { this.touchCache.set(e.pointerId, e); return; }
    if (!this.isDrawing || e.pointerId !== this.activePointerId) return;
    this.currentPoints.push(makePoint(e.x, e.y, e.pressure || 0.5, Date.now()));
  }

  pointerUp(e) {
    this.touchCache.delete(e.pointerId);
    if (this.touchCache.size === 0) this.isPanning = false;
    if (this.imageManip !== null && e.pointerId === this.activePointerId) {
      this.imageManip = null; this.activePointerId = null; return;
    }
    if (!this.isDrawing || e.pointerId !== this.activePointerId) return;
    this.finishStroke();
  }

  pointerCancel(e) {
    this.touchCache.delete(e.pointerId);
    if (this.touchCache.size === 0) this.isPanning = false;
    if (this.imageManip !== null && e.pointerId === this.activePointerId) {
      this.imageManip = null; this.activePointerId = null; return;
    }
    if (e.pointerId === this.activePointerId) {
      if (this.isDrawing && this.currentPoints.length >= 2) { this.finishStroke(); return; }
      this.isDrawing = false; this.activePointerId = null; this.currentPoints = [];
    }
  }
}

const pen   = (id, x, y, p=0.5) => ({ pointerId: id, pointerType: 'pen',   x, y, pressure: p });
const touch = (id, x, y)        => ({ pointerId: id, pointerType: 'touch', x, y, pressure: 0 });

console.log('\n=== 1. pointercancel saves in-progress stroke ===');
{
  const sm = new PointerStateMachine();
  sm.pointerDown(pen(1,10,10)); sm.pointerMove(pen(1,20,20)); sm.pointerMove(pen(1,30,30)); sm.pointerMove(pen(1,40,40));
  sm.pointerCancel(pen(1,40,40));
  assert(sm.committedStrokes.length === 1, `Stroke committed on pointercancel (got ${sm.committedStrokes.length})`);
  assert(sm.committedStrokes[0].points.length >= 4, `All 4+ points preserved (got ${sm.committedStrokes[0]?.points.length})`);
  assert(!sm.isDrawing, `isDrawing cleared after cancel`);
  assert(sm.activePointerId === null, `activePointerId cleared after cancel`);
}

console.log('\n=== 2. pointercancel with single point discards (no phantom dot) ===');
{
  const sm = new PointerStateMachine();
  sm.pointerDown(pen(1,10,10)); sm.pointerCancel(pen(1,10,10));
  assert(sm.committedStrokes.length === 0, `Single-point cancel NOT committed (got ${sm.committedStrokes.length})`);
  assert(!sm.isDrawing, `isDrawing cleared`);
}

console.log('\n=== 3. Two-finger pinch during active stroke saves the stroke ===');
{
  const sm = new PointerStateMachine();
  sm.pointerDown(pen(1,10,10)); sm.pointerMove(pen(1,20,20)); sm.pointerMove(pen(1,30,30));
  sm.pointerDown(touch(10,100,100));
  assert(sm.isDrawing, `Still drawing after first touch finger`);
  sm.pointerDown(touch(11,150,100));
  assert(sm.committedStrokes.length === 1, `Stroke saved when second touch finger lands (got ${sm.committedStrokes.length})`);
  assert(!sm.isDrawing, `isDrawing false after pinch starts`);
}

console.log('\n=== 4. isPanning from touch does NOT block pen drawing ===');
{
  const sm = new PointerStateMachine();
  sm.pointerDown(touch(10,50,50)); assert(sm.isPanning, `isPanning set by touch`);
  sm.pointerMove(touch(10,60,60)); sm.pointerUp(touch(10,70,70));
  assert(!sm.isPanning, `isPanning cleared after touch up`);
  sm.pointerDown(pen(1,100,100)); sm.pointerMove(pen(1,110,110)); sm.pointerMove(pen(1,120,120)); sm.pointerUp(pen(1,120,120));
  assert(sm.committedStrokes.length === 1, `Pen stroke committed after pan (got ${sm.committedStrokes.length})`);
}

console.log('\n=== 5. Stale activePointerId from image manip is cleared ===');
{
  const sm = new PointerStateMachine();
  sm.activePointerId = 99; sm.imageManip = null; sm.isDrawing = false;
  sm.pointerDown(pen(1,100,100)); sm.pointerMove(pen(1,110,110)); sm.pointerMove(pen(1,120,120)); sm.pointerUp(pen(1,120,120));
  assert(sm.committedStrokes.length === 1, `Stroke committed despite stale activePointerId (got ${sm.committedStrokes.length})`);
}

console.log('\n=== 6. Rapid consecutive strokes all committed ===');
{
  const sm = new PointerStateMachine();
  for (let s = 0; s < 10; s++) {
    sm.pointerDown(pen(1,s*50,100));
    for (let p = 1; p <= 5; p++) sm.pointerMove(pen(1,s*50+p*5,100+p*3));
    sm.pointerUp(pen(1,s*50+25,115));
  }
  assert(sm.committedStrokes.length === 10, `All 10 rapid strokes committed (got ${sm.committedStrokes.length})`);
}

console.log('\n=== 7. Pen drawing with palm rejection ON (normal case) ===');
{
  const sm = new PointerStateMachine();
  sm.pointerDown(pen(1,0,0));
  for (let i = 1; i <= 10; i++) sm.pointerMove(pen(1,i*10,i*5));
  sm.pointerUp(pen(1,100,50));
  assert(sm.committedStrokes.length === 1, `Pen stroke committed with palm rejection ON`);
  assert(sm.committedStrokes[0].points.length >= 10, `All points captured (${sm.committedStrokes[0]?.points.length})`);
}

console.log('\n=== 8. Touch pan → immediate pen stroke (most common miss scenario) ===');
{
  const sm = new PointerStateMachine();
  sm.pointerDown(touch(10,200,200)); sm.pointerMove(touch(10,210,210)); sm.pointerMove(touch(10,220,220)); sm.pointerUp(touch(10,220,220));
  sm.pointerDown(pen(1,50,50)); sm.pointerMove(pen(1,60,60)); sm.pointerMove(pen(1,70,70)); sm.pointerMove(pen(1,80,80)); sm.pointerUp(pen(1,80,80));
  assert(sm.committedStrokes.length === 1, `Pen stroke after touch pan committed (got ${sm.committedStrokes.length})`);
  assert(sm.committedStrokes[0].points.length >= 4, `All points in stroke (${sm.committedStrokes[0]?.points.length})`);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
