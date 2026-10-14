import { h, icon } from '../dom';

let host: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info', ms = 4200) {
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const el = h(
    'div',
    { class: `toast toast--${kind}` },
    icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'sparkle', 14),
    h('span', {}, message),
  );
  host.append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 250);
  }, ms);
}
