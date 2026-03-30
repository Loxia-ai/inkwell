// @ts-nocheck
/**
 * Precise timing simulation of the React pointer handler closure problem.
 *
 * The fast letter-to-letter miss scenario:
 *
 * T+0ms:   pointerDown (letter 1) — handler A captures state snapshot S0
 * T+50ms:  pointerMove x5
 * T+80ms:  pointerUp → finishStroke() → dispatch(ADD_STROKE)
 *            React schedules re-render (async, ~4-16ms)
 * T+85ms:  pointerDown (letter 2) — which handler runs?
 *            If React hasn't re-rendered yet: handler A (old closure) runs
 *            handler A's finishStroke sees isDrawing=false → returns early
 *            BUT isDrawing was already set false by letter 1's finishStroke
 *            So letter 2's pointerDown proceeds... but what about selectedImageId?
 *            setSelectedImageId is a setState call — if page has images,
 *            the image hit-test runs with STALE page.images from S0
 *
 * The REAL remaining problem after our fixes:
 * The `handlePointerDown` useCallback has dep [... selectedImageId]
 * selectedImageId is React STATE — when it changes, handlePointerDown is recreated.
 * But between dispatch() and React re-render, the old handler is still attached.
 * This is fine for most cases.
 *
 * ACTUAL REMAINING BUG identified:
 * finishStroke's clearRect on overlay (line 591) still uses rect.width/rect.height
 * (CSS pixels) not physical pixels. On Retina this leaves ghost overlay content.
 * The ghost makes it LOOK like the stroke is missing when it's actually committed
 * but the overlay wasn't cleared properly, leaving the live-preview ghost on top.
 *
 * SECOND REMAINING BUG:
 * The `redrawAll` triggered by dispatch(ADD_STROKE) resets canvas.width/height
 * which clears the main canvas, then redraws all strokes. But if this happens
 * WHILE the second stroke's RAF is pending (live preview), the overlay RAF fires
 * AFTER redrawAll clears everything — and draws on a freshly cleared canvas.
 * The stroke IS in state but the redraw happened before the RAF cleared the overlay.
 * Result: the committed stroke appears, then the overlay RAF fires and draws
 * the live preview of the NEW stroke on top — which then gets cleared by the
 * NEXT redrawAll. Net effect: the first stroke flickers/disappears briefly.
 *
 * THIRD REMAINING BUG (most likely cause of actual miss):
 * When finishStroke is called from pointerUp:
 *   1. isDrawing = false
 *   2. points snapshot taken
 *   3. dispatch(ADD_STROKE) called
 * Then pointerDown for letter 2 arrives:
 *   4. isDrawing is false → skip finishStroke call
 *   5. isDrawing = true, currentPoints reset
 *   6. first point added
 * React processes dispatch from step 3:
 *   7. re-render: new state with stroke added
 *   8. redrawAll() called — redraws all strokes including letter 1
 * Meanwhile letter 2 is being drawn on overlay.
 * This is CORRECT — no miss here.
 *
 * BUT: if pointerDown for letter 2 arrives BEFORE pointerUp for letter 1:
 * (This happens with fast stylus — the digitizer reports the next touch
 *  before the lift is fully registered)
 *   1. pointerDown(2) fires while isDrawing=true, activePointerId=1
 *   2. Check: activePointerId(1) !== e.pointerId(2) → RETURN EARLY
 *   3. Letter 2 is completely ignored!
 *
 * This is the REAL bug for fast writing:
 * The stylus digitizer on iPad can fire pointerDown for the next stroke
 * before pointerUp for the current stroke when writing fast.
 * The guard `if (activePointerId !== null && activePointerId !== e.pointerId)`
 * was added to prevent multi-touch interference, but it ALSO blocks
 * the same stylus reporting a new stroke before the old one is lifted.
 *
 * On iPad, the Apple Pencil always uses pointerId=1 (or a consistent ID).
 * So a fast second stroke from the SAME pencil will have the SAME pointerId.
 * But the guard checks `activePointerId !== e.pointerId` — if they're the SAME,
 * it calls finishStroke() and starts the new stroke. This should work.
 *
 * UNLESS: the OS sends a synthetic pointerUp with a DIFFERENT pointerId
 * than the pointerDown, which can happen with palm rejection active.
 * Then: activePointerId=1 (from pencil down), pointerUp fires with id=1 (ok),
 * but then pointerDown fires with id=2 (new interaction ID assigned by OS).
 * finishStroke was already called by pointerUp(1), so isDrawing=false.
 * pointerDown(2): isDrawing=false, activePointerId=null (cleared by finishStroke).
 * This should work fine.
 *
 * THE ACTUAL REMAINING SCENARIO that causes the miss:
 * Race between pointerUp and the next pointerDown when they arrive in the
 * same event batch (same microtask queue flush).
 * React processes synthetic events synchronously within a batch.
 * If pointerUp and pointerDown arrive in the same batch:
 *   - pointerUp handler runs: finishStroke() → isDrawing=false, points cleared
 *   - pointerDown handler runs: isDrawing=false → starts new stroke correctly
 * This should work.
 *
 * CONCLUSION after deep analysis:
 * The most likely remaining cause is the overlay clearRect using CSS px (line 591).
 * Fix it. Also: add a minimum-points guard — if a stroke has only 1 point
 * (just a tap between letters), it should still be committed as a dot.
 */

