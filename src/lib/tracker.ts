/**
 * Vikunja, as a provider of the tracker family (@webship.co/workspace-tracker): the tasks of a Vikunja project, over
 * its JSON-RPC API (/api/jsonrpc) as a person, with that person's bearer token (the Authorization header), in a header
 * file, never on a command line. The builder's tool makes the token with Vikunja's own console (--connect <login>).
 *
 * A scope is a project, by its name ("Webship site"); an item is a task, by its number ("12"), which is the same on
 * the whole site: Vikunja shows it as "#12".
 *
 * Reads: the open tasks (their status is not of the DONE type), mine, assigned to someone, the current sprint's (the
 * sprint whose dates hold today), and a search in the title; one task with its comments and its history. Milestones are
 * not tasks: the lists leave them out.
 *
 * Each author's standing is their role in the project (the project's own role, else the person's role): an Owner, an
 * Administrator and a Company Manager are owners of it, an Editor a member; a Commenter and a Read Only person, who may
 * change no task, and someone not in the project's team are outside, so the base keeps their tasks analyze-only unless
 * a person confirms by name. Each comment's author is read on their own. The last editor is the person of the newest
 * change of the title or the description in the task's history, else its creator.
 *
 * Writes, which the base offers only with writes on, each after a person's click: a comment, a status, the task's tags
 * as labels, an assignee, logged time (the worklog), and a new task. The base writes Markdown; Vikunja keeps HTML, so
 * the provider turns it into the HTML Vikunja's editor reads, with every character of the text escaped. Vikunja is
 * not a forge: the pull request of the work is opened from the project's forge menu. A Vikunja API key is
 * `lt_<user>_<secret>`; the base refuses that shape, and the provider's own token, in whatever is about to be posted.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PluginApi } from '@webship.co/workspace-plugin-api';
import type { Person, TrackerItem, TrackerItemFull, TrackerProvider, TrackerScope, WriteResult } from '@webship.co/workspace-tracker';

/** A task: its number, with or without Vikunja's "#". */
export const ITEM_RE = /^#?([1-9][0-9]{0,9})$/;
/** A project's name, as a scope. */
const NAME_RE = /^[^\u0000-\u001f\u007f]{1,120}$/;
/** What a Vikunja API key looks like (an API user's key, not a person's bearer token). */
export const KEY_RE = /lt_[A-Za-z0-9]{1,64}_[A-Za-z0-9]{16,128}/;
/** How long the project, its team, statuses and sprints are kept before they are asked again. */
const KEEP_MS = 5 * 60 * 1000;
/** The tasks a list reads at most. */
const MAX_TASKS = 500;

const configured = (v: unknown) => { const s = String(v == null ? '' : v).trim(); return s && s !== 'CHANGE_ME' ? s : ''; };

/** A role of Vikunja's (its numbers), as the base reads an author's standing. */
export function roleAssociation(role: unknown): Person['association'] {
  const r = Number(role);
  if (r >= 30) return 'owner'; // Company Manager, Administrator, Owner
  if (r === 20) return 'member'; // Editor
  return 'outside'; // Commenter (10), Read Only (5), or none
}

/** How a status reads, by its type: DONE is done, INPROGRESS is work going on, NEW is open. */
export function stateClassOf(type: unknown): TrackerItem['stateClass'] {
  const t = String(type || '').toUpperCase();
  if (t === 'DONE') return 'done';
  if (t === 'INPROGRESS') return 'doing';
  return t ? 'open' : undefined;
}

/** A person's name, as Vikunja shows it: the first name and the last, else the address. */
export function nameOf(u: any): string {
  if (!u || typeof u !== 'object') return 'unknown';
  return String([u.firstname, u.lastname].filter(Boolean).join(' ') || u.username || 'unknown');
}

