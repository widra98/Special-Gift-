const $ = id => document.getElementById(id);
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
function message(id, text, error = false) {
  $(id).textContent = text;
  $(id).className = `status${error ? ' error' : ''}`;
}
function read(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } }
function save(key, value) { try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* Kein Einfluss auf bereits gespeicherte Notizen. */ } }

export function imageDimensions(width, height, maximum = 1800) {
  if (!(width > 0 && height > 0)) throw new Error('Das Bild hat keine gültige Größe.');
  const scale = Math.min(1, maximum / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function validateNote(text, hasImage) {
  const clean = text.trim();
  if (!clean && !hasImage) throw new Error('Schreib eine Nachricht oder wähle ein Bild aus.');
  if (clean.length > 2000) throw new Error('Die Nachricht darf höchstens 2000 Zeichen haben.');
  return clean;
}
export async function prepareImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Bitte ein JPG-, PNG- oder WebP-Bild auswählen.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Bitte ein Bild mit höchstens 20 MB auswählen.');
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('Dieses Bild konnte nicht geöffnet werden. Bitte wähle ein anderes Bild.'); }
  try {
    const size = imageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Die Bildverarbeitung ist in diesem Browser nicht verfügbar.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size > 5 * 1024 * 1024) throw new Error('Bitte ein kleineres Bild auswählen.');
    // Neu enkodiert: keine ursprünglichen EXIF-/GPS-Metadaten übernehmen.
    return blob;
  } finally { bitmap.close(); }
}

