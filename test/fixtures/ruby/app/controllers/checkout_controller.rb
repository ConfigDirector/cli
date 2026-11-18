# frozen_string_literal: true

class CheckoutController < ApplicationController
  def show
    client = FeatureFlags.client
    @new_checkout = client.get_value(FeatureFlags::NEW_CHECKOUT, false)
    @banner = client.get_value("banner-#{params[:region]}", false)
  end
end
