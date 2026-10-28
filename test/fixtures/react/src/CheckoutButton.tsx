import { useClient } from "@configdirector/react-web-sdk";

function CheckoutButton() {
  const { client } = useClient();

  const startCheckout = () => {
    const evaluation = client.evaluate("new-checkout", false);
    analytics.track("checkout-started", { newCheckout: evaluation.value, reason: evaluation.reason });
  };

  return <button onClick={startCheckout}>Check out</button>;
}
