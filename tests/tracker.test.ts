import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { htmlOf, ITEM_RE, keyOf, nameOf, permissionAssociation, saidOf, textOf, TOKEN_RE, vikunjaTracker } from '../src/lib/tracker';

// Recorded from a Vikunja 2.8.0 site the plugin's builder made (--install --add-users --sample-content), read as the
// account member (tools/vk-record-fixtures.py in the trackers round), the site's address made https://vikunja.test.
// WEB-1 and WEB-2 are the sample tasks; Webship site (project 6) is owned by owner and shared with member (read &
// write) and reader (read only); stranger has no share. Its board (view 24) has the buckets To-Do, Doing and Done.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const FIX = path.join(PKG, 'tests', 'fixtures', 'tracker');
const fixture = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, `${f}.json`), 'utf8'));
const made: string[] = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const TOKEN = `tk_${'a1b2c3d4e5'.repeat(4)}`;
const SETTINGS = { url: 'https://vikunja.test', token: TOKEN, default_scope: 'Webship site' };
const SCOPE = { id: 'Webship site', name: 'Webship site', web: 'https://vikunja.test/projects' };

/** What a curl call asked: its method, its route under /api/v1, its body and its headers file. */
function readCurl(args: string[]) {
  const headerFile = args.find((a) => a.startsWith('@') && a.endsWith('/headers'));
  const bodyFile = args.find((a) => a.startsWith('@') && a.endsWith('/body.json'));
  const url = new URL(args[args.length - 1]);
  return {
    args, url: args[args.length - 1], method: args[args.indexOf('-X') + 1], route: url.pathname.replace(/^\/api\/v1/, ''), query: url.searchParams,
    body: bodyFile ? JSON.parse(fs.readFileSync(bodyFile.slice(1), 'utf8')) : undefined, headers: headerFile ? fs.readFileSync(headerFile.slice(1), 'utf8') : '',
  };
}

/** The answer the recorded site gives to a call: [status, body]. The task list filters as Vikunja's own does. */
function recorded(c: ReturnType<typeof readCurl>): [number, unknown] {
  const r = `${c.method} ${c.route}`;
  if (r === 'GET /user') return [200, fixture('user-me')];
  if (r === 'GET /projects') return [200, fixture('projects')];
  if (r === 'GET /projects/6/users') return [200, fixture('project-users')];
  if (r === 'GET /projects/6/teams') return [200, fixture('project-teams')];
  if (r === 'GET /projects/6/views') return [200, fixture('views')];
  if (r === 'GET /projects/6/views/24/buckets') return [200, fixture('buckets')];
  if (r === 'GET /projects/6/views/24/tasks') return [200, fixture('board')];
  if (r === 'GET /tasks') {
    const filter = String(c.query.get('filter') || '');
    const who = (/assignees in (\S+)/.exec(filter) || [])[1];
    const text = String(c.query.get('s') || '').toLowerCase();
    return [200, (fixture('tasks-all') as any[]).filter((t) => (!/done = false/.test(filter) || !t.done)
      && (!who || (t.assignees || []).some((a: any) => a.username === who)) && (!text || String(t.title).toLowerCase().includes(text)))];
  }
  const byIndex = /^GET \/projects\/6\/tasks\/by-index\/(\d+)$/.exec(r);
  if (byIndex) return fs.existsSync(path.join(FIX, `task-${byIndex[1]}.json`)) ? [200, fixture(`task-${byIndex[1]}`)] : [404, { code: 2001, message: 'This task does not exist' }];
  const comments = /^GET \/tasks\/(\d+)\/comments$/.exec(r);
  if (comments) return [200, fixture(`comments-${comments[1]}`)];
  if (r === 'GET /labels') return [200, fixture('labels')];
  if (c.method === 'PUT' && r === 'PUT /projects/6/tasks') return [201, { id: 9, index: 3, identifier: 'WEB-3', project_id: 6, title: c.body.title }];
  if (['PUT', 'POST', 'DELETE'].includes(c.method)) return [200, { ok: true }];
  return [404, { message: `no recording of ${r}` }];
}

