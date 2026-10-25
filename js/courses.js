/** Pure, local course grouping and revision metadata. No provider requests. */
function boundedText(value, max, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`Invalid ${label}.`);
    return value.trim();
}
export function validateCourseMemberships(value = []) {
    if (!Array.isArray(value) || value.length > 100) throw new TypeError('Invalid course memberships.');
    const ids = new Set();
    return value.map(item => {
        const id = boundedText(item?.id, 200, 'course ID');
        if (ids.has(id)) throw new TypeError('Duplicate course ID.'); ids.add(id);
        return {id, title: boundedText(item?.title, 160, 'course title')};
    });
}
export function validateRevisionProgress(value = []) {
    if (!Array.isArray(value) || value.length > 1000) throw new TypeError('Invalid revision progress.');
    const keys = new Set();
    return value.map(item => {
        const key = boundedText(item?.key, 2200, 'recall key');
        if (keys.has(key) || !['got-it', 'practice'].includes(item?.rating)) throw new TypeError('Invalid recall rating.');
        keys.add(key); return {key, rating: item.rating};
    });
}
const stop = new Set('the and for with this that from into about what when where how why lecture lectures introduction overview summary concept concepts topic topics study notes learning learn understand understanding basic basics example examples course part chapter today will have has are was were been being their they them these those then than also can could would should not more some such through using use used each which your our its'.split(' '));
function tokens(text) {return String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(t => t.length > 2 && !stop.has(t) && !/^\d+$/.test(t)) ?? [];}
function terms(lecture) {
    const result = new Map(), analysis = lecture.analysis ?? lecture;
    const add = (text, weight) => {for (const term of new Set(tokens(text))) result.set(term, (result.get(term) ?? 0) + weight);};
    add(lecture.title, 3); add(analysis.summary, 1);
    for (const concept of analysis.concepts ?? []) add(concept.term, 5);
    for (const topic of analysis.topics ?? []) add(topic, 3);
    return result;
}
export function suggestCourseGroups(lectures) {
    const ready = lectures.filter(l => l.status === 'ready');
    if (ready.length < 3) return [];
    const vectors = ready.map(terms);
    function related(a, b) {
        const shared = [...vectors[a].keys()].filter(t => vectors[b].has(t));
        const strong = shared.filter(t => vectors[a].get(t) >= 3 && vectors[b].get(t) >= 3);
        const overlap = shared.reduce((sum,t) => sum + Math.min(vectors[a].get(t),vectors[b].get(t)),0);
        const total = Math.min(...[a,b].map(i => [...vectors[i].values()].reduce((x,y) => x+y,0)));
        return strong.length >= 2 && overlap / total >= 0.35;
    }
    // Complete-link groups prevent a weak bridge joining unrelated subjects.
    const groups = [], assigned = new Set();
    for (let i=0; i<ready.length; i++) {
        if (assigned.has(i)) continue;
        const members = [i];
        for (let j=i+1; j<ready.length; j++) if (!assigned.has(j) && members.every(k => related(k,j))) members.push(j);
        if (members.length < 2) continue;
        members.forEach(i => assigned.add(i));
        const shared = [...vectors[i]].filter(([term]) => members.every(k => vectors[k].has(term))).sort((a,b) => b[1]-a[1]);
        const title = shared.slice(0,3).map(([term]) => term[0].toUpperCase()+term.slice(1)).join(' · ');
        groups.push({title, lectureIds: members.map(k => ready[k].id)});
    }
    return groups;
}
export function listCourses(lectures) {
    const courses = new Map();
    for (const lecture of lectures) for (const member of lecture.courseMemberships ?? []) {
        if (!courses.has(member.id)) courses.set(member.id, {...member, lectureIds: []});
        courses.get(member.id).lectureIds.push(lecture.id);
    }
    return [...courses.values()];
}
// Include both question and answer in a bounded content identity across regeneration.
export function recallKey(card) {
    const text = JSON.stringify([card.q,card.a]);
    const hashes = [2166136261, 3335557771, 1234567891, 294967291];
    for (let i=0; i<text.length; i++) for (let j=0; j<hashes.length; j++) hashes[j] = Math.imul(hashes[j] ^ text.charCodeAt(i), 16777619 + j*2) >>> 0;
    return `recall:${text.length}:${hashes.map(n => n.toString(16).padStart(8,'0')).join('')}`;
}
export function courseRecall(lectures, lectureIds) {
    const ids = new Set(lectureIds);
    return lectures.filter(l => ids.has(l.id) && l.status === 'ready').flatMap(l => (l.analysis?.flashcards ?? l.flashcards ?? []).map(card => {
        const key = recallKey(card);
        return {...card, key, lectureId:l.id, lectureTitle:l.title, rating:l.revisionProgress?.find(p => p.key === key)?.rating};
    }));
}
