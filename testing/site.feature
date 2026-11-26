@site
Feature: The tasks of the site
  A first feature of a Vikunja site of the Webship Workspace, placed by the testing setup: the site opens on its login
  form, a member reads the sample project's tasks and its board, and works a task of its own, which goes after the
  scenario. It passes on a site built with --install --add-users --sample-content; add your own features beside it.

  # A visitor is sent to the login form; sign-ups are closed on a site the workspace built.
  Scenario: The site opens on its login form
    Given I am not logged in
    When I go to the homepage
    Then I should see "Welcome Back!"

  Scenario: A member reads the sample project and its board
    Given I am a logged in user with the "member" user
    When I open the project "Webship site"
    Then the task list should show "The greeting script says Helo instead of Hello"
    When I open the board of the project "Webship site"
    Then the bucket "Doing" should list the task "The greeting script says Helo instead of Hello"

  Scenario: A member works a task of its own
    Given there is a task "Webship test site" in the project "Webship site"
    And I am a logged in user with the "member" user
    When I open the task "Webship test site"
    And I add the comment "Checked on the test site" to the task
    And I mark the task done
    Then the task should show the comment "Checked on the test site" by "Member Test"
    And the task should be done

  @js-off
  Scenario: An account the project is not shared with is refused it
    Given I am a logged in user with the "stranger" user
    Then I should be refused the project "Webship site"
