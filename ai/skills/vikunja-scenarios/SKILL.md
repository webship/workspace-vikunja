---
name: leantime-scenarios
description: Write webship-js scenarios for a Leantime site (the open-source project management software) of the Webship Workspace from phrases that exist — the Leantime step pack's steps by area (logging in and out and a refused login, a project and who may open it, the task list, one task with its status, comments, assignee, logged time and maker, a new task, a sprint, what a Commenter, a Read Only person or an account outside the team may not do, test content), the traps found on real sites, and whole features. Use when asked to write, extend or fix scenarios for a Leantime site, or when a scenario of the site fails on a phrase.
---

# leantime-scenarios

Scenarios for a site built with the Leantime plugin (`bash cmd-leantime-project.sh <site> --install --add-users
--sample-content`) in a container-based workspace (DDEV by default), tested with webship-js and
`@webship-js/leantime-steps` once `bash cmd-tools-testing.sh <site>` set the project up. Every phrase below exists in
the pack or in webship-js; a scenario names no platform.

## Accounts

- `Given I am a logged in user with the "member" user`: `owner` (Company Manager in the team of Webship site),
  `member` (Editor), `commenter` (Commenter), `reader` (Read Only), `stranger` (an Editor outside the team).
  `Given I am not logged in` for a visitor.
- The accounts are made by the build (`cmd-tools-leantime-cli.sh <site> --add-users`); a suite never creates or
  deletes one, and never writes a password: it logs in by the handle. Each logs in with its address
  (`member@example.com`) and shows as its whole name (`Member Test`).

## Phrases by area

| Area | Steps |
| --- | --- |
| Session | `I am a logged in user with the "member" user`, `I log in with the "member" user`, `I log in as "member@example.com" with the password "…"`, `the login should be refused with "Username or password incorrect"`, `I am not logged in`, `I log out`, `I should be logged in as "Member Test"` (or the address), `I should not be logged in` |
| Projects | `I open the project "Webship site"` (its tasks), `I should be refused the project "Webship site"` |
| Test content | `there is a task "Webship test …" in the project "Webship site"` (it goes after the scenario), `there is no task "Webship test …" in the project "Webship site"` |
| The list | `the task list should show "…"` (`should not show`), `I create a task "Webship test …" in the project "Webship site"` (on the board, it goes after the scenario) |
| One task | `I open the task "…"` (its title, or its number "#1"), `I set the status of the task to "In Progress"`, `the status of the task should be "In Progress"`, `I add the comment "…" to the task`, `the task should show the comment "…"` (`… by "Member Test"`), `I assign the task to "Owner Test"`, `the task should be assigned to "Owner Test"`, `I log "1.5" hours on the task with the note "…"`, `the task should have "1.5" hours logged`, `the task should be created by "Owner"` |
| What an account may not do | `I should not be able to change the task`, `I should not be able to comment on the task`, `I should not be able to create a task in the project "Webship site"`, `I should be refused the task "…"`, `I should be refused the project "Webship site"` |
| Sprints | `I open the sprint "Sprint 1" of the project "Webship site"`, `the sprint should list the task "…"` (`should not list`) |

## The sample content

`--sample-content` adds, in Webship site: "The greeting script says Helo instead of Hello" (#1, by the owner, In
Progress, high, assigned to the member, tagged bug, in the sprint "Sprint 1", with the owner's comment "Seen on the
test site: the greeting prints Helo." and 1.5 hours the member logged) and "The usage line spells greeting as
greting" (#2, by the member, New, with the commenter's comment, a word from outside the project's editors). A suite
reads them and never changes them.

## Traps found on real sites

- A task opens in a window over the board: the steps find it by the task's own address, never by its place.
- A screen shows a person its window of help once a session ("I'll explore on my own"); the steps close it by its
  own button and the run says so. The site keeps one window at a time: the steps close the board's before they open a
  task, and ask for the task again when one came over it.
- A comment stays: change only a task the scenario made (`there is a task "Webship test …"`), which goes after it.
- The assignee list offers everyone of the project's team by their whole name, a Commenter and a Read Only person
  too: name the one the scenario means ("Owner Test").
- A Commenter's task window has its Save buttons and lists closed, and comments; a Read Only person's has no comment
  box either.
- A refusal (a wrong password, a project or a task an account may not see) makes the browser log refused requests:
  tag those scenarios `@js-off`.
- Leantime allows a set number of logins and API calls a minute (20 and 120 by default); a site the workspace built
  allows 100 and 1000, and a step that is refused for that says so.
- Leantime's own delete of a task keeps its comments, logged time and history in its database, out of every screen:
  `bash cmd-tools-leantime-cli.sh <site> --tidy` removes them, and the "Webship test …" tasks a stopped run left.

## Whole features

`examples/` holds three features that pass on a site built with `--install --add-users --sample-content`: the session
(`session.feature`), a task worked by an Editor (`issue.feature`) and the roles (`roles.feature`).

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
