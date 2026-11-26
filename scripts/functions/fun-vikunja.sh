#!/usr/bin/env bash

# Vikunja for the Webship Workspace: build a site of Vikunja (the open-source to-do and project management app) from
# its own image, run Vikunja's own commands in its container, add its default accounts and share a sample project with
# them in their permissions, add its sample content, and wire its step pack into the testing setup.
#
# Placed by `plugins.sh --install vikunja` in core/scripts/plugins/vikunja/functions/, where bootstrap sources it after
# the core's own functions. Everything runs in containers, never on the host:
#   - DDEV (the default): Vikunja's image is a service of a generic project, on the project's own MariaDB (the db
#     service), at https://<name>.ddev.site, run as the host user; the project's web container keeps the mail catcher.
# Docker Compose, Podman, Kubernetes, Lando and Docksal are not proven yet: asked for one, the builder says so and
# changes nothing.
# Vikunja's image has no shell: its own commands run with `docker exec` of its binary, and the site's accounts and
# content go through its API from the project's web container (vikunja-site.php, with PHP there). Passwords and
# tokens travel on an input, never on a command line: the first account's password reaches Vikunja's own command
# through a pseudo-terminal, from a file only its owner reads, removed after.
#
# The container tool has no project type for Vikunja, so a site of this plugin is recognised by a file on DDEV
# (.ddev/config.vikunja.yaml, written by the builder).
# Four names are the ones the core's tools look for:
#   set_vikunja_users          the default accounts                     (cmd-tools-add-users.sh <project> vikunja)
#   add_vikunja_users          make them, and their sharing              (the same tool, and --add-users of the builder)
#   cancel_vikunja_users       keep them from logging in                (cmd-tools-cancel-users.sh <project> vikunja)
#   testing_configure_vikunja  the step pack in the testing stack       (cmd-tools-testing.sh <project>)

# The step pack a site is tested with, and the release line it is required at.
readonly VIKUNJA_STEPS_PACKAGE='@webship-js/vikunja-steps';
readonly VIKUNJA_STEPS_VERSION='^2.0.0';

# The release the builder runs when none is asked for (a tag of Vikunja's image).
readonly VIKUNJA_DEFAULT_RELEASE='2.8.0';

# The sample project the default accounts share, its key, and the folder of a site with the plugin's script, the
# site's own values and Vikunja's files.
readonly VIKUNJA_PROJECT_NAME='Webship site';
readonly VIKUNJA_PROJECT_KEY='WEB';
readonly VIKUNJA_FILES='vikunja';

# The free memory a build asks for, in MB: Vikunja, beside MariaDB.
readonly VIKUNJA_MEMORY_MB=1024;

# The database of a site: Vikunja supports MySQL, MariaDB, PostgreSQL and SQLite, and the Workspace uses MariaDB, so a
# site's database is the same on every runtime.
readonly VIKUNJA_DATABASE='mariadb:11.4';

# How many requests a minute Vikunja allows from one address before a login (its log-in, sign-up and confirmation
# forms) on a site the builder makes (--login-limit, or site_vikunja_login_limit of the folder's settings): a dev and
# test setting. Vikunja's own is 10, and it holds even with its rate limit off; a test suite logs in more often than a
# person. A Vikunja the dashboard is connected to with --connect keeps its own: nothing here touches it.
readonly VIKUNJA_LOGIN_LIMIT=100;

# The default accounts, the ones a scenario logs in as, each with what the sample project gives them: its owner (owner),
# read & write (member), read only (reader), and none (stranger). Vikunja logs in with the username or the e-mail
# address, and shows the name. Accounts are configuration, made once on the site; a test suite never creates or
# deletes one. The workspace account the builder makes with --install is the instance's admin, not in this list.
function set_vikunja_users() {
  users=(owner member reader stranger);
  local user ;
  for user in "${users[@]}" ; do
    printf -v "user_${user}_name" '%s' "${user}" ;
    printf -v "user_${user}_mail" '%s' "${user}@example.com" ;
    printf -v "user_${user}_password" '%s' 'dD.123123ddd' ;
    printf -v "user_${user}_fullname" '%s' "${user^} Test" ;
  done
  user_owner_role='owner' ;
  user_member_role='write' ;
  user_reader_role='read' ;
  user_stranger_role='' ;
}

# The runtime of the project in this folder, or of a new build (--runtime, else the workspace's setting, else DDEV).
# A core without the runtime layer has DDEV only.
function vikunja_runtime() {
  if declare -f runtime_of > /dev/null ; then runtime_of "$@" ; else echo 'ddev' ; fi
}

