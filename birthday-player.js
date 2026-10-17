const node = (tag, text, cls = '') => {
  const n = document.createElement(tag); n.className = cls;
  if (text !== undefined) n.textContent = text; return n;
};
const action = (text, fn) => {
  const n = node('button', text, 'secondary'); n.type = 'button'; n.onclick = fn; return n;
};

export class BirthdayPlaylist {
  constructor(root, transport, context) {
    this.root = root; this.transport = transport; this.context = context;
    this.items = []; this.ticket = 0; this.current = null;
    this.panel = node('section', undefined, 'panel'); this.panel.id = 'birthdayPlaylist'; this.panel.hidden = true;
    this.panel.append(node('h2', 'Deine Glückwünsche'));
    this.title = node('h3', '');
    this.kind = node('p', '', 'field-hint');
    this.media = node('video'); this.media.controls = true; this.media.playsInline = true;
    this.media.preload = 'metadata'; this.media.style.width = '100%'; this.media.style.borderRadius = '14px';
    this.media.hidden = true; this.media.setAttribute('aria-label', 'Videos und Sprachmemos abspielen');
    this.status = node('p', '', 'status'); this.status.setAttribute('role', 'status');
    const controls = node('div', undefined, 'feature-toolbar');
    this.all = action('▶ Alle Glückwünsche abspielen', () => void this.playAt(0)); this.all.className = 'primary';
    this.previous = action('‹ Vorheriger Gruß', () => void this.playAt(this.index - 1));
    this.next = action('Nächster Gruß ›', () => void this.playAt(this.index + 1));
    this.retry = action('▶ Starten / fortsetzen', () => {
      if (this.objectUrl) void this.tryPlay(this.ticket);
      else if (this.current) void this.playAt(this.index);
    });
    this.stopButton = action('Wiedergabe beenden', () => this.stop());
    controls.append(this.all, this.previous, this.next, this.retry, this.stopButton);
    this.panel.append(this.title, this.kind, this.media, this.status, controls); root.append(this.panel);
    this.media.onplaying = () => { this.retry.hidden = true; this.status.textContent = 'Die Glückwünsche laufen nacheinander.'; };
    this.media.onerror = () => {
      if (!this.current || this.loading) return;
      this.status.textContent = 'Diese Datei kann der Browser nicht abspielen. Du kannst den nächsten Gruß wählen. Für Audio hilft gegebenenfalls ein Export als M4A oder MP3.';
      this.retry.hidden = false;
    };
    this.media.onended = () => {
      if (!this.current || this.loading) return;
      if (this.index + 1 < this.items.length) void this.playAt(this.index + 1);
      else { this.status.textContent = 'Das waren alle Glückwünsche. ♡'; this.retry.hidden = true; }
    };
    this.controls();
  }
  get index() { return this.items.findIndex(item => item.id === this.current); }
  setItems(items) {
    this.items = items.filter(item => item.uploaded && !item.deleting);
    if (this.current && this.index < 0) this.stop('Dieser Gruß ist nicht mehr verfügbar.');
    this.panel.hidden = !this.items.length; this.controls();
  }
  controls() {
    this.all.disabled = !this.items.length;
    this.previous.disabled = this.index <= 0;
    this.next.disabled = this.index < 0 || this.index >= this.items.length - 1;
    this.stopButton.hidden = !this.current;
    if (!this.current) this.retry.hidden = true;
    const item = this.items[this.index];
    if (item) {
      this.title.textContent = item.title;
      this.kind.textContent = `${this.index + 1} von ${this.items.length} · ${item.mime.startsWith('audio/') ? '🎙️ Sprachmemo' : '🎬 Video'}`;
    }
  }
  playFrom(id) { const index = this.items.findIndex(item => item.id === id); if (index >= 0) void this.playAt(index); }
  async tryPlay(ticket) {
    try { await this.media.play(); }
    catch (error) {
      if (ticket !== this.ticket) return;
      this.retry.hidden = false;
      this.status.textContent = error.name === 'NotAllowedError' ?
        'Der Browser wartet auf dein Antippen. Bitte „Starten / fortsetzen“ wählen.' :
        'Die Wiedergabe konnte nicht starten. Bitte erneut versuchen oder den nächsten Gruß wählen.';
    }
  }
  releaseMedia() {
    this.media.pause(); this.media.removeAttribute('src'); this.media.load(); this.media.hidden = true;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); this.objectUrl = null;
  }
  async playAt(index) {
    const item = this.items[index]; if (!item) return;
    const ticket = ++this.ticket; this.controller?.abort(); this.controller = new AbortController();
    const ctx = this.context(this.controller.signal);
    this.current = item.id; this.loading = true; this.retry.hidden = true;
    this.releaseMedia(); this.controls(); this.status.textContent = 'Dein Gruß wird geladen …';
    try {
      const blob = await this.transport.download(item, ctx); this.transport.check(ctx);
      if (ticket !== this.ticket || this.index < 0) return;
      this.objectUrl = URL.createObjectURL(blob); this.media.src = this.objectUrl;
      this.media.style.height = item.mime.startsWith('audio/') ? '68px' : 'auto';
      this.media.hidden = false; this.loading = false;
      await this.tryPlay(ticket);
    } catch (error) {
      if (ticket === this.ticket && error.message !== 'SESSION_CHANGED') {
        this.status.textContent = 'Laden unterbrochen. Bitte „Starten / fortsetzen“ wählen. ' + error.message;
        this.retry.hidden = false;
      }
    } finally { if (ticket === this.ticket) this.loading = false; }
  }
  stop(message = '') {
    this.ticket++; this.controller?.abort(); this.controller = null;
    this.current = null; this.loading = false; this.releaseMedia();
    this.title.textContent = ''; this.kind.textContent = ''; this.status.textContent = message; this.controls();
  }
  destroy() { this.stop(); this.panel.remove(); }
}
