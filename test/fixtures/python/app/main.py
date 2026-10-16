from config_director_setup import client

# Retrieve config values
retries = client.get_value("max-retries", 3)
theme = client.get_value("theme", "light")
limits = client.get_value("rate-limits", {"per_minute": 60}) # JSON config

# Watch for config updates
def on_change(value: bool) -> None:
    print(f"new-checkout is now {value}")

subscription = client.watch("new-checkout", False, on_change)

# Call close when the subscription is not longer needed
subscription.close()

timeout = client.get_value(config_key="request-timeout", default=2.5)
