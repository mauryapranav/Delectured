// Fixed field names and numeric counts only: diagnostics never retain model text.
const string = max => ({type:'text', max});
const list = (max, item, min = 0) => ({type:'list', max, min, item});
const object = fields => ({type:'object', fields});
const evidence = list(4, object({sourceId:string(80), quote:string(300)}), 1);
export const PACKET_RULES = object({
    notes:string(2000), evidence, topics:list(8,string(100)),
    concepts:list(8,object({term:string(100),definition:string(600),evidence})),
    flashcards:list(8,object({q:string(300),a:string(600),evidence})),
    examSignals:list(4,object({label:string(200),evidence})),
    links:list(8,object({from:string(100),to:string(100),relation:string(150),evidence})),
});
const paths = new Set(['packet']);
function collect(rule, path = '') {
    if(path)paths.add(path);
    if(rule.type === 'object')for(const [key, child] of Object.entries(rule.fields))collect(child,path?`${path}.${key}`:key);
    if(rule.type === 'list')collect(rule.item,path);
}
collect(PACKET_RULES);
// Gemini documents maxItems/minItems, but not maxLength. Text limits are
// guidance in the schema and are still enforced by the local validator.
export function geminiStudySchema(schema) {
    // Schema builders reuse leaf objects; each field needs independent guidance.
    const result=JSON.parse(JSON.stringify(schema));
    function visit(node,rule) {
        if(!rule)return;
        if(node.type==='string' && rule.type==='text')node.description=`Non-empty text, at most ${rule.max} characters.`;
        if(node.type==='array' && rule.type==='list') {
            node.maxItems=rule.max;node.minItems=rule.min;visit(node.items,rule.item);
        }
        if(node.type==='object' && rule.type==='object')for(const [key,child] of Object.entries(node.properties ?? {}))visit(child,rule.fields[key]);
    }
    visit(result,PACKET_RULES);
    return result;
}
export function safeValidationIssue(value) {
    if(!value || !paths.has(value.field) || !['missing','type','empty','too_long','too_many','too_few'].includes(value.code))return undefined;
    return {field:value.field,code:value.code,...Object.fromEntries(['actual','limit'].filter(k=>Number.isSafeInteger(value[k]) && value[k]>=0 && value[k]<=1000000).map(k=>[k,value[k]]))};
}
export function diagnosePacket(value, rule = PACKET_RULES, path = '') {
    const field = path || 'packet';
    const fail = (code, extra = {}) => ({field,code,...extra});
    if(value === undefined)return fail('missing');
    if(rule.type === 'text') {
        if(typeof value !== 'string')return fail('type');
        if(!value.trim())return fail('empty');
        if(value.length > rule.max)return fail('too_long',{actual:value.length,limit:rule.max});
    } else if(rule.type === 'list') {
        if(!Array.isArray(value))return fail('type');
        if(value.length > rule.max)return fail('too_many',{actual:value.length,limit:rule.max});
        if(value.length < rule.min)return fail('too_few',{actual:value.length,limit:rule.min});
        for(const item of value){const issue=diagnosePacket(item,rule.item,path);if(issue)return issue;}
    } else {
        if(!value || typeof value !== 'object' || Array.isArray(value))return fail('type');
        for(const [key,child] of Object.entries(rule.fields)){
            const issue=diagnosePacket(value[key],child,path?`${path}.${key}`:key);if(issue)return issue;
        }
    }
}
export function explainValidation(value) {
    const issue=safeValidationIssue(value);if(!issue)return '';
    const names={notes:'section notes',topics:'topic list',concepts:'concepts',flashcards:'recall cards',examSignals:'exam cues',links:'concept connections',evidence:'supporting references',packet:'notes response'};
    const parts=issue.field.split('.');
    const suffix={term:'term',definition:'definition',q:'question',a:'answer',label:'label',from:'starting concept',to:'linked concept',relation:'relationship',evidence:'references',quote:'quote',sourceId:'source ID'};
    const label=[names[parts[0]],...parts.slice(1).map(p=>suffix[p])].join(' / ');
    if(issue.code==='too_long')return `The AI wrote ${issue.actual} characters for ${label}; this app allows ${issue.limit}.`;
    if(issue.code==='too_many')return `The AI returned ${issue.actual} items for ${label}; this app allows ${issue.limit}.`;
    if(issue.code==='missing')return `The AI left out ${label}.`;
    if(['empty','too_few'].includes(issue.code))return `The AI returned empty ${label}.`;
    return `The AI returned ${label} in the wrong format.`;
}
