import { useConfigValue } from "@configdirector/react-native-sdk";

function YourComponent() {
  const { value } = useConfigValue("my-config-key", false);

  return <p>my-config-key: {value}</p>;
}

export default YourComponent;
