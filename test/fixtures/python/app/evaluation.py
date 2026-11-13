from config_director_setup import client

evaluation = client.evaluate("checkout-banner", False)
print(evaluation.value, evaluation.reason)

discount = client.evaluate(config_key="checkout-discount", default=0.1)
