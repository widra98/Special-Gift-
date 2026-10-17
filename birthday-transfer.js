const bucket = 'rq-birthday-videos';
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const CHUNK = 6 * 1024 * 1024;
const hashes = new WeakMap();

export class VideoError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}
export function videoMime(file) {
  const name = file.name.toLowerCase();
  const extension = name.split('.').at(-1);
  const mime = ({mp4:'video/mp4',webm:file.type?.startsWith('audio/')?'audio/webm':'video/webm',
    opus:'audio/ogg',ogg:'audio/ogg',m4a:'audio/mp4',mp3:'audio/mpeg',aac:'audio/aac',wav:'audio/wav'})[extension] || '';
  if (!mime) throw new VideoError('Erlaubt: MP4, WebM, OPUS, OGG, M4A, MP3, AAC oder WAV. MOV vorher in MP4 umwandeln.');
  if (!file.size || file.size > MAX_VIDEO_BYTES) throw new VideoError('Jede Datei darf höchstens 50 MB groß sein.');
  return mime;
}
export async function fileHash(file) {
  if (!hashes.has(file)) hashes.set(file, file.arrayBuffer().then(data => crypto.subtle.digest('SHA-256', data))
    .then(data => Array.from(new Uint8Array(data), n => n.toString(16).padStart(2, '0')).join('')));
  return hashes.get(file);
}
const encodedPath = value => value.split('/').map(encodeURIComponent).join('/');
const b64 = value => btoa(String.fromCharCode(...new TextEncoder().encode(value)));

