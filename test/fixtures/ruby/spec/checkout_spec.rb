# frozen_string_literal: true

require "configdirector/testing"

RSpec.describe CheckoutController do
  it "follows the new-checkout flag" do
    test_client = ConfigDirector::Testing.create_test_client({ "new-checkout" => true, dark_mode: false })
    test_client.client.init

    test_client.set_value("new-checkout", false)
    expect(test_client.client.get_value("new-checkout", true)).to be(false)

    test_client.remove_value "new-checkout"
    test_client.replace_values("max-items" => 20, "checkout-theme": "dark", theme_name: "dark")
  end
end
