module FeatureFlags
  NEW_CHECKOUT = "new-checkout".freeze

  def self.client
    @client ||= ConfigDirector.create_client(ENV.fetch("CONFIGDIRECTOR_SERVER_KEY")).tap(&:init)
  end
end
