// Read-only preview content. Never saved to the user's Library or sent to a provider.
export function folioSample() {
    const quote='A set of vectors is linearly independent if no vector in the set can be written as a combination of the others.';
    const evidence=[{sourceId:'sample-2',quote}];
    const concepts=[
        {term:'Vector',definition:'A vector can describe a direction and an amount. In two dimensions, its components tell us how far to move along each axis.'},
        {term:'Vector space',definition:'A collection of vectors that stays within the collection when we add vectors or multiply them by scalars.'},
        {term:'Linear independence',definition:'Each independent vector adds a direction that the others cannot reproduce.'},
        {term:'Basis',definition:'An independent set of vectors that spans a vector space.'}
    ];
    const packet=(id,topic,notes)=>({id,topics:[topic],notes,evidence,concepts:[],flashcards:[],examSignals:[],links:[]});
    return {
        id:'read-only-folio-sample',title:'Linear Algebra',createdAt:'2026-10-12T09:00:00.000Z',durationMs:2880000,
        language:'en',analysisStatus:'ready',captureGaps:[],
        transcript:'In two dimensions, a vector can describe how far to move sideways and upwards. We can add vectors and multiply them by numbers. '+quote+' An independent set that spans the space is called a basis. For example, (1, 0) and (0, 1) span the two-dimensional plane.',
        analysis:{
            summary:'Today’s lecture introduced the geometric view of vectors, vector spaces and linear independence. We saw how combinations of vectors describe a space, and why independence matters when choosing a basis.',
            sections:[
                packet('sample-1','Vectors & spaces','Think of a vector as a way to describe several quantities together. In two dimensions, those quantities might tell you how far to move sideways and upwards. The same idea extends to a list of features in a machine-learning model: each number describes one aspect of the input.\n\n**Key idea:** Vectors help us represent several quantities as one object.\n\n**Margin note:** A direction, plus an amount.'),
                packet('sample-2','Linear independence','Each independent vector adds a direction that the others cannot reproduce. If one vector can be built by combining the others, it adds no new direction.\n\nFor example, (2, 0) is twice (1, 0). Keeping both does not let us reach any extra part of the plane.\n\n**Key idea:** Independence tells us which directions contribute something new.'),
                packet('sample-3','Worked example','Take the vectors (1, 0) and (0, 1). Moving three times along the first and twice along the second gives (3, 2).\n\nThe two starting vectors are independent, and combinations of them reach every point in the plane. Together, they form a basis for this two-dimensional space.')
            ],
            topics:['Vectors','Vector spaces','Linear independence','Basis'],concepts,
            flashcards:[{q:'What does linear independence tell us?',a:concepts[2].definition},{q:'What makes an independent set a basis?',a:'It must also span the whole vector space.'}],
            conceptGraph:{nodes:concepts.map((c,i)=>({id:'sample-c'+i,label:c.term})),edges:[
                {from:'sample-c0',to:'sample-c1',relation:'belongs to',evidence},
                {from:'sample-c3',to:'sample-c1',relation:'spans',evidence},
                {from:'sample-c3',to:'sample-c2',relation:'requires',evidence}
            ]},
            timestamps:[{sourceId:'sample-1',start:3,end:504,quote:'In two dimensions, a vector can describe how far to move sideways and upwards.'},{sourceId:'sample-2',start:625,end:1090,quote}],
            warnings:['Illustrative sample notes and timings. This preview is not an actual recording.'],examSignals:[]
        }
    };
}
