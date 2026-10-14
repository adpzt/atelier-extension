import { h, icon } from '../dom';
import { store } from '../store';
import { cloneSettings } from '../../core/types';
import { BUILTIN_PRESETS, loadUserPresets, saveUserPresets, type Preset } from '../../lib/storage';
import { toast } from './toast';

const SAVE_VALUE = '__save__';

/** Sélecteur de préréglages (en-tête) + formulaire d'enregistrement. */
export async function mountPresets(selectHost: HTMLElement, formHost: HTMLElement) {
  let userPresets: Preset[] = await loadUserPresets();
  let activeId = '';
  let applying = false;

  const select = h('select', { class: 'input select select--ghost', 'aria-label': 'Préréglages' });
  const delBtn = h('button', { type: 'button', class: 'icon-btn icon-btn--sm', title: 'Supprimer ce préréglage' }, icon('trash', 14));
  selectHost.append(select, delBtn);

  const nameInput = h('input', { type: 'text', class: 'input', placeholder: 'Nom du préréglage', maxlength: 40 });
  const form = h(
    'form',
    { class: 'preset-form', hidden: true },
    nameInput,
    h('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, 'Enregistrer'),
    h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => closeForm() }, 'Annuler'),
  );
  const openBtn = h('button', { type: 'button', class: 'link-btn', onclick: () => openForm() }, icon('save', 13), 'Enregistrer ces réglages comme préréglage');
  formHost.append(openBtn, form);

  function render() {
    const opt = (p: Preset) => h('option', { value: p.id }, p.name);
    select.replaceChildren(
      h('option', { value: '' }, 'Préréglages…'),
      h('optgroup', { label: 'Atelier' }, BUILTIN_PRESETS.map(opt)),
      ...(userPresets.length ? [h('optgroup', { label: 'Mes préréglages' }, userPresets.map(opt))] : []),
      h('option', { value: SAVE_VALUE }, '＋ Enregistrer les réglages actuels…'),
    );
    select.value = activeId;
    delBtn.hidden = !userPresets.some((p) => p.id === activeId);
  }

  function openForm() {
    form.hidden = false;
    openBtn.hidden = true;
    nameInput.value = '';
    nameInput.focus();
  }
  function closeForm() {
    form.hidden = true;
    openBtn.hidden = false;
  }

  select.addEventListener('change', () => {
    const id = select.value;
    if (id === SAVE_VALUE) {
      select.value = activeId;
      openForm();
      formHost.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const preset = [...BUILTIN_PRESETS, ...userPresets].find((p) => p.id === id);
    if (!preset) return;
    applying = true;
    store.replaceSettings(preset.settings);
    applying = false;
    activeId = id;
    render();
    toast(`Préréglage « ${preset.name} » appliqué`, 'success', 2200);
  });

  delBtn.addEventListener('click', async () => {
    const p = userPresets.find((x) => x.id === activeId);
    if (!p) return;
    userPresets = userPresets.filter((x) => x.id !== activeId);
    await saveUserPresets(userPresets);
    activeId = '';
    render();
    toast(`Préréglage « ${p.name} » supprimé`, 'info', 2200);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return nameInput.focus();
    const preset: Preset = { id: `u${Date.now()}`, name, settings: cloneSettings(store.editing) };
    userPresets = [...userPresets.filter((p) => p.name !== name), preset];
    await saveUserPresets(userPresets);
    activeId = preset.id;
    closeForm();
    render();
    toast(`Préréglage « ${name} » enregistré`, 'success', 2200);
  });

  // Toute modification manuelle désélectionne le préréglage actif.
  store.on('edit', () => {
    if (applying || !activeId) return;
    activeId = '';
    render();
  });

  render();
}
