import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
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
  assert.deepStrictEqual(names, ['docker-compose.vikunja.yaml', 'vikunja-site.php', 'vikunja-serve.sh', 'site.feature']);
  assert.deepStrictEqual(manifest.features, ['features/vikunja.feature', 'features/vikunja-runtimes.feature']);
  assert.strictEqual(manifest.featuresSite, 'cmd-vikunja-project.sh ci-vikunja --install --add-users --sample-content --runtime docker', 'CI builds a site on Docker Compose for the runtimes feature');
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
  assert.match(pty, /said="\$\(ddev exec "script -q -e -c \$\(printf '%q' "\$\(vikunja_cli_line "\$@"\)"\) \/dev\/null" < "\$\{file\}" 2>&1\)" ;/, 'elsewhere the web container\'s own pseudo-terminal, the password on the input from the same file');
  assert.match(pty, /rm -f "\$\{file:\?\}"/, 'and the file goes after');
  assert.doesNotMatch(pty, /--password/, 'never the password flag');
  assert.doesNotMatch(FUN, /admin\/users|set-admin/, 'no admin panel: a feature of Vikunja\'s paid licence');
  assert.match(fn('cancel_vikunja_users'), /vikunja_cli user change-status "\$\{!user_name\}" --disable/);
  assert.match(fn('vikunja_cli'), /docker exec "\$\(vikunja_container\)" \/app\/vikunja\/vikunja "\$@"/, 'Vikunja\'s image has no shell: its binary runs by itself');
  assert.match(fn('vikunja_cli'), /ddev exec "\$\(vikunja_cli_line "\$@"\)"/, 'elsewhere in the web container');
  assert.match(fn('vikunja_cli_line'), /set -a ; \. \/var\/www\/html\/%s\/env ; set \+a ; cd \/var\/www\/html\/%s && \/usr\/local\/bin\/vikunja %s/, 'with the site\'s values, each word quoted');
  const build = fn('vikunja_build');
  assert.ok(build.indexOf('command -v script') < build.indexOf('drop_database'), '--install needs script, said before anything is removed');
  assert.ok(build.indexOf('vikunja_account "${account_name}"') > build.indexOf('vikunja_wait'), 'the workspace account once Vikunja answers');
});

