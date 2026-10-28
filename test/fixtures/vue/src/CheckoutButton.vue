<script setup lang="ts">
import { useClient } from "@configdirector/vue-sdk";

const { client } = useClient();

const startCheckout = () => {
  const evaluation = client.evaluate("new-checkout", false);
  analytics.track("checkout-started", { newCheckout: evaluation.value, reason: evaluation.reason });
};
</script>

<template>
  <button @click="startCheckout">Check out</button>
</template>
