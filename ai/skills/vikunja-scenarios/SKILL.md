---
name: vikunja-scenarios
description: Write webship-js scenarios for a Vikunja site (the open-source to-do and project management app) of the Webship Workspace from phrases that exist — the Vikunja step pack's steps by area (logging in and out and a refused login, a project and who may open it, the task list, one task with its done state, comments, labels, assignee, priority and maker, a new task, the board and its buckets, what read-only sharing or none may not do, test content), the traps found on real sites, and whole features. Use when asked to write, extend or fix scenarios for a Vikunja site, or when a scenario of the site fails on a phrase.
---

# vikunja-scenarios

Scenarios for a site built with the Vikunja plugin (`bash cmd-vikunja-project.sh <site> --install --add-users
--sample-content`) in a container-based workspace (DDEV by default), tested with webship-js and
`@webship-js/vikunja-steps` once `bash cmd-tools-testing.sh <site>` set the project up. Every phrase below exists in
the pack or in webship-js; a scenario names no platform.

## Accounts

- `Given I am a logged in user with the "member" user`: `owner` (the owner of Webship site), `member` (read &
  write), `reader` (read only), `stranger` (not shared). `Given I am not logged in` for a visitor.
- The accounts are made by the build (`cmd-tools-vikunja-cli.sh <site> --add-users`); a suite never creates or
  deletes one, and never writes a password: it logs in by the handle. Each logs in with its username (`member`) and
  shows as its name (`Member Test`).

## Phrases by area

| Area | Steps |
| --- | --- |
| Session | `I am a logged in user with the "member" user`, `I log in with the "member" user`, `I log in as "member" with the password "…"`, `the login should be refused with "Wrong username or password"`, `I am not logged in`, `I log out`, `I should be logged in as "Member Test"` (or the username), `I should not be logged in` |
| Projects | `I open the project "Webship site"` (its list), `I should be refused the project "Webship site"` |
| Test content | `there is a task "Webship test …" in the project "Webship site"` (it goes after the scenario), `there is no task "Webship test …" in the project "Webship site"` |
| The list | `the task list should show "…"` (`should not show`), `I create a task "Webship test …" in the project "Webship site"` (through "Add a task…", it goes after the scenario) |
| One task | `I open the task "…"` (its title, or its key "WEB-1"), `I mark the task done`, `I mark the task undone`, `the task should be done` (`should not be done`), `I add the comment "…" to the task`, `the task should show the comment "…"` (`… by "Member Test"`), `I add the label "bug" to the task`, `the task should have the label "bug"`, `I assign the task to "Owner Test"`, `the task should be assigned to "Owner Test"`, `the task should be created by "Owner Test"`, `I move the task to the trash`, `the task should be in the trash` (`should not be in the trash`), `I restore the task from the trash` |
| What an account may not do | `I should not be able to change the task`, `I should not be able to comment on the task`, `I should not be able to create a task in the project "Webship site"`, `I should be refused the task "…"`, `I should be refused the project "Webship site"` |
| The board and the table | `I open the board of the project "Webship site"`, `the bucket "Doing" should list the task "…"` (`should not list`), `I move the task "…" to the bucket "Doing"` (from its own page, opened from its card), `I open the table of the project "Webship site"`, `the table should show the task "…"` (`should not show`), `the table row of the task "…" should show "Done"` (its key, Done, a label, a due date) |

## The sample content

`--sample-content` shares Webship site (`WEB`), owned by owner, with member (read & write) and reader (read only),
and adds "The greeting script says Helo instead of Hello" (WEB-1, by owner, high, labelled bug, assigned to member, in
the bucket Doing, with owner's comment "Seen on the test site: the greeting prints Helo.") and "The usage line spells
greeting as greting" (WEB-2, by member, in To-Do). A suite reads them and never changes them.

## Traps found on real sites

- The session is kept in the page's storage (a token), with a cookie that renews it: the steps put both back. A login
  through the API sets that cookie too, so the pack's API calls never share the browser's cookies.
- A task has a page of its own (`/tasks/<id>`), and shows its project's key and number ("WEB-1").
- A comment stays: change only a task the scenario made (`there is a task "Webship test …"`), which goes after it.
- A deleted task goes to Vikunja's trash for 30 days, with everything attached to it; the pack takes a scenario's task
  out of the trash too. The trash page lists the trashed tasks of the projects an account may change: read-only
  sharing sees none there.
- A task's page offers the board's buckets under its title only when it was opened from its card on the board.
- Marking a task done moves it to the board's Done bucket, and back out when it is undone.
- Labels belong to the people who make them: a label is added by its title, and the account must be able to use it.
- An assignee is someone the project is shared with read & write, or its owner: read-only sharing gives no tasks.
- A refusal (a wrong password, a project or a task an account may not see) and a logout make the browser log refused
  requests: tag those scenarios `@js-off`.
- Vikunja allows a set number of requests a minute before a login (10 by default); a site the workspace built allows
  100, and a step that is refused for that says so.
- A run that was stopped half way leaves its "Webship test …" tasks: `bash cmd-tools-vikunja-cli.sh <site> --tidy`
  removes them, live or in the trash.

## Whole features

`examples/` holds three features that pass on a site built with `--install --add-users --sample-content`: the session
(`session.feature`), a task worked by a member (`issue.feature`) and the roles (`roles.feature`).

## The book

For any automated functional testing in this work (a Gherkin feature, a step definition, choosing a
step, a test run and its failures), read the book *Automated Functional Testing Recipes* first.

- **Where.** Use the first that exists: `.claude/automated-functional-testing-recipes/` in the project,
  `~/.claude/automated-functional-testing-recipes/` (installed by webship/webship-js-ai-agent,
  webship/webship-js-skills or webship/ai-agents), or
  https://github.com/webship/webship-js-ai-agent/tree/2.0.x/automated-functional-testing-recipes
- **How.** Its `README.md` first, then the chapter that matches the task (one file per chapter,
  named by its subject), not the single complete file.
- **Which wins.** The installed webship-js package and the step pack are the source of truth for
  step phrasing. When they differ from the book, follow them and say so.
- **For a site.** Start with `ch10-authentication-authorization.md` (logins, refusals and what each role may do),
  `ch07-waiting-dynamic-content.md` (waiting on the app's own signals) and `ch26-testing-cms-applications.md`
  (content made and removed, roles, a workflow across roles).
