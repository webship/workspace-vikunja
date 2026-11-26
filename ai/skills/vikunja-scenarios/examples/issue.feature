@tasks
Feature: A task worked by an Editor
  Scenario: Its status, a comment, its assignee and the time on it
    Given there is a task "Webship test work" in the project "Webship site"
    And I am a logged in user with the "member" user
    When I open the task "Webship test work"
    And I set the status of the task to "In Progress"
    And I add the comment "Checked on the test site" to the task
    And I assign the task to "Owner Test"
    And I log "1.5" hours on the task with the note "Looked into it"
    Then the status of the task should be "In Progress"
    And the task should show the comment "Checked on the test site" by "Member Test"
    And the task should be assigned to "Owner Test"
    And the task should have "1.5" hours logged
