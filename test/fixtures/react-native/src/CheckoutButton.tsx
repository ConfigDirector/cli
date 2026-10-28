import { Button } from "react-native";
import { useClient } from "@configdirector/react-native-sdk";

function CheckoutButton() {
  const { client } = useClient();

  const startCheckout = () => {
    const evaluation = client.evaluate("new-checkout", false);
    analytics.track("checkout-started", { newCheckout: evaluation.value, reason: evaluation.reason });
  };

  return <Button title="Check out" onPress={startCheckout} />;
}