export class BirthdayTransfer {
  constructor(api, fetchImpl = globalThis.fetch.bind(globalThis)) {
    this.api = api; this.fetch = fetchImpl;
    this.base = api.url.replace(/\/$/, '');
    const project = new URL(this.base);
    if (project.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(project.hostname)) throw new VideoError('Die Supabase-Adresse ist ungültig.');
    this.storage = project.origin.replace('.supabase.co', '.storage.supabase.co');
    this.endpoint = this.storage + '/storage/v1/upload/resumable';
  }
  context(signal, guard = () => {}) { return { signal, guard, generation: this.api.generation }; }
  check(ctx) {
    ctx.guard();
    if (ctx.signal?.aborted) throw new VideoError('Übertragung pausiert. Du kannst sie fortsetzen.');
    if (ctx.generation !== this.api.generation || !this.api.session) throw new VideoError('SESSION_CHANGED');
  }
  tusUrl(value) {
    const url = new URL(value, this.endpoint);
    if (![this.base, this.storage].includes(url.origin) || url.username || url.password || url.hash ||
        !url.pathname.startsWith('/storage/v1/upload/resumable/')) throw new VideoError('Der Server hat eine ungültige Upload-Adresse geliefert.');
    return url.href;
  }
  async rpc(name, data, ctx, retryAuth = true) {
    this.check(ctx);
    await this.api.refreshSession(); this.check(ctx);
    try {
      const result = await this.api.request('/rest/v1/rpc/' + name, data, this.api.session.access_token);
      this.check(ctx); return result;
    } catch (error) {
      this.check(ctx);
      if (error.status !== 401 || !retryAuth) throw error;
      await this.api.refreshSession(true); this.check(ctx);
      return this.rpc(name, data, ctx, false);
    }
  }
  async http(target, options, ctx, retryAuth = true) {
    this.check(ctx);
    const url = new URL(target, this.base);
    if (![this.base, this.storage].includes(url.origin) || url.username || url.password || url.hash ||
        !url.pathname.startsWith('/storage/v1/')) throw new VideoError('Ungültige Speicheradresse.');
    await this.api.refreshSession(); this.check(ctx);
    const controller = new AbortController();
    const stop = () => controller.abort();
    ctx.signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, options.timeout ?? 120000);
    try {
      const response = await this.fetch(url.href, { ...options, timeout: undefined,
        headers: { ...options.headers, apikey: this.api.key, Authorization: 'Bearer ' + this.api.session.access_token },
        signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
      this.check(ctx);
      if (response.status === 401 && retryAuth) {
        await response.body?.cancel();
        await this.api.refreshSession(true); this.check(ctx);
        return await this.http(target, options, ctx, false);
      }
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new VideoError(response.status === 413 ? 'Das Video ist zu groß. Erlaubt sind bis zu 50 MB.' :
          response.status === 401 ? 'Bitte melde dich erneut an.' :
          detail.message || detail.error || `Speicheranfrage fehlgeschlagen (${response.status}).`, response.status);
      }
      if (options.blobResponse) {
        const blob = await response.blob(); this.check(ctx); return blob;
      }
      await response.body?.cancel(); return response;
    } catch (error) {
      this.check(ctx);
      if (error instanceof VideoError) throw error;
      throw new VideoError('Die Verbindung wurde unterbrochen. Bitte erneut versuchen; ein angefangener Upload kann fortgesetzt werden.');
    } finally { clearTimeout(timer); ctx.signal?.removeEventListener('abort', stop); }
  }
  async upload(pending, file, ctx, { save, progress }) {
    const reserved = await this.rpc('rq_birthday_reserve', {
      p_id: pending.id, p_title: pending.title, p_description: pending.description,
      p_mime: pending.mime, p_bytes: pending.bytes, p_hash: pending.hash,
    }, ctx);
    pending.path = reserved.path; save(pending);
    const state = await this.rpc('rq_birthday_status', { p_id: pending.id }, ctx);
    if (state.deleting) throw new VideoError('Dieser Gruß wird bereits entfernt. Bitte die Entfernung abschließen.');
    if (state.stored) {
      await this.rpc('rq_birthday_finish', { p_id: pending.id }, ctx);
      progress(pending.bytes, pending.bytes); return;
    }
    if (!file) throw new VideoError('Bitte dieselbe Datei noch einmal auswählen. Der bisherige Stand bleibt erhalten.');
    if (videoMime(file) !== pending.mime || file.size !== pending.bytes || await fileHash(file) !== pending.hash) {
      throw new VideoError('Das ist eine andere Datei. Bitte die ursprüngliche Datei auswählen.');
    }
    this.check(ctx);
    let offset = 0;
    if (pending.url) {
      pending.url = this.tusUrl(pending.url);
      try {
        const head = await this.http(pending.url, { method: 'HEAD', timeout: 20000, headers: { 'Tus-Resumable': '1.0.0' } }, ctx);
        offset = this.offset(head, pending.bytes);
        if (Number(head.headers.get('Upload-Length')) !== pending.bytes) throw new VideoError('Die Upload-Länge stimmt nicht mit der Datei überein.');
      } catch (error) {
        if (![404, 410].includes(error.status)) throw error;
        pending.url = null; save(pending);
      }
    }
    if (!pending.url) {
      const metadata = { bucketName: bucket, objectName: pending.path, contentType: pending.mime, cacheControl: '0' };
      const response = await this.http(this.endpoint, { method: 'POST', timeout: 20000,
        headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(pending.bytes), 'x-upsert': 'false',
          'Upload-Metadata': Object.entries(metadata).map(([key, value]) => key + ' ' + b64(value)).join(',') } }, ctx);
      if (response.status !== 201 || !response.headers.get('Location')) throw new VideoError('Der Upload konnte nicht begonnen werden. Bitte den vorhandenen Upload erneut prüfen.');
      pending.url = this.tusUrl(response.headers.get('Location')); save(pending);
    }
    progress(offset, pending.bytes);
    while (offset < pending.bytes) {
      this.check(ctx);
      const end = Math.min(offset + CHUNK, pending.bytes);
      const response = await this.http(pending.url, { method: 'PATCH',
        headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream', 'x-upsert': 'false' },
        body: file.slice(offset, end) }, ctx);
      const next = this.offset(response, pending.bytes);
      if (next !== end) throw new VideoError('Die Upload-Bestätigung ist unklar. Bitte „Upload fortsetzen“ wählen.');
      offset = next; progress(offset, pending.bytes);
    }
    await this.rpc('rq_birthday_finish', { p_id: pending.id }, ctx);
  }
  offset(response, size) {
    const raw = response.headers.get('Upload-Offset');
    const offset = Number(raw);
    if (raw === null || !Number.isSafeInteger(offset) || offset < 0 || offset > size) throw new VideoError('Ungültiger Upload-Fortschritt. Bitte die Übertragung erneut prüfen.');
    return offset;
  }
  async download(item, ctx) {
    const blob = await this.http(`/storage/v1/object/authenticated/${bucket}/${encodedPath(item.path)}`, { method: 'GET', blobResponse: true }, ctx);
    if (blob.size !== Number(item.bytes) || blob.size > MAX_VIDEO_BYTES) throw new VideoError('Die geladene Datei ist unvollständig. Bitte erneut versuchen.');
    return blob;
  }
  async remove(id, ctx) {
    const result = await this.rpc('rq_birthday_remove_start', { p_id: id }, ctx);
    if (!result.gone) {
      await this.http(`/storage/v1/object/${bucket}`, { method: 'DELETE', timeout: 20000,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [result.path] }) }, ctx);
      await this.rpc('rq_birthday_delete', { p_id: id }, ctx);
    }
  }
}
