<script setup lang="ts">
const field = useField("search-query");
const query = computed(() => field.getValue("search-query", ""));
</script>
