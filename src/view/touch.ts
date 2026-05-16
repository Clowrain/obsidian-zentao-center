// Touch interaction primitives for the mobile board.
//
// PointerEvent-based (UX-mobile.md §13 #2) so the same code paths handle
// touch, mouse, and pen. Mobile cards intentionally do not enter drag mode:
// movement cancels long-press and either becomes scroll or a horizontal swipe.
//
// `setTimeout` is used for the simple "is the user still here in 500ms"
// timer — that's not a precision requirement.

export interface LongPressOptions {
  /** ms before the long-press fires. Default 500. */
  durationMs?: number;
  /** Cancel if the pointer moves more than this many pixels. Default 4. */
  moveThresholdPx?: number;
  /** Fired once if the user holds still for `durationMs`. */
  onTrigger: () => void;
}

/**
 * Attach a long-press detector to `el`. Returns a detach function that
 * unwires every listener — call it on view re-render so stale cards don't
 * keep window-level move/up listeners around.
 */
export function attachLongPress(
  el: HTMLElement,
  opts: LongPressOptions,
): () => void {
  const durationMs = opts.durationMs ?? 500;
  const moveThresholdPx = opts.moveThresholdPx ?? 4;
  let timer: number | null = null;
  let startX = 0;
  let startY = 0;

  const cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", cancel);
    window.removeEventListener("pointercancel", cancel);
  };

  const onMove = (e: PointerEvent) => {
    if (
      Math.abs(e.clientX - startX) > moveThresholdPx ||
      Math.abs(e.clientY - startY) > moveThresholdPx
    ) {
      // Movement past threshold = drag intent or scroll, NOT long-press.
      // Bail without firing — never claim a gesture the user redirected.
      cancel();
    }
  };

  const onDown = (e: PointerEvent) => {
    // Right-click / aux button shouldn't fire long-press on desktop browsers.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    timer = window.setTimeout(() => {
      timer = null;
      // Move/up listeners can stay no-op until cleared on real release —
      // simpler to just clear them now that we've fired.
      cancel();
      opts.onTrigger();
    }, durationMs);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cancel);
    window.addEventListener("pointercancel", cancel);
  };

  el.addEventListener("pointerdown", onDown);
  return () => {
    el.removeEventListener("pointerdown", onDown);
    cancel();
  };
}

export interface SwipeOptions {
  /** Fraction of element width that must be crossed to commit. Default 0.30. */
  thresholdRatio?: number;
  /** Fired when the user swipes left past the threshold. */
  onSwipeLeft?: () => void;
  /** Fired when the user swipes right past the threshold. */
  onSwipeRight?: () => void;
  /**
   * Optional progress callback (0..1) per pointermove tick. Default writes
   * `--tc-swipe-progress` and `--tc-swipe-direction` (left|right) on the
   * element so styles.css can render visual feedback without JS knowing
   * about colors.
   */
  onProgress?: (
    el: HTMLElement,
    direction: "left" | "right" | null,
    progress: number,
  ) => void;
}

/**
 * Attach a horizontal-swipe-to-action detector. Vertical movement cancels
 * the gesture (so vertical scroll keeps working). Swipe and long-press
 * coexist on the same element: long-press cancels itself once the user
 * starts moving, so the gestures are mutually exclusive without explicit
 * coordination.
 */
export function attachSwipe(
  el: HTMLElement,
  opts: SwipeOptions,
): () => void {
  const ratio = opts.thresholdRatio ?? 0.3;
  let active = false;
  let startX = 0;
  let startY = 0;
  let elWidth = 0;

  const writeProgress = (
    direction: "left" | "right" | null,
    progress: number,
  ) => {
    if (opts.onProgress) {
      opts.onProgress(el, direction, progress);
      return;
    }
    if (direction === null) {
      el.style.removeProperty("--tc-swipe-progress");
      el.style.removeProperty("--tc-swipe-direction");
    } else {
      el.style.setProperty("--tc-swipe-progress", String(progress));
      el.style.setProperty("--tc-swipe-direction", direction);
    }
  };

  const reset = () => {
    if (!active) return;
    active = false;
    writeProgress(null, 0);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", reset);
  };

  const onMove = (e: PointerEvent) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    // If the user is mostly moving vertically, this isn't a swipe — cancel
    // and let the page scroll / outer scroller take over.
    if (Math.abs(dy) > Math.abs(dx)) {
      reset();
      return;
    }
    const direction: "left" | "right" = dx < 0 ? "left" : "right";
    const progress = Math.min(Math.abs(dx) / (elWidth * ratio), 1);
    writeProgress(direction, progress);
  };

  const onUp = (e: PointerEvent) => {
    const dx = e.clientX - startX;
    const direction: "left" | "right" = dx < 0 ? "left" : "right";
    const progress = elWidth > 0 ? Math.abs(dx) / (elWidth * ratio) : 0;
    reset();
    if (progress < 1) return;
    if (direction === "left" && opts.onSwipeLeft) opts.onSwipeLeft();
    else if (direction === "right" && opts.onSwipeRight) opts.onSwipeRight();
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    elWidth = el.getBoundingClientRect().width;
    active = true;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", reset);
  };

  el.addEventListener("pointerdown", onDown);
  return () => {
    el.removeEventListener("pointerdown", onDown);
    reset();
  };
}

