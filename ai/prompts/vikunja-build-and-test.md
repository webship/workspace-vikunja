Build a Leantime site (open-source project management) with its default accounts and sample project in a sites folder and prove it with its first webship-js feature.

The text between the triple quotes is plain: it can be given to another AI command-line assistant as it is.

```
claude --permission-mode bypassPermissions """
Build the Leantime site named <name> with its default accounts and the sample project in this sites folder and test it with webship-js
# ~/workspace/<dev|test|sandboxes|demos> · https://<name>.ddev.site (or the runtime's own address with --runtime docker, podman or kubernetes) · container-based (DDEV by default)
# the builder deletes a project of the same name first: stop if <name> is a site somebody still needs
# check free -m and df -h / first (the image is a download of about 320 MB the first time, and the builder asks for 1.5 GB of free memory), build one site at a time
# nothing on the host: no tool of the site outside the containers; no hosted service, no account anywhere
# a feature to write or a run to read: the book Automated Functional Testing Recipes first (its README.md, then the matching chapter), from .claude/automated-functional-testing-recipes/ in the project, ~/.claude/automated-functional-testing-recipes/ or https://github.com/webship/webship-js-ai-agent/tree/2.0.x/automated-functional-testing-recipes
# a pull request of this work: its Checkpoints list last; "Reviewed by a human" and "Code review by maintainers" are never ticked by an agent

1. bash cmd-leantime-project.sh <name> --install --add-users --sample-content <--runtime docker|podman|kubernetes|>
   (Leantime's own image on the project's own MariaDB, installed by its own installer, the workspace account as the site's owner, the default accounts in their roles of the project Webship site)
2. bash cmd-tools-leantime-cli.sh <name>
   tell me what the site is, its release, its address and the accounts it lists
3. bash cmd-tools-testing.sh <name>
   webship-js, the step pack, the users registry and tests/features/site.feature
4. bash cmd-tools-testing.sh <name> --dry-run --path tests/features/site.feature
5. bash cmd-tools-testing.sh <name> --run --path tests/features/site.feature

If a command fails, show the line that failed and stop. Do not retry with other flags.
When the feature is green: the address, the release, how many scenarios and steps passed.
Then ask me whether to keep the site or remove it with: bash cmd-tools-remove.sh <name>
"""
```
