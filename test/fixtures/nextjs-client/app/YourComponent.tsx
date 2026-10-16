"use client";

import { useConfigValue } from "@configdirector/nextjs-sdk/client";

function YourComponent() {
  const { value } = useConfigValue("my-config-key", false);

  return (<p>my-config-key: {value}</p>);
}

export default YourComponent;