/** A task of the API, as the base reads an item. */
export function itemOf(t: any, base: string, statuses: Map<string, { name: string; type: string }>, people: Map<string, string>, sprints: Map<string, string>): TrackerItem {
  const status = statuses.get(String(t.status));
  const assignee = String(t.editorId || '');
  const sprint = sprints.get(String(t.sprint || ''));
  return {
    id: String(t.id),
    title: String(t.headline || ''),
    url: `${base}/tickets/showAll#/tickets/showTicket/${t.id}`,
    state: status ? status.name : String(t.status ?? ''),
    stateClass: status ? stateClassOf(status.type) : undefined,
    type: t.type ? String(t.type) : undefined,
    assignees: assignee && assignee !== '0' ? [people.get(assignee) || [t.editorFirstname, t.editorLastname].filter(Boolean).join(' ') || `#${assignee}`] : [],
    labels: String(t.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
    ...(sprint ? { iteration: `sprint ${sprint}` } : {}),
    updated: t.modified ? String(t.modified).replace(' ', 'T') : undefined,
  };
}

/** The sprint a "current sprint" view means: of the ones whose dates hold `now`, the one that ends first. */
export function currentSprint(list: any[], now: Date = new Date()): { id: string; name: string } | null {
  const day = now.toISOString().slice(0, 19).replace('T', ' ');
  const running = (Array.isArray(list) ? list : []).filter((s) => s && s.id && String(s.startDate || '') <= day && day <= String(s.endDate || ''));
  running.sort((a, b) => String(a.endDate || '').localeCompare(String(b.endDate || '')));
  return running.length ? { id: String(running[0].id), name: String(running[0].name || '') } : null;
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
 * Vikunja's HTML (its editor's), as the text a snapshot keeps: blocks on their own lines, list items as "- ", a task
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
 * Markdown, as the HTML Vikunja's editor reads: paragraphs, headings, lists and task lists, quotes, code blocks, code,
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

/** What an answer of Vikunja says went wrong, in one line: its error's message, and its data when it adds to it. */
export function saidOf(data: any): string {
  const e = data && typeof data === 'object' ? data.error : null;
  if (!e || typeof e !== 'object') return '';
  const message = typeof e.message === 'string' ? e.message : '';
  const more = typeof e.data === 'string' ? e.data : '';
  return [message, more && more !== message ? more : ''].filter(Boolean).join(': ').slice(0, 300);
}

interface Member { name: string; email: string; first: string; role: number; active: boolean }

export function vikunjaTracker(api: PluginApi): TrackerProvider {
  const lib = api.lib;
  const settings = () => api.settings.read() || {};
  const base = () => configured(settings().url).replace(/\/+$/, '');
  const token = () => configured(settings().token);

  // Who is asking: the site and its token, so that what is kept follows a change of either.
  const asker = () => crypto.createHash('sha1').update(`${base()}\n${token()}`).digest('hex').slice(0, 12);

  /** One call of the JSON-RPC API: the token and the body in files only this user reads, removed after. */
  async function rpc(method: string, params: Record<string, unknown>): Promise<any> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-vikunja-'));
    try {
      const h = path.join(dir, 'headers');
      fs.writeFileSync(h, `Authorization: Bearer ${token()}\nAccept: application/json\nContent-Type: application/json\n`, { mode: 0o600 });
      const b = path.join(dir, 'body.json');
      fs.writeFileSync(b, JSON.stringify({ jsonrpc: '2.0', method: `vikunja.rpc.${method}`, params, id: 1 }), { mode: 0o600 });
      const args = ['-sS', '-m', '30', '-X', 'POST', '-w', '\n%{http_code}', '-H', `@${h}`, '--data-binary', `@${b}`, `${base()}/api/jsonrpc`];
      const r = await lib.run('curl', args, process.env.HOME || '/', { timeoutMs: 40 * 1000, env: process.env });
      const out = String(r.stdout || '');
      const at = out.lastIndexOf('\n');
      const status = Number(out.slice(at + 1)) || 0;
      if (!status) throw new Error(lib.cliError(String(r.stderr || 'curl did not answer')));
      let data: any = null;
      try { data = JSON.parse(at >= 0 ? out.slice(0, at) : out); } catch (_) { data = null; }
      if (status === 401 || status === 403) throw new Error(`Vikunja refused the token (${status}): connect again with the site's tool (--connect <login>)`);
      if (status < 200 || status >= 300 || !data) throw new Error(`Vikunja answered ${status}${saidOf(data) ? `: ${saidOf(data)}` : ''}`);
      if (data.error) throw new Error(`Vikunja refused ${method}: ${saidOf(data) || 'no reason given'}`);
      return data.result;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  async function write(method: string, params: Record<string, unknown>, url: string): Promise<WriteResult & { result?: any }> {
    try {
      const result = await rpc(method, params);
      return result === false ? { ok: false, error: `Vikunja did not take it (${method} answered false)` } : { ok: true, error: '', url, result };
    } catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
  }

  // What is kept for five minutes: the token's own account, a project, its team, statuses and sprints.
  const kept = new Map<string, { at: number; value: unknown }>();
  async function keep<T>(what: string, make: () => Promise<T>): Promise<T> {
    const key = `${asker()}:${what}`;
    const hit = kept.get(key);
    if (hit && Date.now() - hit.at < KEEP_MS) return hit.value as T;
    const value = await make();
    kept.set(key, { at: Date.now(), value });
    return value;
  }

  const me = () => keep('me', async () => { const u = await rpc('Users.Users.getUser', {}); return { id: String(u && u.id || ''), name: nameOf(u) }; });
  async function projectOf(scope: TrackerScope): Promise<{ id: string; name: string }> {
    return keep(`project:${scope.id}`, async () => {
      const mine = await rpc('Projects.Projects.getProjectsAssignedToUser', { userId: Number((await me()).id) });
      const found = (Array.isArray(mine) ? mine : []).find((p: any) => p && String(p.name) === scope.id);
      if (!found) throw new Error(`no project "${scope.id}" among the projects of the account the token is of`);
      return { id: String(found.id), name: String(found.name) };
    });
  }
  async function membersOf(scope: TrackerScope): Promise<Map<string, Member>> {
    const project = await projectOf(scope);
    return keep(`members:${scope.id}`, async () => {
      const rows = await rpc('Projects.Projects.getUsersAssignedToProject', { projectId: Number(project.id) });
      return new Map((Array.isArray(rows) ? rows : []).filter((u: any) => u && u.id).map((u: any) => [String(u.id), {
        name: nameOf(u), email: String(u.username || ''), first: String(u.firstname || ''),
        // The project's own role, else the person's role on the site.
        role: Number(u.projectRole || u.role || 0), active: String(u.status || 'a').toLowerCase() === 'a',
      } as Member]));
    });
  }
  const statusesOf = (scope: TrackerScope) => keep(`statuses:${scope.id}`, async () => {
    const project = await projectOf(scope);
    const labels = await rpc('Tickets.Tickets.getStatusLabels', { projectId: Number(project.id) });
    // In Vikunja's own order (its sortKey), as its board shows the columns.
    return new Map(Object.entries(labels && typeof labels === 'object' ? labels : {})
      .sort(([, a]: [string, any], [, b]: [string, any]) => Number(a && a.sortKey || 0) - Number(b && b.sortKey || 0))
      .map(([k, v]: [string, any]) => [k, { name: String(v && v.name || k), type: String(v && v.statusType || '') }]));
  });
  const sprintsOf = (scope: TrackerScope) => keep(`sprints:${scope.id}`, async () => {
    const project = await projectOf(scope);
    const rows = await rpc('Sprints.Sprints.getAllSprints', { projectId: Number(project.id) });
    return Array.isArray(rows) ? rows : [];
  });
  async function personOf(scope: TrackerScope, uid: unknown, fallback = ''): Promise<Person> {
    const id = String(uid || '');
    const members = await membersOf(scope);
    const m = id ? members.get(id) : undefined;
    if (!id) return { name: fallback || 'unknown', association: 'unknown' };
    return { name: m ? m.name : (fallback || `#${id}`), association: m && m.active ? roleAssociation(m.role) : 'outside' };
  }

  /**
   * Someone of the project by what the person typed: "me", the whole name, the first name or the address. Their id.
   * Tasks go to an Editor or above: a Commenter or a Read Only person may change no task.
   */
  async function memberBy(scope: TrackerScope, who: string, toAssign: boolean): Promise<string> {
    const w = who.trim().toLowerCase();
    if (w === 'me') return (await me()).id;
    const list = [...(await membersOf(scope)).entries()].filter(([, m]) => m.active);
    const found = list.find(([id]) => id === w.replace(/^#/, ''))
      || list.find(([, m]) => m.email.toLowerCase() === w)
      || list.find(([, m]) => m.name.toLowerCase() === w)
      || list.find(([, m]) => m.first.toLowerCase() === w);
    if (!found) throw new Error(`${who} is not in the project's team`);
    if (toAssign && found[1].role < 20) throw new Error(`${who} is a Commenter or Read Only in the project: Vikunja gives tasks to its Editors and above`);
    return found[0];
  }

  /** The task behind an id of the scope (its project checked), as the API gives it. */
  async function taskIn(scope: TrackerScope, id: string): Promise<any> {
    const m = ITEM_RE.exec(String(id || '').trim());
    if (!m) throw new Error(`not a task: ${id}`);
    const project = await projectOf(scope);
    const t = await rpc('Tickets.Tickets.getTicket', { id: Number(m[1]) });
    if (!t || typeof t !== 'object' || String(t.projectId) !== project.id || t.type === 'milestone') throw new Error(`#${m[1]} is not a task of ${scope.id}`);
    return t;
  }
  const taskUrl = (id: string) => `${base()}/tickets/showAll#/tickets/showTicket/${String(id).replace(/^#/, '')}`;
  const failed = (e: unknown): WriteResult => ({ ok: false, error: String((e as Error).message || e) });
  async function listOf(scope: TrackerScope, criteria: Record<string, unknown>, keepIt: (t: any) => boolean, limit: number): Promise<TrackerItem[]> {
    const project = await projectOf(scope);
    const [statuses, members, sprints] = [await statusesOf(scope), await membersOf(scope), await sprintsOf(scope)];
    const people = new Map([...members.entries()].map(([id, m]) => [id, m.name] as [string, string]));
    const sprintNames = new Map(sprints.map((s: any) => [String(s.id), String(s.name || '')] as [string, string]));
    const rows = await rpc('Tickets.Tickets.getAll', { searchCriteria: { currentProject: Number(project.id), excludeType: 'milestone', ...criteria }, limit: MAX_TASKS });
    const open = (t: any) => stateClassOf((statuses.get(String(t.status)) || { type: '' }).type) !== 'done';
    return (Array.isArray(rows) ? rows : []).filter((t: any) => t && t.id && t.type !== 'milestone' && open(t) && keepIt(t))
      .sort((a: any, b: any) => String(b.modified || '').localeCompare(String(a.modified || '')))
      .slice(0, limit)
      .map((t: any) => itemOf(t, base(), statuses, people, sprintNames));
  }

  return {
    id: api.name,
    title: 'Vikunja',
    label: 'VIKUNJA',
    noun: { one: 'task', many: 'tasks' },
    capabilities: {
      views: ['open', 'mine', 'assigned', 'iteration', 'query'],
      iterationWord: 'sprint',
      comment: true, worklog: true, transition: true, labels: true, assign: true, create: true,
      request: 'none',
    },
    idPattern: ITEM_RE,
    tokenVariables: ['VIKUNJA_TOKEN', 'VIKUNJA_API_KEY'],
    secret: () => token(),
    tokenShapes: [['a Vikunja API key', KEY_RE]],
    ready: () => (!base() ? `no Vikunja address in ${api.settings.file} (url)` : !token() ? `no token in ${api.settings.file} (token)` : ''),
    // A workspace project has no Vikunja project of its own: it remembers one, or the default is used.
    scopeOf: () => null,
    parseScope: (text) => {
      const t = String(text || '').trim();
      return NAME_RE.test(t) && base() ? { id: t, name: t, web: `${base()}/projects/showMy` } : null;
    },
    urlOf: (_scope, id) => taskUrl(id),
    account: async () => { try { return (await me()).name; } catch (_) { return ''; } },
    // The projects the token's account is a member of.
    scopes: async () => {
      const mine = await rpc('Projects.Projects.getProjectsAssignedToUser', { userId: Number((await me()).id) });
      return (Array.isArray(mine) ? mine : []).filter((p: any) => p && p.name && NAME_RE.test(String(p.name)))
        .map((p: any) => ({ id: String(p.name), name: String(p.name), web: `${base()}/projects/changeCurrentProject/${p.id}` }));
    },

    list: async (scope, q) => {
      const limit = Math.max(1, Math.min(q.limit, 100));
      if (q.view === 'mine') return listOf(scope, { users: (await me()).id }, () => true, limit);
      if (q.view === 'assigned') {
        if (!q.who) return [];
        const uid = await memberBy(scope, q.who, false);
        return listOf(scope, { users: uid }, (t) => String(t.editorId || '') === uid, limit);
      }
      if (q.view === 'iteration') {
        const sprint = currentSprint(await sprintsOf(scope));
        if (!sprint) return [];
        return listOf(scope, { sprint: sprint.id }, (t) => String(t.sprint || '') === sprint.id, limit);
      }
      if (q.view === 'query') {
        const words = String(q.text || '').trim().toLowerCase();
        return listOf(scope, {}, (t) => String(t.headline || '').toLowerCase().includes(words), limit);
      }
      return listOf(scope, {}, () => true, limit);
    },

    get: async (scope, id) => {
      const t = await taskIn(scope, id);
      const [statuses, members, sprints] = [await statusesOf(scope), await membersOf(scope), await sprintsOf(scope)];
      const people = new Map([...members.entries()].map(([uid, m]) => [uid, m.name] as [string, string]));
      const sprintNames = new Map(sprints.map((s: any) => [String(s.id), String(s.name || '')] as [string, string]));
      const author = await personOf(scope, t.userId, [t.userFirstname, t.userLastname].filter(Boolean).join(' '));
      // The last editor: the person of the newest change of the title or the description, when not the creator.
      const history = await rpc('Tickets.TicketHistory.getTicketHistory', { ticketId: Number(t.id) });
      const edit = (Array.isArray(history) ? history : []).find((h: any) => h && (h.field === 'headline' || h.isDescriptionChange === true || h.field === 'description'));
      const lastEditor = edit && String(edit.userId) !== String(t.userId) ? await personOf(scope, edit.userId, String(edit.userName || '')) : undefined;
      const comments = [];
      const rows = await rpc('Comments.Comments.getComments', { module: 'ticket', entityId: Number(t.id) });
      for (const c of (Array.isArray(rows) ? rows : []).slice().sort((a: any, b: any) => String(a.date || '').localeCompare(String(b.date || '')))) {
        const body = textOf(String(c.text || ''));
        if (body) comments.push({ author: await personOf(scope, c.userId, [c.firstname, c.lastname].filter(Boolean).join(' ')), body, at: String(c.date || '').replace(' ', 'T') });
      }
      const full: TrackerItemFull = { ...itemOf(t, base(), statuses, people, sprintNames), body: textOf(String(t.description || '')), author, ...(lastEditor ? { lastEditor } : {}), comments };
      return full;
    },

    comment: async (scope, id, markdown) => {
      try {
        const t = await taskIn(scope, id);
        return await write('Comments.Comments.addComment', { values: { text: htmlOf(markdown), father: 0 }, module: 'ticket', entityId: Number(t.id) }, taskUrl(String(t.id)));
      } catch (e) { return failed(e); }
    },
    worklog: async (scope, id, entry) => {
      try {
        const t = await taskIn(scope, id);
        const minutes = Math.round(Number(entry.minutes));
        if (!(minutes > 0 && minutes <= 24 * 60)) return { ok: false, error: 'the time is a number of minutes, more than none and at most a day' };
        return await write('Timesheets.Timesheets.logTime', {
          ticketId: Number(t.id),
          params: { hours: Math.round((minutes / 60) * 100) / 100, timestamp: Math.floor(Date.now() / 1000), kind: 'GENERAL_BILLABLE', description: String(entry.text || '').slice(0, 2000) },
        }, `${taskUrl(String(t.id))}`);
      } catch (e) { return failed(e); }
    },
    transitions: async (scope, id) => {
      const t = await taskIn(scope, id);
      return [...(await statusesOf(scope)).entries()].filter(([k]) => k !== String(t.status)).map(([k, s]) => ({ id: k, name: s.name }));
    },
    transition: async (scope, id, to) => {
      try {
        const t = await taskIn(scope, id);
        if (!(await statusesOf(scope)).has(String(to))) return { ok: false, error: `not a status of ${scope.id}: ${to}` };
        return await write('Tickets.Tickets.patchTicket', { id: Number(t.id), values: { status: Number(to) } }, taskUrl(String(t.id)));
      } catch (e) { return failed(e); }
    },
    labels: async (scope, id, add, remove) => {
      try {
        const t = await taskIn(scope, id);
        const now = String(t.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
        const gone = new Set(remove.map((r) => r.trim().toLowerCase()));
        const tags = [...now.filter((x) => !gone.has(x.toLowerCase())), ...add.map((a) => a.trim()).filter((a) => a && !now.some((x) => x.toLowerCase() === a.toLowerCase()))];
        if (tags.some((x) => x.includes(','))) return { ok: false, error: 'a tag holds no comma in Vikunja' };
        return await write('Tickets.Tickets.patchTicket', { id: Number(t.id), values: { tags: tags.join(',') } }, taskUrl(String(t.id)));
      } catch (e) { return failed(e); }
    },
    assign: async (scope, id, who) => {
      try {
        const t = await taskIn(scope, id);
        const uid = await memberBy(scope, who, true);
        return await write('Tickets.Tickets.patchTicket', { id: Number(t.id), values: { editorId: Number(uid) } }, taskUrl(String(t.id)));
      } catch (e) { return failed(e); }
    },
    create: async (scope, item) => {
      try {
        const project = await projectOf(scope);
        const r = await write('Tickets.Tickets.addTicket', { values: { headline: item.title, description: htmlOf(item.body), projectId: Number(project.id), type: 'task', status: 3 } }, '');
        if (!r.ok) return r;
        const made = Array.isArray(r.result) ? r.result[0] : r.result;
        const tid = Number(made) > 0 ? String(made) : '';
        return tid ? { ok: true, error: '', url: taskUrl(tid), id: tid } : { ok: false, error: 'Vikunja made no task (addTicket answered no number)' };
      } catch (e) { return failed(e); }
    },
  };
}
