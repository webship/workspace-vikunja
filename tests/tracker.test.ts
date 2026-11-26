import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { currentSprint, htmlOf, ITEM_RE, KEY_RE, vikunjaTracker, nameOf, roleAssociation, saidOf, stateClassOf, textOf } from '../src/lib/tracker';

// Recorded from a Vikunja 3.17.0 site the plugin's builder made (--install --add-users --sample-content), read as the
// account member through its bearer token (tools/lt-record-fixtures.py in the trackers round), the site's address
// left out. #1 and #2 are the sample tasks; #3 "Webship test explore" was made by member, renamed and described again
// by owner, and commented on by commenter, then tidied away. owner is a Company Manager of the project, member an
// Editor, commenter a Commenter, reader Read Only; stranger is not in the project's team.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const FIX = path.join(PKG, 'tests', 'fixtures', 'tracker');
const result = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')).result;
const made: string[] = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const TOKEN = 'Abc123def456Ghi789jkl012Mno345pqr678Stu9';
const SETTINGS = { url: 'https://vikunja.test', token: TOKEN, default_scope: 'Webship site' };
const SCOPE = { id: 'Webship site', name: 'Webship site', web: 'https://vikunja.test/projects/showMy' };
const day = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

/** What a curl call asked: the JSON-RPC method and params from its body file, and its headers file. */
function readCurl(args: string[]) {
  const headerFile = args.find((a) => a.startsWith('@') && a.endsWith('/headers'));
  const bodyFile = args.find((a) => a.startsWith('@') && a.endsWith('/body.json'));
  const body = bodyFile ? JSON.parse(fs.readFileSync(bodyFile.slice(1), 'utf8')) : {};
  return { args, url: args[args.length - 1], headers: headerFile ? fs.readFileSync(headerFile.slice(1), 'utf8') : '', method: String(body.method || '').replace(/^vikunja\.rpc\./, ''), params: body.params || {} };
}

/** The answer the recorded site gives to a call; the list filters as Vikunja's own does, by its criteria. */
function recorded(c: ReturnType<typeof readCurl>): unknown {
  const p = c.params;
  switch (c.method) {
    case 'Users.Users.getUser': return result('user-me.json');
    case 'Projects.Projects.getProjectsAssignedToUser': return result('projects-of-me.json');
    case 'Projects.Projects.getUsersAssignedToProject': return result('team.json');
    case 'Tickets.Tickets.getStatusLabels': return result('status-labels.json');
    // The sprint holds today, whenever the test runs.
    case 'Sprints.Sprints.getAllSprints': return result('sprints.json').map((s: any) => ({ ...s, startDate: `${day(-3)} 00:00:00`, endDate: `${day(10)} 23:59:59` }));
    case 'Tickets.Tickets.getAll': {
      const sc = p.searchCriteria || {};
      return result('tasks.json').filter((t: any) => String(t.projectId) === String(sc.currentProject)
        && (!sc.users || String(sc.users).split(',').includes(String(t.editorId)))
        && (!sc.sprint || String(sc.sprint).split(',').includes(String(t.sprint))));
    }
    case 'Tickets.Tickets.getTicket': return fs.existsSync(path.join(FIX, `task-${p.id}.json`)) ? result(`task-${p.id}.json`) : false;
    case 'Tickets.TicketHistory.getTicketHistory': return result(`history-${p.ticketId}.json`);
    case 'Comments.Comments.getComments': return result(`comments-${p.entityId}.json`);
    case 'Comments.Comments.addComment': case 'Tickets.Tickets.patchTicket': case 'Timesheets.Timesheets.logTime': return true;
    case 'Tickets.Tickets.addTicket': return 4;
    default: return { error: `no recording of ${c.method}` };
  }
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
        const a: any = answer(c);
        const body = a && typeof a === 'object' && !Array.isArray(a) && 'error' in a && Object.keys(a).length === 1
          ? { jsonrpc: '2.0', error: { code: -32601, message: a.error }, id: 1 } : { jsonrpc: '2.0', result: a, id: 1 };
        return { ok: true, code: 0, stdout: `${JSON.stringify(body)}\n200`, stderr: '' };
      },
      cliError: (s: string) => s,
    },
  };
  return { p: vikunjaTracker(api), calls };
}

