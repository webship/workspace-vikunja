# @webship.co/workspace-vikunja

Vikunja, the open-source to-do and project management app, for the [Webship Workspace](https://github.com/webship/workspace),
a container-based workspace (DDEV by default). The plugin brings:

- **a builder**, `cmd-vikunja-project.sh`: a real Vikunja site from Vikunja's own image on the project's own MariaDB,
  on DDEV, every account made by Vikunja's own command, a sample project shared with the default accounts in their
  permissions, and its tasks, a label, an assignee, a comment and its board;
- **a tool**, `cmd-tools-vikunja-cli.sh`: what a site is and its accounts, Vikunja's own commands in its container,
  the default accounts, the sample content, a clean-up after a stopped test run, and the dashboard's connection;
- **the step pack** [`@webship-js/vikunja-steps`](https://github.com/webship/vikunja-steps) wired into the workspace's
  testing setup, with a first feature for a site;
- **the tasks as work items** of the tracker family
  ([`@webship.co/workspace-tracker`](https://github.com/webship/workspace-tracker)): the VIKUNJA menu on a project row
  lists them, reads one, analyzes it, and lets the workspace's AI CLI work it on a branch, with a person in charge;
- **AI items** in their folders: three agents, a skill, a command and two prompts.

## Install

From the workspace's root, the same four steps as Settings → Plugins:

```bash
bash core/scripts/plugins.sh --require @webship.co/workspace-vikunja
bash core/scripts/plugins.sh --activate vikunja --with-needs
bash core/scripts/plugins.sh --install vikunja --with-needs
bash core/scripts/plugins.sh --configure vikunja
```

## What it needs

- A sites folder: one of the `dev`, `test`, `sandboxes` or `demos` plugins. The commands are placed there.
- The AI folders `ai-agents`, `ai-skills`, `ai-commands` and `ai-prompts`, where its AI items land.
- DDEV, the container runtime Vikunja is proven on so far. Docker Compose, Podman and Kubernetes are not proven for it
  yet: asked for one, the builder says so and changes nothing.
- `script` (util-linux) on the machine, which every Linux distribution has: Vikunja's own command takes a password from
  a terminal only (see below).
- A download of about 55 MB for Vikunja's image the first time, and memory: the builder asks for 1 GB free before it
  starts (`free -m`).

## Build a site

```bash
cd ~/workspace/sandboxes                      # or dev, test, demos
bash cmd-vikunja-project.sh mysite --install --add-users --sample-content
```

| Flag | What it does |
| --- | --- |
| `--install` | Makes the workspace account (`account` of `core/config/settings.yml`) the instance's first account, with Vikunja's own command. Vikunja asks a password of at least eight characters |
| `--add-users` | With `--install`: the default accounts, made the same way |
| `--sample-content` | With `--install --add-users`: the project Webship site shared with them, two tasks, a label, an assignee, a comment and its board |
| `--release <X.Y.Z>` | The release of Vikunja's image: 2.8.0 by default |
| `--login-limit <number>` | The requests a minute before a login (the log-in, sign-up and confirmation forms) Vikunja allows from one address on the site, a dev and test setting: 100 by default, where Vikunja's own is 10 |
| `--runtime ddev` | DDEV, the runtime proven for Vikunja so far (the default, or `container.runtime` of `settings.yml`) |
| `--launch` | Open the site when it is ready |

A project of the same name is deleted first, with its database and its files. Vikunja's own image (`vikunja/vikunja`:
its API and its web app in one binary, an image with no shell) is a service of a generic project, on the project's
MariaDB 11.4, at `https://mysite.ddev.site`, run as the host user. Its files (attachments, avatars, backgrounds) are in
the project's `vikunja/files`, the host user's. The project's web container keeps the mail catcher, at
`https://mysite.ddev.site:8026`, where the site's mail goes. Sign-ups are closed.

| Image | What it is | Source and licence |
| --- | --- | --- |
| `docker.io/vikunja/vikunja:2.8.0` | Vikunja: its API and its web app (`--release` picks another tag) | [go-vikunja/vikunja](https://github.com/go-vikunja/vikunja), AGPL-3.0 |

**The database is MariaDB.** Vikunja supports MySQL, MariaDB, PostgreSQL and SQLite; the Workspace uses MariaDB 11.4,
so a site's database is the same on every runtime the Workspace has.

**How the accounts are made.** Every account, the workspace account first, is made with Vikunja's own command
(`vikunja user create`), in its container. That command takes a password from its flag or from a terminal only, and a
flag would put the password on a command line. So the builder gives it the password through a pseudo-terminal
(`script`), from a file only its owner reads, which goes right after: never on a command line, never in a log. Then the
account is made active (`vikunja user change-status --enable`), as Vikunja, its mailer on, would otherwise wait for the
account to confirm its address. An account that is there already gets its password back the same way (`vikunja user
reset-password --direct`).

**What the open-source edition does not have.** Vikunja's admin panel, which can make accounts through its API, and its
time tracking are features of Vikunja's paid licence. The plugin uses the open-source edition only: the accounts come
from Vikunja's own command, and there is no time to log on a task.

The site's own values, its secret, are made for it and kept in `vikunja/env` of the project, which only you can read.
The builder never prints them. As Vikunja's image has no shell, the builder reaches its API and its database from the
project's web container, with PHP there (`vikunja/vikunja-site.php`).

**The login limit is a dev and test setting.** Vikunja allows a set number of requests a minute before a login from one
address, 10 by default, even with its rate limit off. A test suite logs in far more often than a person, so a site the
workspace builds allows 100: `--login-limit` (or `site_vikunja_login_limit` in the folder's settings) sets another,
and `--login-limit 10` builds a site with Vikunja's own default. Only the sites the builder makes get it: a Vikunja you
point the dashboard at, with `--connect` or by hand, keeps its own limit, and the plugin never changes it.

### The default accounts

| Account | Name | What Webship site gives them |
| --- | --- | --- |
| `owner` | Owner Test | Its owner |
| `member` | Member Test | Read & write |
| `reader` | Reader Test | Read only: reads, and neither changes nor comments |
| `stranger` | Stranger Test | Nothing: the project is not shared with them |

Each has the password of the workspace's other default lists, `dD.123123ddd`, logs in with its username or its address
(`member@example.com`), and shows as its name. They are configuration: a test suite never creates or deletes one.
`bash cmd-tools-add-users.sh mysite vikunja` and `bash cmd-tools-cancel-users.sh mysite vikunja` (the row's Tests
menu) add them and keep them from logging in.

### The sample content

Webship site (key `WEB`), owned by owner and shared with member (read & write) and reader (read only): "The greeting
script says Helo instead of Hello" (WEB-1, by owner, high, labelled bug, assigned to member, in the board's Doing, with
owner's comment) and "The usage line spells greeting as greting" (WEB-2, by member, in To-Do). The builder makes them
through Vikunja's API, as their authors.

## The tool

```bash
bash cmd-tools-vikunja-cli.sh mysite                                  # what the site is: release, address, accounts
bash cmd-tools-vikunja-cli.sh mysite --run "user list"                # one of Vikunja's own commands, in its container
bash cmd-tools-vikunja-cli.sh mysite --sample-content                 # the sample content, where it is missing
bash cmd-tools-vikunja-cli.sh mysite --tidy                           # what a stopped test run left
bash cmd-tools-vikunja-cli.sh mysite --add-users                      # the default accounts, their passwords back
bash cmd-tools-vikunja-cli.sh mysite --cancel-users                   # keep them from logging in
bash cmd-tools-vikunja-cli.sh mysite --connect member                 # the dashboard reads this site as member
```

`--connect <login>` makes a new API token of a default account through Vikunja's API, as that account, with the
permissions the dashboard needs (tasks, comments, labels, assignees, the projects, their sharing, views and buckets),
revokes the earlier one of the same title, and writes the token, with the site's address, into
`core/config/plugin.vikunja.settings.yml`, and the sample project as the default one when none was set. The token is
never shown. The dashboard then acts as that person.

`--tidy` deletes for good, with no way back. It removes the tasks a stopped test run left: titled "Webship test …",
made by one of the default accounts in Webship site, with what Vikunja keeps of them in tables of their own (comments,
assignees, labels, places on the board and in the lists, reminders, relations, subscriptions, reactions). A task with
another title ("Webship testing plan") or another author stays, and so does everything of other people.

## The tasks as work items

The plugin is a provider of the tracker family. With a Vikunja address and an API token in its settings (`--connect`
writes both for a site the workspace built; for your own Vikunja, Settings → API Tokens), the project rows of sites
and code folders carry the **VIKUNJA** menu, once they have a Vikunja project to work against (`default_scope` as the
project's title, `Webship site`, or one remembered from the list):

- **The list**: the open tasks (not done), mine, assigned to someone, and a search in the title. A task's state is its
  bucket on the project's board (To-Do, Doing, Done by default). Vikunja has no sprint: there is no iteration view.
- **One task** (`WEB-1`, its project's key and its number; `#1` and `1` too): its text, its author with their standing,
  and its comments.
- **Analyze**: the AI CLI reads it and proposes a plan, with reading tools only.
- **Do the work**: the AI CLI works it on a new branch of the project (or a worktree), made from the default branch of
  the project's remote, in a screen session you watch. The task is saved as data, never as instructions; an HTML
  comment in its text stays as it was written.
- **Result**: the branch, its commits and the notes, the reviewer role, and the comment to post.
- With writes on (`allow_writes: true`): a comment, a move to another bucket of the board (Done marks the task done),
  labels the account can use (Vikunja's labels belong to the people who make them), an assignee (`me`, or someone the
  project is shared with read & write or admin, or its owner, by their name or username) and a new task, each your
  click after a preview. The text the dashboard writes is Markdown; Vikunja keeps HTML, so the plugin turns it into the
  HTML Vikunja's editor reads, with every character of the text escaped.

**Who is inside.** Each person's standing is what the project gives them: its owner and an admin share are owners of
it, a read & write share a member; they are inside. Someone the project is shared with read only, and someone it is not
shared with, are outside. A team's share counts for its members. A task made by someone outside is analyze only unless
you confirm it by its author's name (`outsider_items: refuse` refuses it), and each comment's author counts on their own.

**The last editor** is the task's creator: Vikunja keeps no history of a task.

**Credentials.** The token travels in a file only you can read, never on a command line. Before anything is posted,
the text is checked for credentials: the ones the tracker family knows, the token of the settings, and anything shaped
like a Vikunja API token (`tk_` and its secret).

Vikunja opens no pull request: push the branch and open its pull request from the project's forge menu (GITHUB,
GITLAB) when its remote is on a forge.

### Settings

`core/config/plugin.vikunja.settings.yml` (Settings → Plugins → Vikunja):

| Key | What it is |
| --- | --- |
| `url` | The Vikunja address, without a trailing slash |
| `token` | An API token of the account the dashboard reads (and, with writes on, writes) as. Never printed |
| `allow_writes` | Comments, moves on the board, labels, assignees and new tasks to Vikunja; `false` by default |
| `max_agents` | Author sessions at once |
| `default_scope` | The Vikunja project a workspace project works against when it remembers none: its title, `Webship site` |
| `scopes` | The Vikunja projects (their titles) the list may be switched to; empty is any project the account can see |
| `work_in` | `branch` (a new branch in the project) or `worktree` (outside the workspace folders) |
| `sandbox` | `required` (the AI CLI's sandbox, and no session without it) or `off` (a person's choice) |
| `network_domains` | The domains the sandbox allows (the project's package registries) |
| `allow_web` | Web fetch and web search in the author session |
| `comments_from` | The comments a saved task keeps: `members` (its owner, admin and read & write shares), `all`, `none` |
| `outsider_items` | A task from outside the project: `analyze` (work it only after a confirmation by name) or `refuse` |

## Testing a site

```bash
bash cmd-tools-testing.sh mysite                       # webship-js, the step pack, the users registry, a first feature
bash cmd-tools-testing.sh mysite --run
```

The testing setup adds `@webship-js/vikunja-steps` to the project, its step definitions to `cucumber.js`, the managing
account (`owner`, which makes and removes the test content through the site's own API), the project of the steps
(`Webship site`), the users registry (`owner`, `member`, `reader`, `stranger`, each logging in with its username), and
`tests/features/site.feature`, whose first scenario checks the site opens on its login form. The suite leaves the site
as it found it.

## AI items

| Kind | Item | What it is for |
| --- | --- | --- |
| Agent | `vikunja-site-builder` | Build, look after and remove Vikunja sites |
| Agent | `vikunja-tester` | Test a site with the step pack: look at the screens first, write scenarios, run, read |
| Agent | `vikunja-issue-worker` | Work a task on a branch, the writes left to a person |
| Skill | `vikunja-scenarios` | The pack's phrases by area, the traps found on real sites, whole features |
| Command | `/vikunja-test <site>` | Set the testing stack up, run the suite, report |
| Prompt | `vikunja-build-and-test` | Build a site and prove it with its first feature |
| Prompt | `vikunja-issue-to-branch` | Work a task on a branch |

## License

ISC (see `LICENSE`). Vikunja itself is AGPL-3.0: the plugin runs Vikunja's own image and carries none of its code.
