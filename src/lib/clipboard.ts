// Copie dans le presse-papier.
// Après une pipette prise hors de Chrome, le panneau n'a plus le focus et
// navigator.clipboard refuse d'écrire : on passe alors par le document « offscreen »
// de l'extension (via le service worker), qui peut copier sans focus.

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'atelier-copy', text });
      return !!res?.ok;
    } catch {
      return false;
    }
  }
}
