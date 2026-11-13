package main

import "github.com/ConfigDirector/go-sdks/configdirector"

func checkoutBannerShown(client *configdirector.Client, user configdirector.UserContext) bool {
	evaluation, err := client.Evaluate("checkout-banner", false, user)
	if err != nil {
		return false
	}
	return evaluation.Value.(bool)
}
