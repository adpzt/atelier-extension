// « Boîte de réception » : images envoyées par le menu clic droit vers le panneau.
export const INBOX_KEY = 'atelier.inbox';

export interface InboxEntry {
  url: string;
  pageUrl: string;
  ts: number;
}
