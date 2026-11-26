/**
 * Vikunja, as a provider of the tracker family (@webship.co/workspace-tracker): the tasks of a Vikunja project, over its
 * REST API (/api/v1) as a person, with that person's API token (the Authorization header), in a header file, never on
 * a command line. The builder's tool makes the token through Vikunja's API as the account (--connect <login>).
 *
 * A scope is a project, by its title ("Webship site"); an item is a task, by its project's key and its number there
 * ("WEB-1"), as Vikunja shows it; "#1" and "1" are the same task of the scope's project.
 *
 * Reads: the open tasks (not done), mine, assigned to someone, and a search in the title; one task with its comments.
 * A task's state is its bucket on the project's board (its Kanban view): To-Do, Doing, Done by default. Vikunja has no
 * sprint, and its time tracking is a feature of its paid licence, not of its open-source edition: no iteration view and
 * no worklog here.
 *
 * Each person's standing is what the project gives them: its owner and an admin share are owners of it, a read & write
 * share a member; a read only share and someone it is not shared with are outside, so the base keeps their tasks
 * analyze-only unless a person confirms by name. A team's share counts for its members. Each comment's author is read on
 * their own. Vikunja keeps no history of a task: the last editor is its creator.
 *
 * Writes, which the base offers only with writes on, each after a person's click: a comment, a move to another bucket of
 * the board (Done marks the task done), labels the person can use, an assignee who may change tasks, and a new task.
 * The base writes Markdown; Vikunja keeps HTML, so the provider turns it into the HTML Vikunja's editor reads, with every
 * character of the text escaped. Vikunja is not a forge: the pull request of the work is opened from the project's
 * forge menu. A Vikunja API token is `tk_` and its secret; the base refuses that shape in whatever is about to be posted.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { PluginApi } from '@webship.co/workspace-plugin-api';
import type { Person, TrackerItem, TrackerItemFull, TrackerProvider, TrackerScope, WriteResult } from '@webship.co/workspace-tracker';

/** A task: its project's key and its number ("WEB-1"), or its number alone ("#1", "1"). */
export const ITEM_RE = /^(?:([A-Za-z][A-Za-z0-9]{0,9})-|#)?([1-9][0-9]{0,9})$/;
/** A project's title, as a scope. */
const NAME_RE = /^[^\u0000-\u001f\u007f]{1,250}$/;
/** What a Vikunja API token looks like. */
export const TOKEN_RE = /tk_[A-Za-z0-9]{32,64}/;
/** How long the person, a project, its sharing and its board are kept before they are asked again. */
const KEEP_MS = 5 * 60 * 1000;
/** The tasks a list reads at most, in pages of Vikunja's own size. */
const PAGE = 50;
const MAX_PAGES = 10;

const configured = (v: unknown) => { const s = String(v == null ? '' : v).trim(); return s && s !== 'CHANGE_ME' ? s : ''; };

/** What a share of Vikunja's gives (0 read only, 1 read & write, 2 admin), as the base reads an author's standing. */
export function permissionAssociation(permission: unknown): Person['association'] {
  const p = Number(permission);
  if (p >= 2) return 'owner';
  if (p === 1) return 'member';
  return 'outside';
}

/** A person as Vikunja shows them: their name, else their username. */
export function nameOf(u: any): string {
  return String((u && (u.name || u.username)) || '').trim();
}

/** A task's key: its project's key and its number, or "#" and its number when the project has no key. */
export function keyOf(t: any): string {
  return String(t.identifier || '') || `#${t.index}`;
}

/** A task of the API as the base reads it; its state is its bucket on the board, when the board is known. */
export function itemOf(t: any, base: string, board: Map<string, { bucket: string; first: boolean; done: boolean }>): TrackerItem {
  const place = board.get(String(t.id));
  const state = place ? place.bucket : (t.done ? 'Done' : 'To-Do');
  const stateClass: TrackerItem['stateClass'] = t.done || (place && place.done) ? 'done' : (!place || place.first ? 'open' : 'doing');
  return {
    id: keyOf(t),
    title: String(t.title || ''),
    url: `${base}/tasks/${t.id}`,
    state,
    stateClass,
    assignees: (Array.isArray(t.assignees) ? t.assignees : []).map(nameOf).filter(Boolean),
    labels: (Array.isArray(t.labels) ? t.labels : []).map((l: any) => String(l.title || '')).filter(Boolean),
    ...(place ? { column: place.bucket } : {}),
    updated: String(t.updated || ''),
  };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8}|#39);/gi, (all, e: string) => {
    if (/^#/.test(e) && e !== '#39') {
      const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      // A control character (but a tab or a new line) stays as it is written.
      return (n >= 0x20 || n === 9 || n === 10) && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}
const tagsOut = (s: string) => s.replace(/<[^>]*>/g, '');

/**
 * Leantime's HTML (its editor's), as the text a snapshot keeps: blocks on their own lines, list items as "- ", a task
 * as "- [ ]" or "- [x]", a quote as "> ", code as Markdown code, a link with its address. An HTML comment stays as it is written: what a page does not show is still read, as data.
 */
export function textOf(html: string): string {
  const kept: string[] = [];
  const hold = (text: string) => { kept.push(text); return `\u0000${kept.length - 1}\u0000`; };
  let s = String(html || '').replace(/[\u0000-\u0002]/g, '');
  s = s.replace(/<!--[\s\S]*?-->/g, (c) => hold(c));
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, c: string) => `\n${hold(`\`\`\`\n${decode(tagsOut(c)).replace(/\n+$/, '')}\n\`\`\``)}\n`);
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, c: string) => hold(`\`${decode(tagsOut(c))}\``));
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
    const text = decode(tagsOut(label)).trim();
    const url = decode(href);
    return hold(text && text !== url ? `${text} (${url})` : url);
  });
  s = s.replace(/<img\b[^>]*>|<image-component\b[^>]*>(?:<\/image-component>)?/gi, (img) => {
    const alt = (img.match(/\balt="([^"]*)"/i) || [])[1] || '';
    return hold(alt ? `[image: ${decode(alt)}]` : '[image]');
  });
  // A quote's lines get "> " in front, one for each quote they are in.
  s = s.replace(/<blockquote\b[^>]*>/gi, '\n\u0001\n').replace(/<\/blockquote>/gi, '\n\u0002\n');
  // A list item's own wrappers (a task's checkbox, a paragraph) are not lines of their own.
  s = s.replace(/(<li\b[^>]*>)(?:\s*<label\b[^>]*>[\s\S]*?<\/label>)?(?:\s*<(?:div|p)\b[^>]*>)*/gi, '$1');
  s = s.replace(/(?:<\/(?:p|div)>\s*)+(<\/li>)/gi, '$1');
  s = s.replace(/<li\b[^>]*data-checked="(true|false)"[^>]*>/gi, (_, c: string) => `\n- [${c === 'true' ? 'x' : ' '}] `);
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<h([1-6])\b[^>]*>/gi, (_, n: string) => `\n\n${'#'.repeat(Number(n))} `);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6]|ul|ol|table|tr)>/gi, '\n\n');
  s = s.replace(/<(p|div|ul|ol|table|tr)\b[^>]*>/gi, '\n');
  s = s.replace(/<\/(td|th)>/gi, ' | ');
  s = decode(tagsOut(s));
  // Held text may hold more held text (code in a link): put it back until none is left.
  for (let n = 0; n < 4 && /\u0000\d+\u0000/.test(s); n++) s = s.replace(/\u0000(\d+)\u0000/g, (_, k: string) => kept[Number(k)] ?? '');
  let depth = 0;
  const lines: string[] = [];
  for (const line of s.split('\n')) {
    const l = line.replace(/[ \t]+$/, '');
    if (l.trim() === '\u0001') { depth += 1; continue; }
    if (l.trim() === '\u0002') { depth = Math.max(0, depth - 1); continue; }
    lines.push(depth && l.trim() ? `${'> '.repeat(depth)}${l.trim()}` : l);
  }
  return lines.join('\n').replace(/\n(?:[ \t]*\n){2,}/g, '\n\n').trim();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Bold and a word in underscores, in text already escaped. */
