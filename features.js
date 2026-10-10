import { prepareImage } from './notes.js?v=20261006';
import { validateQuestion } from './quiz-state.js?v=20261006';

const node = (tag, cls = '', text) => {
  const n = document.createElement(tag); n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const button = (text, action, cls = 'secondary') => {
  const n = node('button', cls, text); n.type = 'button'; n.onclick = () => action(n); return n;
};
const textField = (form, label, name, { value = '', type = 'text', required = false, max = 500, rows } = {}) => {
  const id = `field-${crypto.randomUUID()}`;
  const l = node('label', '', label); l.htmlFor = id;
  const input = node(rows ? 'textarea' : 'input'); input.id = id; input.name = name;
  if (rows) input.rows = rows; else input.type = type;
  input.maxLength = max; input.required = required; input.value = value;
  form.append(l, input); return input;
};
const submit = (form, label) => { const b = node('button', 'primary', label); b.type = 'submit'; form.append(b); return b; };
const details = (root, label) => { const d = node('details'); d.append(node('summary', '', label)); root.append(d); return d; };
const read = key => { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } };
const save = (key, value) => { try { value ? sessionStorage.setItem(key, JSON.stringify(value)) : sessionStorage.removeItem(key); } catch { /* Aktueller Tab bleibt wiederholbar. */ } };
const formatDate = (value, berlin = false) => new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', ...(berlin ? { timeZone: 'Europe/Berlin' } : {}) });
const localInput = value => {
  if (!value) return '';
  const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

class Panel {
  constructor(api, namespace, rootId, changed) {
    this.api = api; this.namespace = namespace; this.root = document.getElementById(rootId); this.changed = changed;
    this.rootId = rootId; this.user = null; this.epoch = 0; this.renderId = 0; this.urls = new Map(); this.busy = false;
  }
  get key() { return `rq-v2-outbox:${this.namespace}:${this.user?.id}:${this.rootId}`; }
  attach(user) { if (this.user?.id !== user.id) { this.reset(); this.user = user; this.pending = read(this.key); } }
  reset() {
    this.epoch++; this.renderId++; this.user = null; this.pending = null; this.busy = false;
    clearInterval(this.timer); this.urls.forEach(URL.revokeObjectURL); this.urls.clear(); this.root.replaceChildren();
  }
  guard(ticket) { if (!this.user || ticket !== this.epoch) throw new Error('SESSION_CHANGED'); }
  async call(action, data = {}) {
    const ticket = this.epoch; this.guard(ticket);
    const result = await this.api.features(action, data); this.guard(ticket); return result;
  }
  async write(action, data) {
    if (this.pending && JSON.stringify(this.pending) !== JSON.stringify({ action, data })) {
      throw new Error('Bitte zuerst die offene Übertragung mit „Übertragung prüfen“ abschließen.');
    }
    this.pending = { action, data }; save(this.key, this.pending);
    try {
      const result = await this.call(action, data);
      save(this.key, null); this.pending = null; return result;
    } catch (error) {
      if (this.user && [400, 403, 404, 409, 422].includes(error.status)) { save(this.key, null); this.pending = null; }
      throw error;
    }
  }
  message(text = '', error = false) {
    if (!this.status?.isConnected) return;
    this.status.textContent = text; this.status.className = `status${error ? ' error' : ''}`;
  }
  async run(control, job) {
    if (this.busy || !this.user) return;
    this.busy = true; const ticket = this.epoch; if (control) control.disabled = true;
    try { await job(); }
    catch (error) {
      if (ticket === this.epoch && error.message !== 'SESSION_CHANGED') {
        this.message(error.message, true); this.retryButton();
        if (!this.api.session) this.changed();
      }
    } finally { if (ticket === this.epoch) { this.busy = false; if (control) control.disabled = false; } }
  }
  frame() {
    clearInterval(this.timer); this.renderId++;
    this.urls.forEach(URL.revokeObjectURL); this.urls.clear(); this.root.replaceChildren();
    const toolbar = node('div', 'feature-toolbar');
    toolbar.append(button('Aktualisieren', b => this.run(b, () => this.load()), 'text-btn'));
    this.retry = node('div'); this.status = node('p', 'status'); this.status.setAttribute('role', 'status');
    this.root.append(toolbar, this.status, this.retry); this.retryButton();
  }
  retryButton() {
    if (!this.retry) return;
    this.retry.replaceChildren();
    if (this.pending) {
      this.retry.append(node('p', '', 'Für eine Übertragung fehlt noch die Bestätigung. Erneutes Prüfen erzeugt keine zweite Kopie.'));
      this.retry.append(button('Übertragung prüfen', b => this.run(b, async () => {
        await this.write(this.pending.action, this.pending.data); await this.load(); this.changed();
      })));
    }
  }
  async image(path, bucket, target, title = '') {
    const ticket = this.epoch, renderId = this.renderId;
    try {
      const key = `${bucket}/${path}`;
      let url = this.urls.get(key);
      if (!url) {
        const blob = await this.api.downloadImage(path, bucket);
        if (ticket !== this.epoch || renderId !== this.renderId || !target.isConnected) return;
        url = URL.createObjectURL(blob); this.urls.set(key, url);
      }
      const img = node('img'); img.alt = title || 'Gemeinsame Erinnerung'; img.src = url; img.loading = 'lazy';
      target.replaceChildren(img);
    } catch {
      if (ticket === this.epoch && renderId === this.renderId) target.textContent = 'Bild konnte nicht geladen werden. Bitte aktualisieren.';
    }
  }
  images(jobs) {
    const r = this.renderId;
    const worker = async () => { while (jobs.length && r === this.renderId) await jobs.shift()(); };
    void Promise.all([worker(), worker(), worker()]);
  }
}

class Gallery extends Panel {
  reset() { super.reset(); this.albumId = null; this.offset = 0; this.queue = null; }
  async load() {
    const result = this.albumId ? await this.call('album_get', { id: this.albumId, offset: this.offset }) : await this.call('albums_list', { offset: this.offset });
    this.frame(); this.queue = null;
    if (this.albumId) this.album(result); else this.list(result);
  }
  list(items) {
    const create = details(this.root, '＋ Neues Album anlegen');
    const form = node('form', 'panel'); create.append(form);
    const title = textField(form, 'Albumname', 'title', { required: true, max: 100 });
    const description = textField(form, 'Beschreibung (optional)', 'description', { rows: 2, max: 1000 });
    const send = submit(form, 'Album erstellen'); const id = crypto.randomUUID();
    form.onsubmit = e => { e.preventDefault(); void this.run(send, async () => {
      const result = await this.write('album_create', { id, title: title.value.trim(), description: description.value.trim() });
      this.albumId = result.id; this.offset = 0; await this.load(); this.message('Album angelegt. Jetzt kannst du Fotos hinzufügen.');
    }); };
    if (!items.length) this.root.append(node('p', 'panel empty', 'Noch keine Alben. Legt euer erstes gemeinsames Album an.'));
    const grid = node('div', 'album-grid'); this.root.append(grid); const jobs = [];
    for (const item of items.slice(0, 20)) {
      const card = button('', b => this.run(b, async () => { this.albumId = item.id; this.offset = 0; await this.load(); }), 'album-card');
      const cover = node('div', 'album-cover', '📸'); card.append(cover, node('strong', '', item.title), node('span', '', `${item.count} Fotos`));
      if (item.description) card.append(node('p', '', item.description)); grid.append(card);
      if (item.cover) jobs.push(() => this.image(item.cover, 'rq-albums', cover, `Titelbild: ${item.title}`));
    }
    this.pages(20, items.length > 20); this.images(jobs);
  }
  pages(size, more) {
    const bar = node('div', 'pager');
    if (this.offset > 0) bar.append(button('Vorherige Seite', b => this.run(b, async () => { this.offset = Math.max(0, this.offset - size); await this.load(); })));
    if (more) bar.append(button('Weitere anzeigen', b => this.run(b, async () => { this.offset += size; await this.load(); })));
    this.root.append(bar);
  }
  album(data) {
    const a = data.album;
    this.root.append(button('‹ Alle Alben', b => this.run(b, async () => { this.albumId = null; this.offset = 0; await this.load(); }), 'text-btn'));
    this.root.append(node('h2', '', a.title), node('p', '', a.description));
    const edit = details(this.root, 'Albumname und Beschreibung bearbeiten'); const rename = node('form', 'panel'); edit.append(rename);
    const title = textField(rename, 'Albumname', 'title', { value: a.title, max: 100, required: true });
    const description = textField(rename, 'Beschreibung', 'description', { value: a.description, rows: 2, max: 1000 });
    const renameButton = submit(rename, 'Änderungen speichern');
    rename.onsubmit = e => { e.preventDefault(); void this.run(renameButton, async () => {
      await this.write('album_rename', { id: a.id, title: title.value.trim(), description: description.value.trim() }); await this.load();
    }); };
    const form = node('form', 'panel');
    const files = textField(form, 'Fotos vom Handy auswählen', 'photos', { type: 'file', required: true });
    files.multiple = true; files.accept = 'image/jpeg,image/png,image/webp';
    form.append(node('p', 'field-hint', 'Mehrere Bilder möglich. JPG, PNG oder WebP, bis 20 MB je Bild. Sie werden vor dem Hochladen verkleinert. Bitte warte bis zur Bestätigung.'));
    const send = submit(form, 'Fotos hochladen'); this.root.append(form);
    files.onchange = () => {
      if (this.pending) { files.value = ''; this.message('Bitte zuerst die offene Übertragung prüfen, bevor du weitere Fotos auswählst.'); return; }
      this.queue = null; send.textContent = 'Fotos hochladen';
    };
    form.onsubmit = e => { e.preventDefault(); void this.run(send, async () => {
      if (!this.queue) this.queue = [...files.files].map(file => ({ file, id: crypto.randomUUID(), done: false, blob: null }));
      if (!this.queue.length) throw new Error('Bitte mindestens ein Foto auswählen.');
      const ticket = this.epoch; files.disabled = true;
      try {
        for (let i = 0; i < this.queue.length; i++) {
          const photo = this.queue[i]; if (photo.done) continue; this.guard(ticket);
          this.message(`Foto ${i + 1} von ${this.queue.length} wird hochgeladen …`);
          photo.blob ??= await prepareImage(photo.file); this.guard(ticket);
          await this.api.uploadImage(`${this.user.id}/${photo.id}.jpg`, photo.blob, 'rq-albums'); this.guard(ticket);
          await this.write('photo_add', { id: photo.id, album_id: a.id, caption: '' });
          photo.done = true; photo.blob = null;
        }
        const count = this.queue.length; this.queue = null; this.offset = 0; await this.load();
        this.message(`${count} ${count === 1 ? 'Foto ist' : 'Fotos sind'} im Album gespeichert und für euch beide sichtbar.`);
      } catch (error) { send.textContent = 'Hochladen fortsetzen'; throw error; }
      finally { if (ticket === this.epoch) files.disabled = false; }
    }); };
    const photos = data.photos.slice(0, 24); const grid = node('div', 'photo-grid'); this.root.append(grid); const jobs = [];
    if (!photos.length) grid.append(node('p', '', 'In diesem Album sind noch keine Fotos.'));
    photos.forEach((photo, index) => {
      const card = node('article', 'photo-card'); const open = button('', () => this.viewer(photos, index), 'photo-open');
      open.setAttribute('aria-label', photo.caption || `Foto ${index + 1} von ${photo.author} vergrößern`);
      const image = node('div', 'photo-thumb', 'Bild wird geladen …'); open.append(image); card.append(open);
      card.append(node('p', '', photo.caption || `Von ${photo.author}`));
      if (photo.mine) card.append(button('Foto entfernen', b => this.run(b, async () => {
        if (!confirm('Dieses Foto aus dem gemeinsamen Album entfernen?')) return;
        const result = await this.write('photo_remove', { id: photo.id });
        let notice = 'Foto entfernt.';
        try { await this.api.removeAlbumImage(result.path); } catch (error) { notice = error.message; }
        await this.load(); this.message(notice);
      }), 'text-btn'));
      grid.append(card); jobs.push(() => this.image(photo.path, 'rq-albums', image, photo.caption || `Foto von ${photo.author}`));
    });
    this.pages(24, data.photos.length > 24); this.images(jobs);
  }
  viewer(photos, index) {
    const dialog = node('dialog', 'photo-dialog'); dialog.setAttribute('aria-label', 'Fotoansicht');
    const heading = node('p'); const image = node('div', 'viewer-image');
    const close = button('Schließen ×', () => { dialog.close(); dialog.remove(); }, 'text-btn');
    let current = index;
    const draw = () => { image.replaceChildren(); image.textContent = 'Bild wird geladen …'; heading.textContent = `${current + 1} / ${photos.length} · ${photos[current].caption || photos[current].author}`;
      const photo = photos[current]; const placeholder = node('div'); image.replaceChildren(placeholder); void this.image(photo.path, 'rq-albums', placeholder, photo.caption); };
    const move = n => { current = (current + n + photos.length) % photos.length; draw(); };
    const bar = node('div', 'pager'); bar.append(button('‹ Vorheriges', () => move(-1)), button('Nächstes ›', () => move(1)));
    dialog.append(close, heading, image, bar); this.root.append(dialog); dialog.showModal(); draw();
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); move(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); } });
    let x = null;
    image.addEventListener('touchstart', e => { x = e.touches[0]?.clientX; }, { passive: true });
    image.addEventListener('touchend', e => { const end = e.changedTouches[0]?.clientX; if (x !== null && Math.abs(end - x) > 50) move(end < x ? 1 : -1); x = null; }, { passive: true });
  }
}

