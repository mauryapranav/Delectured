// Isolated synthetic library; all model responses are mocked.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.argv[2]));
const root=resolve('dist');
const server=createServer(async(req,res)=>{
    try {const file=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+sep))throw Error();
        res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css'})[extname(file)]||'text/html');res.end(await readFile(file));
    }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const requests=[];
    await context.route('**/*',async route=>{
        if(route.request().url().startsWith(base))return route.continue();
        if(route.request().url().endsWith('/chat/completions')){
            const request=route.request().postDataJSON(), payload=JSON.parse(request.messages[1].content);requests.push(payload);
            const source=payload.passages[0];
            return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answerable:true,answer:'Database indexes speed up lookups.',references:[{id:source.id,lectureId:source.lectureId,quote:source.text}]})}}]})});
        }
        return route.abort();
    });
    const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
    const ready=()=>page.waitForSelector('html[data-router-ready="true"]');
    await page.goto(base+'/index.html');await ready();
    assert.match(await page.locator('#welcome-title').innerText(),/Every lecture,\nevery word,\nstructured\./);
    await page.evaluate(async()=>{
        const store=await import('./js/store.js'),{saveConfig}=await import('./js/config.js');
        saveConfig({notesProvider:'groq',keys:{groq:'synthetic-fixture'},models:{groq:{completion:'llama-3.3-70b-versatile'}}});
        for(const [id,title,text,terms] of [
            ['db1','Database indexes','Database indexes speed up lookups.',['Database indexes','Query planning']],
            ['db2','Database query planning','Database query planning chooses efficient indexes.',['Database indexes','Query planning']],
            ['chem','Organic chemistry','Carbon forms covalent bonds.',['Carbon bonds','Organic chemistry']]]) {
            await store.saveLecture({id,title,status:'ready',analysisStatus:'ready',transcript:text,analysis:{summary:text,topics:terms,concepts:terms.map(term=>({term,definition:text})),flashcards:[{q:`What is taught in ${title}?`,a:text}]}});
        }
    });
    await page.goto(base+'/library.html');await ready();
    await page.getByRole('button',{name:'Suggest course groups',exact:true}).click();
    await page.getByRole('button',{name:'Review group',exact:true}).first().click();
    const choices=page.getByRole('group',{name:'Ready lectures'});
    assert(await choices.getByLabel('Database indexes',{exact:true}).isChecked());
    assert(await choices.getByLabel('Database query planning',{exact:true}).isChecked());
    assert(!await choices.getByLabel('Organic chemistry',{exact:true}).isChecked());
    await choices.getByLabel('Database query planning',{exact:true}).uncheck();
    await page.getByLabel('Course title',{exact:true}).fill('Database course');
    await page.getByRole('button',{name:'Save course',exact:true}).click();
    await page.getByRole('heading',{name:'Database course',exact:true}).waitFor();
    let membership=await page.evaluate(async()=>{const s=await import('./js/store.js');return (await s.getAllLectures()).filter(l=>l.courseMemberships?.length).map(l=>l.id);});
    assert.deepEqual(membership,['db1']);assert.equal(requests.length,0);
    await page.getByRole('button',{name:'Edit course',exact:true}).click();
    await page.getByRole('group',{name:'Ready lectures'}).getByLabel('Database query planning',{exact:true}).check();
    await page.getByRole('button',{name:'Save course',exact:true}).click();
    await page.getByRole('button',{name:'Revise',exact:true}).click();
    await page.getByRole('button',{name:'Reveal answer',exact:true}).first().click();
    await page.getByRole('button',{name:'Practice again',exact:true}).first().click();
    await page.waitForFunction(async()=>((await (await import('./js/store.js')).getLecture('db1')).revisionProgress??[]).length===1);
    await page.reload();await ready();
    await page.getByRole('button',{name:'Revise',exact:true}).click();
    await page.getByLabel('Show only “Practice again”').check();
    assert.equal(await page.locator('.course-workspace .recall-card').count(),1);
    await page.getByRole('button',{name:'Ask course',exact:true}).click();
    await page.locator('.course-questions').getByLabel('Database query planning',{exact:true}).uncheck();
    await page.locator('.course-questions').getByLabel('Question',{exact:true}).fill('How do database indexes help?');
    await page.getByRole('button',{name:'Ask selected lectures',exact:true}).click();
    await page.locator('.course-questions').getByText('Answer ready.',{exact:true}).waitFor();
    assert.equal(requests.length,1);assert(requests[0].passages.every(p=>p.lectureId==='db1'));
    await page.getByRole('button',{name:'Ask selected lectures',exact:true}).click();
    await page.locator('.course-questions').getByText('Answer ready.',{exact:true}).waitFor();assert.equal(requests.length,1);
    await page.screenshot({path:join(tmpdir(),'delectured-courses.png')});
    await page.locator('.course-questions figure a').click();
    await page.locator('#lecture-heading').filter({hasText:'Database indexes'}).waitFor();
    await page.locator('#rename-lecture-visible').click();
    await page.getByLabel('Lecture name',{exact:true}).fill('Indexes explained');
    await page.getByRole('button',{name:'Save name',exact:true}).click();
    await page.locator('#lecture-heading').filter({hasText:'Indexes explained'}).waitFor();
    await page.getByRole('button',{name:'Edit section text',exact:true}).first().click();
    await page.getByLabel('Your version (Markdown supported)',{exact:true}).fill('My corrected explanation of database indexes.\n\nA second paragraph to annotate.');
    await page.locator('.back-library').click();
    await page.locator('#app-notice').filter({hasText:'Save or cancel your personal note draft'}).waitFor();
    assert.match(await page.getByLabel('Your version (Markdown supported)',{exact:true}).inputValue(),/My corrected explanation/);
    await page.getByRole('button',{name:'Save personal edit',exact:true}).click();
    await page.locator('#note-overview').getByText('My corrected explanation of database indexes.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Add annotation: tap a passage',exact:true}).click();
    await page.locator('#note-overview').getByText('A second paragraph to annotate.',{exact:true}).click();
    await page.getByLabel('Your typed annotation',{exact:true}).fill('Remember to compare a table scan. <script>not executed</script>');
    await page.getByRole('button',{name:'Save annotation',exact:true}).click();
    await page.locator('.personal-annotation').waitFor();
    await page.reload();await ready();
    await page.locator('.personal-annotation').waitFor();
    assert.match(await page.locator('.personal-annotation').innerText(),/Remember to compare/);
    assert.equal(await page.locator('#summary-content script').count(),0);
    await page.getByRole('button',{name:'Edit / position',exact:true}).click();
    await page.getByLabel('Arrow position',{exact:true}).selectOption('before');
    await page.getByRole('button',{name:'Save annotation',exact:true}).click();
    await page.waitForFunction(async()=>((await (await import('./js/store.js')).getLecture('db1')).annotations[0].placement)==='before');
    await page.getByRole('button',{name:'Move arrow',exact:true}).click();
    await page.locator('#note-overview').getByText('My corrected explanation of database indexes.',{exact:true}).click();
    await page.waitForFunction(async()=>((await (await import('./js/store.js')).getLecture('db1')).annotations[0].quote)==='My corrected explanation of database indexes.');
    const saved=await page.evaluate(async()=>{
        const store=await import('./js/store.js'),{createBackup,parseBackup}=await import('./js/schema.js');
        const lecture=await store.getLecture('db1');return parseBackup(JSON.parse(JSON.stringify(createBackup([lecture]))))[0];
    });
    assert.equal(saved.title,'Indexes explained');assert.equal(saved.analysis.summary,'Database indexes speed up lookups.');assert.equal(saved.annotations.length,1);assert.equal(saved.personalNotes.length,1);
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:join(tmpdir(),'delectured-personal-mobile.png')});
    await page.emulateMedia({media:'print'});
    assert(await page.locator('.personal-annotation').isVisible());
    assert(!await page.getByRole('button',{name:'Edit / position',exact:true}).isVisible());
    await page.emulateMedia({media:'screen'});
    await page.getByRole('button',{name:'Delete annotation',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.personal-annotation'));
    await page.locator('.back-library').click();
    await page.locator('#library-list').getByText('Indexes explained',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS courses: local suggestions, deselection/save/edit, revision persistence, selected-only Q&A/cache/citations; personal edits/annotations reload/position/delete/backup/print/mobile; rename and tagline');
} finally {await browser?.close();await new Promise(r=>server.close(r));}
