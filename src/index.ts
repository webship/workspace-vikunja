/**
 * Vikunja for Webship Workspace: a platform plugin and a provider of the tracker family.
 *
 * What the package carries is placed by the installer from the manifest: the builder and the tool in the sites
 * folders, their functions and argparse under core/scripts/plugins/vikunja/ (with the compose file of Vikunja's
 * service, the PHP script the builder runs with Vikunja's own code in its container, and the first feature of a
 * site), and its AI items (ai/ in this package) in the folder of their kind.
 *
 * What register() adds: the tasks of a Vikunja as work items (@webship.co/workspace-tracker): the VIKUNJA menu on
 * the project rows of sites and code folders that work against a Vikunja project, the list, one task, analyze, do
 * the work with the workspace's AI CLI on a branch, and, with writes on, a comment, a status, tags, an assignee and
 * logged time, each a person's click after a preview. And what the assistant is told.
 *
 * Everything the dashboard is asked for goes through `api`; this package requires nothing from the dashboard's own
 * files, so it can be installed from npm and removed without a trace.
 */

import type { PluginApi } from '@webship.co/workspace-plugin-api';
import { registerTracker } from '@webship.co/workspace-tracker';

import { vikunjaTracker } from './lib/tracker';

export { vikunjaTracker };

/** The plugin's name: a site is a generic project in containers that the plugin claims, and the core's tools call its functions under it. */
export const PLATFORM = 'vikunja';

/** The commands the installer places in every sites folder. */
export const COMMANDS = ['cmd-vikunja-project.sh', 'cmd-tools-vikunja-cli.sh'];

/** The agents the installer places in the AI Agents folder. */
export const AGENTS = ['vikunja-site-builder', 'vikunja-tester', 'vikunja-issue-worker'];

/** The skill the installer places in the AI Skills folder (a folder each, with its SKILL.md). */
export const SKILLS = ['vikunja-scenarios'];

/** The slash command the installer places in the AI Commands folder. */
export const AI_COMMANDS = ['vikunja-test'];

/** The prompts the installer places in the AI Prompts folder: each a whole launch command for a new session. */
export const PROMPTS = ['vikunja-build-and-test', 'vikunja-issue-to-branch'];

/** What the assistant is told about Vikunja sites in this workspace (the tasks are told by the tracker). */
export function assistantContext(): string {
  return [
    'Vikunja (a plugin, @webship.co/workspace-vikunja), the open-source project management software: a site is built with',
    '`bash cmd-vikunja-project.sh <name> --install --add-users --sample-content` from a sites folder (dev, test, sandboxes, demos):',
    'Vikunja\'s own image (3.17.0 by default, `--release`) on the project\'s own MariaDB 11.4, on DDEV at https://<name>.ddev.site,',
    'or with `--runtime docker` or `podman` at http://127.0.0.1:<port>, or with `--runtime kubernetes` on the workspace\'s kind cluster at the node\'s address (the image is the web container\'s there, run as the host user, its code moved to /opt/vikunja).',
    'The builder asks for 1.5 GB of free memory before it starts.',
    '`--install` runs Vikunja\'s own installer and makes the workspace account the site\'s owner (its onboarding project, My Project, stays empty: the installer fills it only for a person);',
    '`--add-users` adds the default accounts (owner: Company Manager, member: Editor, commenter: Commenter, reader: Read Only, in the team of the project Webship site; stranger: an Editor outside it), each @example.com;',
    '`--sample-content` adds its tasks #1 and #2, the sprint "Sprint 1", two comments and logged time.',
    '`bash cmd-tools-vikunja-cli.sh <name>` says what the site is and lists its accounts; `--run "<command>"` runs one of Vikunja\'s own console commands in its container,',
    '`--sample-content` adds the sample content later, `--tidy` removes the tasks a stopped test run left ("Webship test …") and what Vikunja keeps of removed tasks, `--add-users` and `--cancel-users` manage the default accounts,',
    'and `--connect <login>` points the dashboard\'s Vikunja at the site as that account (a new bearer token in the plugin\'s settings, never shown, its earlier one revoked).',
    'A Commenter of a Vikunja project reads and comments, and changes no task; a Read Only person only reads; Vikunja logs time on a task (its Time Tracking).',
    '`bash cmd-tools-testing.sh <name>` sets up webship-js with the Vikunja step pack; `--run` runs the suite.',
    `For Vikunja sites hand over to the agent \`${AGENTS[0]}\`, for testing one to \`${AGENTS[1]}\`, for working a task to \`${AGENTS[2]}\`.`,
    `The plugin also places the skill ${SKILLS.map((a) => `\`${a}\``).join(', ')} (the step pack's phrases, by area) in ai-skills/,`,
    `the command ${AI_COMMANDS.map((a) => `\`/${a} <site>\``).join(', ')} in ai-commands/ and the prompts ${PROMPTS.map((a) => `\`${a}\``).join(' and ')} in ai-prompts/.`,
    'Never run Vikunja\'s tools on the host for a project; removing the project removes its database and its files too.',
  ].join(' ');
}

export function register(api: PluginApi): void {
  registerTracker(api, vikunjaTracker(api));
  if (typeof api.addAssistantContext === 'function') api.addAssistantContext(assistantContext);
}