test('the site script reaches Vikunja\'s API and database, and each verb does what it says', () => {
  assert.match(SITE, /^define\('API', getenv\('VIKUNJA_API'\) \?: 'http:\/\/vikunja:3456\/api\/v1'\);$/m, 'its service on DDEV, or where VIKUNJA_API says');
  assert.match(fn('vikunja_site'), /ddev exec "VIKUNJA_API=\$\(vikunja_inside_url\)\/api\/v1 php /);
  assert.match(fn('vikunja_inside_url'), /if \[ "\$\(vikunja_runtime\)" = 'ddev' \] ; then echo 'http:\/\/vikunja:3456' ; else echo "http:\/\/127\.0\.0\.1:\$\{VIKUNJA_SERVE_PORT\}" ; fi/);
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

test('the runtimes: DDEV, Docker Compose, Podman and Kubernetes; another is refused before anything is changed, and so is a machine with too little memory', () => {
  assert.match(read('scripts/args/arg-vikunja.sh'), /choices=\['ddev', 'docker', 'podman', 'kubernetes'\]/);
  const build = fn('vikunja_build');
  const guard = build.indexOf('case "${runtime}" in');
  const serve = build.indexOf('declare -f rt_serve');
  assert.ok(guard > 0 && guard < build.indexOf('drop_database') && guard < build.indexOf('ddev config'), 'the runtime is asked first');
  assert.match(build, /case "\$\{runtime\}" in\n\s+ddev\|docker\|podman\|kubernetes\) ;;/, 'the four runtimes the plugin was proven on');
  assert.ok(build.includes('Vikunja builds on DDEV, Docker Compose, Podman and Kubernetes for now (--runtime ddev, docker, podman or kubernetes), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed.'));
  assert.ok(serve > guard && serve < build.indexOf('drop_database'), 'a workspace whose runtimes serve no application of its own is told so before anything is removed');
  assert.ok(build.indexOf('vikunja_free_memory') < build.indexOf('drop_database'), 'the free memory is asked before anything is removed');
  assert.match(FUN, /^readonly VIKUNJA_MEMORY_MB=1024;$/m);
  assert.match(FUN, /^readonly VIKUNJA_DATABASE='mariadb:11\.4';$/m);
  assert.match(build, /ddev config --project-type=generic --project-name=\$\{PROJECT_NAME\} --database=\$\{VIKUNJA_DATABASE\} \\\n\s+--nodejs-version=\$\(ddev_nodejs_version\)/, 'on DDEV a generic project on MariaDB 11.4');
  assert.match(build, /ddev config --project-type=generic --webserver-type=generic --project-name=\$\{PROJECT_NAME\} --database=\$\{VIKUNJA_DATABASE\} --auto/, 'elsewhere the runtime\'s own project, on the same database');
  assert.ok(build.indexOf('base_url="$(vikunja_url)"') > build.indexOf('vikunja_write_config'), 'the address is read once the runtime has given the project its port');
  assert.match(read('README.md'), /Vikunja supports MySQL, MariaDB, PostgreSQL and SQLite; the Workspace uses MariaDB 11\.4,/);
});

/** What the builder writes for a runtime, with the runtime layer stood in: its calls, and the project's files. */
function written(runtime: string, address: string): { calls: string, dir: string, read: (f: string) => string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vikunja-runtimes-'));
  const plugin = path.join(dir, 'scripts', 'plugins', 'vikunja');
  fs.mkdirSync(plugin, { recursive: true });
  for (const f of manifest.scripts.machine) fs.copyFileSync(path.join(PKG, f), path.join(plugin, path.basename(f)));
  const project = path.join(dir, 'mysite');
  fs.mkdirSync(path.join(project, '.ddev'), { recursive: true });
  const stand = [
    'rt_claim() { echo "rt_claim $*" >> "$LOG" ; }',
    'rt_stack() { echo "rt_stack $*" >> "$LOG" ; }',
    'rt_web_build() { echo "rt_web_build $*" >> "$LOG" ; cat > "$LOG.dockerfile" ; }',
    'rt_service() { echo "rt_service $*" >> "$LOG" ; }',
    'rt_serve() { echo "rt_serve $1 [$2]" >> "$LOG" ; }',
  ].join('\n');
  const script = `${stand}\nsource "${path.join(PKG, 'scripts/functions/fun-vikunja.sh')}"\nvikunja_write_config "${project}" 2.8.0 ${runtime} && vikunja_write_env "${project}" 2.8.0 "${address}" 100 ${runtime}`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, WORKSPACE_SCRIPTS: path.join(dir, 'scripts'), LOG: path.join(dir, 'calls.log') } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const log = path.join(dir, 'calls.log');
  return { calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', dir, read: (f: string) => fs.readFileSync(path.join(project, f), 'utf8') };
}

/** Remove a folder of this file's tests, never a path outside one. */
function removeTestDir(dir: string): void {
  const parts = path.relative(os.tmpdir(), path.resolve(dir)).split(path.sep);
  assert.ok(parts.length === 1 && /^vikunja-runtimes-[A-Za-z0-9]{6}$/.test(parts[0]), `refused to remove ${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

test('on Docker Compose, Podman and Kubernetes: Vikunja\'s own binary in the web container, started once the database takes connections', () => {
  for (const runtime of ['docker', 'podman', 'kubernetes']) {
    const w = written(runtime, 'http://127.0.0.1:33001');
    try {
      assert.deepStrictEqual(w.calls.trim().split('\n'), [
        'rt_claim vikunja',
        'rt_stack image docker.io/library/php:8.3-cli-bookworm',
        'rt_web_build vikunja',
        'rt_serve 3456 [bash vikunja/vikunja-serve.sh]',
      ], `${runtime}: no service of the project's own: Vikunja stops at once when its database does not answer at its start`);
      const fragment = fs.readFileSync(path.join(w.dir, 'calls.log.dockerfile'), 'utf8');
      assert.match(fragment, /^COPY --from=docker\.io\/vikunja\/vikunja:2\.8\.0 \/app\/vikunja\/vikunja \/usr\/local\/bin\/vikunja$/m, `${runtime}: Vikunja's own binary, of the release the site runs`);
      assert.match(fragment, /^RUN docker-php-ext-install pdo_mysql$/m, `${runtime}: the site script reads the project's database`);
      const env = w.read('vikunja/env').split('\n');
      for (const line of ['VIKUNJA_SERVICE_PUBLICURL=http://127.0.0.1:33001/', 'VIKUNJA_DATABASE_HOST=db', 'VIKUNJA_MAILER_HOST=mail',
        'VIKUNJA_SERVICE_ROOTPATH=/var/www/html/vikunja', 'VIKUNJA_FILES_BASEPATH=/var/www/html/vikunja/files']) assert.ok(env.includes(line), `${runtime}: ${line}`);
      assert.strictEqual(fs.statSync(path.join(w.dir, 'mysite', 'vikunja', 'env')).mode & 0o777, 0o600, `${runtime}: vikunja/env is its owner's only`);
      for (const f of ['vikunja-site.php', 'vikunja-serve.sh']) assert.ok(fs.existsSync(path.join(w.dir, 'mysite', 'vikunja', f)), `${runtime}: vikunja/${f}`);
      assert.ok(fs.statSync(path.join(w.dir, 'mysite', 'vikunja', 'files')).isDirectory(), `${runtime}: the folder of Vikunja's files, in the project`);
      for (const f of ['docker-compose.vikunja.yaml', 'config.vikunja.yaml', '.env']) assert.ok(!fs.existsSync(path.join(w.dir, 'mysite', '.ddev', f)), `${runtime}: no DDEV file (${f})`);
    } finally {
      removeTestDir(w.dir);
    }
  }
  // On DDEV the project is what it was: Vikunja's own image as a service, the mail catcher in the web container.
  const d = written('ddev', 'https://mysite.ddev.site');
  try {
    assert.strictEqual(d.calls, '', 'no call of the runtime layer on DDEV');
    const env = d.read('vikunja/env').split('\n');
    for (const line of ['VIKUNJA_SERVICE_PUBLICURL=https://mysite.ddev.site/', 'VIKUNJA_MAILER_HOST=web']) assert.ok(env.includes(line), line);
    assert.ok(!env.some((l) => l.startsWith('VIKUNJA_FILES_BASEPATH=')), 'on DDEV its files are where its image keeps them, the project\'s folder mounted there');
    for (const f of ['docker-compose.vikunja.yaml', 'config.vikunja.yaml', '.env']) assert.ok(fs.existsSync(path.join(d.dir, 'mysite', '.ddev', f)), f);
    assert.ok(!fs.existsSync(path.join(d.dir, 'mysite', 'vikunja', 'vikunja-serve.sh')), 'no server script on DDEV');
  } finally {
    removeTestDir(d.dir);
  }
});

