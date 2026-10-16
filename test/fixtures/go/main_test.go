package main

import (
	"testing"

	"github.com/ConfigDirector/go-sdks/configdirector/configdirectortest"
)

func TestNewCheckout(t *testing.T) {
	testClient := configdirectortest.NewTestClient(map[string]any{"new-checkout": true})
	defer testClient.Close()
	if err := testClient.SetValue("new-checkout", false); err != nil {
		t.Fatal(err)
	}
}
