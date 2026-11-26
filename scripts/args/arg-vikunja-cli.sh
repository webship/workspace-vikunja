#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the Vikunja project in this folder.')
parser.add_argument('-r', '--run',
                    default="_none_",
                    help='Run one of Vikunja\'s own commands (vikunja <command>) in its container. Example: --run "user list"')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='Make the default accounts (owner, member, reader, stranger) through Vikunja\'s admin API, or give them back their names and their access.')
parser.add_argument('-c', '--cancel-users',
                    action='store_true',
                    default=False,
                    help='Keep the default accounts from logging in: their work stays.')
parser.add_argument('-s', '--sample-content',
                    action='store_true',
                    default=False,
                    help='Add the sample content the step pack and the tracker are tested on, where it is missing: the project Webship site and its sharing, its tasks, a label, an assignee, a comment.')
parser.add_argument('-t', '--tidy',
                    action='store_true',
                    default=False,
                    help='Remove for good what a test run that was stopped half way left: its tasks, titled "Webship test …" and made by one of the default accounts in the project Webship site, with what Vikunja keeps of them (comments, assignees, labels, places on the board). Nothing else is touched.')
parser.add_argument('--connect',
                    default="_none_",
                    help='Point the dashboard\'s Vikunja at this site as a default account: a new API token of it goes into core/config/plugin.vikunja.settings.yml (never shown, its earlier one revoked), with the site\'s address. Example: --connect member')
ARGEOF
