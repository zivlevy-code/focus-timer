'use strict';
// Reads and writes the tasks markdown file.
//
//   # Tasks
//   - [ ] Write the report #work !high @2026-11-10 <!--t:abc123-->
//   - [x] Send the invoice <!--t:def456-->
//
//   ## Backlog
//   - [ ] Reorganize the garage <!--t:ghi789-->
//
// One checkbox per task. A heading containing "Backlog" starts the backlog; any other
// heading starts today's list again. Everything that is not a checkbox line (headings,
// notes, blank lines) is left exactly as it is.

const TASK_RE = /^(\s*[-*]\s+)\[( |x|X)\]\s+(.*?)\s*$/;
const ID_RE = /<!--\s*t:([A-Za-z0-9_-]+)\s*-->/;
const TAG_RE = /(^|\s)#(\p{L}[\p{L}\p{N}_-]*)/gu;
const DUE_RE = /(^|\s)@(\d{4}-\d{2}-\d{2})(?=\s|$)/;
const PRI_RE = /(^|\s)!(high|low)(?=\s|$)/i;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// A line typed by hand has no id yet. It gets a stable one derived from its text, so the
// same line maps to the same task on every read until it is rewritten with a real id.
function derivedId(raw, counters) {
  const n = (counters[raw] = (counters[raw] || 0) + 1);
  return 'h' + fnv(raw + '\u0000' + n).toString(36);
}

function parseLine(line, counters) {
  const m = TASK_RE.exec(line);
  if (!m) return null;
  const raw = m[3];
  let body = raw;
  let id = null;
  const im = ID_RE.exec(body);
  if (im) { id = im[1]; body = body.replace(ID_RE, ' '); }
  let due = '';
  const dm = DUE_RE.exec(body);
  if (dm) { due = dm[2]; body = body.replace(DUE_RE, '$1'); }
  let pri = 1;
  const pm = PRI_RE.exec(body);
  if (pm) { pri = pm[2].toLowerCase() === 'high' ? 2 : 0; body = body.replace(PRI_RE, '$1'); }
  const tags = [];
  body = body.replace(TAG_RE, (all, sp, tag) => {
    if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    return sp;
  });
  const text = body.replace(/\s+/g, ' ').trim();
  if (!id) id = derivedId(raw.replace(/\s+/g, ' ').trim(), counters);
  return { prefix: m[1], done: m[2] !== ' ', id, text, tags, pri, due, hadId: !!im };
}

function formatLine(t, prefix) {
  let s = (prefix || '- ') + '[' + (t.done ? 'x' : ' ') + '] ' + t.text;
  (t.tags || []).forEach((g) => { s += ' #' + g; });
  if (t.pri === 2) s += ' !high';
  else if (t.pri === 0) s += ' !low';
  if (t.due) s += ' @' + t.due;
  return s + ' <!--t:' + t.id + '-->';
}

function parseMarkdown(text) {
  const out = [];
  const seen = new Set();
  const counters = {};
  let section = 'today';
  String(text || '').replace(/\r\n/g, '\n').split('\n').forEach((line) => {
    const h = HEADING_RE.exec(line);
    if (h) { section = /backlog/i.test(h[2]) ? 'backlog' : 'today'; return; }
    const p = parseLine(line, counters);
    if (!p || !p.text || seen.has(p.id)) return;
    seen.add(p.id);
    out.push({ id: p.id, text: p.text, done: p.done, pri: p.pri, due: p.due, tags: p.tags, section });
  });
  return out;
}

// Returns text with its checkbox lines brought in line with tasks. Lines for tasks that
// no longer exist are dropped; new tasks are added at the end of their section.
function patchText(text, tasks) {
  const src = String(text || '').replace(/\r\n/g, '\n');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const lines = src === '' ? [] : src.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const out = [];
  const seen = new Set();
  const counters = {};
  let section = 'today';
  let lastToday = -1, lastBacklog = -1, backlogHead = -1;
  for (const line of lines) {
    const h = HEADING_RE.exec(line);
    if (h) {
      section = /backlog/i.test(h[2]) ? 'backlog' : 'today';
      if (section === 'backlog' && backlogHead < 0) backlogHead = out.length;
      out.push(line);
      continue;
    }
    const p = parseLine(line, counters);
    if (!p || !p.text) { out.push(line); continue; }
    const t = byId.get(p.id);
    if (!t || seen.has(p.id)) continue;           // deleted in the app (or a duplicate line)
    if ((t.section || 'today') !== section) continue; // moved between halves: re-added below
    seen.add(p.id);
    out.push(formatLine(t, p.prefix));
    if (section === 'today') lastToday = out.length - 1; else lastBacklog = out.length - 1;
  }

  const addToday = [], addBacklog = [];
  for (const t of tasks) {
    if (seen.has(t.id)) continue;
    (t.section === 'backlog' ? addBacklog : addToday).push(formatLine(t, '- '));
  }

  const inserts = [];
  if (addToday.length) {
    if (lastToday >= 0) inserts.push({ at: lastToday + 1, lines: addToday, kind: 'today' });
    else if (backlogHead >= 0) inserts.push({ at: backlogHead, lines: addToday.concat(['']), kind: 'today' });
    else if (out.length === 0) inserts.push({ at: 0, lines: ['# Tasks', ''].concat(addToday), kind: 'today' });
    else inserts.push({ at: out.length, lines: addToday, kind: 'today' });
  }
  if (addBacklog.length) {
    if (lastBacklog >= 0) inserts.push({ at: lastBacklog + 1, lines: addBacklog, kind: 'backlog' });
    else if (backlogHead >= 0) inserts.push({ at: backlogHead + 1, lines: addBacklog, kind: 'backlog' });
    else inserts.push({ at: out.length, lines: (out.length || addToday.length ? [''] : []).concat(['## Backlog', ''], addBacklog), kind: 'backlog' });
  }
  // Apply from the bottom up so earlier positions stay valid. On a tie the backlog goes
  // first, so that today's lines end up above it.
  inserts.sort((a, b) => b.at - a.at || (a.kind === 'backlog' ? -1 : 1));
  for (const ins of inserts) out.splice(ins.at, 0, ...ins.lines);

  return out.length ? out.join('\n') + '\n' : '';
}

module.exports = { parseMarkdown, patchText, parseLine, formatLine };
