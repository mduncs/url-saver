/**
 * Simplified Emotion Wheel - 8-sector radial selector for tagging at download time
 *
 * Plutchik's 8 base emotions: joy, trust, fear, surprise, sadness, disgust, anger, anticipation
 *
 * Usage:
 *   EmotionWheel.show(x, y, (emotion) => {
 *     console.log(emotion); // 'joy', 'trust', etc.
 *   });
 *   EmotionWheel.hide();
 */

const EmotionWheel = (function() {
  'use strict';

  // Plutchik's 8 base emotions with colors
  const EMOTIONS = [
    { name: 'joy', color: '#FFE66D' },
    { name: 'trust', color: '#98D8AA' },
    { name: 'fear', color: '#4ECDC4' },
    { name: 'surprise', color: '#45B7D1' },
    { name: 'sadness', color: '#7B68EE' },
    { name: 'disgust', color: '#9B59B6' },
    { name: 'anger', color: '#E74C3C' },
    { name: 'anticipation', color: '#F39C12' }
  ];

  let state = {
    active: false,
    element: null,
    selected: null,
    callback: null
  };

  // ═══════════════════════════════════════════════════════════════════
  // SVG GENERATION
  // ═══════════════════════════════════════════════════════════════════

  function createWheel(size = 280) {
    const wheel = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wheel.setAttribute('viewBox', '-1 -1 2 2');
    wheel.setAttribute('width', size);
    wheel.setAttribute('height', size);
    wheel.setAttribute('class', 'emotion-wheel');
    wheel.style.cssText = `
      position: fixed;
      pointer-events: auto;
      filter: drop-shadow(0 8px 32px rgba(0,0,0,0.4));
      z-index: 2147483647;
      transform: scale(0.8);
      opacity: 0;
      transition: transform 0.2s ease-out, opacity 0.2s ease-out;
    `;

    const numSectors = EMOTIONS.length;
    const anglePerSector = (2 * Math.PI) / numSectors;
    const innerRadius = 0.28;
    const outerRadius = 0.92;

    // Draw 8 sectors
    EMOTIONS.forEach((emotion, i) => {
      const startAngle = i * anglePerSector - Math.PI / 2;
      const endAngle = startAngle + anglePerSector;

      const path = createArcPath(innerRadius, outerRadius, startAngle, endAngle);
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', path);
      pathEl.setAttribute('fill', emotion.color);
      pathEl.setAttribute('stroke', 'rgba(255,255,255,0.4)');
      pathEl.setAttribute('stroke-width', '0.008');
      pathEl.style.cursor = 'pointer';
      pathEl.style.transition = 'filter 0.1s, transform 0.1s';
      pathEl.dataset.emotion = emotion.name;
      wheel.appendChild(pathEl);

      // Label
      const midAngle = (startAngle + endAngle) / 2;
      const labelRadius = (innerRadius + outerRadius) / 2;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', labelRadius * Math.cos(midAngle));
      label.setAttribute('y', labelRadius * Math.sin(midAngle) + 0.02);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('fill', 'rgba(0,0,0,0.75)');
      label.setAttribute('font-size', '0.11');
      label.setAttribute('font-weight', '600');
      label.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, sans-serif');
      label.textContent = emotion.name;
      label.style.pointerEvents = 'none';
      label.style.textTransform = 'uppercase';
      wheel.appendChild(label);
    });

    // Center cancel zone
    const center = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    center.setAttribute('cx', '0');
    center.setAttribute('cy', '0');
    center.setAttribute('r', '0.25');
    center.setAttribute('fill', 'rgba(30, 30, 30, 0.95)');
    center.setAttribute('stroke', 'rgba(255,255,255,0.2)');
    center.setAttribute('stroke-width', '0.01');
    center.style.cursor = 'pointer';
    center.dataset.cancel = 'true';
    wheel.appendChild(center);

    const centerText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    centerText.setAttribute('x', '0');
    centerText.setAttribute('y', '0.03');
    centerText.setAttribute('text-anchor', 'middle');
    centerText.setAttribute('dominant-baseline', 'middle');
    centerText.setAttribute('fill', 'rgba(255,255,255,0.6)');
    centerText.setAttribute('font-size', '0.09');
    centerText.textContent = 'skip';
    centerText.style.pointerEvents = 'none';
    wheel.appendChild(centerText);

    return wheel;
  }

  function createArcPath(innerRadius, outerRadius, startAngle, endAngle) {
    const polarToXY = (r, a) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
    const innerStart = polarToXY(innerRadius, startAngle);
    const innerEnd = polarToXY(innerRadius, endAngle);
    const outerStart = polarToXY(outerRadius, startAngle);
    const outerEnd = polarToXY(outerRadius, endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

    return [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerEnd.x} ${innerEnd.y}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
      'Z'
    ].join(' ');
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERACTION
  // ═══════════════════════════════════════════════════════════════════

  function handleMouseMove(e) {
    if (!state.active || !state.element) return;

    const wheel = state.element;
    const rect = wheel.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const normalizedDist = Math.sqrt(dx * dx + dy * dy) / (rect.width / 2);

    // Reset highlights
    wheel.querySelectorAll('path').forEach(p => {
      p.style.filter = '';
      p.style.transform = '';
    });

    // Cancel zone or outside
    if (normalizedDist < 0.25 || normalizedDist > 1) {
      state.selected = null;
      return;
    }

    // Find hovered sector
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (target && target.dataset.emotion) {
      target.style.filter = 'brightness(1.15)';
      target.style.transform = 'scale(1.03)';
      state.selected = target.dataset.emotion;
    }
  }

  function setupClickHandler(wheel, callback) {
    wheel.addEventListener('click', (e) => {
      const target = e.target;

      if (target.dataset.cancel) {
        callback(null); // Skip tagging
        hide();
        return;
      }

      if (target.dataset.emotion) {
        callback(target.dataset.emotion);
        hide();
      }
    });

    // Close on outside click
    setTimeout(() => {
      const closeHandler = (e) => {
        if (!wheel.contains(e.target) && state.active) {
          hide();
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    }, 100);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════

  function show(x, y, onSelect) {
    hide();

    const wheel = createWheel(280);
    wheel.style.left = `${x - 140}px`;
    wheel.style.top = `${y - 140}px`;
    document.body.appendChild(wheel);

    requestAnimationFrame(() => {
      wheel.style.transform = 'scale(1)';
      wheel.style.opacity = '1';
    });

    state = {
      active: true,
      element: wheel,
      selected: null,
      callback: onSelect
    };

    document.addEventListener('mousemove', handleMouseMove);
    setupClickHandler(wheel, onSelect);
  }

  function hide() {
    if (state.element) {
      state.element.style.transform = 'scale(0.8)';
      state.element.style.opacity = '0';
      setTimeout(() => state.element?.remove(), 200);
    }
    document.removeEventListener('mousemove', handleMouseMove);
    state = { active: false, element: null, selected: null, callback: null };
  }

  function release(forceClose = false) {
    if (!state.active) return;

    if (state.selected && state.callback) {
      state.callback(state.selected);
      hide();
      return;
    }

    if (forceClose) {
      state.callback?.(null);
      hide();
    }
  }

  function isActive() {
    return state.active;
  }

  return {
    show,
    hide,
    release,
    isActive,
    EMOTIONS: EMOTIONS.map(e => e.name)
  };
})();

if (typeof window !== 'undefined') {
  window.EmotionWheel = EmotionWheel;
}
