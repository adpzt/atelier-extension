// Document invisible chargé à la demande : copie dans le presse-papier sans avoir le focus.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'atelier-offscreen-copy') return;
  const area = document.getElementById('buffer') as HTMLTextAreaElement;
  area.value = msg.text;
  area.select();
  const ok = document.execCommand('copy');
  reply({ ok });
});
