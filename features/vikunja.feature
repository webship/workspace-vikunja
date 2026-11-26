Feature: The Vikunja plugin on the dashboard
  Once the plugin is activated and installed, the sites folders offer the Vikunja builder, each AI folder lists the
  items of its kind the plugin ships, the Plugins page lists the plugin with its settings, and the project rows of
  sites and code folders carry the VIKUNJA menu of tasks once a Vikunja is connected.

  # Settings lists every plugin that was added; the package and what the plugin ships are on its own page.
  Scenario: Settings lists the plugin, and its own page names its package, what it ships and its settings
    Given I am on "/settings"
     Then I should see "Vikunja"
     When I go to "/settings/plugin/vikunja"
     Then I should see "@webship.co/workspace-vikunja"
      And I should see "cmd-vikunja-project.sh"
      And I should see "vikunja-site-builder"
      And I should see "Writes to Vikunja (tasks)"

  Scenario: A sites folder offers the Vikunja builder
    Given I am on "/dev"
     Then "option[value='cmd-vikunja-project.sh']" should be attached

  # The AI folders are searched by name: with every plugin on, a folder lists more than one page of items.
  Scenario: The AI Agents folder lists the agents the plugin ships
    Given I am on "/ai-agents?q=vikunja-"
     Then I should see "vikunja-site-builder"
      And I should see "vikunja-tester"
      And I should see "vikunja-issue-worker"

  Scenario: The AI Skills folder lists the skill the plugin ships
    Given I am on "/ai-skills?q=vikunja-scenarios"
     Then I should see "vikunja-scenarios"

  Scenario: The AI Commands folder lists the command the plugin ships
    Given I am on "/ai-commands?q=vikunja-test"
     Then I should see "vikunja-test"

  Scenario: The AI Prompts folder lists the prompts the plugin ships
    Given I am on "/ai-prompts?q=vikunja-"
     Then I should see "vikunja-build-and-test"
      And I should see "vikunja-issue-to-branch"

  # The tasks as work items (@webship.co/workspace-tracker). The list asks Vikunja again when its View or its filter
  # changes, and Enter submits it. It needs a Vikunja with a token, a default project and a project in the dev
  # folder: CI has none, so it skips this, saying why.
  @needs-setting-vikunja-token @needs-setting-vikunja-default_scope @needs-project-dev
  Scenario: The task list follows its View and its filter
    Given I am on "/dev"
     When I click on the element ".act-menu-vikunja > button"
      And I click on the element ".act-menu-vikunja a[hx-get*='/tracker/list/']"
     Then eventually I should see "All open tasks ·" within 30 seconds
     When I select "My tasks" from "view"
     Then eventually I should see "My tasks ·" within 30 seconds
     When I fill in "q" with "WEB-1"
      And I press the key "Enter" on the element "input[name=q]"
     Then eventually I should see "Vikunja task WEB-1 ·" within 30 seconds