class Match extends Panel {
  async load(result = null) {
    const state = result ?? await this.call('match_get'); this.frame();
    this.root.append(node('p', 'counter', `Heute ${state.daily_used}/5 beantwortet · Bei ${state.agreed} von ${state.compared} verglichenen Fragen seid ihr euch einig.`));
    if (state.next) {
      const q = state.next; const form = node('form', 'panel'); const fields = node('fieldset'); fields.append(node('legend', '', q.question));
      q.options.forEach((text, i) => {
        const label = node('label', 'answer-option'); const radio = node('input'); radio.type = 'radio'; radio.name = 'matchAnswer'; radio.value = String(i); radio.required = true;
        label.append(radio, node('span', '', text)); fields.append(label);
      });
      form.append(fields); const send = submit(form, 'Antwort verbindlich abgeben'); this.root.append(form);
      form.onsubmit = e => { e.preventDefault(); void this.run(send, async () => {
        const selected = form.querySelector('input:checked'); if (!selected) return;
        fields.disabled = true;
        try {
          const result = await this.write('match_answer', { id: q.id, selected: Number(selected.value) });
          const answer = result.history.find(x => x.id === q.id); await this.load(result);
          this.message(answer?.partner == null ? 'Deine Antwort ist gespeichert. Sobald dein Gegenüber antwortet, könnt ihr vergleichen.' : answer.agrees ? `Ihr stimmt überein! Je 1 Punkt. Eure Antwort: ${answer.mine}` : `Diesmal verschieden. Du: ${answer.mine}. Dein Gegenüber: ${answer.partner}.`);
          this.changed();
        } catch (error) { if (!this.pending) fields.disabled = false; throw error; }
      }); };
    } else this.root.append(node('p', 'panel empty', state.daily_used >= 5 ? 'Deine fünf Fragen für heute sind erledigt. Morgen geht es weiter.' : 'Ihr habt alle verfügbaren Fragen beantwortet. Ihr könnt jederzeit neue ergänzen.'));
    const create = details(this.root, '＋ Eine gemeinsame Frage hinzufügen'); const form = node('form', 'panel'); create.append(form);
    const question = textField(form, 'Frage für euch beide', 'question', { required: true, max: 500, rows: 2 });
    const options = [0, 1, 2, 3].map(i => textField(form, `Antwort ${'ABCD'[i]}`, `option${i}`, { required: true, max: 160 }));
    form.append(node('p', 'field-hint', 'Hier gibt es keine richtige Lösung. Du beantwortest die Frage später selbst, genau wie dein Gegenüber.'));
    const send = submit(form, 'Frage hinzufügen'); const id = crypto.randomUUID();
    form.onsubmit = e => { e.preventDefault(); void this.run(send, async () => {
      const validated = validateQuestion(question.value, options.map(o => o.value), 0);
      await this.write('match_create', { id, question: validated.p_question, options: validated.p_options });
      await this.load(); this.message('Die neue Frage ist für euch beide verfügbar.');
    }); };
    const history = details(this.root, 'Unsere Antworten und offenen Vergleiche'); history.open = true;
    if (!state.history.length) history.append(node('p', '', 'Noch keine Antworten.'));
    const list = node('div', 'list'); history.append(list);
    for (const item of state.history) {
      const card = node('article', 'list-item');
      card.append(node('span', 'tag', item.partner == null ? 'Wartet auf dein Gegenüber' : item.agrees ? 'Gleiche Antwort · je 1 Punkt' : 'Unterschiedliche Antworten'), node('strong', '', item.question), node('p', '', `Du: ${item.mine}`));
      if (item.partner != null) card.append(node('p', '', `Dein Gegenüber: ${item.partner}`)); list.append(card);
    }
  }
}