# The address of the site in this folder (or of a new build named PROJECT_NAME, on DDEV).
function vikunja_url() {
  echo "https://${1:-${PROJECT_NAME}}.ddev.site" ;
}

# Is this folder a Vikunja site of this plugin? On DDEV the builder leaves .ddev/config.vikunja.yaml in it.
function vikunja_is_project() {
  local project_path="$1" ;
  [ -f "${project_path}/.ddev/config.vikunja.yaml" ] && return 0 ;
  if declare -f rt_is_platform > /dev/null ; then rt_is_platform "${project_path}" vikunja ; return $? ; fi
  return 1 ;
}

# Go to the project a tool was asked about, or say why not.
function vikunja_enter_project() {
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  if [ ! -d "${project_path}" ] ; then
    echo "No project ${PROJECT_NAME} in ${WORKSPACE_ROOT}/${doc_name}." ;
    return 1 ;
  fi
  if ! vikunja_is_project "${project_path}" ; then
    echo "${doc_name}/${PROJECT_NAME} is not a Vikunja site of this plugin." ;
    return 1 ;
  fi
  vikunja_refresh_files "${project_path}" || return 1 ;
  cd "${project_path}" || return 1 ;
}

# The site's copy of the plugin's script (vikunja/), brought up to the installed plugin's, so a plugin updated with
# --install reaches the sites built before it. The site's own values (vikunja/env) and files are left as they are.
function vikunja_refresh_files() {
  local project_path="$1" from="${WORKSPACE_SCRIPTS}/plugins/vikunja" ;
  [ -d "${project_path}/${VIKUNJA_FILES}" ] || return 0 ;
  if [ -f "${from}/vikunja-site.php" ] && ! cmp -s "${from}/vikunja-site.php" "${project_path}/${VIKUNJA_FILES}/vikunja-site.php" ; then
    cp "${from}/vikunja-site.php" "${project_path}/${VIKUNJA_FILES}/vikunja-site.php" || return 1 ;
  fi
}

# A value of the site's own values (vikunja/env), never printed by the tools: VIKUNJA_RELEASE.
function vikunja_setting() {
  sed -n "s/^$1=\\(.*\\)\$/\\1/p" "${2:-.}/${VIKUNJA_FILES}/env" 2>/dev/null | head -n 1 ;
}

# A value made for this site only: letters and digits.
function vikunja_secret() {
  head -c 200 /dev/urandom | base64 -w0 | tr -dc 'A-Za-z0-9' | head -c "${1:-64}" ;
}

# The free memory of this machine, in MB (what the kernel says is available).
function vikunja_free_memory() {
  awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null ;
}

# Write the project's files: Vikunja's service (.ddev/docker-compose.vikunja.yaml), its image in .ddev/.env, the claim
# (.ddev/config.vikunja.yaml), the plugin's script, and the folder of Vikunja's files, the host user's.
function vikunja_write_config() {
  local project_path="$1" release="$2" ;
  local from="${WORKSPACE_SCRIPTS}/plugins/vikunja" f ;
  for f in docker-compose.vikunja.yaml vikunja-site.php ; do
    if [ ! -f "${from}/${f}" ] ; then
      echo "${f} is not in ${from}: install the plugin (plugins.sh --install vikunja)." ;
      return 1 ;
    fi
  done
  mkdir -p "${project_path}/${VIKUNJA_FILES}/files" || return 1 ;
  cp "${from}/vikunja-site.php" "${project_path}/${VIKUNJA_FILES}/" || return 1 ;
  cp "${from}/docker-compose.vikunja.yaml" "${project_path}/.ddev/docker-compose.vikunja.yaml" || return 1 ;
  printf 'VIKUNJA_IMAGE=%s\n' "docker.io/vikunja/vikunja:${release}" > "${project_path}/.ddev/.env" || return 1 ;
  cat > "${project_path}/.ddev/config.vikunja.yaml" <<YAMLEOF
# Vikunja in this project: its service (docker-compose.vikunja.yaml), its image in .env, the site's own values in
# ../vikunja/env and its files in ../vikunja/files. Written by the Vikunja builder of the workspace; build again rather
# than editing.
web_environment:
  - VIKUNJA_RELEASE=${release}
YAMLEOF
}

