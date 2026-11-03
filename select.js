/* Theme-aware, keyboard-accessible choices around ordinary local form values. */
(function () {
  'use strict';
  const pickers = [];
  function closeAll(except = null) { pickers.forEach((picker) => { if (picker !== except) picker.close(); }); }
  function enhance(selector) {
    document.querySelectorAll(selector).forEach((select) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'select-picker';
      const trigger = document.createElement('button');
      trigger.type = 'button'; trigger.className = 'select-trigger joy-ring'; trigger.id = select.id + '-trigger';
      trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', select.id + '-options');
      trigger.setAttribute('aria-label', select.getAttribute('aria-label'));
      const value = document.createElement('span'); value.className = 'select-value';
      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      arrow.setAttribute('class', 'icon chevron'); arrow.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-chevron'); arrow.append(use);
      trigger.append(value, arrow);
      const list = document.createElement('div');
      list.className = 'select-menu'; list.id = select.id + '-options'; list.hidden = true;
      list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', select.getAttribute('aria-label'));
      const options = [...select.options].map((option) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'select-option'; button.textContent = option.textContent;
        button.setAttribute('role', 'option'); button.id = select.id + '-option-' + option.value;
        button.tabIndex = -1; button.dataset.value = option.value;
        const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        check.setAttribute('class', 'icon'); check.setAttribute('aria-hidden', 'true');
        const mark = document.createElementNS('http://www.w3.org/2000/svg', 'use'); mark.setAttribute('href', '#i-check'); check.append(mark); button.append(check);
        button.addEventListener('click', () => {
          select.value = option.value; sync(); close(true);
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        list.append(button); return button;
      });
      select.before(wrapper); wrapper.append(select, trigger, list);
      select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
      const picker = { close, sync }; pickers.push(picker);
      function sync() {
        value.textContent = select.selectedOptions[0].textContent;
        trigger.disabled = select.disabled;
        options.forEach((button) => button.setAttribute('aria-selected', String(button.dataset.value === select.value)));
      }
      function close(focus = false) {
        list.hidden = true; wrapper.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false');
        if (focus) trigger.focus({ preventScroll: true });
      }
      function open(edge = null) {
        closeAll(picker); list.hidden = false; wrapper.classList.add('is-open'); trigger.setAttribute('aria-expanded', 'true');
        const active = edge === 'first' ? options[0] : edge === 'last' ? options.at(-1) : options.find((button) => button.dataset.value === select.value);
        active.focus({ preventScroll: true });
      }
      trigger.addEventListener('click', () => { if (list.hidden) open(); else close(true); });
      wrapper.addEventListener('keydown', (event) => {
        const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Enter', ' '];
        if (event.key === 'Tab') { close(true); return; }
        event.stopPropagation();
        if (!keys.includes(event.key)) {
          if (/^[a-z]$/i.test(event.key)) {
            event.preventDefault(); if (list.hidden) open();
            options.find((button) => button.textContent.toLowerCase().startsWith(event.key.toLowerCase()))?.focus();
          }
          return;
        }
        event.preventDefault();
        if (event.key === 'Escape') { close(true); return; }
        if (list.hidden) { open(event.key === 'Home' ? 'first' : event.key === 'End' ? 'last' : null); return; }
        if (event.key === 'Enter' || event.key === ' ') { if (options.includes(document.activeElement)) document.activeElement.click(); return; }
        const index = options.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowDown' ? (index + 1) % options.length : (index - 1 + options.length) % options.length;
        options[next].focus({ preventScroll: true });
      });
      wrapper.addEventListener('focusout', () => setTimeout(() => { if (!wrapper.contains(document.activeElement)) close(); }, 0));
      select.addEventListener('change', sync); sync();
    });
    return { sync: () => pickers.forEach((picker) => picker.sync()), closeAll };
  }
  document.addEventListener('pointerdown', (event) => { if (!event.target.closest('.select-picker')) closeAll(); });
  window.RemixSelect = Object.freeze({ enhance });
})();