class Mystery extends Panel {
  async load() { const state = await this.call('hunt_get'); this.frame(); if (state.admin) this.admin(state); else this.play(state); }
  admin(state) {
    this.root.append(node('p', 'counter', `${state.progress} von ${state.total} Aufgaben erledigt`));
    if (state.started) this.root.append(node('p', 'panel', 'Richard hat begonnen. Aufgaben und Starttermin bleiben jetzt fest. Hier kannst du seine Nachweise prüfen.'));
    const settings = details(this.root, 'Starttermin und Geschenk-Finale'); settings.open = !state.settings.published;
    const form = node('form', 'panel'); settings.append(form); const fields = node('fieldset'); fields.disabled = state.started; form.append(fields);
    const start = textField(fields, 'Starttermin (Ortszeit deines Geräts)', 'start', { type: 'datetime-local', value: localInput(state.settings.starts_at) });
    const hint = node('p', 'field-hint'); fields.append(hint);
    start.oninput = () => { hint.textContent = start.value ? `Das ist ${formatDate(new Date(start.value).toISOString(), true)} Uhr in Deutschland.` : 'Du kannst den Termin später festlegen.'; }; start.oninput();
    const final = textField(fields, 'Nachricht nach der letzten Aufgabe: Wo ist das große Geschenk?', 'final', { rows: 4, max: 4000, value: state.settings.final_message });
    const label = node('label', 'check-label'); const published = node('input'); published.type = 'checkbox'; published.checked = state.settings.published;
    label.append(published, node('span', '', 'Schnitzeljagd zum eingetragenen Termin freigeben')); fields.append(label);
    fields.append(node('p', 'field-hint', 'Lege zuerst alle Aufgaben an. Ohne Freigabe bleibt die Schnitzeljagd für Richard verborgen.'));
    const saveSettings = submit(fields, 'Einstellungen speichern');
    form.onsubmit = e => { e.preventDefault(); void this.run(saveSettings, async () => {
      await this.write('hunt_save', { starts_at: start.value ? new Date(start.value).toISOString() : null, published: published.checked, final_message: final.value });
      await this.load(); this.message('Einstellungen gespeichert.');
    }); };
    const editor = details(this.root, '＋ Aufgabe anlegen oder bearbeiten');
    const edit = node('form', 'panel'); const editFields = node('fieldset'); editFields.disabled = state.started; edit.append(editFields); editor.append(edit);
    let editId = crypto.randomUUID();
    const position = textField(editFields, 'Reihenfolge (freie Nummer von 1 bis 100)', 'position', { type: 'number', value: String(Math.max(0, ...state.steps.map(x => x.position)) + 1), required: true }); position.min = '1'; position.max = '100';
    const title = textField(editFields, 'Titel der Aufgabe', 'title', { required: true, max: 150 });
    const instruction = textField(editFields, 'Aufgabe und Hinweise für Richard', 'instruction', { required: true, rows: 5, max: 4000 });
    const kindLabel = node('label', '', 'Wie wird die Aufgabe bestätigt?'); const kind = node('select'); kindLabel.append(kind); editFields.append(kindLabel);
    for (const [value, text] of [['code', 'Lösungswort oder Zahlencode'], ['manual', 'Text / Foto und meine Freigabe']]) { const o = node('option', '', text); o.value = value; kind.append(o); }
    const solution = textField(editFields, 'Richtiges Lösungswort / Code', 'solution', { max: 200, required: true });
    editFields.append(node('p', 'field-hint', 'Bei Codes werden Groß-/Kleinschreibung und Leerzeichen am Anfang und Ende ignoriert. Führende Nullen bleiben erhalten.'));
    kind.onchange = () => { solution.disabled = state.started || kind.value !== 'code'; solution.required = kind.value === 'code'; }; kind.onchange();
    const saveStep = submit(editFields, 'Aufgabe speichern');
    edit.onsubmit = e => { e.preventDefault(); void this.run(saveStep, async () => {
      await this.write('hunt_step_save', { id: editId, position: Number(position.value), title: title.value.trim(), instruction: instruction.value.trim(), kind: kind.value, solution: kind.value === 'code' ? solution.value.trim() : '' });
      await this.load(); this.message('Aufgabe gespeichert.');
    }); };
    this.root.append(node('h2', '', 'Deine Aufgaben'));
    if (!state.steps.length) this.root.append(node('p', '', 'Noch keine Aufgaben. Öffne „Aufgabe anlegen oder bearbeiten“.'));
    const steps = node('div', 'list'); this.root.append(steps);
    for (const step of state.steps) {
      const card = node('article', 'list-item'); card.append(node('strong', '', `${step.position}. ${step.title}`), node('p', 'pre-line', step.instruction), node('span', 'tag', step.kind === 'code' ? 'Lösungswort / Code' : 'Deine Freigabe'));
      if (!state.started) {
        card.append(button('Bearbeiten', () => { editId = step.id; position.value = step.position; title.value = step.title; instruction.value = step.instruction; kind.value = step.kind; solution.value = step.solution; kind.onchange(); editor.open = true; title.focus(); }, 'text-btn'));
        card.append(button('Aufgabe löschen', b => this.run(b, async () => {
          if (!confirm(`Aufgabe „${step.title}“ löschen?`)) return;
          await this.write('hunt_step_delete', { id: step.id }); await this.load();
        }), 'text-btn'));
      }
      steps.append(card);
    }
    this.root.append(node('h2', '', 'Richards Nachweise'));
    if (!state.reviews.length) this.root.append(node('p', '', 'Gerade wartet kein Nachweis auf deine Freigabe.'));
    const jobs = [];
    for (const review of state.reviews) {
      const card = node('article', 'panel'); const step = state.steps.find(s => s.id === review.step_id);
      card.append(node('h3', '', step?.title || 'Aufgabe'), node('p', 'pre-line', review.message));
      if (review.image_path) { const target = node('div', 'proof-image', 'Foto wird geladen …'); card.append(target); jobs.push(() => this.image(review.image_path, 'rq-mystery', target, 'Richards Fotonachweis')); }
      const feedback = textField(card, 'Rückmeldung für Richard (optional)', 'feedback', { rows: 2, max: 1000 });
      const decide = status => b => this.run(b, async () => { await this.write('hunt_review', { id: review.id, status, feedback: feedback.value.trim() }); await this.load(); this.message(status === 'approved' ? 'Freigegeben. Richard kann mit der nächsten Aufgabe weitermachen.' : 'Zurückgegeben. Richard kann einen neuen Nachweis senden.'); });
      card.append(button('Aufgabe freigeben', decide('approved'), 'primary'), button('Zurückgeben', decide('rejected'))); this.root.append(card);
    }
    this.images(jobs);
  }
  play(state) {
    if (state.locked) {
      const card = node('div', 'panel empty'); card.append(node('span', 'big-icon', '🎁'), node('h2', '', 'Eine Überraschung wartet.')); this.root.append(card);
      if (!state.starts_at) { card.append(node('p', '', 'Der Starttermin wird noch festgelegt.')); return; }
      card.append(node('p', '', `Start: ${formatDate(state.starts_at)} Uhr (deine Ortszeit)`));
      const countdown = node('p', 'countdown'); card.append(countdown); const received = Date.now(); const serverNow = new Date(state.server_now).getTime();
      const tick = () => {
        const seconds = Math.max(0, Math.ceil((new Date(state.starts_at).getTime() - (serverNow + Date.now() - received)) / 1000));
        countdown.textContent = `${Math.floor(seconds / 86400)} Tage · ${Math.floor(seconds / 3600) % 24} Std · ${Math.floor(seconds / 60) % 60} Min · ${seconds % 60} Sek`;
        if (seconds === 0) { clearInterval(this.timer); void this.run(null, () => this.load()); }
      }; this.timer = setInterval(tick, 1000); tick(); return;
    }
    this.root.append(node('p', 'counter', `${state.progress} von ${state.total} Aufgaben geschafft`));
    if (state.finished) { const card = node('div', 'panel'); card.append(node('h2', '', 'Geschafft! 🎉'), node('p', 'pre-line', state.final_message || 'Du hast alle Aufgaben gelöst. Frag Kira nach deinem großen Geschenk.')); this.root.append(card); return; }
    if (!state.step) { this.root.append(node('p', '', 'Es ist noch keine Aufgabe verfügbar.')); return; }
    const step = state.step; const card = node('div', 'panel'); card.append(node('h2', '', step.title), node('p', 'pre-line', step.instruction)); this.root.append(card);
    if (state.latest?.feedback) card.append(node('p', 'result', `Kira: ${state.latest.feedback}`));
    if (state.latest?.status === 'pending') { card.append(node('p', 'result', 'Dein Nachweis ist eingereicht. Kira gibt die nächste Aufgabe nach ihrer Prüfung frei. Tippe danach auf „Aktualisieren“.')); return; }
    if (state.latest?.status === 'wrong') card.append(node('p', 'status error', 'Das Lösungswort stimmt noch nicht. Du kannst es erneut versuchen.'));
    if (state.latest?.status === 'rejected') card.append(node('p', 'status', 'Bitte ergänze deinen Nachweis und reiche ihn erneut ein.'));
    const form = node('form'); const fields = node('fieldset'); form.append(fields);
    const message = textField(fields, step.kind === 'code' ? 'Dein Lösungswort oder Code' : 'Dein Nachweis als Nachricht', 'message', { required: step.kind === 'code', max: step.kind === 'code' ? 200 : 2000, rows: step.kind === 'manual' ? 3 : null });
    let file = null;
    if (step.kind === 'manual') { file = textField(fields, 'Foto als Nachweis (optional)', 'proof', { type: 'file' }); file.accept = 'image/jpeg,image/png,image/webp'; fields.append(node('p', 'field-hint', 'Text, Foto oder beides. JPG, PNG oder WebP, bis 20 MB.')); }
    const send = submit(form, step.kind === 'code' ? 'Lösung prüfen' : 'Nachweis an Kira senden'); card.append(form); let payload = null, blob = null;
    form.onsubmit = e => { e.preventDefault(); void this.run(send, async () => {
      const ticket = this.epoch; fields.disabled = true;
      try {
        if (!payload) {
          if (!message.value.trim() && !file?.files[0]) throw new Error('Bitte eine Nachricht oder ein Foto hinzufügen.');
          const id = crypto.randomUUID();
          if (file?.files[0]) { this.message('Fotonachweis wird vorbereitet …'); blob = await prepareImage(file.files[0]); this.guard(ticket); }
          payload = { id, step_id: step.id, message: message.value.trim(), image_path: blob ? `${this.user.id}/${id}.jpg` : null };
        }
        if (blob) { this.message('Fotonachweis wird hochgeladen …'); await this.api.uploadImage(payload.image_path, blob, 'rq-mystery'); this.guard(ticket); }
        await this.write('hunt_submit', payload); await this.load();
      } catch (error) { if (!this.pending && [400,403,404,409,422].includes(error.status)) { payload = null; blob = null; } throw error; }
      finally { if (ticket === this.epoch && !this.pending) fields.disabled = false; }
    }); };
  }
}

export class Features {
  constructor(api, namespace, changed) {
    this.panels = { gallery: new Gallery(api, namespace, 'galleryPanel', changed), match: new Match(api, namespace, 'matchPanel', changed), mystery: new Mystery(api, namespace, 'mysteryPanel', changed) };
    this.current = null;
  }
  attach(user) { Object.values(this.panels).forEach(p => p.attach(user)); }
  reset() { this.current = null; Object.values(this.panels).forEach(p => p.reset()); }
  route(name) {
    if (name === this.current) return;
    if (this.panels[this.current]) clearInterval(this.panels[this.current].timer);
    this.current = name; const panel = this.panels[name];
    if (panel) { panel.frame(); panel.message('Wird geladen …'); void panel.run(null, () => panel.load()); }
  }
}
