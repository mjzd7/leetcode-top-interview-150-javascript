/**
 * Cursor & Magnetic Lens Physics Integrator
 * Semi-implicit Euler spring stepped at fixed 240Hz (H = 1/240).
 */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  // Interactive targets selector
  const INTERACTIVE_SELECTOR =
    'a, button, [role="button"], input, select, .nav-item, #paletteBtn, #guidesBtn, #themeToggle, [data-cur="link"], .ltc-chip';

  const TEXT_SELECTOR =
    '.prose p, .prose li, .prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6, .prose blockquote, .prose td, .prose th, pre, pre code, textarea, input[type="text"], input:not([type]), input[type="search"], [contenteditable="true"], [data-cursor-text]';

  // Fixed timestep for physics (240Hz)
  const H = 1 / 240;

  // Spring constants
  // Dot: k = 1400, c = 60
  const DOT_K = 1400;
  const DOT_C = 60;
  // Ring: k = 190, c = 17
  const RING_K = 190;
  const RING_C = 17;
  // Scale: k = 240, c = 20
  const SCALE_K = 240;
  const SCALE_C = 20;

  // Elements
  let dot = null;
  let ring = null;
  let isMounted = false;

  // Mouse & Target positions
  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let targetX = mouseX;
  let targetY = mouseY;
  let targetScale = 1.0;

  // Integrator state
  let dotX = mouseX;
  let dotY = mouseY;
  let dotVx = 0;
  let dotVy = 0;

  let ringX = mouseX;
  let ringY = mouseY;
  let ringVx = 0;
  let ringVy = 0;

  let currentScale = 1.0;
  let scaleVx = 0;

  let rafId = null;
  let lastTime = performance.now();

  // Expose sleep state and target coordinates for testing
  window.__cursorSpringSleeping = false;
  window.__cursorTargetX = targetX;
  window.__cursorTargetY = targetY;

  function mountCursor() {
    if (!document.body || isMounted) return;

    dot = document.getElementById('cur-dot');
    if (!dot) {
      dot = document.createElement('div');
      dot.id = 'cur-dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.innerHTML =
        '<svg viewBox="0 0 6 6" width="6" height="6" style="display:block;overflow:visible;"><circle cx="3" cy="3" r="3" fill="#ffffff" shape-rendering="geometricPrecision"/></svg>';
      document.body.appendChild(dot);
    } else if (!dot.querySelector('svg')) {
      dot.innerHTML =
        '<svg viewBox="0 0 6 6" width="6" height="6" style="display:block;overflow:visible;"><circle cx="3" cy="3" r="3" fill="#ffffff" shape-rendering="geometricPrecision"/></svg>';
    }

    ring = document.getElementById('cur-ring');
    const ringMarkup =
      '<svg class="cur-ring-circle" viewBox="0 0 32 32" width="32" height="32" style="position:absolute;inset:0;pointer-events:none;overflow:visible;"><circle cx="16" cy="16" r="15.5" fill="none" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke" shape-rendering="geometricPrecision"/></svg>' +
      '<div class="cur-icons" aria-hidden="true" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">' +
      '<svg class="cur-icon cur-icon-ew" viewBox="0 0 20 12" width="20" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l3-3m-3 3l3 3m-3-3h12m0 0l-3-3m3 3l-3 3"/></svg>' +
      '<svg class="cur-icon cur-icon-ns" viewBox="0 0 12 20" width="12" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l-3 3m3-3l3 3m-3-3v12m0 0l-3-3m3 3l3-3"/></svg>' +
      '<svg class="cur-icon cur-icon-nwse" viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h7M4 4v7M4 4l10 10m0 0v-7m0 7h-7"/></svg>' +
      '<svg class="cur-icon cur-icon-nesw" viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4H7M14 4v7M14 4L4 14m0 0v-7m0 7h7"/></svg>' +
      '<svg class="cur-icon cur-icon-grab" viewBox="0 0 12 16" width="12" height="16" fill="currentColor"><circle cx="3" cy="3" r="1.3"/><circle cx="9" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="9" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="9" cy="13" r="1.3"/></svg>' +
      '</div>';
    if (!ring) {
      ring = document.createElement('div');
      ring.id = 'cur-ring';
      ring.setAttribute('aria-hidden', 'true');
      ring.innerHTML = ringMarkup;
      document.body.appendChild(ring);
    } else if (!ring.querySelector('.cur-icons')) {
      ring.innerHTML = ringMarkup;
    }

    isMounted = true;
    document.documentElement.dataset.cursor = 'on';

    // Apply initial transforms
    dot.style.transform = `translate3d(${dotX.toFixed(2)}px, ${dotY.toFixed(2)}px, 0)`;
    ring.style.transform = `translate3d(${ringX.toFixed(2)}px, ${ringY.toFixed(2)}px, 0) scale(${currentScale.toFixed(3)})`;

    wakeUp();
  }

  function isInlineLinkOrTag(el) {
    if (!el || !(el instanceof Element)) return false;

    // Sidebar navigation items follow Rule 2 (.nav-item)
    if (el.closest('.nav-item')) {
      return false;
    }

    // Form inputs and editable fields follow Rule 0 (native text caret)
    if (el.closest('input, textarea, select, [contenteditable="true"]')) {
      return false;
    }

    // Explicit buttons, controls, chips, and toggles follow Rule 3 (corner snap)
    if (
      el.closest(
        'button, [role="button"], #themeToggle, #paletteBtn, #guidesBtn, #brandHome, .btn, .copy-btn, .nav-cat-btn, .ltc-chip, [data-cur="button"]'
      )
    ) {
      return false;
    }

    // Inline tags, badges, and code links
    if (
      el.closest(
        '.badge, .tag, .nav-badge, .ltc-empty-badge, code.primer-link, .leetcode-link, code.leetcode-code, [data-tag]'
      )
    ) {
      return true;
    }

    // Anchors / links
    const anchor = el.closest('a');
    if (anchor) {
      const cls = typeof anchor.className === 'string' ? anchor.className : '';
      // If styled as an action button or chip, treat as interactive control (Rule 3)
      if (
        cls.includes('btn') ||
        cls.includes('chip') ||
        cls.includes('h-11') ||
        cls.includes('h-10') ||
        cls.includes('rounded-xl') ||
        cls.includes('rounded-lg')
      ) {
        return false;
      }
      return true;
    }

    return false;
  }

  function updateTarget(targetEl) {
    // 0. Active drag/resize or native cursor zones:
    // When dragging the panel, resizing via handles/resizers, hovering over handles, grips,
    // draggable titlebar, or when panel is in fullscreen mode, suppress custom cursor and let native cursor show.
    // 0. Active dragging mode
    if (document.body.classList.contains('is-chat-dragging')) {
      document.documentElement.setAttribute('data-cursor-mode', 'grabbing');
      if (dot) dot.style.opacity = '0';
      if (ring) ring.style.opacity = '1';
      targetX = mouseX;
      targetY = mouseY;
      targetScale = 0.9;
      window.__cursorTargetX = targetX;
      window.__cursorTargetY = targetY;
      return;
    }

    // 0b. Active resizing mode
    const resizingEdge = document.body.getAttribute('data-resizing');
    if (resizingEdge) {
      let mode = 'resize-ew';
      if (resizingEdge === 'e' || resizingEdge === 'w') {
        mode = 'resize-ew';
      } else if (resizingEdge === 'n' || resizingEdge === 's') {
        mode = 'resize-ns';
      } else if (resizingEdge === 'nw' || resizingEdge === 'se') {
        mode = 'resize-nwse';
      } else if (resizingEdge === 'ne' || resizingEdge === 'sw') {
        mode = 'resize-nesw';
      }
      document.documentElement.setAttribute('data-cursor-mode', mode);
      if (dot) dot.style.opacity = '0';
      if (ring) ring.style.opacity = '1';
      targetX = mouseX;
      targetY = mouseY;
      targetScale = 1.0;
      window.__cursorTargetX = targetX;
      window.__cursorTargetY = targetY;
      return;
    }

    // 0c. Hovering over handles or resizers
    if (targetEl instanceof Element) {
      const handle = targetEl.closest('.ltc-handle, .ltc-panel-resizer, #ltRailResizer');
      if (handle) {
        let mode = 'resize-ew';
        if (handle.classList.contains('ltc-handle-n') || handle.classList.contains('ltc-handle-s') || handle.classList.contains('ltc-panel-resizer')) {
          mode = 'resize-ns';
        } else if (handle.classList.contains('ltc-handle-nw') || handle.classList.contains('ltc-handle-se')) {
          mode = 'resize-nwse';
        } else if (handle.classList.contains('ltc-handle-ne') || handle.classList.contains('ltc-handle-sw')) {
          mode = 'resize-nesw';
        } else {
          mode = 'resize-ew';
        }
        document.documentElement.setAttribute('data-cursor-mode', mode);
        if (dot) dot.style.opacity = '0';
        if (ring) ring.style.opacity = '1';
        targetX = mouseX;
        targetY = mouseY;
        targetScale = 1.0;
        window.__cursorTargetX = targetX;
        window.__cursorTargetY = targetY;
        return;
      }

      // Titlebar drag grip or draggable header (excluding buttons inside header)
      const isGrip = targetEl.closest('.ltc-drag-grip');
      const isHeader = targetEl.closest('.ltc-head') && !targetEl.closest('button, .ltc-icon-btn, input, textarea, a');
      if (isGrip || isHeader) {
        document.documentElement.setAttribute('data-cursor-mode', 'grab');
        if (dot) dot.style.opacity = '0';
        if (ring) ring.style.opacity = '1';
        targetX = mouseX;
        targetY = mouseY;
        targetScale = 1.0;
        window.__cursorTargetX = targetX;
        window.__cursorTargetY = targetY;
        return;
      }
    }

    // Restore dot and ring opacity when exiting handle/grab mode
    if (dot && ring) {
      dot.style.opacity = '1';
      ring.style.opacity = '1';
    }

    // 1. Form inputs and text fields always use native text cursor
    if (
      targetEl instanceof Element &&
      targetEl.closest(
        'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]'
      )
    ) {
      document.documentElement.setAttribute('data-cursor-mode', 'text');
      targetX = mouseX;
      targetY = mouseY;
      targetScale = 1.0;
      window.__cursorTargetX = targetX;
      window.__cursorTargetY = targetY;
      return;
    }

    // 1. Sidebar navigation items: circle geometry is vertically centered,
    // and the centre point of the circle rests on the right border middle of the vertical height of the element
    const navItem = targetEl instanceof Element ? targetEl.closest('.nav-item') : null;
    if (navItem) {
      const rect = navItem.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        const compactScale = Math.min(0.75, Math.max(0.45, (rect.height * 0.55) / 32));
        targetScale = compactScale;

        // Center point of circle rests on the right border middle of the vertical height of the element
        targetX = rect.right;
        targetY = rect.top + rect.height / 2;

        document.documentElement.setAttribute('data-cursor-mode', 'link');
        window.__cursorTargetX = targetX;
        window.__cursorTargetY = targetY;
        return;
      }
    }

    // 2. Inline links and tags: remove the circle ring, dot follows cursor, link highlighted with underline
    if (isInlineLinkOrTag(targetEl)) {
      document.documentElement.setAttribute('data-cursor-mode', 'inline-link');
      targetX = mouseX;
      targetY = mouseY;
      targetScale = 0;
      window.__cursorTargetX = targetX;
      window.__cursorTargetY = targetY;
      return;
    }

    // 3. Rest of all things (buttons, controls, toggles, chips, cards):
    // Centre of circle at the exact top right of the element without offset,
    // 1/4 of the circle inside the element and 3/4 outside, with proportional scale factor.
    const interactiveEl =
      targetEl instanceof Element ? targetEl.closest(INTERACTIVE_SELECTOR) : null;

    if (interactiveEl) {
      const rect = interactiveEl.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        const compactScale = Math.min(0.85, Math.max(0.45, (Math.min(rect.height, 64) * 0.55) / 32));
        targetScale = compactScale;

        // Centre of circle at exact top right of element (1/4 inside element, 3/4 outside element)
        targetX = rect.right;
        targetY = rect.top;

        document.documentElement.setAttribute('data-cursor-mode', 'link');
        window.__cursorTargetX = targetX;
        window.__cursorTargetY = targetY;
        return;
      }
    }

    // 4. Selectable prose paragraphs, lists, and code blocks use native text caret
    if (targetEl instanceof Element && targetEl.closest(TEXT_SELECTOR)) {
      document.documentElement.setAttribute('data-cursor-mode', 'text');
      targetX = mouseX;
      targetY = mouseY;
      targetScale = 1.0;
      window.__cursorTargetX = targetX;
      window.__cursorTargetY = targetY;
      return;
    }

    // 5. Default / unconstrained pointer tracking
    targetX = mouseX;
    targetY = mouseY;
    targetScale = 1.0;
    document.documentElement.removeAttribute('data-cursor-mode');
    window.__cursorTargetX = targetX;
    window.__cursorTargetY = targetY;
  }

  function wakeUp() {
    window.__cursorSpringSleeping = false;
    if (!rafId && isMounted) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    const n = Math.max(1, Math.ceil(dt / H));

    const curMode = document.documentElement.getAttribute('data-cursor-mode') || '';
    const isTextMode = curMode === 'text';
    const isResizeOrGrab = /^(resize|grab)/.test(curMode);
    const curRingK = isTextMode || isResizeOrGrab ? 1400 : RING_K;
    const curRingC = isTextMode || isResizeOrGrab ? 60 : RING_C;

    for (let i = 0; i < n; i++) {
      // Semi-implicit Euler integration:
      // v_{n+1} = v_n + a_n * H
      // x_{n+1} = x_n + v_{n+1} * H

      // Dot spring: k = 1400, c = 60
      const dotAx = -DOT_K * (dotX - mouseX) - DOT_C * dotVx;
      dotVx += dotAx * H;
      dotX += dotVx * H;

      const dotAy = -DOT_K * (dotY - mouseY) - DOT_C * dotVy;
      dotVy += dotAy * H;
      dotY += dotVy * H;

      // Ring spring (adaptive stiffness: instant tracking in text caret mode, fluid magnetic spring on buttons)
      const ringAx = -curRingK * (ringX - targetX) - curRingC * ringVx;
      ringVx += ringAx * H;
      ringX += ringVx * H;

      const ringAy = -curRingK * (ringY - targetY) - curRingC * ringVy;
      ringVy += ringAy * H;
      ringY += ringVy * H;

      // Scale spring: k = 240, c = 20
      const scaleA = -SCALE_K * (currentScale - targetScale) - SCALE_C * scaleVx;
      scaleVx += scaleA * H;
      currentScale += scaleVx * H;
    }

    dot.style.transform = `translate3d(${dotX.toFixed(2)}px, ${dotY.toFixed(2)}px, 0)`;
    ring.style.transform = `translate3d(${ringX.toFixed(2)}px, ${ringY.toFixed(2)}px, 0) scale(${currentScale.toFixed(3)})`;

    // Rest/Sleep threshold:
    if (
      Math.hypot(dotVx, dotVy) < 0.05 &&
      Math.hypot(ringVx, ringVy) < 0.05 &&
      Math.hypot(ringX - targetX, ringY - targetY) < 0.1 &&
      Math.abs(scaleVx) < 0.005 &&
      Math.abs(currentScale - targetScale) < 0.005
    ) {
      // Snap to exact targets at rest
      dotX = mouseX;
      dotY = mouseY;
      dotVx = 0;
      dotVy = 0;

      ringX = targetX;
      ringY = targetY;
      ringVx = 0;
      ringVy = 0;

      currentScale = targetScale;
      scaleVx = 0;

      dot.style.transform = `translate3d(${dotX.toFixed(2)}px, ${dotY.toFixed(2)}px, 0)`;
      ring.style.transform = `translate3d(${ringX.toFixed(2)}px, ${ringY.toFixed(2)}px, 0) scale(${currentScale.toFixed(3)})`;

      window.__cursorSpringSleeping = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      return;
    }

    window.__cursorSpringSleeping = false;
    rafId = requestAnimationFrame(frame);
  }

  function onPointerMove(e) {
    // If input is from touch (e.g. tablet finger drag), hide cursor to prevent orphaned dot
    if (e.pointerType === 'touch') {
      if (dot && ring) {
        dot.style.opacity = '0';
        ring.style.opacity = '0';
      }
      return;
    }

    // Restore visibility when mouse or stylus is active
    if (dot && ring && dot.style.opacity === '0') {
      const activeMode = document.documentElement.getAttribute('data-cursor-mode') || '';
      if (!activeMode.startsWith('resize') && activeMode !== 'grab' && activeMode !== 'grabbing' && activeMode !== 'text') {
        dot.style.opacity = '1';
      }
      ring.style.opacity = '1';
    }

    mouseX = e.clientX;
    mouseY = e.clientY;

    // Delegated spotlight tracking: compute --mx and --my on closest [data-spot], .spot, tables, and chat cards
    if (e.target instanceof Element) {
      const spotEl = e.target.closest('[data-spot], .spot, .table-scroll, .ltc-table-scroll, .tbl, .chat-code, .ltc-msg--user .ltc-msg-body');
      if (spotEl) {
        const rect = spotEl.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const mx = (((e.clientX - rect.left) / rect.width) * 100).toFixed(1) + '%';
          const my = (((e.clientY - rect.top) / rect.height) * 100).toFixed(1) + '%';
          spotEl.style.setProperty('--mx', mx);
          spotEl.style.setProperty('--my', my);
        }
      }
    }

    updateTarget(e.target);
    wakeUp();
  }

  function onPointerDown(e) {
    if (e.pointerType === 'touch') {
      if (dot && ring) {
        dot.style.opacity = '0';
        ring.style.opacity = '0';
      }
    }
  }

  function onScroll() {
    if (
      mouseX >= 0 &&
      mouseY >= 0 &&
      mouseX <= window.innerWidth &&
      mouseY <= window.innerHeight
    ) {
      const el = document.elementFromPoint(mouseX, mouseY);
      updateTarget(el);
    }
    wakeUp();
  }

  // Event listeners
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });

  // Mount automatically on DOMContentLoaded or immediately if body exists
  if (document.body) {
    mountCursor();
  } else {
    document.addEventListener('DOMContentLoaded', mountCursor);
  }
})();
