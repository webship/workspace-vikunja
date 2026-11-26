import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { assistantContext, PLATFORM, COMMANDS, AGENTS, SKILLS, AI_COMMANDS, PROMPTS } from '../src/index';

// Compiled, these tests run from dist/tests, so the package root is one folder further up.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(PKG, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const manifest = pkg.workspacePlugin;
const FUN = read('scripts/functions/fun-vikunja.sh');
const SITE = read('scripts/vikunja-site.php');
/** The part of the site script that answers one verb. */
const verb = (name: string) => {
  const start = SITE.indexOf(`$verb === '${name}'`);
  assert.ok(start > 0, `the site script answers ${name}`);
  const next = SITE.indexOf('$verb === ', start + 10);
  return SITE.slice(start, next > 0 ? next : SITE.length);
};
const fn = (name: string) => FUN.slice(FUN.indexOf(`function ${name}()`), FUN.indexOf('\n}\n', FUN.indexOf(`function ${name}()`)) + 2);

test('the manifest names the platform, and every file it names ships', () => {
  assert.strictEqual(manifest.name, PLATFORM);
  const named = [...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args, ...manifest.scripts.machine,
    ...manifest.ai.agents, ...manifest.ai.skills, ...manifest.ai.commands, ...manifest.ai.prompts, ...manifest.features, manifest.settingsTemplate, manifest.labels];
  for (const f of named) assert.ok(fs.existsSync(path.join(PKG, f)), `${f} is in the package`);
  for (const f of named) assert.ok(pkg.files.includes(f.split('/')[0]), `${f} is published with the package`);
  assert.deepStrictEqual(manifest.commands.files.map((f: string) => path.basename(f)), COMMANDS);
  assert.deepStrictEqual(manifest.ai.agents.map((f: string) => path.basename(f, '.md')), AGENTS);
  assert.deepStrictEqual(manifest.ai.skills.map((f: string) => path.basename(f)), SKILLS);
  assert.deepStrictEqual(manifest.ai.commands.map((f: string) => path.basename(f, '.md')), AI_COMMANDS);
  assert.deepStrictEqual(manifest.ai.prompts.map((f: string) => path.basename(f, '.md')), PROMPTS);
  assert.deepStrictEqual(manifest.commands.types, ['sites'], 'the commands go to sites folders only');
  assert.deepStrictEqual(manifest.typeActions, { vikunja: ['sites', 'code'] }, 'the VIKUNJA menu on the rows of sites and code folders');
  const names = manifest.scripts.machine.map((f: string) => path.basename(f));
  assert.strictEqual(new Set(names).size, names.length, 'the machine files have names of their own');
  assert.deepStrictEqual(names, ['docker-compose.vikunja.yaml', 'vikunja-site.php', 'site.feature']);
  assert.deepStrictEqual(manifest.features, ['features/vikunja.feature']);
  assert.strictEqual(manifest.featuresSite, undefined, 'a site for the features needs a runtime CI has: Vikunja is proven on DDEV only so far');
  assert.deepStrictEqual(pkg.dependencies, { '@webship.co/workspace-tracker': '^1.0.2' });
  assert.ok(manifest.summary.length <= 110, 'the catalogue line shows at most 110 characters');
});