# The site's own values (vikunja/env, which only you can read): the address, the project's database, the mail
# catcher, sign-ups closed, and its secret, of this site only.
function vikunja_write_env() {
  local project_path="$1" release="$2" base_url="$3" login_limit="${4:-${VIKUNJA_LOGIN_LIMIT}}" ;
  ( umask 077 && cat > "${project_path}/${VIKUNJA_FILES}/env" <<ENVEOF
# The values of this Vikunja site, made by the Vikunja builder of the workspace: its secret is of this site only.
# Read by Vikunja's container; never printed.
VIKUNJA_RELEASE=${release}
VIKUNJA_SERVICE_PUBLICURL=${base_url}/
VIKUNJA_SERVICE_SECRET=$(vikunja_secret 64)
VIKUNJA_SERVICE_ENABLEREGISTRATION=false
VIKUNJA_SERVICE_TIMEZONE=UTC
VIKUNJA_DATABASE_TYPE=mysql
VIKUNJA_DATABASE_HOST=db
VIKUNJA_DATABASE_USER=db
VIKUNJA_DATABASE_PASSWORD=db
VIKUNJA_DATABASE_DATABASE=db
VIKUNJA_MAILER_ENABLED=true
VIKUNJA_MAILER_HOST=web
VIKUNJA_MAILER_PORT=1025
VIKUNJA_MAILER_AUTHTYPE=plain
VIKUNJA_MAILER_USERNAME=
VIKUNJA_MAILER_PASSWORD=
VIKUNJA_MAILER_SKIPTLSVERIFY=true
VIKUNJA_MAILER_FORCESSL=false
VIKUNJA_MAILER_FROMEMAIL=vikunja@example.com
# The requests a minute before a login, from one address (--login-limit): a dev and test setting, as a test suite logs
# in more often than a person; Vikunja's own is 10.
VIKUNJA_RATELIMIT_NOAUTHLIMIT=${login_limit}
ENVEOF
  ) ;
}

# The name of Vikunja's container of the project in this folder.
function vikunja_container() {
  echo "ddev-$(sed -n 's/^name:[[:space:]]*"\{0,1\}\([A-Za-z0-9._-]*\)"\{0,1\}[[:space:]]*$/\1/p' .ddev/config.yaml | head -n 1)-vikunja" ;
}

# One of Vikunja's own commands (`vikunja <command>…`), in its container: its image has no shell, so its binary runs
# by itself, with the container's own values.
function vikunja_cli() {
  docker exec "$(vikunja_container)" /app/vikunja/vikunja "$@" ;
}

# Vikunja's command that asks for a password (user create, user reset-password): the password reaches it through a
# pseudo-terminal, twice, from a file only its owner reads, which goes after; never on a command line or in a log.
function vikunja_cli_password() {
  local password="$1" ; shift ;
  local file ; file="$(umask 077 && mktemp)" || return 1 ;
  printf '%s\n%s\n' "${password}" "${password}" > "${file}" ;
  local quoted ; quoted="$(printf '%q ' docker exec -it "$(vikunja_container)" /app/vikunja/vikunja "$@")" ;
  # What the command says (the terminal does not echo the password) is shown when it fails.
  local said ; said="$(script -q -e -c "${quoted}" /dev/null < "${file}" 2>&1)" ;
  local status=$? ;
  rm -f "${file:?}" ;
  [ ${status} -eq 0 ] || printf '%s\n' "${said}" | tr -d '\r' | grep -v 'Password: *$' | tail -n 3 >&2 ;
  return ${status} ;
}

# Run verbs of vikunja-site.php (version, accounts, content, tidy, list, token, counts) with PHP in the project's web
# container. A payload (accounts, passwords, a login) travels on the input, never on a command line.
function vikunja_site() {
  ddev exec "php /var/www/html/${VIKUNJA_FILES}/vikunja-site.php $*" ;
}

# The answer of Vikunja's info, asked inside the project's network from the web container: 200 once it serves.
function vikunja_probe() {
  ddev exec "curl -s -o /dev/null -m 10 -w '%{http_code}' http://vikunja:3456/api/v1/info" < /dev/null 2>/dev/null | tr -d '\r' | tail -1 ;
}

# Wait until the site answers, in the project's folder: up to five minutes, as the first start makes its tables.
function vikunja_wait() {
  local attempt code="" ;
  for attempt in $(seq 1 100) ; do
    code="$(vikunja_probe)" ;
    [ "${code}" = '200' ] && return 0 ;
    sleep 3 ;
  done
  echo "Vikunja did not answer (its info: ${code:-none}); the end of its log:" ;
  ddev logs -s vikunja --tail 40 < /dev/null 2>/dev/null ;
  return 1 ;
}

