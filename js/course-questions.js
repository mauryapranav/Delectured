import {askLectures} from './chat.js';
import {openLecture} from './lectures.js';
import {processingIssue, describeIssue} from './processing-flow.js';

const localErrors = new Set([
    'Select between 1 and 20 distinct saved lectures.', 'Enter a question of at most 1,000 UTF-8 bytes.',
    'A selected lecture has no usable transcript.', 'Lecture not found in this browser.',
    'Question context exceeds the request limit.', 'Invalid answer response.',
    'The provider returned invalid answer JSON. Try the question again.',
    'Answer lacks supporting evidence.', 'Answer contains an invalid reference.',
    'Another question is being answered. Wait for it to finish before asking again.',
    'Another tab is answering a question. Wait for it to finish before asking again.'
]);
export function describeQuestionError(error) {
    if (error?.name === 'AbortError') return 'Question cancelled.';
    if (localErrors.has(error?.message)) return error.message;
    const issue = processingIssue(error ?? {}, 'notes');
    if (!['auth', 'quota', 'rate_limit', 'network', 'unsupported', 'response'].includes(issue.kind))
        return 'The question could not finish. Try again; if it repeats, reload the saved lectures. No automatic retry was made.';
    const {detail} = describeIssue(issue);
    const next = {
        auth: 'Check the provider key and model access in Settings.',
        quota: 'Check your provider account or select another configured provider in Settings.',
        rate_limit: issue.retryAt ? `Wait at least ${Math.ceil(Math.max(0, issue.retryAt - Date.now()) / 1000)} seconds before asking again.` : 'Check your provider limits before asking again.',
        network: 'Check your connection. If it works, wait briefly before asking again.',
        unsupported: 'Check the selected provider and model in Settings.',
        response: 'Check the selected model and supported settings before asking again.'
    }[issue.kind];
    return `${detail} ${next} No automatic retry was made.`;
}

const mountedCancels = new Set();
export function cancelCourseQuestions() {
    for (const cancel of mountedCancels) cancel();
}

/** Mount a local source picker. Only a deliberate form submission uses a provider. */
export function mountCourseQuestions(container, {lectureIds = []} = {}) {
    let disposed = false, pending = null, revision = 0;
    const root = document.createElement('section');
    root.className = 'course-questions';
    const make = (tag, text) => {const node = document.createElement(tag); if (text) node.textContent = text; return node;};
    root.append(make('h3', 'Ask your lectures'));
    root.append(make('p', 'Select up to 20 saved lectures. Only matching passages from these sources are sent when you ask a question.'));
    const form = make('form');
    const sources = make('fieldset');
    sources.disabled = true;
    sources.append(make('legend', 'Sources'));
    const choices = [];
    const questionLabel = make('label', 'Question ');
    const question = make('textarea');
    question.rows = 3;
    question.required = true;
    question.maxLength = 1000;
    questionLabel.append(question);
    const submit = make('button', 'Ask selected lectures');
    submit.type = 'submit';
    const cancel = make('button', 'Cancel');
    cancel.type = 'button';
    cancel.hidden = true;
    const status = make('p', 'Loading saved sources…');
    status.setAttribute('role', 'status');
    const results = make('div');
    results.setAttribute('aria-live', 'polite');
    form.append(sources, questionLabel, submit, cancel);
    root.append(form, status, results);
    container.replaceChildren(root);
    submit.disabled = true;
    const selected = () => choices.filter(item => item.input.checked).map(item => item.id);
    const refresh = () => {
        const count = selected().length;
        submit.disabled = !!pending || count === 0 || count > 20;
        status.textContent = `${count} sources selected (maximum 20).`;
    };
    const abort = () => {
        revision++;
        pending?.abort();
        pending = null;
        cancel.hidden = true;
    };
    const onChange = () => {abort(); results.replaceChildren(); refresh();};
    sources.addEventListener('change', onChange);
    const onCancel = () => {abort(); refresh(); status.textContent = 'Question cancelled.';};
    mountedCancels.add(onCancel);
    cancel.addEventListener('click', onCancel);
    const onSubmit = async event => {
        event.preventDefault();
        if (pending || disposed) return;
        const ids = selected();
        if (!ids.length || ids.length > 20) {refresh(); return;}
        if (!question.value.trim() || new TextEncoder().encode(question.value).length > 1000) {
            status.textContent = 'Enter a question of at most 1,000 UTF-8 bytes.'; return;
        }
        const current = ++revision;
        const controller = new AbortController();
        pending = controller;
        submit.disabled = true;
        cancel.hidden = false;
        results.replaceChildren();
        status.textContent = 'Finding supporting passages and answering…';
        try {
            const result = await askLectures({lectureIds: ids, question: question.value, signal: controller.signal});
            if (disposed || current !== revision) return;
            results.append(make('p', result.answer));
            for (const ref of result.references) {
                const citation = make('figure');
                const caption = make('figcaption');
                const link = make('a', ref.title);
                link.href = `index.html?lecture=${encodeURIComponent(ref.lectureId)}`;
                caption.append(link);
                citation.append(caption, make('blockquote', ref.quote));
                results.append(citation);
            }
            if (result.references.length) results.append(make('p', 'Quotes were checked against the selected sources. Check that they support the answer; matching quotes do not prove every claim.'));
            status.textContent = result.references.length ? 'Answer ready.' : 'No supported answer found in the retrieved passages.';
        } catch (error) {
            if (disposed || current !== revision) return;
            status.textContent = describeQuestionError(error);
        } finally {
            if (!disposed && current === revision) {
                pending = null;
                cancel.hidden = true;
                submit.disabled = selected().length === 0 || selected().length > 20;
            }
        }
    };
    form.addEventListener('submit', onSubmit);
    void (async () => {
        let unavailable = 0;
        for (const id of [...new Set(lectureIds)]) {
            if (disposed) return;
            try {
                const lecture = await openLecture(id);
                if (disposed) return;
                const label = make('label');
                const input = make('input');
                input.type = 'checkbox';
                input.checked = choices.length < 20;
                label.append(input, document.createTextNode(` ${lecture.title || 'Untitled lecture'}`));
                const row = make('div'); row.append(label); sources.append(row);
                choices.push({id, input});
            } catch {unavailable++;}
        }
        if (disposed) return;
        sources.disabled = false;
        refresh();
        if (unavailable) status.textContent += ` ${unavailable} unavailable sources omitted.`;
    })();
    return () => {
        disposed = true;
        abort();
        mountedCancels.delete(onCancel);
        sources.removeEventListener('change', onChange);
        cancel.removeEventListener('click', onCancel);
        form.removeEventListener('submit', onSubmit);
        root.remove();
    };
}
