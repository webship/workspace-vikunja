@roles
Feature: What each account may do in the project
  Scenario: Read-only sharing reads a task, and neither changes nor comments on it
    Given I am a logged in user with the "reader" user
    When I open the task "The greeting script says Helo instead of Hello"
    Then I should not be able to change the task
    And I should not be able to comment on the task
    And I should not be able to create a task in the project "Webship site"

  @js-off
  Scenario: An account the project is not shared with is refused its tasks
    Given I am a logged in user with the "stranger" user
    Then I should be refused the task "The greeting script says Helo instead of Hello"