export class NotesPanel {
  constructor(api, namespace) {
    this.api = api; this.namespace = namespace;
    this.user = null; this.generation = 0; this.imageGeneration = 0; this.loadGeneration = 0;
    this.urls = []; this.items = []; this.pending = null; this.blob = null; this.preview = null;
    this.sending = false; this.preparing = false; this.loading = false;
    $('noteForm').onsubmit = event => { event.preventDefault(); void this.send(); };
    $('noteImage').onchange = () => void this.pickImage();
    $('removeNoteImage').onclick = () => this.clearImage();
    $('refreshNotes').onclick = () => void this.load();
    $('olderNotes').onclick = () => void this.load(true);
  }
  get key() { return `rq-note-outbox:${this.namespace}:${this.user?.id}`; }
  attach(user) {
    if (this.user?.id === user.id) return;
    this.reset(); this.user = user;
    const saved = read(this.key);
    if (saved?.p_id && typeof saved.p_message === 'string') {
      this.pending = saved; this.uploaded = true;
      $('noteText').value = saved.p_message; $('noteFields').disabled = true;
      $('sendNote').textContent = 'Übertragung erneut prüfen';
      message('noteStatus', 'Für eine Notiz fehlt noch die Bestätigung. Prüfe die Übertragung, bevor du eine neue Notiz sendest.');
    }
  }
  reset() {
    this.generation++; this.imageGeneration++; this.loadGeneration++;
    this.user = null; this.pending = null; this.uploaded = false; this.sending = false; this.loading = false;
    this.preparing = false; this.items = [];
    this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = [];
    this.clearImage(); $('noteForm').reset(); $('noteFields').disabled = false;
    $('sendNote').disabled = false; $('sendNote').textContent = 'Notiz senden';
    $('refreshNotes').disabled = false; $('olderNotes').hidden = true;
    $('notesTimeline').replaceChildren(); message('noteStatus', ''); message('notesLoadStatus', '');
  }
  clearImage() {
    this.imageGeneration++; this.blob = null;
    this.preparing = false;
    $('sendNote').disabled = this.sending;
    if (this.preview) URL.revokeObjectURL(this.preview);
    this.preview = null;
    $('notePreview').removeAttribute('src'); $('notePreview').hidden = true;
    $('noteImage').value = ''; $('removeNoteImage').hidden = true;
  }
  async pickImage() {
    const file = $('noteImage').files[0];
    if (!file) { this.clearImage(); return; }
    this.clearImage();
    const ticket = this.generation; const imageTicket = this.imageGeneration;
    this.preparing = true; $('sendNote').disabled = true; message('noteStatus', 'Dein Bild wird vorbereitet …');
    try {
      const blob = await prepareImage(file);
      if (ticket !== this.generation || imageTicket !== this.imageGeneration) return;
      this.blob = blob; this.preview = URL.createObjectURL(blob);
      $('notePreview').src = this.preview; $('notePreview').hidden = false; $('removeNoteImage').hidden = false;
      message('noteStatus', 'Dein Bild ist bereit.');
    } catch (error) { if (ticket === this.generation) message('noteStatus', error.message, true); }
    finally { if (ticket === this.generation && imageTicket === this.imageGeneration) { this.preparing = false; $('sendNote').disabled = false; } }
  }
  async send() {
    if (!this.user || this.sending || this.preparing) return;
    const ticket = this.generation;
    try {
      if (!this.pending) {
        const text = validateNote($('noteText').value, Boolean(this.blob));
        const id = crypto.randomUUID();
        this.pending = { p_id: id, p_message: text, p_image_path: this.blob ? `${this.user.id}/${id}.jpg` : null };
      }
      this.sending = true; $('noteFields').disabled = true; $('sendNote').disabled = true;
      if (this.blob && !this.uploaded) {
        message('noteStatus', 'Dein Bild wird hochgeladen …');
        await this.api.uploadImage(this.pending.p_image_path, this.blob);
        if (ticket !== this.generation) return;
        this.uploaded = true;
      }
      save(this.key, this.pending);
      message('noteStatus', 'Deine Notiz wird gesendet …');
      await this.api.createNote(this.pending);
      if (ticket !== this.generation) return;
      save(this.key, null); this.pending = null; this.uploaded = false;
      this.clearImage(); $('noteForm').reset(); $('noteFields').disabled = false; $('sendNote').textContent = 'Notiz senden';
      message('noteStatus', 'Gesendet. Deine Notiz ist jetzt für euch beide im Verlauf sichtbar.');
      await this.load();
    } catch (error) {
      if (ticket !== this.generation) return;
      message('noteStatus', error.message, true);
      $('sendNote').textContent = this.pending ? 'Übertragung erneut prüfen' : 'Notiz senden';
    } finally { if (ticket === this.generation) { this.sending = false; $('sendNote').disabled = false; } }
  }
  async load(older = false) {
    if (!this.user || this.loading) return;
    this.loading = true; const ticket = this.generation;
    $('refreshNotes').disabled = true; $('olderNotes').disabled = true;
    message('notesLoadStatus', 'Notizen werden geladen …');
    try {
      const cursor = older ? this.items.at(-1) : null;
      const incoming = await this.api.listNotes(cursor);
      if (ticket !== this.generation) return;
      const hasMore = incoming.length > 20;
      this.items = older ? [...this.items, ...incoming.slice(0, 20)] : incoming.slice(0, 20);
      $('olderNotes').hidden = !hasMore;
      this.render(); message('notesLoadStatus', '');
    } catch (error) { if (ticket === this.generation) message('notesLoadStatus', error.message, true); }
    finally { if (ticket === this.generation) { this.loading = false; $('refreshNotes').disabled = false; $('olderNotes').disabled = false; } }
  }
  render() {
    const ticket = ++this.loadGeneration;
    const timeline = $('notesTimeline'); timeline.replaceChildren();
    this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = [];
    if (!this.items.length) { timeline.append(make('p', '', 'Noch keine Notizen. Der erste kleine Gruß kann von dir kommen.')); return; }
    let lastDay = '';
    const imageJobs = [];
    for (const item of this.items) {
      const date = new Date(item.created_at);
      const day = date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
      if (day !== lastDay) { timeline.append(make('h3', 'day-label', day)); lastDay = day; }
      const card = make('article', `list-item note-card${item.is_mine ? ' mine' : ''}`);
      const meta = make('div', 'note-meta');
      meta.append(make('strong', '', item.is_mine ? 'Du' : item.author), make('span', '', date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })));
      card.append(meta);
      if (item.message) card.append(make('p', 'note-message', item.message));
      if (item.image_path) {
        const loading = make('p', '', 'Bild wird geladen …'); card.append(loading);
        imageJobs.push(async () => {
          try {
            const blob = await this.api.downloadImage(item.image_path);
            if (ticket !== this.loadGeneration) return;
            const url = URL.createObjectURL(blob); this.urls.push(url);
            const image = make('img', 'note-image'); image.alt = `Bild von ${item.author} zur Notiz vom ${day}`;
            image.src = url; image.loading = 'lazy'; loading.replaceWith(image);
          } catch { if (ticket === this.loadGeneration) loading.textContent = 'Das Bild konnte nicht geladen werden. Bitte lade die Notizen erneut.'; }
        });
      }
      timeline.append(card);
    }
    // Begrenzte gleichzeitige Downloads, auch bei längeren Verläufen.
    const worker = async () => { while (imageJobs.length && ticket === this.loadGeneration) await imageJobs.shift()(); };
    void Promise.all([worker(), worker(), worker()]);
  }
}