test('every command finds the workspace by itself, names its folder, and sources its args from where the installer puts them', () => {
  for (const f of manifest.commands.files) {
    const src = read(f);
    assert.match(src, /^#!\/usr\/bin\/env bash/, `${f} is a bash script`);
    assert.match(src, /WORKSPACE_SCRIPTS="\$\{WORKSPACE_SCRIPTS:-\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/core\/scripts" && pwd\)\}"/, `${f} locates the tooling from its own path`);
    assert.match(src, /workspace\.__WORKSPACE__\.settings\.yml/, `${f} loads the settings of the folder it is installed into`);
    assert.match(src, /source \$\{WORKSPACE_SCRIPTS\}\/plugins\/vikunja\/args\/arg-[a-z-]+\.sh \|\| exit 1 ;/, `${f} reads its arguments from the plugin's args`);
    const last = src.trim().split('\n').pop() as string;
    assert.match(FUN, new RegExp(`^function ${last.replace(/ ;$/, '')}\\(\\)`, 'm'), `${f} ends by calling a function the plugin defines`);
  }
  assert.match(read('commands/cmd-vikunja-project.sh'), /^# workspace-name: Vikunja \(to-do and project management\)$/m, 'the builder carries the name the Build list shows');
  assert.doesNotMatch(read('commands/cmd-tools-vikunja-cli.sh'), /^# workspace-name:/m, 'a tool is not a builder');
});

test('every shell script parses', () => {
  for (const f of [...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args]) {
    const r = spawnSync('bash', ['-n', path.join(PKG, f)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${f}: ${r.stderr}`);
  }
});

const PHP = spawnSync('php', ['--version'], { encoding: 'utf8' }).status === 0;

test('the site script is PHP that parses', { skip: PHP ? false : 'no php on this machine (the workspace runs PHP in containers only); the CI runner has one' }, () => {
  const r = spawnSync('php', ['-l', path.join(PKG, 'scripts/vikunja-site.php')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('every account is made by Vikunja\'s own command, its password through a pseudo-terminal, never on a command line', () => {
  const account = fn('vikunja_account');
  assert.match(account, /vikunja_cli_password "\$\{password\}" user create --username "\$\{login\}" --email "\$\{mail\}"/);
  assert.match(account, /vikunja_cli_password "\$\{password\}" user reset-password "\$\{login\}" --direct/, 'one that is there gets its password back');
  assert.match(account, /vikunja_cli user change-status "\$\{login\}" --enable/, 'then active: Vikunja would wait for a confirmed address');
  assert.match(account, /grep -qE "│ \*\[0-9\]\+ \*│ \*\$\{login\} \*│"/, 'an account is found by its row of Vikunja\'s own list');
  const pty = fn('vikunja_cli_password');
  assert.match(pty, /local file ; file="\$\(umask 077 && mktemp\)"/, 'the password in a file only its owner reads');
  assert.match(pty, /printf '%s\\n%s\\n' "\$\{password\}" "\$\{password\}" > "\$\{file\}"/, 'twice, as the command asks it twice');
  assert.match(pty, /script -q -e -c "\$\{quoted\}" \/dev\/null < "\$\{file\}"/, 'through a pseudo-terminal');
  assert.match(pty, /rm -f "\$\{file:\?\}"/, 'and the file goes after');
  assert.doesNotMatch(pty, /--password/, 'never the password flag');
  assert.doesNotMatch(FUN, /admin\/users|set-admin/, 'no admin panel: a feature of Vikunja\'s paid licence');
  assert.match(fn('cancel_vikunja_users'), /vikunja_cli user change-status "\$\{!user_name\}" --disable/);
  assert.match(fn('vikunja_cli'), /docker exec "\$\(vikunja_container\)" \/app\/vikunja\/vikunja "\$@"/, 'Vikunja\'s image has no shell: its binary runs by itself');
  const build = fn('vikunja_build');
  assert.ok(build.indexOf('command -v script') < build.indexOf('drop_database'), '--install needs script, said before anything is removed');
  assert.ok(build.indexOf('vikunja_account "${account_name}"') > build.indexOf('vikunja_wait'), 'the workspace account once Vikunja answers');
});

test('the site script reaches Vikunja\'s API and database, and each verb does what it says', () => {
  assert.match(SITE, /^const API = 'http:\/\/vikunja:3456\/api\/v1';$/m);
  assert.match(SITE, /new PDO\('mysql:host=db;dbname=db;charset=utf8mb4', 'db', 'db'/, 'the project\'s database');
  for (const name of ['version', 'accounts', 'content', 'tidy', 'list', 'token', 'counts']) verb(name);
  const content = verb('content');
  assert.match(content, /api\('PUT', '\/projects', \['title' => SAMPLE_PROJECT, 'identifier' => SAMPLE_KEY/, 'the sample project, as its owner');
  assert.match(content, /\['member' => 'write', 'reader' => 'read'\]/, 'its sharing: member read & write, reader read only, stranger none');
  assert.match(content, /\$member = login\('member', \$pw\['member'\]\);/, 'WEB-2 made as member, its author');
  const token = verb('token');
  assert.match(token, /'title' => TOKEN_TITLE/);
  assert.match(token, /'tasks_by_index', 'views_buckets', 'views_buckets_tasks', 'views_buckets_tasks_update'/, 'the board\'s moves and the task numbers the provider reads');
  assert.match(token, /api\('DELETE', '\/tokens\/' \. \(int\) \$t\['id'\], null, \$token\)/, 'the earlier one goes');
  assert.match(SITE, /^const TOKEN_TITLE = 'webship-workspace';$/m);
  assert.match(SITE, /if \(\$status === 429 && \$attempt < 8\) \{\n\s+sleep\(10\);/, 'a login refused for the limit waits and tries again');
});

test('tidy removes only the default accounts\' "Webship test …" tasks of the sample project, with what Vikunja keeps of them', () => {
  assert.match(SITE, /^const TEST_PREFIX = 'Webship test ';$/m);
  assert.match(SITE, /^const TEST_ACCOUNTS = \['owner', 'member', 'reader', 'stranger'\];$/m);
  const tidy = verb('tidy');
  assert.match(tidy, /SELECT id FROM tasks WHERE project_id = \? AND title LIKE \? AND created_by_id IN \(\{\$in\}\)/);
  for (const table of ['task_comments', 'task_assignees', 'label_tasks', 'task_buckets', 'task_positions', 'task_reminders', 'task_relations', 'task_attachments', 'task_unread_statuses', 'subscriptions', 'reactions']) {
    assert.ok(tidy.includes(`'${table}' =>`), `${table} of the task`);
  }
  assert.match(tidy, /'subscriptions' => 'entity_type = 3 AND entity_id = \?'/, 'a subscription to the task, not to another entity');
  assert.match(tidy, /'reactions' => 'entity_kind = 0 AND entity_id = \?'/, 'a reaction to the task');
  assert.match(tidy, /db\(\)->prepare\('DELETE FROM tasks WHERE id = \?'\)/);
});

test('the runtimes: DDEV only for now; another is refused before anything is changed, and so is a machine with too little memory', () => {
  assert.match(read('scripts/args/arg-vikunja.sh'), /choices=\['ddev'\]/);
  const build = fn('vikunja_build');
  const guard = build.indexOf('if [ "${runtime}" != \'ddev\' ] ; then');
  assert.ok(guard > 0 && guard < build.indexOf('drop_database') && guard < build.indexOf('ddev config'), 'the runtime is asked first');
  assert.ok(build.includes('Vikunja builds on DDEV for now (--runtime ddev), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed.'));
  assert.ok(build.indexOf('vikunja_free_memory') < build.indexOf('drop_database'), 'the free memory is asked before anything is removed');
  assert.match(FUN, /^readonly VIKUNJA_MEMORY_MB=1024;$/m);
  assert.match(FUN, /^readonly VIKUNJA_DATABASE='mariadb:11\.4';$/m);
  assert.match(build, /ddev config --project-type=generic --project-name=\$\{PROJECT_NAME\} --database=\$\{VIKUNJA_DATABASE\} \\\n\s+--nodejs-version=\$\(ddev_nodejs_version\)/);
  assert.match(read('README.md'), /Vikunja supports MySQL, MariaDB, PostgreSQL and SQLite; the Workspace uses MariaDB 11\.4,/);
});

test('Vikunja\'s service on DDEV: its own image at the project\'s address, as the host user, its files in the project', () => {
  const compose = read('scripts/docker-compose.vikunja.yaml');
  assert.match(compose, /image: "\$\{VIKUNJA_IMAGE:-docker\.io\/vikunja\/vikunja:2\.8\.0\}"/, 'pinned, by its whole name');
  assert.match(FUN, /^readonly VIKUNJA_DEFAULT_RELEASE='2\.8\.0';$/m);
  assert.match(compose, /user: "\$\{DDEV_UID\}:\$\{DDEV_GID\}"/, 'the host user, who owns the project\'s files');
  assert.match(compose, /- \$\{DDEV_APPROOT\}\/vikunja\/files:\/app\/vikunja\/files/);
  assert.match(compose, /VIRTUAL_HOST: \$\{DDEV_HOSTNAME\}/);
  assert.match(compose, /HTTP_EXPOSE: "80:3456"/);
  assert.match(compose, /HTTPS_EXPOSE=8457:80,8026:8025/, 'the web container moves, its mail catcher stays at :8026');
  assert.match(compose, /depends_on:\n\s+db:\n\s+condition: service_healthy/);
  assert.doesNotMatch(compose, /PASSWORD|SECRET|TOKEN/, 'no secret in the compose file');
  const env = fn('vikunja_write_env');
  for (const line of ['VIKUNJA_SERVICE_PUBLICURL=${base_url}/', 'VIKUNJA_SERVICE_SECRET=$(vikunja_secret 64)', 'VIKUNJA_SERVICE_ENABLEREGISTRATION=false',
    'VIKUNJA_DATABASE_TYPE=mysql', 'VIKUNJA_DATABASE_HOST=db', 'VIKUNJA_MAILER_HOST=web', 'VIKUNJA_MAILER_PORT=1025', 'VIKUNJA_RATELIMIT_NOAUTHLIMIT=${login_limit}']) {
    assert.ok(env.split('\n').includes(line), line);
  }
  assert.match(env, /\( umask 077 && cat > "\$\{project_path\}\/\$\{VIKUNJA_FILES\}\/env"/, 'vikunja/env is its owner\'s only');
});

test('a test site allows the logins a suite makes, by a setting of its own; a connected Vikunja keeps its own', () => {
  assert.match(FUN, /^readonly VIKUNJA_LOGIN_LIMIT=100;$/m);
  assert.match(FUN, /local login_limit="\$\{LOGIN_LIMIT:-\$\{site_vikunja_login_limit:-\$\{VIKUNJA_LOGIN_LIMIT\}\}\}"/);
  assert.match(read('scripts/args/arg-vikunja.sh'), /'--login-limit',\n\s+dest='LOGIN_LIMIT'/);
  assert.doesNotMatch(fn('vikunja_connect'), /RATELIMIT|login_limit/i, 'connecting to a Vikunja never changes its limit');
});

test('the functions carry the names the core\'s tools look for; --connect keeps the token off screens and command lines', () => {
  for (const name of ['set_vikunja_users', 'add_vikunja_users', 'cancel_vikunja_users', 'testing_configure_vikunja', 'vikunja_build', 'vikunja_cli_tool', 'vikunja_connect']) {
    assert.match(FUN, new RegExp(`^function ${name}\\(\\) \\{`, 'm'), `${name} is defined`);
  }
  assert.match(FUN, /users=\(owner member reader stranger\);/);
  assert.match(FUN, /user_owner_role='owner' ;\n\s+user_member_role='write' ;\n\s+user_reader_role='read' ;\n\s+user_stranger_role='' ;/);
  assert.match(FUN, /ddev exec "php \/var\/www\/html\/\$\{VIKUNJA_FILES\}\/vikunja-site\.php \$\*"/, 'the site script with the web container\'s PHP');
  assert.doesNotMatch(FUN, /ddev stop -y/, 'ddev stop takes no -y');
  const connect = fn('vikunja_connect');
  assert.match(connect, /VIKUNJA_NEW_TOKEN="\$\{token\}" python3/, 'the token reaches the settings writer in its environment only');
  assert.match(connect, /0o600/);
  assert.doesNotMatch(connect, /echo[^\n]*\$\{token\}/, 'the token is never printed');
  assert.match(connect, /\[\[ "\$\{token\}" =~ \^tk_\[A-Za-z0-9\]\{20,\}\$ \]\]/);
  const testing = FUN.slice(FUN.indexOf('function testing_configure_vikunja()'));
  assert.match(testing, /registry="\$\{registry\}\$\{user\}\|\$\{!user_name\}\|\$\{!user_password\}\|\$\{!user_fullname\}"/, 'the pack logs in with the username and shows the name');
  assert.match(testing, /elif ! \( cd "\$\{project_path\}" && vikunja_content > \/dev\/null 2>&1 \) ; then/, 'the sample content, in the project');
});

test('the assistant is told how to build, test and connect a site, and what the open-source edition does not have', () => {
  const told = assistantContext();
  for (const c of COMMANDS) assert.ok(told.includes(c), `the assistant is told about ${c}`);
  for (const a of AGENTS) assert.ok(told.includes(a), `the assistant is told about ${a}`);
  assert.match(told, /1 GB of free memory/);
  assert.match(told, /--connect <login>/);
  assert.match(told, /pseudo-terminal/);
  assert.match(told, /time tracking and admin panel are features of its paid licence/);
});

test('the docs say container-based, name only what ships, and carry no personal value', () => {
  const docs = ['README.md', ...manifest.ai.agents, 'scripts/functions/fun-vikunja.sh', 'config/plugin.vikunja.settings.yml'];
  for (const f of docs) {
    const src = read(f);
    assert.doesNotMatch(src, /DDEV-only/i, `${f}: the workspace is container-based, DDEV by default`);
    assert.doesNotMatch(src, /\/home\/(?!YOUR_USER)[a-z]/, `${f} carries no personal path`);
    const mails = src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[a-z]{2,}/g) || [];
    for (const m of mails) assert.match(m, /@example\.(com|org)$/, `${f}: ${m} is not an example address`);
  }
  for (const c of COMMANDS) assert.ok(read('README.md').includes(c), `the README lists ${c}`);
  const keys = [...read('config/plugin.vikunja.settings.yml').matchAll(/^([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 12);
  for (const k of keys) assert.ok(read('README.md').includes(`\`${k}\``), `the README describes the setting ${k}`);
  assert.match(read('README.md'), /\*\*What the open-source edition does not have\.\*\*/);
});
