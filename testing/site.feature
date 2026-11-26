@site
Feature: The tasks of the site
  A first feature of a Leantime site of the Webship Workspace, placed by the testing setup: the site opens on its
  login form, an Editor reads the sample project's tasks and its sprint, and works a task of its own, which goes after
  the scenario. It passes on a site built with --install --add-users --sample-content; add your own features beside it.

  # An installed site asks a visitor to log in; one that is not installed sends the visitor to its Installation.
  Scenario: The site opens on its login form, installed
    Given I am not logged in
    When I go to the homepage
    Then I should see "Welcome Back"
    And I should not see "Installation"

  Scenario: An Editor reads the sample project
    Given I am a logged in user with the "member" user
    When I open the project "Webship site"
    Then the task list should show "The greeting script says Helo instead of Hello"
    When I open the sprint "Sprint 1" of the project "Webship site"
    Then the sprint should list the task "The greeting script says Helo instead of Hello"

  Scenario: An Editor works a task of its own
    Given there is a task "Webship test site" in the project "Webship site"
    And I am a logged in user with the "member" user
    When I open the task "Webship test site"
    And I set the status of the task to "In Progress"
    And I add the comment "Checked on the test site" to the task
    Then the task should show the comment "Checked on the test site" by "Member Test"
    And the status of the task should be "In Progress"

  @js-off
  Scenario: An account outside the project's team is refused the project
    Given I am a logged in user with the "stranger" user
    Then I should be refused the project "Webship site"
