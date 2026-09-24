// One shared popup owner keeps pointer previews separate from committed values.
// The original select remains the controller/evidence contract, never a second state store.
export function enhanceValueSelectors(selects) {
  let active = null;
  const instances = selects.map(select => {
    const host = document.createElement('div');
    host.className = 'value-selector';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'value-selector-trigger';
    trigger.id = `${select.id}-trigger`;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-label', select.getAttribute('aria-label'));
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('div');
    panel.className = 'value-selector-options';
    panel.id = `${select.id}-options`;
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', select.getAttribute('aria-label'));
    panel.hidden = true;
    trigger.setAttribute('aria-controls', panel.id);
    const items = [...select.options].map((option, index) => {
      const node = document.createElement('div');
      node.id = `${select.id}-option-${index}`;
      node.setAttribute('role', 'option');
      node.textContent = option.label;
      node.dataset.value = option.value;
      panel.append(node);
      node.addEventListener('click', () => choose(index));
      return node;
    });
    select.after(host);
    host.append(trigger);
    document.body.append(panel);
    select.hidden = true;
    let current = select.selectedIndex;
    let prefix = '';
    let typedAt = 0;
    const instance = { host, trigger, panel, close, sync };
    function position() {
      const box = trigger.getBoundingClientRect();
      panel.style.width = `${box.width}px`;
      panel.style.left = `${Math.max(8, Math.min(box.left, innerWidth - box.width - 8))}px`;
      const availableBelow = innerHeight - box.bottom - 12;
      const below = availableBelow >= Math.min(panel.scrollHeight, 220);
      panel.style.maxHeight = `${Math.max(80, below ? availableBelow : box.top - 12)}px`;
      panel.style.top = `${below ? box.bottom + 4 : Math.max(8, box.top - panel.offsetHeight - 4)}px`;
    }
    function mark(index) {
      current = Math.max(0, Math.min(items.length - 1, index));
      items.forEach((node, i) => node.dataset.active = String(i === current));
      trigger.setAttribute('aria-activedescendant', items[current].id);
      items[current].scrollIntoView({ block: 'nearest' });
    }
    function open() {
      if (select.disabled) return;
      active?.close();
      active = instance;
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      position();
      mark(select.selectedIndex);
    }
    function close() {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      prefix = '';
      if (active === instance) active = null;
    }
    function choose(index) {
      if (select.disabled) return close();
      select.value = items[index].dataset.value;
      close();
      sync();
      trigger.focus({ preventScroll: true });
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function sync() {
      const label = select.selectedOptions[0]?.label ?? '';
      if (trigger.textContent !== label) trigger.textContent = label;
      trigger.disabled = select.disabled;
      items.forEach(node => {
        const selected = String(node.dataset.value === select.value);
        if (node.getAttribute('aria-selected') !== selected) node.setAttribute('aria-selected', selected);
      });
      if (select.disabled) close();
    }
    trigger.addEventListener('click', () => active === instance ? close() : open());
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key === 'Tab') { close(); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        if (active !== instance) {
          open();
          if (event.key === 'Home') mark(0);
          if (event.key === 'End') mark(items.length - 1);
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') return choose(current);
        mark(event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : current + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (active !== instance) open();
        prefix = performance.now() - typedAt > 1000 ? event.key : prefix + event.key;
        typedAt = performance.now();
        const match = items.findIndex(node => node.textContent.toLowerCase().startsWith(prefix.toLowerCase()));
        if (match >= 0) mark(match);
      }
    });
    panel.addEventListener('pointerdown', event => event.preventDefault());
    trigger.addEventListener('blur', close);
    sync();
    return instance;
  });
  const outside = event => {
    if (active && !active.host.contains(event.target) && !active.panel.contains(event.target)) active.close();
  };
  const dismiss = () => active?.close();
  const onScroll = event => { if (active && !active.panel.contains(event.target)) dismiss(); };
  document.addEventListener('pointerdown', outside);
  window.addEventListener('resize', dismiss);
  window.addEventListener('scroll', onScroll, true);
  return {
    sync: () => instances.forEach(instance => instance.sync()),
    dispose() {
      dismiss();
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', onScroll, true);
      for (const { host, panel } of instances) { host.remove(); panel.remove(); }
      selects.forEach(select => { select.hidden = false; });
    },
  };
}
