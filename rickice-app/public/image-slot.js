/* <image-slot> — read-only photo display used across the site.
   Renders whatever URL is in `src`. There is no upload, drag-and-drop, or
   click-to-browse here on purpose: photos are only ever changed through the
   admin panel (Products / Categories / Page text tabs), which writes a real
   URL into the database. This component just displays that URL.
   Attributes: id (unused, kept for markup compatibility), shape
   (rect|rounded|circle|pill, default rounded), radius (px, for 'rounded'),
   mask (CSS clip-path, overrides shape), fit (cover|contain, default cover),
   placeholder (empty-state caption), src, credit, credit-href. */
(() => {
  const UNSPLASH_HOMEPAGE_HREF = 'https://unsplash.com/?utm_source=claude_design&utm_medium=referral';
  const isUnsplashHost = (u) => {
    try { return /(^|\.)unsplash\.com$/.test(new URL(u, document.baseURI).hostname.replace(/\.$/, '')); }
    catch { return false; }
  };
  const withReferral = (href) => {
    try {
      const u = new URL(href);
      if (!/(^|\.)unsplash\.com$/.test(u.hostname.replace(/\.$/, ''))) return href;
      if (!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', 'claude_design');
      if (!u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', 'referral');
      return u.toString();
    } catch { return href; }
  };

  const stylesheet =
    ':host{display:block;position:relative;font:13px/1.3 system-ui,-apple-system,sans-serif;' +
    '  width:100%;height:100%;aspect-ratio:3/2}' +
    '.frame{position:absolute;inset:0;overflow:hidden;background:rgba(127,127,127,.08)}' +
    '.frame img{width:100%;height:100%;display:block}' +
    '.empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    '  justify-content:center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;' +
    '  color:inherit;opacity:.6}' +
    '.empty .cap{max-width:90%;font-weight:500;letter-spacing:.01em}' +
    '.ring{position:absolute;inset:0;pointer-events:none;border:1.5px dashed currentColor;opacity:.35}' +
    ':host([data-filled]) .ring{display:none}' +
    '.credit{position:absolute;left:6px;bottom:6px;max-width:calc(100% - 12px);display:none;' +
    '  padding:3px 7px;border-radius:5px;background:rgba(0,0,0,.55);color:#fff;' +
    '  font:10px/1.2 system-ui,-apple-system,sans-serif;text-decoration:none;' +
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.credit a{color:inherit;text-decoration:none}' +
    '.credit a:hover{text-decoration:underline}' +
    ':host([data-credit]) .credit{display:block}' +
    '.attr-error{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;' +
    '  justify-content:center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;' +
    '  background:#f2f1ef;color:#6e6c66;font:13px/1.45 system-ui,-apple-system,sans-serif}' +
    ':host([data-attribution-error]) .attr-error{display:flex}' +
    ':host([data-attribution-error]) .ring{display:none}';

  const icon = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>' +
    '<path d="m21 15-5-5L5 21"/></svg>';

  class ImageSlot extends HTMLElement {
    static get observedAttributes() {
      return ['shape', 'radius', 'mask', 'fit', 'placeholder', 'src', 'credit', 'credit-href'];
    }
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<style>' + stylesheet + '</style>' +
        '<div class="frame" part="frame">' +
        '  <img part="image" alt="" draggable="false" style="display:none">' +
        '  <div class="empty" part="empty">' + icon + '<div class="cap"></div></div>' +
        '  <div class="attr-error" part="attribution-error">' +
        '    <div class="cap">This photo needs attribution</div></div>' +
        '  <div class="ring" part="ring"></div>' +
        '</div>' +
        '<span class="credit" part="credit"></span>';
      this._frame = root.querySelector('.frame');
      this._ring = root.querySelector('.ring');
      this._img = root.querySelector('.frame img');
      this._empty = root.querySelector('.empty');
      this._cap = root.querySelector('.cap');
      this._credit = root.querySelector('.credit');
    }
    connectedCallback() { this._render(); }
    attributeChangedCallback() { if (this.shadowRoot) this._render(); }

    _render() {
      const mask = this.getAttribute('mask');
      const shape = (this.getAttribute('shape') || 'rounded').toLowerCase();
      let radius = '';
      if (shape === 'circle') radius = '50%';
      else if (shape === 'pill') radius = '9999px';
      else if (shape === 'rounded') {
        const n = parseFloat(this.getAttribute('radius'));
        radius = (Number.isFinite(n) ? n : 12) + 'px';
      }
      this._frame.style.borderRadius = mask ? '' : radius;
      this._frame.style.clipPath = mask || '';
      this._ring.style.borderRadius = mask ? '' : radius;
      this._ring.style.display = mask ? 'none' : '';

      this._cap.textContent = this.getAttribute('placeholder') || 'Photo';

      const credit = (this.getAttribute('credit') || '').trim();
      const src = this.getAttribute('src') || '';
      const attrError = !!(!credit && src && isUnsplashHost(src));
      this.toggleAttribute('data-attribution-error', attrError);

      if (src && !attrError) {
        this._img.src = src;
        this._img.style.objectFit = (this.getAttribute('fit') || 'cover').toLowerCase() === 'contain' ? 'contain' : 'cover';
        this._img.style.display = 'block';
        this._empty.style.display = 'none';
        this.toggleAttribute('data-filled', true);
      } else {
        this._img.style.display = 'none';
        this._img.removeAttribute('src');
        this._empty.style.display = attrError ? 'none' : 'flex';
        this.removeAttribute('data-filled');
      }

      const showCredit = !!(src && credit && !attrError);
      this._credit.textContent = '';
      if (showCredit) {
        let href = '';
        const rawHref = this.getAttribute('credit-href') || '';
        if (rawHref) {
          try {
            const u = new URL(rawHref, document.baseURI);
            if (u.protocol === 'http:' || u.protocol === 'https:') href = withReferral(u.href);
          } catch {}
        }
        const mkLink = (text, linkHref) => {
          const a = document.createElement('a');
          a.target = '_blank'; a.rel = 'noopener noreferrer'; a.href = linkHref; a.textContent = text;
          return a;
        };
        const m = /^Photo by (.+) on Unsplash$/.exec(credit);
        if (m) {
          this._credit.appendChild(document.createTextNode('Photo by '));
          this._credit.appendChild(href ? mkLink(m[1], href) : document.createTextNode(m[1]));
          this._credit.appendChild(document.createTextNode(' on '));
          this._credit.appendChild(mkLink('Unsplash', UNSPLASH_HOMEPAGE_HREF));
        } else if (href) {
          this._credit.appendChild(mkLink(credit, href));
        } else {
          this._credit.textContent = credit;
        }
      }
      this.toggleAttribute('data-credit', showCredit);
    }
  }

  if (!customElements.get('image-slot')) customElements.define('image-slot', ImageSlot);
})();
