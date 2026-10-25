import * as store from './store.js';
import {suggestCourseGroups, listCourses, courseRecall} from './courses.js';
import {mountCourseQuestions} from './course-questions.js';
const el = (tag,text,className) => {const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(className)node.className=className; return node;};
function button(text, action) {const b=el('button',text); b.type='button'; b.addEventListener('click',action); return b;}
let cleanup = () => {};
let generation=0;
export async function renderCourses(container) {
    const version=++generation; cleanup(); cleanup=()=>{};
    const lectures=await store.getAllLectures();
    if(version!==generation || !container.isConnected)return;
    const ready=lectures.filter(l=>l.status==='ready');
    container.replaceChildren(el('h2','Your courses'),el('p','Group related lectures, ask across them, and practise saved recall questions.','quiet'));
    const actions=el('div',undefined,'course-actions'), list=el('div'), workspace=el('div');
    workspace.className='course-workspace';
    const status=el('p'); status.setAttribute('role','status');
    const clear=()=>{cleanup();cleanup=()=>{};workspace.replaceChildren();};
    const reportError=error=>{status.textContent=error.message;};
    function edit(course={title:'',lectureIds:[]}) {
        clear();
        const form=el('form'), title=el('input'), label=el('label','Course title'); title.type='text';title.required=true;title.maxLength=160;title.value=course.title;label.append(title);
        form.append(el('h3',course.id?'Edit course':'Review course'),label,el('p','Choose the lectures to include. Suggestions are saved only after your review.','quiet'));
        const fieldset=el('fieldset');fieldset.append(el('legend','Ready lectures'));
        const selections=[];
        for(const lecture of ready) {
            const row=el('label',undefined,'course-choice'), input=el('input');input.type='checkbox';input.checked=course.lectureIds.includes(lecture.id);input.value=lecture.id;
            row.append(input,document.createTextNode(lecture.title));fieldset.append(row);selections.push(input);
        }
        const save=el('button','Save course');save.type='submit';
        form.append(fieldset,save,button('Cancel',clear));
        form.addEventListener('submit',async event=>{
            event.preventDefault();save.disabled=true;status.textContent='';
            try {await store.saveCourse({id:course.id??crypto.randomUUID(),title:title.value,lectureIds:selections.filter(i=>i.checked).map(i=>i.value)});await renderCourses(container);}
            catch(error){reportError(error);save.disabled=false;}
        });workspace.append(form);title.focus();
    }
    function revise(course) {
        clear();const heading=el('h3',`Revise ${course.title}`), filterLabel=el('label',' Show only “Practice again”'), filter=el('input');filter.type='checkbox';filterLabel.prepend(filter);
        const cards=el('div');workspace.append(heading,filterLabel,cards);
        const items=courseRecall(lectures,course.lectureIds);
        function draw(){
            cards.replaceChildren();const shown=items.filter(item=>!filter.checked||item.rating==='practice');
            cards.append(el('p',`${items.filter(i=>i.rating==='got-it').length} of ${items.length} marked “Got it”. Ratings are your self-assessment.`,'quiet'));
            if(!shown.length)cards.append(el('p',filter.checked?'No questions marked “Practice again”.':'No saved recall questions in this course.'));
            for(const item of shown){
                const card=el('section',undefined,'recall-card');card.append(el('p',item.lectureTitle,'eyebrow'),el('h4',item.q));
                const answer=el('p',item.a), ratings=el('div',undefined,'course-actions');answer.hidden=true;ratings.hidden=true;
                const current=el('p',item.rating==='got-it'?'Got it':item.rating==='practice'?'Practice again':'Not rated','quiet');
                for(const [rating,text] of [['got-it','Got it'],['practice','Practice again']])ratings.append(button(text,async()=>{
                    [...ratings.children].forEach(b=>b.disabled=true);
                    try {await store.rateRecall(item.lectureId,item.key,rating);item.rating=rating;const lecture=lectures.find(l=>l.id===item.lectureId);lecture.revisionProgress=(lecture.revisionProgress??[]).filter(p=>p.key!==item.key).concat({key:item.key,rating});draw();}
                    catch(error){reportError(error);[...ratings.children].forEach(b=>b.disabled=false);}
                }));
                const reveal=button('Reveal answer',()=>{answer.hidden=false;ratings.hidden=false;reveal.hidden=true;});card.append(current,reveal,answer,ratings);cards.append(card);
            }
        }filter.addEventListener('change',draw);draw();
    }
    actions.append(button('Create course',()=>edit()));
    if(ready.length>=3)actions.append(button('Suggest course groups',()=>{
        clear();const suggestions=suggestCourseGroups(lectures);
        workspace.append(el('h3','Suggested groups'),el('p','Matched locally using concept, title and summary terms. No AI request. Review every group before saving.','quiet'));
        if(!suggestions.length)workspace.append(el('p','No clear groups found. Create a course manually.'));
        for(const group of suggestions){const row=el('section',undefined,'course-card');row.append(el('h4',group.title),el('p',`${group.lectureIds.length} related lectures`),button('Review group',()=>edit(group)));workspace.append(row);}
    }));
    else actions.append(el('p','Course suggestions unlock after three ready lectures.','quiet'));
    for(const course of listCourses(lectures)) {
        const card=el('section',undefined,'course-card'), links=el('ul'), controls=el('div',undefined,'course-actions');
        for(const id of course.lectureIds){const lecture=lectures.find(l=>l.id===id),li=el('li'),a=el('a',lecture.title);a.href=`index.html?lecture=${encodeURIComponent(id)}`;li.append(a);links.append(li);}
        controls.append(button('Edit course',()=>edit(course)),button('Revise',()=>revise(course)),button('Ask course',()=>{clear();cleanup=mountCourseQuestions(workspace,{lectureIds:course.lectureIds});}),button('Delete course',async()=>{
            if(!confirm(`Delete course “${course.title}”? Its lectures will stay in your Library.`))return;
            try{await store.deleteCourse(course.id);await renderCourses(container);}catch(error){reportError(error);}
        }));card.append(el('h3',course.title),links,controls);list.append(card);
    }
    container.append(actions,list,status,workspace);
}
export function clearCourses(){++generation;cleanup();cleanup=()=>{};}