test('the server on the other runtimes: the site\'s values, the folder of its files, then Vikunja\'s own binary', () => {
  const serve = read('scripts/vikunja-serve.sh');
  assert.match(serve, /^set -a\n# shellcheck disable=SC1091\n\. "\$\{here\}\/env" \|\| exit 1\nset \+a$/m, 'the site\'s values in its environment');
  assert.match(serve, /^mkdir -p "\$\{here\}\/files" \|\| exit 1$/m);
  assert.match(serve, /^exec \/usr\/local\/bin\/vikunja$/m, 'Vikunja\'s own server, as its image starts it');
  const r = spawnSync('bash', ['-n', path.join(PKG, 'scripts/vikunja-serve.sh')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(read('README.md'), /Vikunja stops at once when its database does not answer at its start/, 'the README says why the shape differs off DDEV');
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
    'VIKUNJA_DATABASE_TYPE=mysql', 'VIKUNJA_DATABASE_HOST=db', 'VIKUNJA_MAILER_HOST=${mail}', 'VIKUNJA_MAILER_PORT=1025', 'VIKUNJA_RATELIMIT_NOAUTHLIMIT=${login_limit}']) {
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
  assert.match(FUN, /ddev exec "VIKUNJA_API=\$\(vikunja_inside_url\)\/api\/v1 php \/var\/www\/html\/\$\{VIKUNJA_FILES\}\/vikunja-site\.php \$\*"/, 'the site script with the web container\'s PHP');
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
  assert.match(told, /with `--runtime docker`, `podman` or `kubernetes` through the runtime layer: there Vikunja's own binary runs in the web container, started once MariaDB takes connections/, 'and where else it builds, and how');
  assert.match(told, /Lando and Docksal are not proven for it yet/);
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
