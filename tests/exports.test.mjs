import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportMarkdown, exportAnkiCsv} from '../js/exports.js';
test('exports preserve Unicode and CSV multiline quotes while neutralizing spreadsheet formulas', () => {
    const lecture = {id: 'x', title: 'हिंदी', transcript: 'x += 1;\n  print(x)', analysis: {summary: 'Notes', flashcards: [{q: '"Why",\nक्यों?', a: '=1+1'}]}};
    assert.match(exportMarkdown(lecture), /x \+= 1;\n  print\(x\)/);
    assert.match(exportMarkdown(lecture), /हिंदी/);
    assert.equal(exportAnkiCsv(lecture), '"""Why"",\nक्यों?","\'=1+1"\r\n');
});
