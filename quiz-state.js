// Sperrt sofort, bevor der erste Netzwerkaufruf beginnt.
// Bei Verbindungsfehlern darf nur dieselbe Antwort erneut übertragen werden.
// Die dauerhafte Einmal-Garantie setzt zusätzlich die Datenbank durch.
export class AnswerSubmission {
  constructor(questionId, send) {
    this.questionId = questionId;
    this.send = send;
    this.selected = null;
    this.busy = false;
    this.result = null;
  }
  async submit(index) {
    if (!Number.isInteger(index) || index < 0 || index > 3) throw new Error('Bitte eine Antwort auswählen.');
    if (this.busy || this.result) return null;
    if (this.selected !== null && this.selected !== index) throw new Error('Deine erste Antwort bleibt verbindlich.');
    this.selected = index;
    this.busy = true;
    try { this.result = await this.send(this.questionId, index); return this.result; }
    finally { this.busy = false; }
  }
}

export function validateQuestion(question, options, correctIndex, explanation = '') {
  const cleaned = options.map(value => value.trim());
  if (question.trim().length < 5 || question.trim().length > 500) throw new Error('Die Frage braucht 5 bis 500 Zeichen.');
  if (cleaned.length !== 4 || cleaned.some(value => !value || value.length > 160)) throw new Error('Bitte vier Antworten mit jeweils höchstens 160 Zeichen eintragen.');
  if (new Set(cleaned.map(value => value.toLowerCase())).size !== 4) throw new Error('Die vier Antworten müssen unterschiedlich sein.');
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) throw new Error('Markiere genau eine richtige Antwort.');
  if (explanation.trim().length > 500) throw new Error('Die Erklärung darf höchstens 500 Zeichen haben.');
  return { p_question: question.trim(), p_options: cleaned, p_correct_index: correctIndex, p_explanation: explanation.trim() };
}