/** A provider over the recordings, with what each call asked. */
function provider(settings: Record<string, unknown> = SETTINGS, answer = recorded) {
  const calls: ReturnType<typeof readCurl>[] = [];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vikunja-tracker-'));
  made.push(home);
  const api: any = {
    name: 'vikunja',
    settings: { read: () => settings, file: 'core/config/plugin.vikunja.settings.yml' },
    lib: {
      run: async (cmd: string, args: string[]) => {
        assert.strictEqual(cmd, 'curl');
        const c = readCurl(args);
        calls.push(c);
        const [status, body] = answer(c);
        return { ok: true, code: 0, stdout: `${JSON.stringify(body)}\n${status}`, stderr: '' };
      },
      cliError: (s: string) => s,
    },
  };
  return { p: vikunjaTracker(api), calls };
}

test('permissions, names and keys, as Vikunja gives them', () => {
  assert.deepStrictEqual([2, 1, 0, '2', '', null].map(permissionAssociation), ['owner', 'member', 'outside', 'owner', 'outside', 'outside']);
  assert.strictEqual(nameOf({ name: 'Member Test', username: 'member' }), 'Member Test');
  assert.strictEqual(nameOf({ name: '', username: 'member' }), 'member');
  assert.strictEqual(keyOf({ identifier: 'WEB-1', index: 1 }), 'WEB-1');
  assert.strictEqual(keyOf({ identifier: '', index: 4 }), '#4', 'a project with no key');
  for (const id of ['WEB-12', 'web-12', '#12', '12']) assert.strictEqual(ITEM_RE.exec(id)?.[2], '12', id);
  for (const id of ['0', 'WEB-0', 'WEB12', '-12', 'W E B-1']) assert.strictEqual(ITEM_RE.test(id), false, id);
  assert.ok(TOKEN_RE.test(TOKEN), 'a Vikunja API token');
  assert.strictEqual(TOKEN_RE.test('0123456789abcdef0123456789abcdef01234567'), false, 'a commit is no token');
});

