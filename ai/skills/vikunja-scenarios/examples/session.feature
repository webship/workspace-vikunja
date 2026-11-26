@session
Feature: Logging in and out
  @js-off
  Scenario: An account logs in through the form and out again
    Given I am not logged in
    When I log in with the "member" user
    Then I should be logged in as "Member Test"
    When I log out
    Then I should not be logged in

  @js-off
  Scenario: A wrong password is refused
    When I log in as "member" with the password "not-the-right-password"
    Then the login should be refused with "Wrong username or password"
    And I should not be logged in