const emphasis = (s: string) => s
  .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])_([^_\n]+?)_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>');

/** One line of Markdown text: code spans, links ([text](https://…) and bare addresses), bold and emphasis. */
function inline(text: string): string {
  const out: string[] = [];
  const code = /(`+)([^`][\s\S]*?)\1(?!`)/g;
  let at = 0;
  let m: RegExpExecArray | null;
  const rich = (s: string) => {
    const parts: string[] = [];
    const link = /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]{1,2000})\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;
    let from = 0;
    let l: RegExpExecArray | null;
    while ((l = link.exec(s))) {
      parts.push(emphasis(esc(s.slice(from, l.index))));
      const href = l[2] || l[3];
      parts.push(`<a href="${esc(href)}">${l[1] ? emphasis(esc(l[1])) : esc(href)}</a>`);
      from = l.index + l[0].length;
    }
    parts.push(emphasis(esc(s.slice(from))));
    return parts.join('');
  };
  while ((m = code.exec(text))) {
    out.push(rich(text.slice(at, m.index)));
    out.push(`<code>${esc(m[2])}</code>`);
    at = m.index + m[0].length;
  }
  out.push(rich(text.slice(at)));
  return out.join('');
}

/**
 * Markdown, as the HTML Leantime's editor reads: paragraphs, headings, lists and task lists, quotes, code blocks, code,
 * links, bold and emphasis. Every character of the text is escaped, so nothing in it becomes markup; an HTML comment
 * (a placeholder in a template) is left out, as a Markdown page does not show it.
 */
export function htmlOf(markdown: string): string {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: { kind: 'ul' | 'ol' | 'task'; items: string[] } | null = null;
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  const flushQuote = () => { if (quote.length) out.push(`<blockquote><p>${quote.map(inline).join('<br>')}</p></blockquote>`); quote = []; };
  const flushList = () => {
    if (!list) return;
    if (list.kind === 'task') out.push(`<ul data-type="taskList">${list.items.join('')}</ul>`);
    else out.push(`<${list.kind}>${list.items.join('')}</${list.kind}>`);
    list = null;
  };
  const flush = () => { flushPara(); flushQuote(); flushList(); };
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      flush();
      const body: string[] = [];
      const close = new RegExp(`^\\s*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
      for (n += 1; n < lines.length && !close.test(lines[n]); n++) body.push(lines[n]);
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) { flush(); out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    const q = line.match(/^\s{0,3}>\s?(.*)$/);
    if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
    const task = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d{1,9}[.)]\s+(.*)$/);
    if (task || bullet || numbered) {
      flushPara(); flushQuote();
      const kind = task ? 'task' : bullet ? 'ul' : 'ol';
      if (!list || list.kind !== kind) { flushList(); list = { kind, items: [] }; }
      const current = list as { kind: 'ul' | 'ol' | 'task'; items: string[] };
      if (task) current.items.push(`<li data-type="taskItem" data-checked="${task[1] === ' ' ? 'false' : 'true'}"><p>${inline(task[2])}</p></li>`);
      else current.items.push(`<li><p>${inline((bullet || numbered as RegExpMatchArray)[1])}</p></li>`);
      continue;
    }
    flushQuote(); flushList();
    para.push(line.trim());
  }
  flush();
  return out.join('') || '<p></p>';
}