test('what Vikunja says went wrong, and its HTML both ways', () => {
  assert.strictEqual(saidOf({ code: 2001, message: 'This task does not exist' }), 'This task does not exist');
  assert.strictEqual(saidOf(null), '');
  assert.strictEqual(htmlOf('Fixed in `greeting.sh`: <script>alert(1)</script>'), '<p>Fixed in <code>greeting.sh</code>: &lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.strictEqual(textOf('<p><code>greeting.sh</code> prints <em>Helo</em>.</p>'), '`greeting.sh` prints Helo.');
});

test('the provider: ready, its scope, its capabilities and the address of a task', async () => {
  const { p } = provider();
  assert.strictEqual(p.ready(), '');
  assert.match(provider({ token: TOKEN }).p.ready(), /no Vikunja address/);
  assert.match(provider({ url: 'https://vikunja.test', token: 'CHANGE_ME' }).p.ready(), /no token/);
  assert.deepStrictEqual(p.parseScope('Webship site'), SCOPE);
  assert.strictEqual(p.parseScope('bad\u0007name'), null);
  assert.deepStrictEqual(p.capabilities, { views: ['open', 'mine', 'assigned', 'query'], comment: true, worklog: false, transition: true, labels: true, assign: true, create: true, request: 'none' });
  assert.strictEqual(p.urlOf(SCOPE, 'WEB-1'), SCOPE.web, 'a task not read yet: the projects');
  await p.get(SCOPE, 'WEB-1');
  assert.strictEqual(p.urlOf(SCOPE, 'WEB-1'), 'https://vikunja.test/tasks/1', 'once read, its own page');
  assert.deepStrictEqual((await p.scopes()).map((s) => s.id), ['Inbox', 'Webship site']);
});

test('the views: open, mine, assigned and a search; each task\'s state is its bucket on the board', async () => {
  const { p, calls } = provider();
  const open = await p.list(SCOPE, { view: 'open', limit: 20 });
  assert.deepStrictEqual(open.map((i) => `${i.id} ${i.state} ${i.stateClass}`), ['WEB-1 Doing doing', 'WEB-2 To-Do open']);
  const greeting = open[0];
  assert.deepStrictEqual({ ...greeting, updated: undefined }, {
    id: 'WEB-1', title: 'The greeting script says Helo instead of Hello', url: 'https://vikunja.test/tasks/1',
    state: 'Doing', stateClass: 'doing', assignees: ['Member Test'], labels: ['bug'], column: 'Doing', updated: undefined,
  });
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'mine', limit: 20 })).map((i) => i.id), ['WEB-1'], 'member has the greeting');
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'assigned', who: 'Member Test', limit: 20 })).map((i) => i.id), ['WEB-1']);
  assert.deepStrictEqual(await p.list(SCOPE, { view: 'assigned', limit: 20 }), []);
  await assert.rejects(p.list(SCOPE, { view: 'assigned', who: 'nobody', limit: 20 }), /not someone the project is shared with/);
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'query', text: 'greting', limit: 20 })).map((i) => i.id), ['WEB-2']);
  const lists = calls.filter((c) => c.route === '/tasks');
  assert.ok(lists.every((c) => /^project = 6 && done = false/.test(String(c.query.get('filter')))), 'the project, open tasks');
  assert.ok(lists.some((c) => /assignees in member$/.test(String(c.query.get('filter')))), 'mine is the token\'s account');
  // The token travels in a header file, never on curl's command line.
  assert.ok(calls.every((c) => c.headers.includes(`Authorization: Bearer ${TOKEN}`) && !c.args.join(' ').includes(TOKEN)));
  assert.ok(calls.every((c) => c.url.startsWith('https://vikunja.test/api/v1/')));
});

test('one task: its author and each comment\'s author by what the project gives them; the creator is the last editor', async () => {
  const { p } = provider();
  const greeting = await p.get(SCOPE, 'WEB-1');
  assert.deepStrictEqual(greeting.author, { name: 'Owner Test', association: 'owner' }, 'the project\'s owner');
  assert.strictEqual(greeting.lastEditor, undefined, 'Vikunja keeps no history of a task');
  assert.strictEqual(greeting.body, '`greeting.sh` prints Helo where it should print Hello.');
  assert.deepStrictEqual(greeting.comments.map((c) => [c.author, c.body]), [[{ name: 'Owner Test', association: 'owner' }, 'Seen on the test site: the greeting prints Helo.']]);
  const usage = await p.get(SCOPE, '#2');
  assert.deepStrictEqual(usage.author, { name: 'Member Test', association: 'member' }, 'read & write');
  // Someone whose share is read only now, or who has none, is outside; a team's share counts for its members.
  const shares = (c: ReturnType<typeof readCurl>): [number, unknown] => {
    if (c.route === '/projects/6/users') return [200, (fixture('project-users') as any[]).map((u) => (u.username === 'member' ? { ...u, permission: 0 } : u))];
    if (c.route === '/projects/6/teams') return [200, [{ id: 5, name: 'Writers', permission: 1 }]];
    if (c.route === '/teams/5') return [200, { id: 5, members: [{ id: 5, username: 'stranger', name: 'Stranger Test' }] }];
    return recorded(c);
  };
  const p2 = provider(SETTINGS, shares).p;
  assert.deepStrictEqual((await p2.get(SCOPE, 'WEB-2')).author, { name: 'Member Test', association: 'outside' }, 'read only is outside');
  assert.deepStrictEqual(await (p2 as any).list(SCOPE, { view: 'assigned', who: 'Stranger Test', limit: 5 }), [], 'a team\'s member is someone the project is shared with');
  await assert.rejects(p.get(SCOPE, 'WEB-9'), /404: This task does not exist/);
  await assert.rejects(p.get(SCOPE, 'ABC-1'), /ABC-1 is not a task of Webship site \(WEB\)/);
  await assert.rejects(p.get(SCOPE, 'WEB1'), /not a task: WEB1/);
});

