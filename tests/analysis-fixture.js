// Deterministic provider fixture shared by local browser integration tests.
export function analysisFixture(payload, notes = 'Study notes') {
    if (payload.stage === 'merge') return {summary: 'Merged study overview'};
    const {source} = payload;
    const quote = source.text.trim().slice(0, 80), evidence = [{sourceId: source.id, quote}];
    return {notes, evidence, topics: ['Topic'], concepts: [{term: 'Topic', definition: 'Fixture concept', evidence}],
        flashcards: [{q: 'Question', a: 'Answer', evidence}], examSignals: [], links: []};
}
