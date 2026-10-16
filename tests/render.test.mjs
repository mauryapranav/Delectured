import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown} from '../js/safe-render.js';
test('reading renderer preserves code, lists and Unicode without trusting model HTML', () => {
    const html=renderMarkdown('# हिंदी\n\n**Definition**\n\n- one\n- two\n\n```python\n  x = "<script>"\n  print(*args)\n```\n\n`a*b*c` and <img onerror=alert(1)>');
    assert.match(html, /<h3>हिंदी<\/h3>/);assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
    assert.match(html, /  print\(\*args\)/);assert.match(html, /<code>a\*b\*c<\/code>/);assert(!html.includes('<script>'));assert(!html.includes('<img'));
});
