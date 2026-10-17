import { BirthdayTransfer, VideoError, videoMime, fileHash } from './birthday-transfer.js?v=20261017-v3';
import { BirthdayPlaylist } from './birthday-player.js?v=20261017-v3';

const el = (tag, text, cls = '') => {
  const node = document.createElement(tag); node.className = cls;
  if (text !== undefined) node.textContent = text; return node;
};
const button = (label, action, cls = 'secondary') => {
  const node = el('button', label, cls); node.type = 'button'; node.dataset.videoAction = 'true';
  node.onclick = action; return node;
};
const read = key => { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => { try { value ? sessionStorage.setItem(key, JSON.stringify(value)) : sessionStorage.removeItem(key); } catch { /* Fortsetzung im aktuellen Tab bleibt möglich. */ } };
const mb = value => (value / 1048576).toFixed(1).replace('.', ',') + ' MB';

export class BirthdayVideos {
  constructor(api) {
    this.api = api; this.transport = null; this.epoch = 0; this.listTicket = 0;
    if (!document.getElementById('birthdayMediaStyles')) {
      const style = el('style'); style.id = 'birthdayMediaStyles';
      style.textContent = '#birthdayVideoPanel{min-width:0}#birthdayVideoPanel .panel,#birthdayVideoPanel .list{min-width:0}#birthdayVideoPanel h3{overflow-wrap:anywhere}#birthdayVideoPanel .feature-toolbar{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-start}#birthdayVideoPanel .feature-toolbar>button{flex:1 1 155px;width:auto;min-width:0;margin:0;overflow-wrap:anywhere}#birthdayVideoPanel .feature-toolbar>.primary{flex-basis:100%}#birthdayVideoPanel .feature-toolbar>.text-btn{padding:10px;text-align:center;border:1px solid var(--border);border-radius:10px}#birthdayVideoPanel input[type=file]{min-width:0;max-width:100%}#birthdayVideoPanel video{display:block;max-width:100%;background:#0f1016}';
      document.head.append(style);
    }
    this.view = document.getElementById('view-wishes');
    this.root = document.getElementById('birthdayVideoPanel');
    if (!this.root && this.view) {
      this.root = el('div'); this.root.id = 'birthdayVideoPanel';
      const placeholder = this.view.querySelector('.panel.empty');
      if (placeholder) placeholder.replaceWith(this.root); else this.view.append(this.root);
    }
    this.reset();
    const authenticated = document.getElementById('authenticated');
    if (authenticated && this.view) {
      this.observer = new MutationObserver(() => void this.sync());
      for (const target of [authenticated, this.view]) this.observer.observe(target, { attributes: true, attributeFilter: ['hidden'] });
      window.addEventListener('hashchange', () => void this.sync());
      void this.sync();
    }
    const wake = () => { if (!document.hidden && this.active && !this.busy) void this.loadList(); };
    document.addEventListener('visibilitychange', wake); window.addEventListener('online', wake);
    window.addEventListener('beforeunload', event => { if (this.busy && this.operation === 'upload') { event.preventDefault(); event.returnValue = ''; } });
  }
  get key() { return `rq-birthday-upload-v3:${this.api.url}:${this.user?.id}`; }
  async sync() {
    const authenticated = document.getElementById('authenticated');
    if (!authenticated || authenticated.hidden || !this.api.session) {
      if (this.user || this.booting) this.reset();
      return;
    }
    if (this.user && this.boundGeneration !== this.api.generation) this.reset();
    if (this.view.hidden) { this.route('other'); return; }
    if (this.user) { this.route('wishes'); return; }
    if (this.booting) return;
    const epoch = this.epoch; this.booting = true;
    try {
      this.transport = new BirthdayTransfer(this.api);
      const ctx = this.transport.context(undefined, () => { if (epoch !== this.epoch) throw new VideoError('SESSION_CHANGED'); });
      const data = await this.transport.rpc('rq_birthday_list', {}, ctx);
      if (epoch !== this.epoch || authenticated.hidden || this.view.hidden) return;
      if (data.version !== 3 || !data.me?.id) throw new VideoError('Bitte zuerst die zehn SQL-Schritte für Videos und Sprachmemos ausführen.');
      this.attach(data.me); this.route('wishes');
    } catch (error) {
      if (epoch === this.epoch && !authenticated.hidden && !this.view.hidden && error.message !== 'SESSION_CHANGED') {
        this.root.replaceChildren(el('p', error.status === 404 ? 'Bitte zuerst die zehn SQL-Schritte für Glückwünsche ausführen.' : error.message, 'status error'),
          button('Erneut versuchen', () => void this.sync()));
      }
    } finally { if (epoch === this.epoch) this.booting = false; }
  }
  attach(user) {
    if (!this.root || this.user?.id === user.id) return;
    this.reset(); this.user = user; this.boundGeneration = this.api.generation;
    this.transport = new BirthdayTransfer(this.api);
    const saved = read(this.key);
    const valid = item => item && /^[0-9a-f-]{36}$/.test(item.id) && /^[0-9a-f]{64}$/.test(item.hash) &&
      typeof item.title === 'string' && typeof item.description === 'string' &&
      ['video/mp4','video/webm','audio/ogg','audio/mp4','audio/mpeg','audio/aac','audio/wav','audio/webm'].includes(item.mime) &&
      Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= 52428800;
    if (valid(saved)) {
      this.pending = { ...saved }; delete this.pending.waiting;
      this.waiting = Array.isArray(saved.waiting) ? saved.waiting.filter(valid) : [];
    }
    this.frame();
  }
  reset() {
    this.epoch++; this.listTicket++; this.controller?.abort(); this.controller = null;
    clearInterval(this.timer); this.playlist?.destroy(); this.playlist = null; this.root?.replaceChildren();
    this.user = null; this.pending = null; this.busy = false; this.operation = null; this.active = false; this.lastList = null; this.booting = false;
    this.waiting = []; this.files = new Map(); this.items = [];
  }
  context(signal) {
    const epoch = this.epoch;
    return this.transport.context(signal, () => { if (!this.user || epoch !== this.epoch) throw new VideoError('SESSION_CHANGED'); });
  }
  route(name) {
    if (!this.user || !this.root) return;
    const active = name === 'wishes';
    if (active === this.active) return;
    this.active = active; clearInterval(this.timer);
    if (active) { void this.loadList(); this.timer = setInterval(() => { if (!document.hidden && !this.busy) void this.loadList(); }, 20000); }
    else this.playlist?.stop();
  }
  message(text = '', error = false) {
    if (!this.feedback) return;
    this.feedback.textContent = text; this.feedback.className = 'status' + (error ? ' error' : '');
  }
  frame() {
    this.root.replaceChildren();
    const toolbar = el('div', undefined, 'feature-toolbar');
    toolbar.append(button('Aktualisieren', () => { if (!this.busy) void this.loadList(true); }, 'text-btn'));
    this.feedback = el('p', '', 'status'); this.feedback.setAttribute('role', 'status');
    this.root.append(toolbar, this.feedback);
    if (this.user.person === 'kira') this.uploadForm();
    const playerArea = el('div'); this.root.append(playerArea);
    this.playlist = new BirthdayPlaylist(playerArea, this.transport, signal => this.context(signal));
    this.list = el('div', undefined, 'list'); this.root.append(this.list);
    this.syncControls();
  }
  uploadForm() {
    const form = el('form', undefined, 'panel'); this.form = form;
    form.append(el('h2', 'Videos und Sprachmemos hinzufügen'));
    const field = (label, id, kind) => {
      const text = el('label', label); text.htmlFor = id;
      const input = el(kind === 'textarea' ? 'textarea' : 'input'); input.id = id;
      if (kind !== 'textarea') input.type = kind;
      form.append(text, input); return input;
    };
    this.title = field('Titel bei einer Datei (optional)', 'birthdayTitle', 'text'); this.title.maxLength = 120;
    this.description = field('Text für diese Dateien (optional)', 'birthdayDesc', 'textarea'); this.description.maxLength = 800; this.description.rows = 2;
    this.file = field('Eine oder mehrere Dateien auswählen', 'birthdayFile', 'file');
    this.file.accept = '.mp4,.webm,.opus,.ogg,.m4a,.mp3,.aac,.wav'; this.file.multiple = true;
    this.file.onchange = () => this.syncControls();
    this.fileHint = el('p', '', 'field-hint');
    form.append(this.fileHint, el('p', 'Videos: MP4/WebM. Sprachmemos: OPUS, OGG, M4A, MP3, AAC oder WAV. Bis 50 MB je Datei. Mehrere Dateien erhalten zunächst ihren Dateinamen als Titel. Alles bleibt bis zu deiner Freigabe privat.', 'field-hint'));
    this.progress = el('progress'); this.progress.max = 100; this.progress.value = 0; this.progress.style.width = '100%'; this.progress.hidden = true;
    this.progress.setAttribute('aria-label', 'Gespeicherter Upload-Fortschritt');
    this.progressLabel = el('p', '', 'status'); this.progressLabel.setAttribute('role', 'status');
    this.send = el('button', 'Dateien privat hochladen', 'primary'); this.send.type = 'submit';
    this.pause = button('Upload pausieren', () => this.controller?.abort()); delete this.pause.dataset.videoAction;
    this.discard = button('Offene Übertragungen entfernen', () => {
      if (!this.pending || !confirm('Alle noch offenen Übertragungen dieser Auswahl und ihre gespeicherten Dateien entfernen?')) return;
      void this.run('remove', async ctx => {
        while (this.pending) { const id = this.pending.id; await this.transport.remove(id, ctx); this.clearPending(id); }
        this.message('Die offenen Übertragungen wurden entfernt.');
      });
    }, 'text-btn');
    form.append(this.progress, this.progressLabel, this.send, this.pause, this.discard);
    form.onsubmit = event => { event.preventDefault(); void this.startUpload(); };
    this.root.append(form);
    if (this.pending) { this.title.value = this.pending.title; this.description.value = this.pending.description; }
  }
  syncControls() {
    this.root?.querySelectorAll('[data-video-action]').forEach(node => { node.disabled = this.busy; });
    if (!this.form?.isConnected) return;
    this.title.disabled = this.busy || !!this.pending || this.file.files.length > 1; this.description.disabled = this.busy || !!this.pending;
    this.file.disabled = this.busy; this.send.disabled = this.busy;
    this.send.textContent = this.pending ? 'Upload fortsetzen' : 'Dateien privat hochladen';
    this.pause.hidden = !this.busy || this.operation !== 'upload'; this.discard.hidden = !this.pending;
    this.fileHint.textContent = this.pending ? `${1 + this.waiting.length} Datei(en) noch offen. Jetzt: ${this.pending.fileName || this.pending.title}. Nach Neuladen dieselben Dateien erneut auswählen.` :
      this.file.files.length ? `${this.file.files.length} Datei(en) ausgewählt.` : '';
  }
  persist(pending) { this.pending = pending; write(this.key, pending ? { ...pending, waiting: this.waiting } : null); this.syncControls(); }
  clearPending(id) {
    if (this.pending?.id !== id) return;
    this.files.delete(id); this.persist(this.waiting.shift() || null);
    if (!this.pending) { this.form?.reset(); this.progress.hidden = true; this.progressLabel.textContent = ''; this.files.clear(); }
    else { this.title.value = this.pending.title; this.description.value = this.pending.description; }
    this.syncControls();
  }
  async run(kind, job) {
    if (this.busy || !this.user) return;
    const epoch = this.epoch;
    this.busy = true; this.operation = kind; this.controller = new AbortController();
    const ctx = this.context(this.controller.signal); this.syncControls(); this.message();
    try { await job(ctx); }
    catch (error) { if (epoch === this.epoch && error.message !== 'SESSION_CHANGED') this.message(error.message, true); }
    finally {
      if (epoch === this.epoch) {
        this.busy = false; this.operation = null; this.controller = null; this.syncControls();
        if (this.active) void this.loadList();
      }
    }
  }
  async startUpload() {
    await this.run('upload', async ctx => {
      const selected = Array.from(this.file.files || []);
      if (!this.pending) {
        if (!selected.length) throw new VideoError('Bitte zuerst Dateien auswählen.');
        if (selected.length > 30) throw new VideoError('Bitte höchstens 30 Dateien auf einmal auswählen. Weitere kannst du danach hinzufügen.');
        selected.forEach(videoMime);
        const description = this.description.value.trim();
        if (description.length > 800) throw new VideoError('Der Text darf höchstens 800 Zeichen haben.');
        const prepared = [];
        for (const file of selected) {
          this.message(`Datei ${prepared.length + 1} von ${selected.length} wird geprüft …`);
          const hash = await fileHash(file); this.transport.check(ctx);
          const title = (selected.length === 1 && this.title.value.trim() || file.name.replace(/\.[^.]+$/, '') || 'Ein Gruß für dich').slice(0, 120);
          const entry = { id: crypto.randomUUID(), title, description, mime: videoMime(file), bytes: file.size, hash, fileName: file.name, url: null };
          prepared.push(entry); this.files.set(entry.id, file);
        }
        this.waiting = prepared.slice(1); this.persist(prepared[0]);
      }
      while (this.pending) {
        const pending = this.pending;
        let file = this.files.get(pending.id);
        if (!file) {
          for (const candidate of selected) {
            if (candidate.size === pending.bytes && videoMime(candidate) === pending.mime && await fileHash(candidate) === pending.hash) { file = candidate; break; }
          }
          if (!file && selected.length) throw new VideoError('Das ist eine andere Datei. Bitte die ursprüngliche Datei auswählen.');
        }
        this.transport.check(ctx); this.progress.hidden = false;
        this.message(`„${pending.title}“ wird privat gespeichert. Noch ${1 + this.waiting.length} Datei(en).`);
        await this.transport.upload(pending, file, ctx, {
          save: value => { this.transport.check(ctx); this.persist(value); },
          progress: (done, total) => { this.transport.check(ctx); this.progress.value = Math.round(done / total * 100); this.progressLabel.textContent = `${pending.title}: ${this.progress.value} % (${mb(done)} von ${mb(total)})`; },
        });
        this.transport.check(ctx); this.clearPending(pending.id);
      }
      this.message('Alles privat gespeichert. Du kannst Titel und Reihenfolge anpassen und die Grüße für Richard freigeben.');
    });
  }
  async loadList(force = false) {
    if (!this.user || !this.active || this.busy) return;
    const ticket = ++this.listTicket, epoch = this.epoch, ctx = this.context();
    try {
      const data = await this.transport.rpc('rq_birthday_list', {}, ctx);
      if (epoch !== this.epoch || ticket !== this.listTicket || !this.active || this.busy) return;
      if (data.version !== 3) throw new VideoError('Bitte zuerst die zehn SQL-Schritte für Glückwünsche ausführen.');
      const signature = JSON.stringify(data);
      if (!force && signature === this.lastList) return;
      this.lastList = signature; this.items = data.videos; this.playlist.setItems(this.items); this.list.replaceChildren();
      this.list.append(el('h2', data.admin ? 'Deine Videos und Sprachmemos' : 'Die Sammlung für dich'));
      if (!data.videos.length) this.list.append(el('p', data.admin ? 'Hier erscheinen deine privat gespeicherten Grüße.' : 'Hier wartet noch eine Überraschung auf dich. ♡', 'panel empty'));
      for (const item of data.videos) this.card(item, data.admin);
      this.syncControls();
    } catch (error) {
      if (epoch === this.epoch && ticket === this.listTicket && error.message !== 'SESSION_CHANGED') this.message(error.status === 404 ? 'Bitte zuerst die zehn SQL-Schritte für Glückwünsche ausführen.' : error.message, true);
    }
  }
  move(item, direction) {
    const ordered = this.items.filter(entry => !entry.deleting).map(entry => entry.id);
    const index = ordered.indexOf(item.id), target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    void this.run('order', async ctx => {
      await this.transport.rpc('rq_birthday_order', { p_ids: ordered }, ctx);
      this.message('Reihenfolge gespeichert.');
    });
  }
  card(item, admin) {
    const card = el('article', undefined, 'panel'); card.append(el('h3', item.title));
    card.append(el('p', item.mime.startsWith('audio/') ? '🎙️ Sprachmemo' : '🎬 Video', 'field-hint'));
    if (item.description) card.append(el('p', item.description, 'pre-line'));
    if (admin) card.append(el('p', item.deleting ? 'Entfernung noch nicht abgeschlossen' : !item.uploaded ? 'Übertragung noch offen' : item.published ? 'Für Richard freigegeben' : 'Privater Entwurf, für Richard unsichtbar', 'field-hint'));
    const controls = el('div', undefined, 'feature-toolbar'); card.append(controls);
    if (item.uploaded && !item.deleting) controls.append(button('▶ Ab hier abspielen', () => {
      this.playlist.playFrom(item.id); this.playlist.panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }));
    if (admin && !item.deleting) {
      if (!item.uploaded) {
        controls.append(button('Upload prüfen', () => void this.run('check', async ctx => {
          await this.transport.rpc('rq_birthday_finish', { p_id: item.id }, ctx); this.clearPending(item.id); this.message('Upload bestätigt. Der Gruß bleibt privat.');
        })));
        if (item.hash) controls.append(button('Diesen Upload fortsetzen', () => {
          if (this.busy) return;
          if (this.pending && this.pending.id !== item.id) { this.message('Bitte zuerst deine andere offene Übertragung abschließen oder entfernen.', true); return; }
          if (!this.pending) { this.persist({ id: item.id, title: item.title, description: item.description, bytes: Number(item.bytes), mime: item.mime, hash: item.hash, path: item.path, url: null }); this.file.value = ''; }
          this.title.value = item.title; this.description.value = item.description; this.form.scrollIntoView({ block: 'start', behavior: 'smooth' });
          this.message('Wähle dieselbe Datei und anschließend „Upload fortsetzen“.');
        }));
      } else controls.append(button(item.published ? 'Freigabe zurücknehmen' : 'Für Richard freigeben', () => void this.run('publish', async ctx => {
        await this.transport.rpc('rq_birthday_publish', { p_id: item.id, p_visible: !item.published }, ctx);
        this.message(item.published ? 'Die Freigabe wurde zurückgenommen.' : 'Der Gruß ist jetzt für Richard sichtbar.');
      }), item.published ? 'secondary' : 'primary'));
      controls.append(button('↑ Früher abspielen', () => this.move(item, -1), 'text-btn'), button('↓ Später abspielen', () => this.move(item, 1), 'text-btn'));
      if (item.uploaded && this.pending?.id !== item.id) controls.append(button('Titel und Text bearbeiten', () => {
        if (this.busy) return;
        const title = prompt('Titel des Glückwunsches:', item.title); if (title === null) return;
        const description = prompt('Persönlicher Text (optional):', item.description); if (description === null) return;
        void this.run('edit', async ctx => { await this.transport.rpc('rq_birthday_edit', { p_id: item.id, p_title: title, p_description: description }, ctx); this.message('Titel und Text gespeichert.'); });
      }, 'text-btn'));
    }
    if (admin) controls.append(button(item.deleting ? 'Entfernung abschließen' : 'Gruß löschen', () => {
      if (!confirm(`„${item.title}“ und die gespeicherte Datei dauerhaft entfernen?`)) return;
      void this.run('remove', async ctx => { await this.transport.remove(item.id, ctx); this.clearPending(item.id); this.message('Gruß entfernt.'); });
    }, 'text-btn'));
    this.list.append(card);
  }
}