test('roles, statuses and names, as Vikunja gives them', () => {
  assert.deepStrictEqual([50, 40, 30, 20, 10, 5, 0, '30', ''].map(roleAssociation), ['owner', 'owner', 'owner', 'member', 'outside', 'outside', 'outside', 'owner', 'outside']);
  assert.deepStrictEqual(['NEW', 'INPROGRESS', 'DONE', '', 'done'].map(stateClassOf), ['open', 'doing', 'done', undefined, 'done']);
  assert.strictEqual(nameOf({ firstname: 'Member', lastname: 'Test', username: 'member@example.com' }), 'Member Test');
  assert.strictEqual(nameOf({ username: 'someone@example.com' }), 'someone@example.com');
  assert.strictEqual(nameOf(null), 'unknown');
  assert.deepStrictEqual(ITEM_RE.exec('#12')?.[1], '12');
  assert.deepStrictEqual(ITEM_RE.exec('12')?.[1], '12');
  assert.strictEqual(ITEM_RE.test('WEB-12'), false);
  assert.strictEqual(ITEM_RE.test('0'), false);
});

test('the current sprint: the one whose dates hold today, the first to end of several', () => {
  const now = new Date('2026-11-26T12:00:00Z');
  const list = [
    { id: 1, name: 'Past', startDate: '2026-11-01 00:00:00', endDate: '2026-11-14 23:59:59' },
    { id: 2, name: 'Long', startDate: '2026-11-20 00:00:00', endDate: '2026-12-20 23:59:59' },
    { id: 3, name: 'Short', startDate: '2026-11-23 00:00:00', endDate: '2026-12-06 23:59:59' },
  ];
  assert.deepStrictEqual(currentSprint(list, now), { id: '3', name: 'Short' });
  assert.strictEqual(currentSprint([list[0]], now), null);
  assert.strictEqual(currentSprint(null as any, now), null);
});

test('what Vikunja says went wrong, in one line', () => {
  assert.strictEqual(saidOf({ error: { code: -32001, message: 'Permission denied', data: 'tickets.create' } }), 'Permission denied: tickets.create');
  assert.strictEqual(saidOf({ result: true }), '');
  assert.strictEqual(saidOf(null), '');
});

test('Markdown becomes the escaped HTML Vikunja keeps, and its HTML the text a snapshot reads', () => {
  assert.strictEqual(htmlOf('Fixed in `greeting.sh`: <script>alert(1)</script> & "quotes"'), '<p>Fixed in <code>greeting.sh</code>: &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;</p>');
  assert.strictEqual(htmlOf('- [x] read\n- [ ] fix'), '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>read</p></li><li data-type="taskItem" data-checked="false"><p>fix</p></li></ul>');
  assert.strictEqual(textOf('<p><code>greeting.sh</code> prints <em>Helo</em>.</p><!-- kept -->'), '`greeting.sh` prints Helo.\n\n<!-- kept -->', 'a comment of the page stays, as data');
});

test('the provider: ready, its scope and the address of a task', () => {
  const { p } = provider();
  assert.strictEqual(p.ready(), '');
  assert.match(provider({ token: TOKEN }).p.ready(), /no Vikunja address/);
  assert.match(provider({ url: 'https://vikunja.test', token: 'CHANGE_ME' }).p.ready(), /no token/);
  assert.deepStrictEqual(p.parseScope('Webship site'), SCOPE);
  assert.strictEqual(p.parseScope('bad\u0007name'), null);
  assert.strictEqual(p.urlOf(SCOPE, '#3'), 'https://vikunja.test/tickets/showAll#/tickets/showTicket/3');
  assert.deepStrictEqual(p.capabilities, { views: ['open', 'mine', 'assigned', 'iteration', 'query'], iterationWord: 'sprint', comment: true, worklog: true, transition: true, labels: true, assign: true, create: true, request: 'none' });
  assert.ok(KEY_RE.test(`lt_member_${'a1B2'.repeat(8)}`), 'a Vikunja API key');
  assert.strictEqual(KEY_RE.test('0123456789abcdef0123456789abcdef01234567'), false, 'a commit is no key');
});

