(() => {
  if (window.SmiffysPromotionUI) return;
  function mount(root) {
    let disposed = false;
    const resets = new Set();
    const timers = [...root.querySelectorAll('[data-pe-countdown], [data-pe-compact-countdown]')];
    function tick() {
      for (const timer of timers) {
        const end = Date.parse(timer.dataset.peCountdown || timer.dataset.peCompactCountdown);
        if (!Number.isFinite(end)) continue;
        const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
        const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
        const compact = timer.querySelector('[data-pe-compact-value]');
        if (compact) {
          const totalMinutes = Math.ceil(seconds / 60);
          compact.textContent = seconds ? `${Math.floor(totalMinutes / 1440)}d ${Math.floor(totalMinutes % 1440 / 60)}h ${totalMinutes % 60}m` : 'Offer ended';
        } else {
          timer.querySelector('[data-pe-units]').hidden = seconds === 0;
          timer.querySelector('[data-pe-ended]').hidden = seconds !== 0;
          for (const [unit, value] of Object.entries({ days, hours, minutes, seconds: seconds % 60 })) timer.querySelector(`[data-pe-value="${unit}"]`).textContent = String(value).padStart(2, '0');
          timer.setAttribute('aria-label', seconds ? `${days} days, ${hours} hours, ${minutes} minutes, ${seconds % 60} seconds remaining` : 'Offer ended');
        }
      }
    }
    async function copy(event) {
      const button = event.target.closest('[data-pe-copy-code]');
      if (!button || !root.contains(button) || button.disabled) return;
      const label = button.querySelector('[data-pe-copy-label]');
      const status = button.parentElement.querySelector('[data-pe-copy-status]');
      button.disabled = true;
      let copied = false;
      try { await navigator.clipboard.writeText(button.dataset.peCopyCode); copied = true; } catch {
        const textarea = document.createElement('textarea');
        textarea.value = button.dataset.peCopyCode;
        textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        root.append(textarea);
        try { textarea.focus(); textarea.select(); copied = document.execCommand('copy'); } catch { copied = false; }
        finally { textarea.remove(); button.focus(); }
      }
      if (disposed) return;
      label.textContent = copied ? 'Copied' : 'Copy code';
      status.textContent = copied ? 'Discount code copied.' : 'Could not copy. Select the code and copy it manually.';
      const reset = setTimeout(() => { resets.delete(reset); label.textContent = 'Copy code'; button.disabled = false; }, 2000);
      resets.add(reset);
    }
    tick();
    const interval = timers.length ? setInterval(tick, 1000) : null;
    root.addEventListener('click', copy);
    return () => { disposed = true; clearInterval(interval); resets.forEach(clearTimeout); root.removeEventListener('click', copy); };
  }
  window.SmiffysPromotionUI = { mount };
  window.dispatchEvent(new Event('promotion-ui:ready'));
  if (document.querySelector('[data-pe-countdown], [data-pe-compact-countdown], [data-pe-copy-code]')) mount(document.body);
})();
