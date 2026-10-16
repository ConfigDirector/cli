import { client } from "./config-director-setup"

// Retrieve the current value
client.getValue("my-config-key", false);

// Subscribe to value updates
const unwatchMyKey = client.watch("my-config-key", false, (newValue) => {
  console.log("Value updated:", newValue);
});

unwatchMyKey(); // Call the unwatch function returned to remove the listener

client.unwatch("my-config-key"); // Removes all listeners for that key
