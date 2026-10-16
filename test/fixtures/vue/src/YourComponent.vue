<script setup lang="ts">
import { useConfigValue } from "@configdirector/vue-sdk";

const { value } = useConfigValue("my-config-key", false);
</script>

<template>
  <div>my-config-key is : {{ value }}</div>
</template>