test('the views: open, mine, assigned, the current sprint and a search, newest change first', async () => {
  const { p, calls } = provider();
  const open = await p.list(SCOPE, { view: 'open', limit: 20 });
  assert.deepStrictEqual(open.map((i) => i.id), ['3', '2', '1']);
  const greeting = open.find((i) => i.id === '1')!;
  assert.deepStrictEqual({ ...greeting, updated: undefined }, {
    id: '1', title: 'The greeting script says Helo instead of Hello', url: 'https://vikunja.test/tickets/showAll#/tickets/showTicket/1',
    state: 'In Progress', stateClass: 'doing', type: 'task', assignees: ['Member Test'], labels: ['bug'], iteration: 'sprint Sprint 1', updated: undefined,
  });
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'mine', limit: 20 })).map((i) => i.id), ['1'], 'member has the greeting');
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'assigned', who: 'Member Test', limit: 20 })).map((i) => i.id), ['1']);
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'assigned', limit: 20 })), []);
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'iteration', limit: 20 })).map((i) => i.id), ['1']);
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'query', text: 'GRETING', limit: 20 })).map((i) => i.id), ['2']);
  const list = calls.filter((c) => c.method === 'Tickets.Tickets.getAll');
  assert.ok(list.every((c) => c.params.searchCriteria.currentProject === 2 && c.params.searchCriteria.excludeType === 'milestone'), 'the project, never a milestone');
  // The token travels in a header file, never on curl's command line.
  assert.ok(calls.every((c) => c.headers.includes(`Authorization: Bearer ${TOKEN}`) && !c.args.join(' ').includes(TOKEN)));
  assert.ok(calls.every((c) => c.url === 'https://vikunja.test/api/jsonrpc'));
});

