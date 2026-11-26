<?php
/*
 * The Vikunja site of a Webship Workspace project, run with PHP in the project's web container: Vikunja's own image
 * has no shell and no language of its own to run a script with, so this talks to Vikunja through its API
 * (http://vikunja:3456/api/v1) and reads its database (the project's db) for what the API does not count.
 *
 *     php vikunja/vikunja-site.php <verb>…
 *
 * Verbs, run in the order given:
 *   version   the release the site runs (VERSION <release>)
 *   accounts  the names of the default accounts on the input (Vikunja's own command makes the accounts)
 *   content   the sample project, its sharing and its sample tasks, made as their authors (their logins on the input)
 *   tidy      what a stopped test run left: tasks titled "Webship test …" made by the default accounts in the sample
 *             project, removed for good with what Vikunja keeps of them
 *   list      the accounts, and what the sample project holds
 *   token     a new API token of the account on the input (TOKEN <token>); its earlier one of the same title goes
 *   counts    what the sample project holds, one count a line
 *
 * What a verb reads (accounts, passwords, a login) comes on the input as JSON, never on a command line.
 */

const API = 'http://vikunja:3456/api/v1';
const SAMPLE_PROJECT = 'Webship site';
const SAMPLE_KEY = 'WEB';
const TEST_PREFIX = 'Webship test ';
const TEST_ACCOUNTS = ['owner', 'member', 'reader', 'stranger'];
const TOKEN_TITLE = 'webship-workspace';
// Vikunja's sharing permissions, by the names the builder gives them.
const PERMISSIONS = ['read' => 0, 'write' => 1, 'admin' => 2];

$verbs = array_slice($argv, 1);
$input = null;

function input(): array
{
    global $input;
    if ($input === null) {
        $raw = trim(stream_get_contents(STDIN));
        $input = $raw === '' ? [] : (json_decode(base64_decode($raw, true) ?: $raw, true) ?? []);
    }
    return $input;
}

function say(string $line): void
{
    fwrite(STDOUT, $line . "\n");
}

function fail(string $line): never
{
    fwrite(STDERR, $line . "\n");
    exit(1);
}

/** One call of Vikunja's API: [status, answer]. */
function api(string $method, string $path, ?array $body = null, ?string $token = null): array
{
    $ch = curl_init(API . $path);
    $headers = ['Accept: application/json'];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    if ($token) {
        $headers[] = 'Authorization: Bearer ' . $token;
    }
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 30]);
    $out = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return [$status, json_decode((string) $out, true)];
}

/** An account's session (its JWT), by its login and password. */
function login(string $login, string $password): string
{
    for ($attempt = 1; ; $attempt++) {
        [$status, $answer] = api('POST', '/login', ['username' => $login, 'password' => $password]);
        if ($status === 200 && ! empty($answer['token'])) {
            return $answer['token'];
        }
        // Vikunja allows a few logins a minute from one address: wait, then try again.
        if ($status === 429 && $attempt < 8) {
            sleep(10);
            continue;
        }
        fail("{$login} could not log in ({$status}" . (isset($answer['message']) ? ": {$answer['message']}" : '') . ').');
    }
}

