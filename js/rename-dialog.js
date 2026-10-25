export function requestLectureTitle(currentTitle) {
    const dialog=document.createElement('dialog');dialog.className='print-options rename-dialog';
    const form=document.createElement('form');
    const heading=document.createElement('h2');heading.id='rename-title';heading.textContent='Rename lecture';
    dialog.setAttribute('aria-labelledby',heading.id);
    const label=document.createElement('label');label.textContent='Lecture name';label.htmlFor='rename-lecture-input';
    const input=document.createElement('input');input.id='rename-lecture-input';input.value=currentTitle;input.maxLength=200;input.required=true;
    const status=document.createElement('p');status.setAttribute('role','status');
    const actions=document.createElement('div');actions.className='print-options-actions';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
    const save=document.createElement('button');save.type='submit';save.textContent='Save name';
    actions.append(cancel,save);form.append(heading,label,input,status,actions);dialog.append(form);document.body.append(dialog);
    return new Promise(resolve=>{
        const close=value=>{dialog.close();dialog.remove();resolve(value);};
        cancel.addEventListener('click',()=>close(null));dialog.addEventListener('cancel',e=>{e.preventDefault();close(null);});
        form.addEventListener('submit',e=>{e.preventDefault();if(!input.value.trim()){status.textContent='Enter a lecture name.';input.focus();return;}close(input.value.trim());});
        dialog.showModal();input.focus();input.select();
    });
}