test('one task: its author, its last editor from its history, and each comment\'s author by their role in the team', async () => {
  const { p } = provider();
  const explore = await p.get(SCOPE, '#3');
  assert.strictEqual(explore.title, 'Webship test explore, renamed');
  assert.strictEqual(explore.body, 'Edited by the owner.');
  assert.deepStrictEqual(explore.author, { name: 'Member Test', association: 'member' });
  assert.deepStrictEqual(explore.lastEditor, { name: 'Owner Test', association: 'owner' }, 'the newest change of the title or the description');
  assert.deepStrictEqual(explore.comments.map((c) => [c.author, c.body]), [[{ name: 'Commenter Test', association: 'outside' }, 'From outside: a word on it.']]);
  const greeting = await p.get(SCOPE, '1');
  assert.deepStrictEqual(greeting.author, { name: 'Owner Test', association: 'owner' });
  assert.strictEqual(greeting.lastEditor, undefined, 'no change of its title or description');
  assert.strictEqual(greeting.body, '`greeting.sh` prints Helo where it should print Hello.');
  const usage = await p.get(SCOPE, '2');
  assert.deepStrictEqual(usage.comments.map((c) => c.author.association), ['outside'], 'the commenter is from outside');
  await assert.rejects(p.get(SCOPE, '9'), /#9 is not a task of Webship site/);
  await assert.rejects(p.get(SCOPE, 'WEB-1'), /not a task: WEB-1/);
  // A task of another project, or a milestone, is not one of the scope's.
  const other = provider(SETTINGS, (c) => (c.method === 'Tickets.Tickets.getTicket' ? { ...result('task-1.json'), projectId: 1 } : recorded(c))).p;
  await assert.rejects(other.get(SCOPE, '1'), /#1 is not a task of Webship site/);
  const milestone = provider(SETTINGS, (c) => (c.method === 'Tickets.Tickets.getTicket' ? { ...result('task-1.json'), type: 'milestone' } : recorded(c))).p;
  await assert.rejects(milestone.get(SCOPE, '1'), /is not a task/);
});

test('the writes: a comment, a status, tags, an assignee, logged time and a new task, through the API as the person', async () => {
  const { p, calls } = provider();
  const said = (m: string) => calls.filter((c) => c.method === m).pop()!.params;
  assert.deepStrictEqual(await p.comment!(SCOPE, '1', 'Fixed in `greeting.sh` <b>now</b>'), { ok: true, error: '', url: 'https://vikunja.test/tickets/showAll#/tickets/showTicket/1', result: true });
  assert.deepStrictEqual(said('Comments.Comments.addComment'), { values: { text: '<p>Fixed in <code>greeting.sh</code> &lt;b&gt;now&lt;/b&gt;</p>', father: 0 }, module: 'ticket', entityId: 1 });
  assert.deepStrictEqual((await p.transitions!(SCOPE, '1')).map((t) => `${t.id}=${t.name}`), ['3=New', '1=Blocked', '2=Waiting for Approval', '0=Done', '-1=Archived'], 'in Vikunja\'s order, without the status it has');
  assert.strictEqual((await p.transition!(SCOPE, '1', '0')).ok, true);
  assert.deepStrictEqual(said('Tickets.Tickets.patchTicket'), { id: 1, values: { status: 0 } });
  assert.match((await p.transition!(SCOPE, '1', '7')).error, /not a status of Webship site: 7/);
  assert.strictEqual((await p.labels!(SCOPE, '1', ['docs'], ['BUG'])).ok, true);
  assert.deepStrictEqual(said('Tickets.Tickets.patchTicket'), { id: 1, values: { tags: 'docs' } }, 'bug removed whatever its case, docs added');
  assert.strictEqual((await p.labels!(SCOPE, '1', ['Bug', 'docs'], [])).ok, true);
  assert.deepStrictEqual(said('Tickets.Tickets.patchTicket'), { id: 1, values: { tags: 'bug,docs' } }, 'a tag it has is not added twice');
  assert.match((await p.labels!(SCOPE, '1', ['a,b'], [])).error, /no comma/);
  assert.strictEqual((await p.assign!(SCOPE, '2', 'owner@example.com')).ok, true);
  assert.deepStrictEqual(said('Tickets.Tickets.patchTicket'), { id: 2, values: { editorId: 2 } });
  assert.match((await p.assign!(SCOPE, '2', 'Commenter')).error, /Commenter or Read Only/);
  assert.match((await p.assign!(SCOPE, '2', 'stranger')).error, /not in the project's team/);
  assert.strictEqual((await p.worklog!(SCOPE, '1', { minutes: 90, text: 'Looked into it' })).ok, true);
  const logged = said('Timesheets.Timesheets.logTime');
  assert.deepStrictEqual({ ...logged, params: { ...logged.params, timestamp: 0 } }, { ticketId: 1, params: { hours: 1.5, timestamp: 0, kind: 'GENERAL_BILLABLE', description: 'Looked into it' } });
  assert.match((await p.worklog!(SCOPE, '1', { minutes: 0, text: '' })).error, /number of minutes/);
  assert.deepStrictEqual(await p.create!(SCOPE, { title: 'Webship test new', body: 'A **new** one' }), { ok: true, error: '', url: 'https://vikunja.test/tickets/showAll#/tickets/showTicket/4', id: '4' });
  assert.deepStrictEqual(said('Tickets.Tickets.addTicket'), { values: { headline: 'Webship test new', description: '<p>A <strong>new</strong> one</p>', projectId: 2, type: 'task', status: 3 } });
  // A refusal of Vikunja's is said as it gave it, nothing more is sent.
  const refused = provider(SETTINGS, (c) => (c.method === 'Comments.Comments.addComment' ? { error: 'You are not allowed to perform this action.' } : recorded(c))).p;
  assert.match((await refused.comment!(SCOPE, '1', 'x')).error, /Vikunja refused Comments\.Comments\.addComment: You are not allowed/);
});
