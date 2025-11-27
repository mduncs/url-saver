/**
 * Factory for creating archive buttons across all content scripts
 * Standardized button appearance and behavior
 */

const ButtonFactory = {
  /**
   * Standard archive icon SVG path
   */
  ICON_PATH: 'M12 2L4 6v12l8 4 8-4V6l-8-4zm0 2.18l6 3v8.64l-6 3-6-3V7.18l6-3zM12 7v6m-3-3h6',

  /**
   * Create standard archive button
   * @param {Object} options
   * @param {string} options.size - 'small' (20px), 'medium' (24px), 'large' (32px)
   * @param {string} options.position - 'inline', 'overlay', 'fixed'
   * @param {Function} options.onClick - Click handler
   * @param {Function} options.onHover - Hover handler (optional)
   * @param {boolean} options.showMenu - Show save mode menu on hover
   */
  createButton({ size = 'medium', position = 'inline', onClick, onHover, showMenu = false } = {}) {
    const sizes = { small: 20, medium: 24, large: 32 };
    const px = sizes[size] || sizes.medium;

    const wrapper = document.createElement('div');
    wrapper.className = `archiver-btn archiver-btn-${size} archiver-btn-${position}`;
    wrapper.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: ${px}px;
      height: ${px}px;
      cursor: pointer;
      border-radius: 50%;
      transition: background-color 0.2s, transform 0.1s;
      position: ${position === 'overlay' ? 'absolute' : 'relative'};
    `;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', px * 0.75);
    svg.setAttribute('height', px * 0.75);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', this.ICON_PATH);
    svg.appendChild(path);
    wrapper.appendChild(svg);

    // Event handlers
    if (onClick) {
      wrapper.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      });
    }

    if (onHover) {
      wrapper.addEventListener('mouseenter', onHover);
    }

    // Hover effect
    wrapper.addEventListener('mouseenter', () => {
      wrapper.style.transform = 'scale(1.1)';
    });
    wrapper.addEventListener('mouseleave', () => {
      wrapper.style.transform = 'scale(1)';
    });

    return wrapper;
  },

  /**
   * Create save mode menu (Full / Quick / Text)
   */
  createSaveModeMenu({ onSelect, position = { x: 0, y: 0 } } = {}) {
    const menu = document.createElement('div');
    menu.className = 'archiver-menu';
    menu.style.cssText = `
      position: fixed;
      left: ${position.x}px;
      top: ${position.y}px;
      background: #1a1a2e;
      border-radius: 12px;
      padding: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      z-index: 10001;
      min-width: 180px;
    `;

    const modes = [
      { key: 'full', label: 'Full', desc: 'Media + Screenshot + Metadata', icon: '📦' },
      { key: 'quick', label: 'Quick', desc: 'Media only', icon: '⚡' },
      { key: 'text', label: 'Text', desc: 'Screenshot + Metadata', icon: '📝' }
    ];

    modes.forEach(mode => {
      const item = document.createElement('div');
      item.className = 'archiver-menu-item';
      item.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 8px;
        cursor: pointer;
        color: #fff;
        font-size: 14px;
        transition: background-color 0.15s;
      `;
      item.innerHTML = `
        <span style="font-size: 16px;">${mode.icon}</span>
        <div>
          <div style="font-weight: 500;">${mode.label}</div>
          <div style="font-size: 11px; opacity: 0.6;">${mode.desc}</div>
        </div>
      `;

      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = 'rgba(255,255,255,0.1)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = 'transparent';
      });
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelect(mode.key);
        menu.remove();
      });

      menu.appendChild(item);
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 0);

    return menu;
  },

  /**
   * Create floating overlay button for images/media
   */
  createOverlayButton({ parent, position = 'top-right', onClick } = {}) {
    const positions = {
      'top-right': { top: '8px', right: '8px' },
      'top-left': { top: '8px', left: '8px' },
      'bottom-right': { bottom: '8px', right: '8px' },
      'bottom-left': { bottom: '8px', left: '8px' }
    };

    const btn = this.createButton({
      size: 'medium',
      position: 'overlay',
      onClick
    });

    const pos = positions[position] || positions['top-right'];
    Object.assign(btn.style, pos, {
      backgroundColor: 'rgba(0,0,0,0.6)',
      color: '#fff',
      opacity: '0',
      transition: 'opacity 0.2s'
    });

    // Show on parent hover
    if (parent) {
      parent.style.position = 'relative';
      parent.addEventListener('mouseenter', () => btn.style.opacity = '1');
      parent.addEventListener('mouseleave', () => btn.style.opacity = '0');
      parent.appendChild(btn);
    }

    return btn;
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.ButtonFactory = ButtonFactory;
}
