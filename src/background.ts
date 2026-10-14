// Service worker : ouverture du panneau latéral et menu clic droit sur les images.
import { INBOX_KEY, type InboxEntry } from './lib/inbox';

const MENU_ID = 'kotak-convert-image';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Convertir / compresser avec Kotak',
    contexts: ['image'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;

  // sidePanel.open doit être appelé immédiatement (geste utilisateur), avant tout await.
  if (tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
  }

  // On dépose l'image dans une « boîte de réception » lue par le panneau.
  const entry: InboxEntry = { url: info.srcUrl, pageUrl: info.pageUrl ?? '', ts: Date.now() };
  chrome.storage.session.get(INBOX_KEY).then((r) => {
    const inbox = (r[INBOX_KEY] as InboxEntry[] | undefined) ?? [];
    return chrome.storage.session.set({ [INBOX_KEY]: [...inbox, entry] });
  });
});

// ---------- Mise à jour automatique (installation via GitHub) ----------
// Le script de mise à jour remplace les fichiers sur le disque. On compare la version
// du manifeste sur le disque à celle chargée, et on recharge l'extension si elle a changé,
// en attendant que le panneau soit fermé pour ne pas interrompre un travail en cours.
const UPDATE_ALARM = 'kotak-update-check';

async function checkForUpdate() {
  try {
    const res = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    const onDisk = (await res.json()) as { version?: string };
    if (!onDisk.version || onDisk.version === chrome.runtime.getManifest().version) return;
    const panels = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.SIDE_PANEL] });
    if (panels.length) return; // on réessaiera à la prochaine vérification
    chrome.runtime.reload();
  } catch {
    // Fichiers en cours de remplacement : on réessaiera.
  }
}

chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) checkForUpdate();
});

// ---------- Presse-papier (pipette hors de Chrome) ----------
const OFFSCREEN_URL = 'offscreen/index.html';

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.CLIPBOARD],
    justification: 'Copier la couleur prélevée dans le presse-papier',
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'kotak-copy') return;
  ensureOffscreen()
    .then(() => chrome.runtime.sendMessage({ type: 'kotak-offscreen-copy', text: msg.text }))
    .then((res) => reply(res ?? { ok: false }))
    .catch(() => reply({ ok: false }));
  return true; // réponse asynchrone
});
