#!/usr/bin/env bash
# Vikunja on Docker Compose, Podman and Kubernetes (rt_serve, webship/workspace#841): the web container runs this as the
# host user, from the project's folder, once the project's database takes connections. Vikunja stops at once when its
# database does not answer at its start, so it starts from here, after the stack's wait, and not as a service of the
# project's own (webship/workspace#946). The site's values go into the environment, the folder of its files is made in
# the project, and then Vikunja's own binary serves the project's address itself (its API and its screens). On DDEV
# Vikunja's own image is a service of the project, and this is not used.
here="$(cd "$(dirname "$0")" && pwd)"
set -a
# shellcheck disable=SC1091
. "${here}/env" || exit 1
set +a
mkdir -p "${here}/files" || exit 1
cd "${here}" || exit 1
exec /usr/local/bin/vikunja
