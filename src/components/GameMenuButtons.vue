<script setup lang="ts">
// PC版（GameBoard右パネル）とSP版（App.vueドロワー）で共通利用するメニューボタン群。
// ボタンを追加・変更する際はここを直せば両方に反映される。
const emit = defineEmits<{
  openManual: []
  openSetup: []
  openSummary: []
  openPlayHistory: []
}>()
</script>

<template>
  <button class="btn-restart" @click="emit('openManual')">📖 説明書</button>
  <button class="btn-restart" @click="emit('openSetup')">⚙️ ゲーム設定</button>
  <button class="btn-restart" @click="emit('openPlayHistory')">🏆 プレイ履歴</button>
  <button class="btn-restart" @click="emit('openSummary')">📋 ラウンド毎の情報</button>
</template>