# The release the site runs, as Vikunja says it.
function vikunja_version() {
  ( cd "${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" 2>/dev/null && vikunja_site version < /dev/null 2>/dev/null ) | tr -d '\r' | sed -n 's/^VERSION //p' | tail -n 1 ;
}

# The payload of vikunja-site.php, as the base64 of its JSON: the instance admin's login ("login|password" in
# VIKUNJA_ADMIN), and rows of accounts ("login|mail|password|name|role|action" lines in VIKUNJA_ROWS), which travel to
# Python in the environment, never on a command line.
function vikunja_payload() {
  VIKUNJA_ADMIN="$1" VIKUNJA_ROWS="$2" python3 -c '
import base64, json, os
admin = os.environ["VIKUNJA_ADMIN"].split("\x1f") if os.environ["VIKUNJA_ADMIN"] else ["", ""]
rows = []
for line in os.environ["VIKUNJA_ROWS"].split("\x1e"):
    if not line:
        continue
    login, mail, password, name, role, action = line.split("\x1f")
    rows.append({"login": login, "mail": mail, "password": password, "name": name, "role": role, "action": action})
print(base64.b64encode(json.dumps({"admin": {"login": admin[0], "password": admin[1]}, "rows": rows}).encode()).decode())' ;
}

# The rows of the default accounts (set_vikunja_users), with an action.
function vikunja_rows() {
  local action="$1" user user_name user_mail user_password user_fullname user_role rows="" ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail"; user_password="user_${user}_password";
    user_fullname="user_${user}_fullname"; user_role="user_${user}_role";
    rows="${rows}${!user_name}"$'\x1f'"${!user_mail}"$'\x1f'"${!user_password}"$'\x1f'"${!user_fullname}"$'\x1f'"${!user_role}"$'\x1f'"${action}"$'\x1e' ;
  done
  printf '%s' "${rows}" ;
}

# The sample content, made as its authors (the default accounts' logins on the input).
function vikunja_content() {
  set_vikunja_users ;
  vikunja_payload '' "$(vikunja_rows '')" | vikunja_site content ;
}

