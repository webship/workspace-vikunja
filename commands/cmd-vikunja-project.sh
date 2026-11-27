#!/usr/bin/env bash

# workspace-name: Vikunja (to-do and project management)

# Installed by the Vikunja plugin (plugins.sh --install vikunja); __WORKSPACE__ is the workspace it was installed into.
#
# Build a Vikunja site in containers from Vikunja's own image, on the project's own MariaDB: on DDEV at
# https://<name>.ddev.site, or with --runtime docker, podman or kubernetes at the address the runtime gives it. With
# --install Vikunja's own command makes the workspace account the instance's first account and its admin; with
# --add-users the default accounts; with --sample-content the project Webship site shared with them, its tasks, a
# label, an assignee, a comment and its board.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.__WORKSPACE__.settings.yml);

# Distribution.
distribution_name="vikunja";
distribution_title="Vikunja";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} site in __WORKSPACE__"
# The args file comes with the plugin: core/scripts/plugins/vikunja/ is where plugins.sh --install puts it.
source ${WORKSPACE_SCRIPTS}/plugins/vikunja/args/arg-vikunja.sh || exit 1 ;

shift $#;

vikunja_build ;