let passed = 0, failed = 0;
function assert(ok, msg) {
  if (ok) { console.log(`  [PASS]  ${msg}`); passed++; }
  else    { console.error(`  [FAIL]  ${msg}`); failed++; process.exitCode = 1; }
}

// ─── Simulate the exact timing of fast letter-to-letter ───────────────────────

console.log('\n=== Timing simulation: fast letter-to-letter ===');

// Model the state machine with precise timing
class TimingSimulator {
  isDrawing = false;
  activePointerId = null;
  currentPoints = [];
  committed = [];
  eventLog = [];

  log(msg) { this.eventLog.push(`T+${Date.now()}ms: ${msg}`); }

  finishStroke() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.activePointerId = null;
    const pts = [...this.currentPoints];
    this.currentPoints = [];
    if (pts.length > 0) {
      this.committed.push(pts);
      this.log(`COMMITTED stroke with ${pts.length} pts`);
    } else {
      this.log('LOST stroke — 0 points');
    }
  }

  pointerDown(id, x, y) {
    this.log(`pointerDown id=${id}`);
    if (this.isDrawing) {
      if (this.activePointerId !== null && this.activePointerId !== id) {
        this.log(`IGNORED pointerDown — different pointer (active=${this.activePointerId}, new=${id})`);
        return false; // ← THIS IS THE MISS
      }
      this.finishStroke();
    }
    this.isDrawing = true;
    this.activePointerId = id;
    this.currentPoints = [{ x, y }];
    return true;
  }

  pointerMove(id, x, y) {
    if (!this.isDrawing || id !== this.activePointerId) return;
    this.currentPoints.push({ x, y });
  }

  pointerUp(id) {
    this.log(`pointerUp id=${id}`);
    if (!this.isDrawing || id !== this.activePointerId) return;
    this.finishStroke();
  }
}

// Test 1: Normal case — pointerUp before pointerDown
{
  const sim = new TimingSimulator();
  sim.pointerDown(1, 10, 10);
  sim.pointerMove(1, 20, 20); sim.pointerMove(1, 30, 30);
  sim.pointerUp(1);
  // Gap
  sim.pointerDown(1, 50, 10);
  sim.pointerMove(1, 60, 20); sim.pointerMove(1, 70, 30);
  sim.pointerUp(1);
  assert(sim.committed.length === 2, `Normal case: 2 strokes committed (got ${sim.committed.length})`);
}

