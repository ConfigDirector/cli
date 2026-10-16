package main

import (
	"context"
	"log"

	"github.com/ConfigDirector/go-sdks/configdirector"
	configdirectoropenfeature "github.com/ConfigDirector/go-sdks/configdirector-openfeature"
	"github.com/open-feature/go-sdk/openfeature"
)

func main() {
	// IMPORTANT: Do not commit the server SDK key to your source code, it is a secret value.
	provider, err := configdirectoropenfeature.NewProvider(configdirector.Options{SDKKey: "YOUR-SERVER-SDK-KEY"})
	if err != nil {
		log.Fatal(err)
	}
	if err := openfeature.SetProviderAndWait(provider); err != nil {
		log.Fatal(err)
	}
	defer openfeature.Shutdown()

	client := openfeature.NewClient("my-app")
	ctx := context.Background()

	booleanValue := client.Boolean(ctx, "my-config-key", false, openfeature.EvaluationContext{})

	stringValue := client.String(ctx, "my-string-config-key", "Default", openfeature.EvaluationContext{})

	maxItems := client.Int(ctx, "max-items", 20, openfeature.EvaluationContext{})
	log.Println(booleanValue, stringValue, maxItems)
}