# Build a Vikunja site from nothing: the project and Vikunja; with --install the workspace account as the instance's
# first account and its admin, sign-ups closed; with --add-users the default accounts and their sharing of the sample
# project; with --sample-content its tasks, a label, an assignee, a comment and its board.
function vikunja_build() {
  trim_project_name ;
  local release="${VIKUNJA_VERSION:-${site_vikunja_release:-${VIKUNJA_DEFAULT_RELEASE}}}" ;
  release="${release#v}" ;
  local login_limit="${LOGIN_LIMIT:-${site_vikunja_login_limit:-${VIKUNJA_LOGIN_LIMIT}}}" ;
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" ;
  local runtime ; runtime="$(cd "${WORKSPACE_ROOT}/${doc_name}" && vikunja_runtime)" ;

  if [ "${runtime}" != 'ddev' ] ; then
    echo "Vikunja builds on DDEV for now (--runtime ddev), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed." ;
    exit 1 ;
  fi
  if ! [[ "${release}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ; then
    echo "--release takes a release of Vikunja (2.8.0), not ${release}. Nothing was changed." ;
    exit 1 ;
  fi
  if ! [[ "${login_limit}" =~ ^[1-9][0-9]{0,5}$ ]] ; then
    echo "--login-limit takes a number a minute (100, 10), not ${login_limit}. Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${ADD_USERS}" == 'yes' ] && [ "${INSTALL}" != 'yes' ] ; then
    echo "--add-users needs --install: the default accounts are made by the account --install makes." ;
    exit 1 ;
  fi
  if [ "${SAMPLE_CONTENT}" == 'yes' ] && [ "${ADD_USERS}" != 'yes' ] ; then
    echo "--sample-content needs --add-users: the sample project is shared with the default accounts." ;
    exit 1 ;
  fi
  if [ ${#PROJECT_NAME} -gt 40 ] || ! [[ "${PROJECT_NAME}" =~ ^[a-z0-9][a-z0-9-]*$ ]] ; then
    echo "The project name ${PROJECT_NAME} must be small letters, digits and dashes (its address and its containers take it). Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${INSTALL}" == 'yes' ] && [ ${#account_pass} -lt 8 ] ; then
    echo "The workspace account's password (core/config/settings.yml) has fewer than eight characters, which Vikunja asks of a password: --install makes it the instance's first account. Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${INSTALL}" == 'yes' ] && ! command -v script > /dev/null ; then
    echo "--install needs script (util-linux) on this machine: Vikunja's own command takes the first account's password from a terminal only. Nothing was changed." ;
    exit 1 ;
  fi
  local free ; free="$(vikunja_free_memory)" ;
  if [ -n "${free}" ] && [ "${free}" -lt "${VIKUNJA_MEMORY_MB}" ] ; then
    echo "Vikunja needs about ${VIKUNJA_MEMORY_MB} MB of free memory (Vikunja and MariaDB); this machine has ${free} MB available now. Stop a site you do not need, then build again. Nothing was changed." ;
    exit 1 ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name} || exit 1 ;

  # A project of the same name goes first, with its containers and its database.
  drop_database ;
  rm -rf "${PROJECT_NAME:?}" ;
  mkdir -p "${PROJECT_NAME}" ;
  cd "${project_path}" || exit 1 ;

  # A generic project on MariaDB 11.4.
  ddev config --project-type=generic --project-name=${PROJECT_NAME} --database=${VIKUNJA_DATABASE} \
    --nodejs-version=$(ddev_nodejs_version) < /dev/null || exit 1 ;
  vikunja_write_config "${project_path}" "${release}" || exit 1 ;
  local base_url ; base_url="$(vikunja_url)" ;
  vikunja_write_env "${project_path}" "${release}" "${base_url}" "${login_limit}" || exit 1 ;

  echo "Starting the project and Vikunja ${release}: its image is a download of about 55 MB the first time, and the first start makes its tables." ;
  ddev_up start -y < /dev/null || exit 1 ;
  vikunja_wait || exit 1 ;

  if [ "${INSTALL}" == 'yes' ] ; then
    echo "Making the workspace account the instance's first account, with Vikunja's own command." ;
    vikunja_account "${account_name}" "${account_mail:-${account_name}@example.com}" "${account_pass}" \
      || { echo "The workspace account could not be made by Vikunja's own command." ; exit 1 ; } ;
    if [ "${ADD_USERS}" == 'yes' ] ; then
      set_vikunja_users ;
      add_vikunja_users || exit 1 ;
      if [ "${SAMPLE_CONTENT}" == 'yes' ] ; then
        echo "Adding the sample content: the tasks of ${VIKUNJA_PROJECT_NAME}, a label, an assignee, a comment and its board." ;
        ( cd "${project_path}" && vikunja_content ) || exit 1 ;
      fi
      users=() ;
    fi
    echo "${doc_name} ${PROJECT_NAME} has been installed: Vikunja $(vikunja_version).";
    echo "The site: ${base_url}" ;
    echo "The workspace account logs in as ${account_name}; sign-ups are closed." ;
  else
    echo "${doc_name} ${PROJECT_NAME} is ready at ${base_url}: Vikunja $(vikunja_version), sign-ups closed and no account yet.";
    echo "Build it again with --install (and --add-users) for the workspace account and the default accounts.";
  fi

  if [ "${LAUNCH}" == 'yes' ] ; then
    ddev launch ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name};
}

# An account made with Vikunja's own command (`vikunja user create`), its password through a pseudo-terminal, or given
# back its password (`vikunja user reset-password --direct`) when it is there already; then active: with the mailer on,
# Vikunja would wait for the account to confirm its address. Vikunja's admin panel, which could make accounts through
# its API, is a feature of its paid licence, not of its open-source edition.
function vikunja_account() {
  local login="$1" mail="$2" password="$3" ;
  # A row of Vikunja's own list: "│ <id> │ <username> │ …".
  if vikunja_cli user list 2>/dev/null | grep -qE "│ *[0-9]+ *│ *${login} *│" ; then
    vikunja_cli_password "${password}" user reset-password "${login}" --direct || return 1 ;
  else
    vikunja_cli_password "${password}" user create --username "${login}" --email "${mail}" || return 1 ;
  fi
  vikunja_cli user change-status "${login}" --enable > /dev/null 2>&1 ;
}

# Make the default accounts with Vikunja's own command, or give them back their passwords, their names and their access.
# The list is loaded by the caller (set_vikunja_users): the core's add_users, the builder, the tool. Their sharing of
# the sample project comes with the sample content.
function add_vikunja_users() {
  vikunja_enter_project || return 1 ;
  local user user_name user_mail user_password user_role status=0 ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail"; user_password="user_${user}_password"; user_role="user_${user}_role";
    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo "      User mail: ${!user_mail}";
    echo "  User password: ${!user_password}";
    echo "      User role: $([ -n "${!user_role}" ] && echo "${!user_role} of ${VIKUNJA_PROJECT_NAME}" || echo "not shared")";
    echo " ================================================================= ";
    vikunja_account "${!user_name}" "${!user_mail}" "${!user_password}" || { echo "${!user_name} could not be made." ; status=1 ; } ;
  done
  # Their names, as the site shows them.
  vikunja_payload '' "$(vikunja_rows '')" | vikunja_site accounts || status=1 ;
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# Keep the default accounts from logging in (their work stays), never the workspace account.
function cancel_vikunja_users() {
  vikunja_enter_project || return 1 ;
  local user user_name status=0 ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name";
    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo " ================================================================= ";
    vikunja_cli user change-status "${!user_name}" --disable > /dev/null 2>&1 || status=1 ;
  done
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# Point the dashboard's Vikunja (core/config/plugin.vikunja.settings.yml) at this site, as a default account of it: a
# new API token of that account (made through Vikunja's API as the account; its earlier one of the same title is
# revoked) goes into the settings file, which only you can read, never on a screen or in a log; with it the site's
# address, and the sample project as the default one when none was set.
function vikunja_connect() {
  local login="$1" settings="${WORKSPACE_CONFIG}/plugin.vikunja.settings.yml" out token url user found='' ;
  if ! [[ "${login}" =~ ^[A-Za-z0-9._@-]+$ ]] ; then echo "--connect takes the login of a default account of the site." ; return 1 ; fi
  if [ ! -f "${settings}" ] ; then echo "No ${settings}: install the plugin first (plugins.sh --install vikunja)." ; return 1 ; fi
  set_vikunja_users ;
  for user in "${users[@]}" ; do [ "${user}" = "${login%@*}" ] && found="${user}" ; done
  if [ -z "${found}" ] ; then echo "--connect takes a default account of the site (${users[*]}): its token is made with its password." ; return 1 ; fi
  local pass="user_${found}_password" ;
  out="$(VIKUNJA_LOGIN="${found}" VIKUNJA_PASSWORD="${!pass}" python3 -c 'import base64, json, os; print(base64.b64encode(json.dumps({"login": os.environ["VIKUNJA_LOGIN"], "password": os.environ["VIKUNJA_PASSWORD"]}).encode()).decode())' | vikunja_site token 2>/dev/null)" ;
  token="$(printf '%s\n' "${out}" | tr -d '\r' | sed -n 's/^TOKEN //p' | tail -n 1)" ;
  out='' ;
  if ! [[ "${token}" =~ ^tk_[A-Za-z0-9]{20,}$ ]] ; then echo "No token could be made for ${found} (is it an active account of the site?)." ; return 1 ; fi
  url="$(vikunja_url)" ;
  VIKUNJA_NEW_TOKEN="${token}" python3 - "${settings}" "${url}" "${VIKUNJA_PROJECT_NAME}" <<'PYEOF' || return 1
import os, re, sys
path, url, scope = sys.argv[1:4]
token = os.environ['VIKUNJA_NEW_TOKEN']
text = open(path).read()
def put(text, key, value):
    line = '%s: %s' % (key, value)
    if re.search(r'^%s:.*$' % key, text, re.M):
        return re.sub(r'^%s:.*$' % key, lambda m: line, text, count=1, flags=re.M)
    return text.rstrip('\n') + '\n' + line + '\n'
text = put(text, 'url', url)
text = put(text, 'token', token)
if not re.search(r'^default_scope:[ \t]*[^ \t\n"]', text, re.M) and not re.search(r'^default_scope:[ \t]*"[^"]', text, re.M):
    text = put(text, 'default_scope', '"%s"' % scope)
fd = os.open(path + '.new', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(text)
os.replace(path + '.new', path)
PYEOF
  token='' ;
  echo "The dashboard reads the tasks of ${url} as ${found} now: a new API token of that account is in ${settings} (not shown here, its earlier one revoked), and ${VIKUNJA_PROJECT_NAME} is the default project when none was set." ;
}

# What cmd-tools-vikunja-cli.sh does: the first of --run, --add-users, --cancel-users, --sample-content, --tidy,
# --connect that was asked for; with none of them, what the site is and its accounts.
function vikunja_cli_tool() {
  trim_project_name ;
  vikunja_enter_project || exit 1 ;

  # A site that answers is left as it is; one that does not is started.
  [ "$(vikunja_probe)" = '200' ] || ddev start -y < /dev/null || exit 1 ;
  vikunja_wait > /dev/null || { echo "Vikunja of ${PROJECT_NAME} does not answer; start it again (ddev restart in ${doc_name}/${PROJECT_NAME})." ; exit 1 ; } ;

  if [ ! "${RUN}" == '_none_' ] ; then
    # Vikunja's own commands (vikunja <command>…), in its container. Its words, split as a shell would.
    local -a words ;
    read -r -a words <<< "${RUN}" ;
    vikunja_cli "${words[@]}" < /dev/null ;
    exit $? ;
  fi

  set_vikunja_users ;
  if [ "${ADD_USERS}" == 'yes' ] ; then
    add_vikunja_users ;
  elif [ "${CANCEL_USERS}" == 'yes' ] ; then
    cancel_vikunja_users ;
  elif [ "${SAMPLE_CONTENT}" == 'yes' ] ; then
    vikunja_content ;
    vikunja_site list < /dev/null ;
  elif [ "${TIDY}" == 'yes' ] ; then
    # What a test run that was stopped half way left: its tasks ("Webship test …"), with what Vikunja keeps of them.
    vikunja_site tidy list < /dev/null ;
  elif [ "${CONNECT}" != '_none_' ] ; then
    vikunja_connect "${CONNECT}" ;
  else
    echo "${doc_name}/${PROJECT_NAME}: Vikunja $(vikunja_version)" ;
    echo "  the site:  $(vikunja_url)" ;
    echo "" ;
    vikunja_site list < /dev/null ;
  fi
  cd ${WORKSPACE_ROOT}/${doc_name};
}
function testing_configure_vikunja() {
  local project_path="$1";
  vikunja_is_project "${project_path}" || return 0 ;
  if [ ! -f "${project_path}/cucumber.js" ] || [ ! -f "${project_path}/package.json" ] ; then
    echo "  Vikunja: cucumber.js is not here yet — run the testing setup again once webship-js is scaffolded." ;
    return 1 ;
  fi

  echo "Adding the Vikunja step pack (${VIKUNJA_STEPS_PACKAGE} ${VIKUNJA_STEPS_VERSION}).";
  set_vikunja_users ;
  # Vikunja logs in with the username (or the e-mail address), and shows the person's name.
  local registry="" user user_name user_password user_fullname ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_password="user_${user}_password"; user_fullname="user_${user}_fullname";
    registry="${registry}${user}|${!user_name}|${!user_password}|${!user_fullname}"$'\n' ;
  done

  local address ;
  address="$(cd "${project_path}" && vikunja_url "$(sed -n 's/^name:[[:space:]]*"\{0,1\}\([A-Za-z0-9._-]*\)"\{0,1\}[[:space:]]*$/\1/p' .ddev/config.yaml 2>/dev/null | head -n 1)")" ;

  python3 - "${project_path}" "${VIKUNJA_STEPS_PACKAGE}" "${VIKUNJA_STEPS_VERSION}" 'VIKUNJA' "${registry}" "${address}" "${VIKUNJA_PROJECT_NAME}" <<'PYEOF' || return 1
import json, re, sys

project, pack, version, prefix, registry, address, sample = sys.argv[1:8]

# package.json: the pack as a dev dependency, at the release line this plugin was proven on.
pkg_file = project + '/package.json'
pkg = json.load(open(pkg_file))
if pack not in pkg.get('dependencies', {}) and pack not in pkg.get('devDependencies', {}):
    pkg.setdefault('devDependencies', {})[pack] = version
    open(pkg_file, 'w').write(json.dumps(pkg, indent=4) + '\n')
    print('  package.json: %s %s' % (pack, version))

cucumber_file = project + '/cucumber.js'
src = open(cucumber_file).read()
before = src

if ('node_modules/%s/' % pack) not in src:
    line = "'node_modules/%s/tests/step-definitions/**/*.js'," % pack
    core = re.search(r"^([ \t]*)'node_modules/webship-js/tests/step-definitions/[^']*',.*$", src, re.M)
    opening = re.search(r"^([ \t]*)require:[ \t]*\[[ \t]*$", src, re.M)
    if core:
        src = src[:core.end()] + '\n' + core.group(1) + line + src[core.end():]
    elif opening:
        src = src[:opening.end()] + '\n' + opening.group(1) + '  ' + line + src[opening.end():]
    else:
        sys.exit("  cucumber.js has no require list this can add to. Add this line to it:\n    " + line)
    print('  cucumber.js: the step definitions of %s' % pack)

if not re.search(r"^[ \t]*tags:", src, re.M):
    default = re.search(r"^([ \t]*)default:[ \t]*\{[ \t]*$", src, re.M)
    if default:
        pad = default.group(1) + '  '
        block = [
            pad + "// The pack's assertions that must fail are no part of a normal run.",
            pad + "tags: process.env.CUCUMBER_TAGS || 'not @wip and not @must-fail',",
        ]
        src = src[:default.end()] + '\n' + '\n'.join(block) + src[default.end():]
        print('  cucumber.js: the tags that keep the assertions that must fail out of a normal run')

world = re.search(r"^([ \t]*)worldParameters:[ \t]*\{[ \t]*$", src, re.M)
if not world:
    sys.exit("  cucumber.js has no worldParameters block to add the users registry to.")
pad = world.group(1) + '  '
additions = []
if not re.search(r"^[ \t]*manager:", src, re.M):
    additions += [
        pad + "// The account that prepares and removes test content through the site's API: the sample project's owner.",
        pad + "manager: process.env.MANAGER || 'owner',",
    ]
if not re.search(r"^[ \t]*project:", src, re.M):
    additions += [
        pad + "// The project the steps work in when they name none (its name).",
        pad + "project: process.env.PROJECT || '%s'," % sample,
    ]
if not re.search(r"^[ \t]*users:[ \t]*\{", src, re.M):
    rows = [r.split('|') for r in registry.splitlines() if r.strip()]
    additions += [
        pad + "// The users registry: a handle a scenario reads, mapped to an account of the site (the default accounts:",
        pad + "// cmd-tools-vikunja-cli.sh --add-users). Override one with %s_<HANDLE>_USER and %s_<HANDLE>_PASSWORD." % (prefix, prefix),
        pad + "users: {",
    ]
    for handle, mail, password, display in rows:
        env = '%s_%s' % (prefix, handle.upper())
        additions.append(pad + "  %s: { username: process.env.%s_USER || '%s', password: process.env.%s_PASSWORD || '%s', name: '%s' }," % (handle, env, mail, env, password, display))
    additions.append(pad + "},")
    print('  cucumber.js: the users registry (%s)' % ', '.join(r[0] for r in rows))
if additions:
    src = src[:world.end()] + '\n' + '\n'.join(additions) + src[world.end():]
    print('  cucumber.js: the managing account and the project of the steps')

# The address the suite opens when LAUNCH_URL is not set: the placeholder of the scaffold becomes the site's.
placeholder = "process.env.LAUNCH_URL || 'http://localhost:8080'"
if placeholder in src:
    src = src.replace(placeholder, "process.env.LAUNCH_URL || '%s'" % address)
    print('  cucumber.js: the address of the site (%s)' % address)

if src != before:
    open(cucumber_file, 'w').write(src)
PYEOF

  # A first feature, when the project has none for the site yet.
  local feature="${WORKSPACE_SCRIPTS}/plugins/vikunja/site.feature" ;
  if [ -f "${feature}" ] && [ ! -f "${project_path}/tests/features/site.feature" ] ; then
    mkdir -p "${project_path}/tests/features" && cp "${feature}" "${project_path}/tests/features/site.feature" \
      && echo "  tests/features/site.feature: a first feature for the tasks" ;
  fi

  # The scenarios log in as the default accounts and read the sample project: make sure the site has them, once it
  # answers again (installing the testing stack may restart the project, and Vikunja with it). Each part says when it
  # did not work; add_vikunja_users ends in the folder, so the sample content is asked for in the project again.
  if ! ( cd "${project_path}" && vikunja_wait > /dev/null 2>&1 ) ; then
    echo "  Vikunja does not answer: is the site running (ddev start in ${project_path})? The default accounts and the sample content were not checked." ;
  elif ! ( cd "${project_path}" && add_vikunja_users > /dev/null 2>&1 ) ; then
    echo "  The default accounts could not be written (bash cmd-tools-vikunja-cli.sh <site> --add-users says why)." ;
  elif ! ( cd "${project_path}" && vikunja_content > /dev/null 2>&1 ) ; then
    echo "  The sample content could not be written (bash cmd-tools-vikunja-cli.sh <site> --sample-content says why)." ;
  else
    echo "  the default accounts and the sample content are on the site (${users[*]})" ;
  fi
}
