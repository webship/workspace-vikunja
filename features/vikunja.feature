Feature: The Leantime plugin on the dashboard
  Once the plugin is activated and installed, the sites folders offer the Leantime builder, each AI folder lists the
  items of its kind the plugin ships, the Plugins page lists the plugin with its settings, and the project rows of
  sites and code folders carry the LEANTIME menu of tasks once a Leantime is connected.

  # Settings lists every plugin that was added; the package and what the plugin ships are on its own page.
  Scenario: Settings lists the plugin, and its own page names its package, what it ships and its settings
    Given I am on "/settings"
     Then I should see "Leantime"
     When I go to "/settings/plugin/leantime"
     Then I should see "@webship.co/workspace-leantime"
      And I should see "cmd-leantime-project.sh"
      And I should see "leantime-site-builder"
      And I should see "Writes to Leantime (tasks)"

  Scenario: A sites folder offers the Leantime builder
    Given I am on "/dev"
     Then "option[value='cmd-leantime-project.sh']" should be attached

  # The AI folders are searched by name: with every plugin on, a folder lists more than one page of items.
  Scenario: The AI Agents folder lists the agents the plugin ships
    Given I am on "/ai-agents?q=leantime-"
     Then I should see "leantime-site-builder"
      And I should see "leantime-tester"
      And I should see "leantime-issue-worker"

  Scenario: The AI Skills folder lists the skill the plugin ships
    Given I am on "/ai-skills?q=leantime-scenarios"
     Then I should see "leantime-scenarios"

  Scenario: The AI Commands folder lists the command the plugin ships
    Given I am on "/ai-commands?q=leantime-test"
     Then I should see "leantime-test"

  Scenario: The AI Prompts folder lists the prompts the plugin ships
    Given I am on "/ai-prompts?q=leantime-"
     Then I should see "leantime-build-and-test"
      And I should see "leantime-issue-to-branch"

  # The tasks as work items (@webship.co/workspace-tracker). The list asks Leantime again when its View or its filter
  # changes, and Enter submits it. It needs a Leantime with a token, a default project and a project in the dev
  # folder: CI has none, so it skips this, saying why.
  @needs-setting-leantime-token @needs-setting-leantime-default_scope @needs-project-dev
  Scenario: The task list follows its View and its filter
    Given I am on "/dev"
     When I click on the element ".act-menu-leantime > button"
      And I click on the element ".act-menu-leantime a[hx-get*='/tracker/list/']"
     Then eventually I should see "All open tasks ·" within 30 seconds
     When I select "Current sprint" from "view"
     Then eventually I should see "Current sprint ·" within 30 seconds
     When I fill in "q" with "#1"
      And I press the key "Enter" on the element "input[name=q]"
     Then eventually I should see "Leantime task #1 ·" within 30 seconds
