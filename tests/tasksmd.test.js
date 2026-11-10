const assert = require('assert');
const { parseMarkdown, patchText } = require('../tasksmd');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };

const doc = `# Tasks

Some notes I keep here.

- [ ] Write the report #work !high @2026-11-10 <!--t:aaa-->
- [x] Send invoice <!--t:bbb-->
- [ ] כתיבת מייל #עבודה <!--t:ccc-->
- [ ] hand typed line

## Backlog

- [ ] Reorganize garage #home <!--t:ddd-->
`;

ok('parses fields, sections, Hebrew tags', () => {
  const t = parseMarkdown(doc);
  assert.strictEqual(t.length, 5);
  assert.deepStrictEqual(t[0], { id: 'aaa', text: 'Write the report', done: false, pri: 2, due: '2026-11-10', tags: ['work'], section: 'today' });
  assert.strictEqual(t[1].done, true);
  assert.deepStrictEqual(t[2].tags, ['עבודה']);
  assert.strictEqual(t[4].section, 'backlog');
});
ok('hand typed line gets a stable derived id', () => {
  const a = parseMarkdown(doc)[3].id, b = parseMarkdown(doc)[3].id;
  assert.ok(/^h/.test(a)); assert.strictEqual(a, b);
});
ok('tags: #42 and C# are not tags', () => {
  const t = parseMarkdown('- [ ] Fix bug #42 in C# code #real <!--t:x1-->\n');
  assert.deepStrictEqual(t[0].tags, ['real']);
  assert.strictEqual(t[0].text, 'Fix bug #42 in C# code');
});
ok('case-insensitive duplicate tags collapse', () => {
  assert.deepStrictEqual(parseMarkdown('- [ ] a #Work #work <!--t:y-->')[0].tags, ['Work']);
});
ok('round trip leaves notes and headings untouched', () => {
  const tasks = parseMarkdown(doc);
  const out = patchText(doc, tasks);
  assert.ok(out.includes('Some notes I keep here.'));
  assert.ok(out.includes('## Backlog'));
  assert.deepStrictEqual(parseMarkdown(out), tasks);
});
ok('hand typed line is rewritten with an id, same task', () => {
  const tasks = parseMarkdown(doc);
  const out = patchText(doc, tasks);
  assert.ok(/hand typed line <!--t:h/.test(out));
  assert.strictEqual(parseMarkdown(out)[3].id, tasks[3].id);
});
ok('toggling done and changing text updates only that line', () => {
  const tasks = parseMarkdown(doc); tasks[0].done = true; tasks[0].text = 'Write the final report';
  const out = patchText(doc, tasks);
  assert.ok(out.includes('- [x] Write the final report #work !high @2026-11-10 <!--t:aaa-->'));
});
ok('deleting a task removes its line only', () => {
  const tasks = parseMarkdown(doc).filter((t) => t.id !== 'bbb');
  const out = patchText(doc, tasks);
  assert.ok(!out.includes('Send invoice')); assert.ok(out.includes('Some notes'));
});
ok('new task lands at the end of today, before the backlog heading', () => {
  const tasks = parseMarkdown(doc).concat([{ id: 'new1', text: 'Brand new', done: false, pri: 1, due: '', tags: [], section: 'today' }]);
  const out = patchText(doc, tasks);
  const iNew = out.indexOf('Brand new'), iBl = out.indexOf('## Backlog');
  assert.ok(iNew > 0 && iNew < iBl);
});
ok('new backlog task lands under the backlog heading', () => {
  const tasks = parseMarkdown(doc).concat([{ id: 'new2', text: 'Someday', done: false, pri: 1, due: '', tags: ['x'], section: 'backlog' }]);
  const out = patchText(doc, tasks);
  assert.ok(out.indexOf('Someday') > out.indexOf('## Backlog'));
});
ok('moving a task between halves', () => {
  const tasks = parseMarkdown(doc); tasks[0].section = 'backlog'; tasks[4].section = 'today';
  const out = patchText(doc, tasks);
  const re = parseMarkdown(out);
  assert.strictEqual(re.find((t) => t.id === 'aaa').section, 'backlog');
  assert.strictEqual(re.find((t) => t.id === 'ddd').section, 'today');
});
ok('empty file is created with a header', () => {
  const out = patchText('', [{ id: 'q1', text: 'First', done: false, pri: 1, due: '', tags: [], section: 'today' }, { id: 'q2', text: 'Later', done: false, pri: 0, due: '', tags: [], section: 'backlog' }]);
  assert.ok(out.startsWith('# Tasks\n\n- [ ] First <!--t:q1-->'));
  assert.ok(out.includes('## Backlog'));
  assert.strictEqual(parseMarkdown(out).length, 2);
});
ok('windows line endings are accepted', () => {
  assert.strictEqual(parseMarkdown('- [ ] a <!--t:z1-->\r\n- [x] b <!--t:z2-->\r\n').length, 2);
});
ok('patching is idempotent', () => {
  const tasks = parseMarkdown(doc);
  const once = patchText(doc, tasks);
  assert.strictEqual(patchText(once, parseMarkdown(once)), once);
});
ok('identical hand typed lines get different ids', () => {
  const t = parseMarkdown('- [ ] same\n- [ ] same\n');
  assert.strictEqual(t.length, 2); assert.notStrictEqual(t[0].id, t[1].id);
});
console.log(n + ' tests passed');
