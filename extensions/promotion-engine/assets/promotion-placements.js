(() => {
  if (customElements.get('promotion-engine-embed')) return;
  const productIds = new Map();
  const query = (root, selector) => { try { return root.querySelector(selector); } catch { return null; } };
  const cards = 'product-card, .product-card-wrapper, .card-wrapper';
  class PromotionPlacements extends HTMLElement {
    connectedCallback() {
      this.hidden = true;
      this.entries = new Map();
      this.generation = (this.generation || 0) + 1;
      this.intersection = window.IntersectionObserver && new IntersectionObserver(records => {
        for (const record of records) if (record.isIntersecting) {
          this.intersection.unobserve(record.target);
          this.mountBadge(record.target, this.entries.get(record.target));
        }
      }, { rootMargin: '200px' });
      this.observer = new MutationObserver(() => {
        clearTimeout(this.scanTimer);
        this.scanTimer = setTimeout(() => this.scan(), 100);
      });
      this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-product-id'] });
      this.scan();
    }
    disconnectedCallback() {
      this.generation++;
      clearTimeout(this.scanTimer);
      this.observer?.disconnect();
      this.intersection?.disconnect();
      for (const entry of this.entries.values()) this.removeEntry(entry);
      this.entries.clear();
    }
    create(placement, productId) {
      const element = document.createElement('promotion-engine');
      element.hidden = true;
      element.dataset.peAuto = placement;
      element.dataset.placement = placement;
      element.dataset.proxyPath = this.dataset.proxyPath || '/apps/promotion-engine';
      if (productId) element.dataset.productId = productId;
      if (this.dataset.collectionId) element.dataset.collectionId = this.dataset.collectionId;
      return element;
    }
    scan() {
      if (!this.isConnected) return;
      for (const [card, entry] of this.entries) if (!card.isConnected) {
        this.intersection?.unobserve(card);
        this.removeEntry(entry);
        this.entries.delete(card);
      }
      if (this.dataset.badgesEnabled !== 'true') return;
      let matches;
      try { matches = document.querySelectorAll(this.dataset.cardSelector || cards); } catch { return; }
      for (const card of matches) {
        // Use the innermost card, avoiding a second badge on nested wrappers.
        if (query(card, this.dataset.cardSelector || cards)) continue;
        const link = query(card, 'a[href*="/products/"]');
        if (!link) continue;
        const url = new URL(link.href, location.origin);
        if (url.origin !== location.origin) continue;
        const id = card.dataset.productId || query(card, '[data-product-id]')?.dataset.productId || '';
        const key = `${url.pathname}:${id}`;
        const explicit = query(card, 'promotion-engine[data-placement="badge"]:not([data-pe-auto])');
        const old = this.entries.get(card);
        if (old && (old.key !== key || explicit)) {
          this.intersection?.unobserve(card);
          this.removeEntry(old);
          this.entries.delete(card);
        }
        if (explicit || this.entries.has(card)) continue;
        const entry = { key, url, id };
        this.entries.set(card, entry);
        if (this.intersection) this.intersection.observe(card);
        else this.mountBadge(card, entry);
      }
    }
    removeEntry(entry) {
      entry.removed = true;
      entry.badge?.remove();
      if (entry.positioned) entry.anchor.style.position = entry.originalPosition;
    }
    async mountBadge(card, entry) {
      if (!entry || entry.loading || entry.removed) return;
      entry.loading = true;
      const generation = this.generation;
      try {
        let id = entry.id;
        if (!/^\d+$/.test(id)) {
          const match = entry.url.pathname.match(/\/products\/([^/]+)\/?$/);
          if (!match) return;
          const root = this.dataset.root || '/';
          const url = new URL(`${root.replace(/\/$/, '')}/products/${match[1]}.js`, location.origin);
          if (url.origin !== location.origin) return;
          if (!productIds.has(url.href)) productIds.set(url.href, fetch(url.href, { credentials: 'same-origin' }).then(response => {
            if (!response.ok) throw new Error('Product unavailable');
            return response.json();
          }).then(product => String(product.id)).catch(error => { productIds.delete(url.href); throw error; }));
          id = await productIds.get(url.href);
        }
        if (!/^\d+$/.test(id) || !this.isConnected || generation !== this.generation || entry.removed || !card.isConnected) return;
        if (query(card, 'promotion-engine[data-placement="badge"]:not([data-pe-auto])')) return;
        const anchor = query(card, this.dataset.badgeSelector || '.card__inner, .card-gallery, .product-card__image') || card;
        entry.anchor = anchor;
        entry.originalPosition = anchor.style.position;
        if (getComputedStyle(anchor).position === 'static' || !getComputedStyle(anchor).position) {
          anchor.style.position = 'relative';
          entry.positioned = true;
        }
        const badge = entry.badge = this.create('badge', id);
        const position = this.dataset.badgePosition || 'top-left';
        Object.assign(badge.style, { position: 'absolute', zIndex: '2', pointerEvents: 'none', maxWidth: 'calc(100% - 20px)' });
        badge.style[position.startsWith('bottom') ? 'bottom' : 'top'] = '10px';
        badge.style[position.endsWith('right') ? 'right' : 'left'] = '10px';
        anchor.append(badge);
      } catch { /* A missing product must not interrupt the surrounding storefront. */ }
    }
  }
  customElements.define('promotion-engine-embed', PromotionPlacements);
})();
