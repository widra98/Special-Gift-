import { config } from './config.js';
import { QuizApi } from './api.js';
import { AnswerSubmission, validateQuestion } from './quiz-state.js';
import { NotesPanel } from './notes.js';

const api = new QuizApi(config);
const notes = new NotesPanel(api, config.supabaseUrl);
const $ = id => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const views = ['menu', 'quiz', 'create', 'notes', 'wishes', 'mystery', 'gallery', 'rewards'];
const rewards = [
  { code: 'essen', title: 'Lieblingsessen kochen 🍝', cost: 50 },
  { code: 'kino', title: 'Kino- & Popcornabend 🍿', cost: 100 },
  { code: 'joker', title: 'Wunsch-Joker 🌟', cost: 200 },
];
let state = null;
let answer = null;
let shownQuestion = null;
let epoch = 0;
let refreshing = null;
let draft = null;
let creating = false;
let redeeming = false;
let pendingReward = null;
let restoredFor = null;

function status(id, text = '', kind = '') {
  const node = $(id);
  node.textContent = text;
  node.className = `status ${kind}`;
  node.hidden = !text;
}
function storageGet(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } }
function storageSet(key, value) { try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* Wiederholung im aktuellen Tab bleibt möglich. */ } }
function outboxKey(type) { return `rq-outbox:${config.supabaseUrl}:${state.me.id}:${type}`; }
function dateLabel(value) { return new Date(value).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }); }
function currentView() { const name = location.hash.slice(1); return views.includes(name) ? name : 'menu'; }
function showRoute(scroll = false) {
  for (const name of views) $(`view-${name}`).hidden = name !== currentView();
  if (scroll) window.scrollTo(0, 0);
}
function showLogin() {
  notes.reset();
  state = null; answer = null; shownQuestion = null; draft = null; pendingReward = null; restoredFor = null;
  creating = false; redeeming = false;
  $('authenticated').hidden = true;
  $('pointsBadge').hidden = true;
  $('logout').hidden = true;
  $('loginView').hidden = false;
  $('questionForm').reset();
  $('questionFields').disabled = false;
  $('sendQuestion').disabled = false;
  $('sendQuestion').textContent = 'Frage senden';
  status('composeStatus');
  for (const id of ['quizBox', 'history', 'createdQuestions', 'coupons', 'shop']) $(id).replaceChildren();
}
function displayError(error) {
  if (!api.session) { showLogin(); status('loginStatus', 'Bitte melde dich erneut an.', 'error'); }
  else status('globalStatus', error.message, 'error');
}
function restoreOutbox() {
  if (restoredFor === state.me.id) return;
  restoredFor = state.me.id;
  const saved = storageGet(outboxKey('question'));
  if (saved?.p_id && Array.isArray(saved.p_options) && saved.p_options.length === 4) {
    draft = saved;
    $('questionText').value = saved.p_question;
    saved.p_options.forEach((text, i) => { $(`option${i}`).value = text; });
    const radio = document.querySelector(`input[name="correct"][value="${Number(saved.p_correct_index)}"]`);
    if (radio) radio.checked = true;
    $('explanation').value = saved.p_explanation;
    $('questionFields').disabled = true;
    $('sendQuestion').textContent = 'Übertragung erneut prüfen';
    status('composeStatus', 'Bei dieser Frage fehlt noch die Bestätigung. Erneutes Senden erzeugt keine zweite Kopie.');
  }
  const reward = storageGet(outboxKey('reward'));
  if (reward?.id && rewards.some(r => r.code === reward.code)) pendingReward = reward;
}
async function refresh({ resetQuiz = false } = {}) {
  if (refreshing) { await refreshing; if (resetQuiz && state) renderQuiz(true); return; }
  const ticket = epoch;
  refreshing = (async () => {
    const nextState = await api.snapshot();
    if (ticket !== epoch) return;
    state = nextState;
    notes.attach(state.me);
    $('loginView').hidden = true;
    $('authenticated').hidden = false;
    $('pointsBadge').hidden = false;
    $('logout').hidden = false;
    $('userPoints').textContent = state.points;
    $('greeting').textContent = `Hallo, ${state.me.name}.`;
    $('quizSummary').textContent = state.pending ? `${state.pending} neue ${state.pending === 1 ? 'Frage wartet' : 'Fragen warten'} auf dich.` : 'Du bist auf dem neuesten Stand.';
    $('createTitle').textContent = `Fragen für ${state.partner?.name ?? 'dein Gegenüber'}`;
    $('composeHeading').textContent = `Eine Frage für ${state.partner?.name ?? 'dein Gegenüber'}`;
    restoreOutbox();
    renderQuiz(resetQuiz);
    renderLists();
    renderShop();
    showRoute();
    if (currentView() === 'notes') void notes.load();
  })();
  try { await refreshing; } finally { refreshing = null; }
}
function renderQuiz(reset = false) {
  // Ein offenes Ergebnis oder eine ungeklärte Übertragung nicht durch Hintergrund-Updates entfernen.
  if (!reset && answer && (answer.busy || answer.result || answer.selected !== null)) return;
  const box = $('quizBox');
  box.replaceChildren();
  shownQuestion = state.next;
  answer = null;
  if (!shownQuestion) {
    box.classList.add('empty');
    box.append(el('span', 'big-icon', '✨'), el('h2', '', 'Alle aktuellen Fragen sind erledigt.'),
      el('p', '', 'Sobald neue Fragen für dich da sind, geht es hier weiter.'));
    const check = el('button', 'secondary', 'Nach neuen Fragen schauen');
    check.onclick = () => refresh({ resetQuiz: true }).catch(displayError);
    box.append(check);
    return;
  }
  box.classList.remove('empty');
  answer = new AnswerSubmission(shownQuestion.id, (id, index) => api.answerQuestion(id, index));
  const question = shownQuestion;
  const submission = answer;
  box.append(el('p', 'counter', `${state.pending} offene ${state.pending === 1 ? 'Frage' : 'Fragen'} · ${state.answered} erledigt`));
  const form = el('form');
  const fields = el('fieldset');
  fields.append(el('legend', '', question.question));
  const labels = [];
  question.options.forEach((text, index) => {
    const label = el('label', 'answer-option');
    const radio = el('input');
    radio.type = 'radio'; radio.name = 'quizAnswer'; radio.value = String(index); radio.required = true;
    label.append(radio, el('span', '', text)); fields.append(label); labels.push(label);
  });
  const send = el('button', 'primary', 'Antwort verbindlich abgeben'); send.type = 'submit';
  const feedback = el('p', 'status'); feedback.setAttribute('role', 'status');
  form.append(fields, send, feedback); box.append(form);
  form.onsubmit = async event => {
    event.preventDefault();
    if (submission.busy || submission.result) return;
    const selected = form.querySelector('input:checked');
    if (!selected) return;
    const ticket = epoch;
    fields.disabled = true; send.disabled = true; feedback.textContent = 'Deine Antwort wird gespeichert …';
    try {
      const result = await submission.submit(Number(selected.value));
      if (!result || ticket !== epoch) return;
      send.hidden = true;
      feedback.textContent = result.already_answered ? 'Diese Frage war bereits erledigt. Es zählt dein erster Versuch.' : 'Dein Versuch ist gespeichert.';
      labels.forEach((label, index) => { label.querySelector('input').checked = index === result.selected_index; });
      labels[result.correct_index].classList.add('correct');
      if (!result.is_correct) labels[result.selected_index].classList.add('wrong');
      const resultBox = el('div', 'result');
      resultBox.append(el('strong', '', result.is_correct ? 'Richtig! 50 Punkte.' : 'Leider falsch. Die Frage ist erledigt.'),
        el('p', '', `Richtige Antwort: ${question.options[result.correct_index]}`));
      if (result.explanation) resultBox.append(el('p', '', result.explanation));
      const next = el('button', 'secondary', 'Weiter');
      next.onclick = async () => {
        next.disabled = true;
        try { await refresh({ resetQuiz: true }); status('globalStatus'); }
        catch (error) { next.disabled = false; displayError(error); }
      };
      resultBox.append(next); box.append(resultBox);
      await refresh().catch(displayError);
    } catch (error) {
      if (ticket !== epoch) return;
      send.disabled = false; send.textContent = 'Dieselbe Antwort erneut senden';
      feedback.classList.add('error'); feedback.textContent = error.message;
      if (!api.session) displayError(error);
    }
  };
}
function renderLists() {
  const history = $('history'); history.replaceChildren();
  if (!state.history.length) history.append(el('p', '', 'Du hast noch keine Frage beantwortet.'));
  for (const item of state.history) {
    const card = el('article', 'list-item');
    card.append(el('span', 'tag', `${item.is_correct ? 'Richtig · +50 Punkte' : 'Falsch · 0 Punkte'} · ${dateLabel(item.answered_at)}`),
      el('strong', '', item.question), el('p', '', `Deine Antwort: ${item.selected}`), el('p', '', `Lösung: ${item.correct}`));
    if (item.explanation) card.append(el('p', '', item.explanation)); history.append(card);
  }
  const created = $('createdQuestions'); created.replaceChildren();
  if (!state.created.length) created.append(el('p', '', 'Du hast noch keine Frage gesendet.'));
  for (const item of state.created) {
    const card = el('article', 'list-item');
    card.append(el('span', 'tag', item.answered ? 'Bereits beantwortet' : 'Wartet auf eine Antwort'), el('strong', '', item.question)); created.append(card);
  }
  const coupons = $('coupons'); coupons.replaceChildren();
  if (!state.coupons.length) coupons.append(el('p', '', 'Noch keine Gutscheine eingelöst.'));
  for (const item of state.coupons) {
    const card = el('article', 'list-item');
    card.append(el('strong', '', item.title), el('p', '', `${item.cost} Punkte · ${dateLabel(item.created_at)}`)); coupons.append(card);
  }
}
function renderShop() {
  const shop = $('shop'); shop.replaceChildren();
  const richard = state.me.person === 'richard';
  $('shopIntro').textContent = richard ? 'Löse deine Punkte ein. Deine Gutscheine werden hier für euch beide gespeichert.' : 'Hier siehst du Richards eingelöste Gutscheine. Deine eigenen Quizpunkte zählen separat.';
  if (!richard) return;
  for (const reward of rewards) {
    const row = el('article', 'shop-item'); const info = el('div');
    info.append(el('strong', '', reward.title), el('p', '', `${reward.cost} Punkte`));
    const retry = pendingReward?.code === reward.code;
    const button = el('button', 'primary', retry ? 'Einlösung prüfen' : 'Einlösen');
    button.disabled = redeeming || (pendingReward && !retry) || (!retry && state.points < reward.cost);
    button.onclick = async () => {
      if (redeeming) return;
      if (!pendingReward && !confirm(`„${reward.title}“ für ${reward.cost} Punkte einlösen?`)) return;
      pendingReward ??= { id: crypto.randomUUID(), code: reward.code };
      storageSet(outboxKey('reward'), pendingReward);
      const ticket = epoch; redeeming = true; renderShop();
      try {
        const result = await api.redeem(pendingReward.id, pendingReward.code);
        if (ticket !== epoch) return;
        storageSet(outboxKey('reward'), null); pendingReward = null;
        status('globalStatus', `Dein Gutschein „${result.title}“ ist gespeichert.`, 'success');
        await refresh().catch(displayError);
      } catch (error) {
        if (ticket !== epoch) return;
        // Ein bestätigter Validierungsfehler hat nichts eingelöst. Netzwerkfehler bleiben erneut prüfbar.
        if (error.status === 400) { storageSet(outboxKey('reward'), null); pendingReward = null; }
        displayError(error);
      } finally { if (ticket === epoch) { redeeming = false; if (state) renderShop(); } }
    };
    row.append(info, button); shop.append(row);
  }
}

