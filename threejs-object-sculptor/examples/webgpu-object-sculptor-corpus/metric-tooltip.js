export function attachMetricTooltip(elements) {
  const tooltip = document.createElement('div');
  tooltip.id = 'scene-metric-description';
  tooltip.className = 'metric-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  let target = null;
  function hide() {
    target?.removeAttribute('aria-describedby');
    target = null;
    tooltip.hidden = true;
  }
  function show(element) {
    hide();
    if (!element.dataset.detail) return;
    target = element;
    tooltip.textContent = element.dataset.detail;
    tooltip.hidden = false;
    element.setAttribute('aria-describedby', tooltip.id);
    const box = element.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(box.left, innerWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${box.top > tooltip.offsetHeight + 12 ? box.top - tooltip.offsetHeight - 8 : box.bottom + 8}px`;
  }
  const listeners = [];
  for (const element of elements) {
    element.tabIndex = 0;
    const enter = () => show(element);
    const leave = () => elements.includes(document.activeElement) ? show(document.activeElement) : hide();
    const key = event => { if (event.key === 'Escape') hide(); };
    for (const [event, handler] of [['mouseenter', enter], ['focus', enter], ['mouseleave', leave], ['blur', hide], ['keydown', key]]) {
      element.addEventListener(event, handler);
      listeners.push([element, event, handler]);
    }
  }
  window.addEventListener('resize', hide);
  window.addEventListener('scroll', hide, true);
  return () => {
    hide();
    for (const [element, event, handler] of listeners) element.removeEventListener(event, handler);
    window.removeEventListener('resize', hide);
    window.removeEventListener('scroll', hide, true);
    tooltip.remove();
  };
}