function db(): PDO
{
    static $pdo = null;
    return $pdo ??= new PDO('mysql:host=db;dbname=db;charset=utf8mb4', 'db', 'db', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
}

function one(string $sql, array $args = []): mixed
{
    $q = db()->prepare($sql);
    $q->execute($args);
    return $q->fetchColumn();
}

function user_id(string $login): ?int
{
    $id = one('SELECT id FROM users WHERE username = ?', [$login]);
    return $id === false ? null : (int) $id;
}

function sample_project(): ?array
{
    $q = db()->prepare('SELECT id, title, identifier, owner_id FROM projects WHERE title = ? ORDER BY id LIMIT 1');
    $q->execute([SAMPLE_PROJECT]);
    $row = $q->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

/** The logins of the input: login => password (the accounts the content is made as). */
function passwords(): array
{
    $out = [];
    foreach (input()['rows'] ?? [] as $row) {
        if (! empty($row['login']) && ! empty($row['password'])) {
            $out[$row['login']] = $row['password'];
        }
    }
    return $out;
}

foreach ($verbs as $verb) {
    if ($verb === 'version') {
        [$status, $info] = api('GET', '/info');
        say('VERSION ' . ltrim((string) ($info['version'] ?? ''), 'v'));
    } elseif ($verb === 'accounts') {
        // The accounts are made with Vikunja's own command (the builder's vikunja_account): here their names, as the
        // site shows them.
        foreach (input()['rows'] ?? [] as $row) {
            $id = user_id($row['login']);
            if (! $id) {
                say("{$row['login']}: not there");
                continue;
            }
            db()->prepare('UPDATE users SET name = ? WHERE id = ?')->execute([$row['name'] ?? '', $id]);
            say("{$row['login']}: " . ((int) one('SELECT status FROM users WHERE id = ?', [$id]) === 0 ? 'active' : 'kept from logging in'));
        }
    } elseif ($verb === 'content') {
        $pw = passwords();
        foreach (['owner', 'member'] as $who) {
            if (empty($pw[$who])) {
                fail("No login of {$who} on the input: add the default accounts first (--add-users).");
            }
        }
        $owner = login('owner', $pw['owner']);
        $project = sample_project();
        if (! $project) {
            [$status, $made] = api('PUT', '/projects', ['title' => SAMPLE_PROJECT, 'identifier' => SAMPLE_KEY, 'description' => '<p>The sample project of the Webship Workspace.</p>'], $owner);
            if ($status >= 300) {
                fail('The sample project could not be made (' . $status . ').');
            }
            $project = sample_project();
        }
        $pid = (int) $project['id'];
        // Its sharing: member reads and writes, reader only reads; stranger has none.
        foreach (['member' => 'write', 'reader' => 'read'] as $who => $perm) {
            if (user_id($who) && ! one('SELECT 1 FROM users_projects WHERE project_id = ? AND user_id = ?', [$pid, user_id($who)])) {
                api('PUT', "/projects/{$pid}/users", ['username' => $who, 'permission' => PERMISSIONS[$perm]], $owner);
            }
        }
        $find = fn (string $title) => one('SELECT id FROM tasks WHERE project_id = ? AND title = ? ORDER BY id LIMIT 1', [$pid, $title]);
        $greeting = 'The greeting script says Helo instead of Hello';
        if (! $find($greeting)) {
            [, $task] = api('PUT', "/projects/{$pid}/tasks", ['title' => $greeting, 'description' => '<p><code>greeting.sh</code> prints <em>Helo</em> where it should print <em>Hello</em>.</p>', 'priority' => 3], $owner);
            $tid = (int) $task['id'];
            $label = one('SELECT id FROM labels WHERE title = ? AND created_by_id = ?', ['bug', user_id('owner')]);
            if (! $label) {
                [, $made] = api('PUT', '/labels', ['title' => 'bug', 'hex_color' => 'e8445a'], $owner);
                $label = $made['id'];
            }
            api('PUT', "/tasks/{$tid}/labels", ['label_id' => (int) $label], $owner);
            api('PUT', "/tasks/{$tid}/assignees", ['user_id' => user_id('member')], $owner);
            api('PUT', "/tasks/{$tid}/comments", ['comment' => '<p>Seen on the test site: the greeting prints Helo.</p>'], $owner);
            // On the board, the work goes on: the bucket Doing of the project's Kanban view.
            $view = one("SELECT id FROM project_views WHERE project_id = ? AND view_kind = 3 ORDER BY id LIMIT 1", [$pid]);
            $doing = $view ? one('SELECT id FROM buckets WHERE project_view_id = ? AND title = ?', [$view, 'Doing']) : false;
            if ($doing) {
                api('POST', "/projects/{$pid}/views/{$view}/buckets/{$doing}/tasks", ['task_id' => $tid], $owner);
            }
        }
        $usage = 'The usage line spells greeting as greting';
        if (! $find($usage)) {
            $member = login('member', $pw['member']);
            api('PUT', "/projects/{$pid}/tasks", ['title' => $usage, 'description' => '<p>The usage line of <code>greeting.sh</code> says <em>greting</em>.</p>'], $member);
        }
        say('content: ' . SAMPLE_PROJECT . ' (' . SAMPLE_KEY . ') holds ' . one('SELECT COUNT(*) FROM tasks WHERE project_id = ?', [$pid]) . ' tasks');
    } elseif ($verb === 'tidy') {
        $project = sample_project();
        if (! $project) {
            say('tidy: no sample project');
            continue;
        }
        $authors = array_filter(array_map('user_id', TEST_ACCOUNTS));
        if (! $authors) {
            say('tidy: no default account');
            continue;
        }
        $in = implode(',', array_map('intval', $authors));
        $q = db()->prepare("SELECT id FROM tasks WHERE project_id = ? AND title LIKE ? AND created_by_id IN ({$in})");
        $q->execute([(int) $project['id'], TEST_PREFIX . '%']);
        $left = $q->fetchAll(PDO::FETCH_COLUMN);
        foreach ($left as $id) {
            // What Vikunja keeps of a task in tables of their own: its comments, assignees, labels, places on the boards
            // and in the lists, reminders, relations, attachments, unread marks; a subscription to it (entity 3) and a
            // reaction to it (kind 0).
            $of = ['task_comments' => 'task_id = ?', 'task_assignees' => 'task_id = ?', 'label_tasks' => 'task_id = ?',
                'task_buckets' => 'task_id = ?', 'task_positions' => 'task_id = ?', 'task_reminders' => 'task_id = ?',
                'task_relations' => 'task_id = ? OR other_task_id = ?', 'task_attachments' => 'task_id = ?',
                'task_unread_statuses' => 'task_id = ?', 'subscriptions' => 'entity_type = 3 AND entity_id = ?',
                'reactions' => 'entity_kind = 0 AND entity_id = ?'];
            foreach ($of as $table => $where) {
                try {
                    db()->prepare("DELETE FROM {$table} WHERE {$where}")->execute(array_fill(0, substr_count($where, '?'), $id));
                } catch (PDOException $e) {
                    // A table or a column this release does not have.
                }
            }
            db()->prepare('DELETE FROM tasks WHERE id = ?')->execute([$id]);
        }
        say('tidy: ' . count($left) . ' task(s) of a stopped test run removed');
    } elseif ($verb === 'list') {
        $project = sample_project();
        say('Accounts:');
        $shares = $project ? db()->query('SELECT user_id, permission FROM users_projects WHERE project_id = ' . (int) $project['id'])->fetchAll(PDO::FETCH_KEY_PAIR) : [];
        foreach (db()->query('SELECT id, username, email, status, is_admin FROM users ORDER BY id') as $u) {
            $standing = $project && (int) $project['owner_id'] === (int) $u['id'] ? 'owner of ' . SAMPLE_PROJECT
                : (isset($shares[$u['id']]) ? array_search((int) $shares[$u['id']], PERMISSIONS, true) . ' of ' . SAMPLE_PROJECT : ($u['is_admin'] ? 'the instance admin' : 'not shared'));
            say(sprintf('  %-12s %-28s %-9s %s', $u['username'], (string) $u['email'], (int) $u['status'] === 0 ? 'active' : 'locked', $standing));
        }
        if ($project) {
            say(SAMPLE_PROJECT . ' (' . $project['identifier'] . '): ' . one('SELECT COUNT(*) FROM tasks WHERE project_id = ?', [$project['id']]) . ' tasks');
        }
    } elseif ($verb === 'token') {
        $in = input();
        $login = trim((string) ($in['login'] ?? ''));
        $token = login($login, (string) ($in['password'] ?? ''));
        [, $mine] = api('GET', '/tokens', null, $token);
        foreach (is_array($mine) ? $mine : [] as $t) {
            if (($t['title'] ?? '') === TOKEN_TITLE) {
                api('DELETE', '/tokens/' . (int) $t['id'], null, $token);
            }
        }
        // What the dashboard reads and, with writes on, writes, as this person.
        $permissions = [
            'projects' => ['read_all', 'read_one', 'tasks_by_index', 'views_buckets', 'views_buckets_tasks', 'views_buckets_tasks_update'], 'projects_users' => ['read_all'], 'projects_teams' => ['read_all'],
            'projects_views' => ['read_all', 'read_one'], 'projects_views_tasks' => ['read_all'],
            'tasks' => ['read_all', 'read_one', 'create', 'update'], 'tasks_comments' => ['read_all', 'read_one', 'create'],
            'tasks_assignees' => ['read_all', 'create', 'delete'], 'tasks_labels' => ['read_all', 'create', 'delete'],
            'labels' => ['read_all', 'read_one'], 'teams' => ['read_all'], 'other' => ['user'],
        ];
        [$status, $made] = api('PUT', '/tokens', ['title' => TOKEN_TITLE, 'expires_at' => gmdate('Y-m-d\TH:i:s\Z', time() + 365 * 86400), 'permissions' => $permissions], $token);
        if ($status >= 300 || empty($made['token'])) {
            fail("No token could be made for {$login} ({$status}" . (isset($made['message']) ? ": {$made['message']}" : '') . ').');
        }
        say('TOKEN ' . $made['token']);
    } elseif ($verb === 'counts') {
        $project = sample_project() ?? fail('No sample project.');
        $pid = (int) $project['id'];
        $ids = 'SELECT id FROM tasks WHERE project_id = ' . $pid;
        say('tasks: ' . one("SELECT COUNT(*) FROM tasks WHERE project_id = {$pid}"));
        say('open tasks: ' . one("SELECT COUNT(*) FROM tasks WHERE project_id = {$pid} AND done = 0"));
        say('comments: ' . one("SELECT COUNT(*) FROM task_comments WHERE task_id IN ({$ids})"));
        say('assignees: ' . one("SELECT COUNT(*) FROM task_assignees WHERE task_id IN ({$ids})"));
        say('labels on tasks: ' . one("SELECT COUNT(*) FROM label_tasks WHERE task_id IN ({$ids})"));
        say('tasks in buckets: ' . one("SELECT COUNT(*) FROM task_buckets WHERE task_id IN ({$ids})"));
        say('shares: ' . one("SELECT COUNT(*) FROM users_projects WHERE project_id = {$pid}"));
        say('labels: ' . one('SELECT COUNT(*) FROM labels'));
        say('users: ' . one('SELECT COUNT(*) FROM users'));
    } else {
        fail("No verb {$verb} (version, accounts, content, tidy, list, token, counts).");
    }
}
