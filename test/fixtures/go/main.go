package main

import (
	"context"
	"log"

	"github.com/ConfigDirector/go-sdks/configdirector"
)

func main() {
	// IMPORTANT: Do not commit the server SDK key to your source code, it is a secret value.
	// Creating the client starts its connection in the background.
	client, err := configdirector.NewClient(configdirector.Options{SDKKey: "YOUR-SERVER-SDK-KEY"})
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	if err := client.WaitForReady(context.Background()); err != nil {
		log.Printf("ConfigDirector is not ready yet: %v", err)
	}

	user := configdirector.UserContext{ID: "user-id"}

	// Retrieve config values
	retries := client.IntValue("max-retries", 3, user)
	theme := client.StringValue("theme", "light", user)
	newCheckout := client.BoolValue("new-checkout", false, user)

	// A JSON config is decoded into a value of your own, which holds the in-code default value
	limits := map[string]any{"per_minute": 60}
	if err := client.JSONValue("rate-limits", &limits, user); err != nil {
		log.Fatal(err)
	}

	// Watch for config updates
	unwatch := client.WatchBool("new-checkout", false, user, func(value bool) {
		log.Printf("new-checkout is now %t", value)
	})

	// Call unwatch when the watch is no longer needed
	unwatch()
	log.Println(retries, theme, newCheckout)
}
