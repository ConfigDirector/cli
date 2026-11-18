# frozen_string_literal: true

require "minitest/autorun"
require "configdirector/testing"

class CheckoutTest < Minitest::Test
  def test_new_checkout_can_be_turned_off
    test_client = ConfigDirector::Testing.create_test_client({ :new_checkout => true })
    test_client.client.init

    test_client.set_value "new_checkout", false
    test_client.replace_values({ max_items: 20 })
  end
end
