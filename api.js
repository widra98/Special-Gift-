export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

// Anmeldung wird nur für diesen Tab gespeichert. Der Quizfortschritt liegt online.
export class QuizApi {
  constructor(config, { fetchImpl = globalThis.fetch, storage } = {}) {
    this.url = config.supabaseUrl.replace(/\/$/, '');
    this.key = config.publishableKey;
    this.fetch = fetchImpl === globalThis.fetch ? fetchImpl.bind(globalThis) : fetchImpl;
    try { this.storage = storage ?? globalThis.sessionStorage; } catch { this.storage = null; }
    this.storageKey = `rq-session:${this.url}`;
    this.session = null;
    this.refreshing = null;
    this.generation = 0;
    try {
      const saved = JSON.parse(this.storage.getItem(this.storageKey));
      if (saved?.access_token && saved?.refresh_token && Number.isFinite(saved.expires_at)) this.session = saved;
    } catch { /* Anmeldung im Arbeitsspeicher funktioniert auch ohne Browser-Speicher. */ }
  }
  get configured() {
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(this.url)
      && /^sb_publishable_[A-Za-z0-9_-]+$/.test(this.key);
  }
  save(session) {
    this.session = session ? {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
    } : null;
    try {
      if (this.session) this.storage.setItem(this.storageKey, JSON.stringify(this.session));
      else this.storage.removeItem(this.storageKey);
    } catch { /* Kein Verlust des serverseitigen Spielstands. */ }
  }
  async request(path, body, token = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetch(this.url + path, {
        method: 'POST', signal: controller.signal, credentials: 'omit',
        headers: { 'Content-Type': 'application/json', apikey: this.key,
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : null; }
      catch { throw new ApiError('Der Dienst hat keine gültige Antwort geliefert.', response.status); }
      if (!response.ok) {
        const msg = data?.message || data?.msg || data?.error_description || 'Die Anfrage konnte nicht abgeschlossen werden.';
        throw new ApiError(msg, response.status);
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('Die Verbindung ist unterbrochen. Ob gespeichert wurde, prüfen wir beim erneuten Senden.');
    } finally { clearTimeout(timer); }
  }
  async login(email, password) {
    this.generation++;
    const result = await this.request('/auth/v1/token?grant_type=password', { email, password });
    this.save(result);
  }
  async refreshSession(force = false) {
    if (!this.session) throw new ApiError('Bitte melde dich an.', 401);
    if (!force && this.session.expires_at > Date.now() / 1000 + 30) return;
    if (!this.refreshing) {
      const generation = this.generation;
      const refreshToken = this.session.refresh_token;
      this.refreshing = this.request('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken })
        .then(data => { if (generation === this.generation) this.save(data); })
        .catch(error => {
          if (generation === this.generation && [400, 401, 403].includes(error.status)) this.save(null);
          throw error;
        }).finally(() => { this.refreshing = null; });
    }
    await this.refreshing;
    if (!this.session) throw new ApiError('Bitte melde dich erneut an.', 401);
  }
  async rpc(name, body = {}) {
    await this.refreshSession();
    try { return await this.request(`/rest/v1/rpc/${name}`, body, this.session.access_token); }
    catch (error) {
      if (error.status !== 401) throw error;
      await this.refreshSession(true);
      return this.request(`/rest/v1/rpc/${name}`, body, this.session.access_token);
    }
  }
  async logout() {
    const token = this.session?.access_token;
    this.generation++;
    this.save(null);
    if (token) {
      try { await this.request('/auth/v1/logout?scope=local', {}, token); }
      catch { /* Lokal bereits abgemeldet; erneutes Anmelden erfordert das Passwort. */ }
    }
  }
  snapshot() { return this.rpc('rq_snapshot'); }
  createQuestion(payload) { return this.rpc('rq_create_question', payload); }
  answerQuestion(id, index) { return this.rpc('rq_answer_question', { p_question_id: id, p_selected_index: index }); }
  redeem(id, code) { return this.rpc('rq_redeem', { p_id: id, p_reward_code: code }); }
  createNote(payload) { return this.rpc('rq_create_note', payload); }
  listNotes(before = null) { return this.rpc('rq_list_notes', { p_before_time: before?.created_at ?? null, p_before_id: before?.id ?? null }); }
  async imageRequest(path, { blob, retry = true } = {}) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/.test(path)) throw new ApiError('Ungültiger Bildpfad.');
    await this.refreshSession();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const endpoint = blob ? '/storage/v1/object/rq-notes/' : '/storage/v1/object/authenticated/rq-notes/';
      const response = await this.fetch(this.url + endpoint + path, {
        method: blob ? 'POST' : 'GET', signal: controller.signal, credentials: 'omit',
        headers: { apikey: this.key, Authorization: `Bearer ${this.session.access_token}`,
          ...(blob ? { 'Content-Type': 'image/jpeg', 'x-upsert': 'false', 'Cache-Control': 'private, max-age=0' } : {}) },
        ...(blob ? { body: blob } : {}),
      });
      if (response.status === 401 && retry) { await this.refreshSession(true); return this.imageRequest(path, { blob, retry: false }); }
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (blob && (response.status === 409 || error.error === 'Duplicate' || String(error.statusCode) === '409')) {
          // Eine verlorene Upload-Bestätigung darf dieselbe Datei nicht doppelt anlegen.
          const existing = await this.downloadImage(path);
          const [left, right] = await Promise.all([blob.arrayBuffer(), existing.arrayBuffer()]);
          const a = new Uint8Array(left), b = new Uint8Array(right);
          if (a.length === b.length && a.every((value, index) => value === b[index])) return;
          throw new ApiError('Unter dieser Übertragungs-ID liegt bereits ein anderes Bild.', 409);
        }
        throw new ApiError(error.message || 'Das Bild konnte nicht übertragen werden.', response.status);
      }
      return blob ? undefined : response.blob();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('Die Bildübertragung wurde unterbrochen. Bitte versuche es erneut.');
    } finally { clearTimeout(timer); }
  }
  uploadImage(path, blob) { return this.imageRequest(path, { blob }); }
  downloadImage(path) { return this.imageRequest(path); }
}
