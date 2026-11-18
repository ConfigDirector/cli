# frozen_string_literal: true

module FeatureFlags
  def self.client
    @client ||= OpenFeature::SDK.build_client
  end
end
