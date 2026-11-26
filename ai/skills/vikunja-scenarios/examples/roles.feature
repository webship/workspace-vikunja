@roles
Feature: What each account may do in the project
  Scenario: A Commenter comments on a task and changes nothing
    Given there is a task "Webship test comment" in the project "Webship site"
    And I am a logged in user with the "commenter" user
    When I open the task "Webship test comment"
    Then I should not be able to change the task
    When I add the comment "A word from a commenter" to the task
    Then the task should show the comment "A word from a commenter" by "Commenter Test"
    And I should not be able to create a task in the project "Webship site"

  Scenario: A Read Only person reads a task, and neither changes nor comments on it
    Given I am a logged in user with the "reader" user
    When I open the task "The greeting script says Helo instead of Hello"
    Then I should not be able to change the task
    And I should not be able to comment on the task

  @js-off
  Scenario: An account outside the project's team is refused its tasks
    Given I am a logged in user with the "stranger" user
    Then I should be refused the task "The greeting script says Helo instead of Hello"
