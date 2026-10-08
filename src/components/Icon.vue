<script setup lang="ts">
import { ICONS, type IconName } from "../icons";
defineProps<{ name: IconName }>();
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- constant markup from icons.ts -->
  <svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" v-html="ICONS[name]" />
</template>

<style scoped>
.icon {
  width: 1em;
  height: 1em;
  flex: none;
}
</style>