test('the writes: a comment, a move on the board, labels, an assignee and a new task, through the API as the person', async () => {
  const { p, calls } = provider();
  const last = (m: string, re: RegExp) => calls.filter((c) => c.method === m && re.test(c.route)).pop()!;
  assert.deepStrictEqual(await p.comment!(SCOPE, 'WEB-1', 'Fixed in `greeting.sh` <b>now</b>'), { ok: true, error: '', url: 'https://vikunja.test/tasks/1', result: { ok: true } });
  assert.deepStrictEqual(last('PUT', /^\/tasks\/1\/comments$/).body, { comment: '<p>Fixed in <code>greeting.sh</code> &lt;b&gt;now&lt;/b&gt;</p>' });
  assert.deepStrictEqual((await p.transitions!(SCOPE, 'WEB-1')).map((t) => `${t.id}=${t.name}`), ['16=To-Do', '18=Done'], 'the board\'s buckets, without the one it is in');
  assert.strictEqual((await p.transition!(SCOPE, 'WEB-1', '18')).ok, true);
  assert.deepStrictEqual(last('POST', /buckets/).route, '/projects/6/views/24/buckets/18/tasks');
  assert.deepStrictEqual(last('POST', /buckets/).body, { task_id: 1 });
  assert.match((await p.transition!(SCOPE, 'WEB-1', '99')).error, /not a bucket of the board of Webship site: 99/);
  assert.strictEqual((await p.labels!(SCOPE, 'WEB-2', ['BUG'], [])).ok, true);
  assert.deepStrictEqual(last('PUT', /labels$/).body, { label_id: 1 }, 'a label the account can use, whatever its case');
  assert.strictEqual((await p.labels!(SCOPE, 'WEB-1', [], ['bug'])).ok, true);
  assert.strictEqual(last('DELETE', /labels/).route, '/tasks/1/labels/1');
  assert.match((await p.labels!(SCOPE, 'WEB-1', ['docs'], [])).error, /no label docs the account can use/);
  assert.strictEqual((await p.assign!(SCOPE, 'WEB-2', 'me')).ok, true);
  assert.deepStrictEqual(last('PUT', /assignees$/).body, { user_id: 3 });
  assert.strictEqual((await p.assign!(SCOPE, 'WEB-2', 'Owner Test')).ok, true, 'the project\'s owner');
  assert.match((await p.assign!(SCOPE, 'WEB-2', 'reader')).error, /may only read the project/);
  assert.match((await p.assign!(SCOPE, 'WEB-2', 'stranger')).error, /not someone the project is shared with/);
  assert.deepStrictEqual(await p.create!(SCOPE, { title: 'Webship test new', body: 'A **new** one' }), { ok: true, error: '', url: 'https://vikunja.test/tasks/9', id: 'WEB-3' });
  assert.deepStrictEqual(last('PUT', /^\/projects\/6\/tasks$/).body, { title: 'Webship test new', description: '<p>A <strong>new</strong> one</p>' });
  assert.strictEqual(p.worklog, undefined, 'no worklog: Vikunja\'s time tracking is a feature of its paid licence');
  // A refusal of Vikunja's is said as it gave it.
  const refused = provider(SETTINGS, (c) => (c.method === 'PUT' && /comments$/.test(c.route) ? [403, { code: 1003, message: 'Forbidden' }] : recorded(c))).p;
  assert.match((await refused.comment!(SCOPE, 'WEB-1', 'x')).error, /refused it \(403\): Forbidden/);
  const expired = provider(SETTINGS, () => [401, { message: 'missing, malformed, expired or otherwise invalid token provided' }]).p;
  await assert.rejects(expired.list(SCOPE, { view: 'open', limit: 5 }), /refused the token \(401\): connect again/);
});