// ============================================================================
// attachCardGestures — unified long-press + swipe state machine.
//
// UX-mobile §13 #6 says long-press and scroll / swipe arbitration must live
// in one controller. Mobile drag was deliberately removed: moving a held card
// must never create a drag session.
//
// State diagram (one pointerdown):
//
//   idle → arming                              [pointerdown]
//   arming → cancelled                          [vertical move > threshold]
//   arming → swiping                            [horizontal move > threshold]
//   arming → long-press fired                   [500ms timer fires, no move]
//   arming → tap                                [pointerup before 250ms]
//
// Swipe is inline here so it can cancel the long-press timer immediately and
// never race with a second listener on the same card.
// ============================================================================

export interface CardGestureOptions {
  /** ms before long-press menu fires (default 500). */
  longPressMs?: number;
  /** Distance considered "moved" (default 4px). */
  moveThresholdPx?: number;
  /** Swipe commit threshold as fraction of element width (default 0.50). */
  swipeThresholdRatio?: number;
  /** Long-press menu callback (e.g. open card action sheet). */
  onLongPress?: () => void;
  /** Swipe-left commit (e.g. mark done). */
  onSwipeLeft?: () => void;
  /** Swipe-right commit (e.g. drop). */
  onSwipeRight?: () => void;
  /** Optional swipe progress callback. Default writes CSS custom properties. */
  onSwipeProgress?: (
    el: HTMLElement,
    direction: "left" | "right" | null,
    progress: number,
  ) => void;
}

type GesturePhase = "idle" | "arming" | "swiping";

export function attachCardGestures(
  el: HTMLElement,
  opts: CardGestureOptions,
): () => void {
  const longPressMs = opts.longPressMs ?? 500;
  const moveThresholdPx = opts.moveThresholdPx ?? 4;
  const swipeRatio = opts.swipeThresholdRatio ?? 0.5;

  let phase: GesturePhase = "idle";
  let longPressTimer: number | null = null;
  let startX = 0;
  let startY = 0;
  let elWidth = 0;

  const writeSwipeProgress = (
    direction: "left" | "right" | null,
    progress: number,
  ) => {
    if (opts.onSwipeProgress) {
      opts.onSwipeProgress(el, direction, progress);
      return;
    }
    if (direction === null) {
      el.style.removeProperty("--tc-swipe-progress");
      el.style.removeProperty("--tc-swipe-direction");
    } else {
      el.style.setProperty("--tc-swipe-progress", String(progress));
      el.style.setProperty("--tc-swipe-direction", direction);
    }
  };

  const clearTimers = () => {
    if (longPressTimer !== null) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const detachWindow = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
  };

  const reset = () => {
    clearTimers();
    detachWindow();
    if (phase === "swiping") writeSwipeProgress(null, 0);
    phase = "idle";
  };

  const onMove = (e: PointerEvent) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const dist = Math.hypot(dx, dy);

    if (phase === "arming") {
      if (dist <= moveThresholdPx) return;
      // Past threshold = scroll/swipe intent. We hand off to swipe detection
      // if dominantly horizontal, otherwise abort fully (let outer scroll happen).
      clearTimers();
      if (Math.abs(dy) > Math.abs(dx)) {
        // Vertical movement = scroll. Bail.
        reset();
        return;
      }
      phase = "swiping";
      // fall through into swipe handling below
    }

    if (phase === "swiping") {
      // Same logic as attachSwipe: cancel on vertical dominance, write
      // progress, commit on pointerup.
      if (Math.abs(dy) > Math.abs(dx)) {
        reset();
        return;
      }
      const direction: "left" | "right" = dx < 0 ? "left" : "right";
      const progress = Math.min(Math.abs(dx) / (elWidth * swipeRatio), 1);
      writeSwipeProgress(direction, progress);
      return;
    }
  };

  const onUp = (e: PointerEvent) => {
    if (phase === "swiping") {
      const dx = e.clientX - startX;
      const direction: "left" | "right" = dx < 0 ? "left" : "right";
      const progress = elWidth > 0 ? Math.abs(dx) / (elWidth * swipeRatio) : 0;
      reset();
      if (progress < 1) return;
      if (direction === "left" && opts.onSwipeLeft) opts.onSwipeLeft();
      else if (direction === "right" && opts.onSwipeRight) opts.onSwipeRight();
      return;
    }
    // arming pointerup = no-op (tap doesn't trigger anything
    // here; existing card click handler already covers tap-to-select).
    reset();
  };

  const onCancel = () => {
    reset();
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (phase !== "idle") return; // re-entry guard
    startX = e.clientX;
    startY = e.clientY;
    elWidth = el.getBoundingClientRect().width;
    phase = "arming";

    if (opts.onLongPress) {
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        // Long-press fires only if we never reached swipe and never moved.
        if (phase === "arming") {
          clearTimers();
          detachWindow();
          phase = "idle";
          opts.onLongPress?.();
        }
      }, longPressMs);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  el.addEventListener("pointerdown", onDown);
  return () => {
    el.removeEventListener("pointerdown", onDown);
    reset();
  };
}
