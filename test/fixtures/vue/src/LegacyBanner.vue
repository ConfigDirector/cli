<script setup lang="ts">
import { useConfigValue } from "./legacy-config";

const enabled = useConfigValue("legacy-banner", false);
</script>
