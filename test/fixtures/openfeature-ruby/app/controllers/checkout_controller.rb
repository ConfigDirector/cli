# frozen_string_literal: true

class CheckoutController < ApplicationController
  def show
    @new_checkout = FeatureFlags.client.fetch_boolean_value(flag_key: "new-checkout", default_value: false)
  end
end
