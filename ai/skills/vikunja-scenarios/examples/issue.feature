@tasks
Feature: A task worked by a member
  Scenario: Done, a comment, a label and an assignee
    Given there is a task "Webship test work" in the project "Webship site"
    And I am a logged in user with the "member" user
    When I open the task "Webship test work"
    And I add the comment "Checked on the test site" to the task
    And I add the label "bug" to the task
    And I assign the task to "Owner Test"
    And I mark the task done
    Then the task should show the comment "Checked on the test site" by "Member Test"
    And the task should have the label "bug"
    And the task should be assigned to "Owner Test"
    And the task should be done