/** What an answer of Vikunja says went wrong, in one line. */
export function saidOf(data: any): string {
  return data && typeof data === 'object' && typeof data.message === 'string' ? data.message.slice(0, 300) : '';
}

export function vikunjaTracker(api: PluginApi): TrackerProvider {
  const lib = api.lib;
  const settings = () => api.settings.read() || {};
  const base = () => configured(settings().url).replace(/\/+$/, '');
  const token = () => configured(settings().token);
  // Who is asking: the site and its token, so that what is kept follows a change of either.
  const asker = () => crypto.createHash('sha1').update(`${base()}\n${token()}`).digest('hex').slice(0, 12);

  /** One call of the API: the token and the body in files only this user reads, removed after. */
  async function call(method: string, route: string, body?: unknown): Promise<any> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-vikunja-'));
    try {
      const h = path.join(dir, 'headers');
      fs.writeFileSync(h, `Authorization: Bearer ${token()}\nAccept: application/json\nContent-Type: application/json\n`, { mode: 0o600 });
      const args = ['-sS', '-m', '30', '-X', method, '-w', '\n%{http_code}', '-H', `@${h}`];
      if (body !== undefined) {
        const b = path.join(dir, 'body.json');
        fs.writeFileSync(b, JSON.stringify(body), { mode: 0o600 });
        args.push('--data-binary', `@${b}`);
      }
      args.push(`${base()}/api/v1${route}`);
      const r = await lib.run('curl', args, process.env.HOME || '/', { timeoutMs: 40 * 1000, env: process.env });
      const out = String(r.stdout || '');
      const at = out.lastIndexOf('\n');
      const status = Number(out.slice(at + 1)) || 0;
      if (!status) throw new Error(lib.cliError(String(r.stderr || 'curl did not answer')));
      let data: any = null;
      try { data = JSON.parse(at >= 0 ? out.slice(0, at) : out); } catch (_) { data = null; }
      if (status === 401) throw new Error(`Vikunja refused the token (401): connect again with the site's tool (--connect <login>)`);
      if (status === 403) throw new Error(`Vikunja refused it (403)${saidOf(data) ? `: ${saidOf(data)}` : ''}: the token's account may not do that, or the token's permissions do not cover it`);
      if (status < 200 || status >= 300) throw new Error(`Vikunja answered ${status}${saidOf(data) ? `: ${saidOf(data)}` : ''}`);
      return data;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  async function write(method: string, route: string, body: unknown, url: string): Promise<WriteResult & { result?: any }> {
    try { return { ok: true, error: '', url, result: await call(method, route, body) }; } catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
  }
  const failed = (e: unknown): WriteResult => ({ ok: false, error: String((e as Error).message || e) });

  // What is kept for five minutes: the token's own account, a project, its sharing and its board's buckets.
  const kept = new Map<string, { at: number; value: unknown }>();
  async function keep<T>(what: string, make: () => Promise<T>): Promise<T> {
    const key = `${asker()}:${what}`;
    const hit = kept.get(key);
    if (hit && Date.now() - hit.at < KEEP_MS) return hit.value as T;
    const value = await make();
    kept.set(key, { at: Date.now(), value });
    return value;
  }
  // The address of a task the provider has read: its key to its id on the site.
  const seen = new Map<string, string>();
  const remember = (t: any) => { if (t && t.id) seen.set(`${asker()}:${keyOf(t)}`, String(t.id)); };

  const me = () => keep('me', async () => { const u = await call('GET', '/user'); return { id: String(u && u.id || ''), username: String(u && u.username || ''), name: nameOf(u) }; });
  async function projectOf(scope: TrackerScope): Promise<{ id: string; title: string; key: string; owner: any }> {
    return keep(`project:${scope.id}`, async () => {
      const list = await call('GET', '/projects?per_page=250');
      const found = (Array.isArray(list) ? list : []).find((p: any) => p && Number(p.id) > 0 && String(p.title) === scope.id);
      if (!found) throw new Error(`no project "${scope.id}" the token's account can see`);
      return { id: String(found.id), title: String(found.title), key: String(found.identifier || ''), owner: found.owner || null };
    });
  }
  /** Everyone the project is shared with, by their id: their name, username and permission (a team's for its members). */
  async function sharingOf(scope: TrackerScope): Promise<Map<string, { name: string; username: string; permission: number }>> {
    const project = await projectOf(scope);
    return keep(`sharing:${scope.id}`, async () => {
      const out = new Map<string, { name: string; username: string; permission: number }>();
      const put = (u: any, permission: number) => {
        const id = String(u && u.id || '');
        if (!id) return;
        const had = out.get(id);
        if (!had || had.permission < permission) out.set(id, { name: nameOf(u), username: String(u.username || ''), permission });
      };
      if (project.owner) put(project.owner, 2);
      const users = await call('GET', `/projects/${project.id}/users`);
      for (const u of Array.isArray(users) ? users : []) put(u, Number(u.permission));
      const teams = await call('GET', `/projects/${project.id}/teams`);
      for (const team of Array.isArray(teams) ? teams : []) {
        const full = await call('GET', `/teams/${team.id}`);
        for (const m of (full && Array.isArray(full.members) ? full.members : [])) put(m, Number(team.permission));
      }
      return out;
    });
  }
  async function personOf(scope: TrackerScope, u: any): Promise<Person> {
    const id = String(u && u.id || '');
    if (!id) return { name: nameOf(u) || 'unknown', association: 'unknown' };
    const share = (await sharingOf(scope)).get(id);
    return { name: nameOf(u) || `#${id}`, association: share ? permissionAssociation(share.permission) : 'outside' };
  }
  /** The project's board: its Kanban view and buckets, in their order, and which bucket is done. */
  async function boardOf(scope: TrackerScope): Promise<{ view: string; buckets: { id: string; name: string }[]; done: string }> {
    const project = await projectOf(scope);
    return keep(`board:${scope.id}`, async () => {
      const views = await call('GET', `/projects/${project.id}/views`);
      const kanban = (Array.isArray(views) ? views : []).find((v: any) => v && (v.view_kind === 'kanban' || v.view_kind === 3));
      if (!kanban) return { view: '', buckets: [], done: '' };
      const buckets = await call('GET', `/projects/${project.id}/views/${kanban.id}/buckets`);
      return {
        view: String(kanban.id),
        buckets: (Array.isArray(buckets) ? buckets : []).map((b: any) => ({ id: String(b.id), name: String(b.title || '') })),
        done: String(kanban.done_bucket_id || ''),
      };
    });
  }
  /** Where each task is on the board now: one call, not kept. */
  async function placesOf(scope: TrackerScope): Promise<Map<string, { bucket: string; first: boolean; done: boolean }>> {
    const project = await projectOf(scope);
    const board = await boardOf(scope);
    const out = new Map<string, { bucket: string; first: boolean; done: boolean }>();
    if (!board.view) return out;
    const columns = await call('GET', `/projects/${project.id}/views/${board.view}/tasks`);
    (Array.isArray(columns) ? columns : []).forEach((b: any) => {
      const first = board.buckets.length > 0 && String(b.id) === board.buckets[0].id;
      for (const t of (Array.isArray(b.tasks) ? b.tasks : [])) out.set(String(t.id), { bucket: String(b.title || ''), first, done: String(b.id) === board.done });
    });
    return out;
  }
  /** The task behind an id of the scope, as the API gives it. */
  async function taskIn(scope: TrackerScope, id: string): Promise<any> {
    const m = ITEM_RE.exec(String(id || '').trim());
    if (!m) throw new Error(`not a task: ${id}`);
    const project = await projectOf(scope);
    if (m[1] && project.key && m[1].toUpperCase() !== project.key.toUpperCase()) throw new Error(`${id} is not a task of ${scope.id} (${project.key})`);
    const t = await call('GET', `/projects/${project.id}/tasks/by-index/${m[2]}`);
    if (!t || typeof t !== 'object' || String(t.project_id) !== project.id) throw new Error(`${id} is not a task of ${scope.id}`);
    remember(t);
    return t;
  }
  const taskUrl = (scope: TrackerScope, id: string) => {
    const tid = seen.get(`${asker()}:${String(id).trim()}`);
    return tid ? `${base()}/tasks/${tid}` : scope.web;
  };
  async function listOf(scope: TrackerScope, filter: string, text: string, limit: number): Promise<TrackerItem[]> {
    const project = await projectOf(scope);
    const places = await placesOf(scope);
    const rows: any[] = [];
    for (let page = 1; page <= MAX_PAGES && rows.length < limit; page++) {
      const q = new URLSearchParams({ filter: `project = ${project.id} && done = false${filter ? ` && ${filter}` : ''}`, per_page: String(PAGE), page: String(page), sort_by: 'updated', order_by: 'desc' });
      if (text) q.set('s', text);
      const got = await call('GET', `/tasks?${q.toString()}`);
      const list = Array.isArray(got) ? got : [];
      rows.push(...list);
      if (list.length < PAGE) break;
    }
    rows.forEach(remember);
    return rows.slice(0, limit).map((t) => itemOf(t, base(), places));
  }
  /** Someone of the project by what the person typed: "me", the name, the username. Their id and username. */
  async function sharedBy(scope: TrackerScope, who: string, toAssign: boolean): Promise<{ id: string; username: string }> {
    const w = who.trim().toLowerCase();
    if (w === 'me') { const m = await me(); return { id: m.id, username: m.username }; }
    const list = [...(await sharingOf(scope)).entries()];
    const found = list.find(([, s]) => s.username.toLowerCase() === w) || list.find(([, s]) => s.name.toLowerCase() === w);
    if (!found) throw new Error(`${who} is not someone the project is shared with`);
    if (toAssign && found[1].permission < 1) throw new Error(`${who} may only read the project: Vikunja's tasks go to those who may change them`);
    return { id: found[0], username: found[1].username };
  }

  return {
    id: api.name,
    title: 'Vikunja',
    label: 'VIKUNJA',
    noun: { one: 'task', many: 'tasks' },
    capabilities: {
      views: ['open', 'mine', 'assigned', 'query'],
      comment: true, worklog: false, transition: true, labels: true, assign: true, create: true,
      request: 'none',
    },
    idPattern: ITEM_RE,
    tokenVariables: ['VIKUNJA_TOKEN', 'VIKUNJA_API_TOKEN'],
    secret: () => token(),
    tokenShapes: [['a Vikunja API token', TOKEN_RE]],
    ready: () => (!base() ? `no Vikunja address in ${api.settings.file} (url)` : !token() ? `no token in ${api.settings.file} (token)` : ''),
    // A workspace project has no Vikunja project of its own: it remembers one, or the default is used.
    scopeOf: () => null,
    parseScope: (text) => {
      const t = String(text || '').trim();
      return NAME_RE.test(t) && base() ? { id: t, name: t, web: `${base()}/projects` } : null;
    },
    urlOf: (scope, id) => taskUrl(scope, id),
    account: async () => { try { return (await me()).name; } catch (_) { return ''; } },
    // The projects the token's account can see (not its saved filters).
    scopes: async () => {
      const list = await call('GET', '/projects?per_page=250');
      return (Array.isArray(list) ? list : []).filter((p: any) => p && Number(p.id) > 0 && p.title && NAME_RE.test(String(p.title)))
        .map((p: any) => ({ id: String(p.title), name: String(p.title), web: `${base()}/projects/${p.id}` }));
    },

    list: async (scope, q) => {
      const limit = Math.max(1, Math.min(q.limit, 100));
      if (q.view === 'mine') return listOf(scope, `assignees in ${(await me()).username}`, '', limit);
      if (q.view === 'assigned') {
        if (!q.who) return [];
        const person = await sharedBy(scope, q.who, false);
        return listOf(scope, `assignees in ${person.username}`, '', limit);
      }
      if (q.view === 'query') return listOf(scope, '', String(q.text || '').trim(), limit);
      return listOf(scope, '', '', limit);
    },

    get: async (scope, id) => {
      const t = await taskIn(scope, id);
      const places = await placesOf(scope);
      const author = await personOf(scope, t.created_by);
      const comments = [];
      const rows = await call('GET', `/tasks/${t.id}/comments`);
      for (const c of (Array.isArray(rows) ? rows : []).slice().sort((a: any, b: any) => String(a.created || '').localeCompare(String(b.created || '')))) {
        const body = textOf(String(c.comment || ''));
        if (body) comments.push({ author: await personOf(scope, c.author), body, at: String(c.created || '') });
      }
      const full: TrackerItemFull = { ...itemOf(t, base(), places), body: textOf(String(t.description || '')), author, comments };
      return full;
    },

    comment: async (scope, id, markdown) => {
      try {
        const t = await taskIn(scope, id);
        return await write('PUT', `/tasks/${t.id}/comments`, { comment: htmlOf(markdown) }, `${base()}/tasks/${t.id}`);
      } catch (e) { return failed(e); }
    },
    transitions: async (scope, id) => {
      const t = await taskIn(scope, id);
      const places = await placesOf(scope);
      const now = places.get(String(t.id));
      return (await boardOf(scope)).buckets.filter((b) => !now || b.name !== now.bucket).map((b) => ({ id: b.id, name: b.name }));
    },
    transition: async (scope, id, to) => {
      try {
        const t = await taskIn(scope, id);
        const project = await projectOf(scope);
        const board = await boardOf(scope);
        if (!board.buckets.some((b) => b.id === String(to))) return { ok: false, error: `not a bucket of the board of ${scope.id}: ${to}` };
        return await write('POST', `/projects/${project.id}/views/${board.view}/buckets/${to}/tasks`, { task_id: Number(t.id) }, `${base()}/tasks/${t.id}`);
      } catch (e) { return failed(e); }
    },
    labels: async (scope, id, add, remove) => {
      try {
        const t = await taskIn(scope, id);
        const usable = await call('GET', '/labels?per_page=250');
        const byTitle = new Map<string, string>((Array.isArray(usable) ? usable : []).map((l: any) => [String(l.title || '').toLowerCase(), String(l.id)] as [string, string]));
        const now = new Map<string, string>((Array.isArray(t.labels) ? t.labels : []).map((l: any) => [String(l.title || '').toLowerCase(), String(l.id)] as [string, string]));
        const missing = add.filter((a) => a.trim() && !byTitle.has(a.trim().toLowerCase()));
        if (missing.length) return { ok: false, error: `no label ${missing.join(', ')} the account can use: Vikunja's labels are its people's own; make it in Vikunja first` };
        for (const a of add) {
          const lid = byTitle.get(a.trim().toLowerCase()) as string;
          if (!now.has(a.trim().toLowerCase())) await call('PUT', `/tasks/${t.id}/labels`, { label_id: Number(lid) });
        }
        for (const r of remove) {
          const lid = now.get(r.trim().toLowerCase());
          if (lid) await call('DELETE', `/tasks/${t.id}/labels/${lid}`);
        }
        return { ok: true, error: '', url: `${base()}/tasks/${t.id}` };
      } catch (e) { return failed(e); }
    },
    assign: async (scope, id, who) => {
      try {
        const t = await taskIn(scope, id);
        const person = await sharedBy(scope, who, true);
        return await write('PUT', `/tasks/${t.id}/assignees`, { user_id: Number(person.id) }, `${base()}/tasks/${t.id}`);
      } catch (e) { return failed(e); }
    },
    create: async (scope, item) => {
      try {
        const project = await projectOf(scope);
        const r = await write('PUT', `/projects/${project.id}/tasks`, { title: item.title, description: htmlOf(item.body) }, '');
        if (!r.ok) return r;
        const made = r.result;
        if (!made || !made.id) return { ok: false, error: 'Vikunja made no task (it answered no id)' };
        remember(made);
        return { ok: true, error: '', url: `${base()}/tasks/${made.id}`, id: keyOf(made) };
      } catch (e) { return failed(e); }
    },
  };
}
