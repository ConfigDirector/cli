<script setup lang="ts">
const { value } = useConfigDirectorValue("my-config-key", false);
</script>

<template>
  <div>my-config-key is : {{ value }}</div>
</template>
