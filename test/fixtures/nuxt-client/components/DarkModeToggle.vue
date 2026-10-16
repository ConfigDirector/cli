<script setup lang="ts">
const { client } = useConfigDirectorClient();
const darkMode = ref(client.getValue("dark-mode", false));
</script>
