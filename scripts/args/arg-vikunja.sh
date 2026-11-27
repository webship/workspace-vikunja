#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project: its folder, its project in containers and its host name.')
parser.add_argument('--runtime',
                    dest='RUNTIME',
                    default="_none_",
                    choices=['ddev', 'docker', 'podman', 'kubernetes'],
                    help='The container runtime to build on: ddev (the default), docker (Docker Compose), podman or kubernetes. Vikunja is not proven on Lando or Docksal yet.')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Make the workspace account the instance\'s first account and its admin, with Vikunja\'s own command; sign-ups stay closed.')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='With --install, add the default accounts (owner: the sample project\'s owner, member: read and write, reader: read only, stranger: not shared): the ones the test scenarios log in as.')
parser.add_argument('-s', '--sample-content',
                    action='store_true',
                    default=False,
                    help='With --install and --add-users, add the sample content the step pack and the tracker are tested on: the project Webship site shared with the default accounts, its tasks, a label, an assignee, a comment and its board.')
parser.add_argument('-v', '--release',
                    dest='VIKUNJA_VERSION',
                    default="",
                    help='The release of the site (a tag of Vikunja\'s image): 2.8.0 by default. Example: --release 2.8.0')
parser.add_argument('--login-limit',
                    dest='LOGIN_LIMIT',
                    default="",
                    help='How many requests a minute before a login Vikunja allows from one address on this site: a dev and test setting, 100 by default; Vikunja\'s own is 10. Example: --login-limit 10')
parser.add_argument('-l', '--launch',
                    action='store_true',
                    default=False,
                    help='Open the site in a browser when it is ready.')
ARGEOF