$('questionForm').onsubmit = async event => {
  event.preventDefault();
  if (creating || !state) return;
  const ticket = epoch;
  try {
    if (!draft) {
      const selected = document.querySelector('input[name="correct"]:checked');
      const payload = validateQuestion($('questionText').value, [0, 1, 2, 3].map(i => $(`option${i}`).value), selected ? Number(selected.value) : null, $('explanation').value);
      draft = { p_id: crypto.randomUUID(), ...payload };
      storageSet(outboxKey('question'), draft);
    }
    creating = true; $('sendQuestion').disabled = true; $('questionFields').disabled = true;
    status('composeStatus', 'Deine Frage wird gesendet …');
    await api.createQuestion(draft);
    if (ticket !== epoch) return;
    storageSet(outboxKey('question'), null); draft = null;
    $('questionForm').reset(); $('questionFields').disabled = false; $('sendQuestion').textContent = 'Frage senden';
    status('composeStatus', `Gesendet! Die Frage wartet jetzt auf ${state.partner.name}.`, 'success');
    await refresh().catch(displayError);
  } catch (error) {
    if (ticket !== epoch) return;
    if (error.status === 400 || !draft) {
      if (state) storageSet(outboxKey('question'), null);
      draft = null; $('questionFields').disabled = false;
    }
    status('composeStatus', error.message, 'error');
    $('sendQuestion').textContent = draft ? 'Übertragung erneut prüfen' : 'Frage senden';
    if (!api.session) displayError(error);
  } finally { if (ticket === epoch) { creating = false; $('sendQuestion').disabled = false; } }
};
$('loginForm').onsubmit = async event => {
  event.preventDefault();
  if ($('loginButton').disabled) return;
  $('loginButton').disabled = true; status('loginStatus', 'Anmeldung läuft …');
  try {
    await api.login($('email').value.trim(), $('password').value);
    $('password').value = '';
    await refresh({ resetQuiz: true });
    status('loginStatus'); status('globalStatus');
  } catch (error) {
    // Ein Konto ohne App-Mitgliedschaft bekommt keinen Zugriff.
    if (error.status === 403) await api.logout();
    status('loginStatus', error.status === 400 ? 'E-Mail-Adresse oder Passwort stimmen nicht.' : error.message, 'error');
  } finally { $('loginButton').disabled = false; }
};
$('logout').onclick = () => {
  epoch++; void api.logout(); showLogin(); status('globalStatus');
};
window.addEventListener('hashchange', () => { showRoute(true); if (state) refresh().catch(displayError); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state) refresh().catch(displayError); });
window.addEventListener('online', () => { if (state) refresh().catch(displayError); });

if (!api.configured) $('setup').hidden = false;
else if (api.session) refresh({ resetQuiz: true }).catch(error => { showLogin(); status('loginStatus', error.message, 'error'); });
else showLogin();