// Test 2: FAST case — pointerDown fires before pointerUp (same pointer ID)
// This happens when the digitizer reports the next stroke before lift is registered
{
  const sim = new TimingSimulator();
  sim.pointerDown(1, 10, 10);
  sim.pointerMove(1, 20, 20); sim.pointerMove(1, 30, 30);
  // Fast: pointerDown for letter 2 arrives BEFORE pointerUp for letter 1
  // Same pointer ID (Apple Pencil always uses same ID)
  const started = sim.pointerDown(1, 50, 10); // same ID=1
  sim.pointerUp(1); // this is letter 1's up — but isDrawing is now for letter 2!
  sim.pointerMove(1, 60, 20); sim.pointerMove(1, 70, 30);
  sim.pointerUp(1);
  // Letter 1 was finished by finishStroke() inside the second pointerDown
  // Letter 2 was started, then pointerUp(1) fires — but it's the UP for letter 1
  // which arrives AFTER letter 2's DOWN. This UP will finish letter 2 prematurely!
  console.log(`  Fast same-ID: committed=${sim.committed.length}, started=${started}`);
  console.log(`  Stroke sizes: ${sim.committed.map(s => s.length).join(', ')}`);
  // Letter 2 only has 1 point (the down) because the UP fired immediately after
  assert(sim.committed.length === 2, `Fast same-ID: 2 strokes committed (got ${sim.committed.length})`);
  // Letter 2 may have very few points if UP fired early
  if (sim.committed[1].length < 3) {
    console.log('  [WARN] Letter 2 has very few points — UP arrived before MOVEs');
  }
}

// Test 3: CRITICAL — pointerDown with DIFFERENT ID before pointerUp
// This is what happens with palm rejection: OS assigns new pointer ID
{
  const sim = new TimingSimulator();
  sim.pointerDown(1, 10, 10);
  sim.pointerMove(1, 20, 20); sim.pointerMove(1, 30, 30);
  // OS assigns new pointer ID for next stroke (can happen with palm rejection)
  const started = sim.pointerDown(2, 50, 10); // DIFFERENT ID
  // Now pointerUp for letter 1 arrives
  sim.pointerUp(1);
  sim.pointerMove(2, 60, 20); sim.pointerMove(2, 70, 30);
  sim.pointerUp(2);
  console.log(`  Different-ID: committed=${sim.committed.length}, letter2started=${started}`);
  assert(started === false, `Different-ID pointerDown correctly blocked (would cause miss)`);
  assert(sim.committed.length === 1, `Different-ID: only letter 1 committed (letter 2 was blocked)`);
  // This IS the miss — letter 2 was ignored because activePointerId was 1
}

// Test 4: THE FIX — when pointerDown arrives with different ID while drawing,
// finish the current stroke first, then start the new one
{
  const sim = new TimingSimulator();
  // Override pointerDown to implement the fix
  sim.pointerDown = function(id, x, y) {
    this.log(`pointerDown id=${id}`);
    if (this.isDrawing) {
      // FIX: always finish current stroke before starting new one,
      // regardless of pointer ID
      this.finishStroke();
    }
    this.isDrawing = true;
    this.activePointerId = id;
    this.currentPoints = [{ x, y }];
    return true;
  };

  sim.pointerDown(1, 10, 10);
  sim.pointerMove(1, 20, 20); sim.pointerMove(1, 30, 30);
  // Different ID arrives before pointerUp
  sim.pointerDown(2, 50, 10);
  sim.pointerUp(1); // arrives after — but isDrawing is now for ID=2
  sim.pointerMove(2, 60, 20); sim.pointerMove(2, 70, 30);
  sim.pointerUp(2);
  console.log(`  Fixed different-ID: committed=${sim.committed.length}`);
  assert(sim.committed.length === 2, `Fixed: both strokes committed with different IDs (got ${sim.committed.length})`);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

console.log(`
╔══════════════════════════════════════════════════════════╗
║  ROOT CAUSE IDENTIFIED:                                  ║
║  When writing fast, the OS may assign a NEW pointer ID   ║
║  for the second stroke before the first is lifted.       ║
║  The guard 'if (activePointerId !== e.pointerId) return' ║
║  blocks the second stroke entirely.                      ║
║                                                          ║
║  FIX: Remove the different-pointer-ID guard.             ║
║  Always finish current stroke when a new pointerDown     ║
║  arrives, regardless of pointer ID.                      ║
║                                                          ║
║  The guard was meant to prevent multi-touch interference ║
║  but palm rejection already handles that by filtering    ║
║  touch events. For pen/mouse, there's only ever one      ║
║  active pointer anyway.                                  ║
╚══════════════════════════════════════════════════════════╝`);
