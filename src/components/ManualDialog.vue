<script setup lang="ts">
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal manual-modal">
      <div class="modal-header">
        <h2>説明書</h2>
        <button class="modal-close-btn" @click="emit('close')">✕</button>
      </div>
      <div class="manual-content">
        <p>
          本アプリは <a href="http://spa-game.com/?page_id=4242" target="_blank" rel="noopener">公式ガイドライン</a> に基づいて作成した、ナショナルエコノミーの非公式アプリです。<br>
          ゲームルールは <a href="http://spa-game.com/images/NE_Rules.pdf" target="_blank" rel="noopener">公式ルールブック (PDF)</a> を参照ください。<br>
          バグ報告などは本アプリの開発者（<a href="https://x.com/kk22app" target="_blank" rel="noopener">https://x.com/kk22app</a>）へお願いします。
        </p>
        <h3>本アプリのコンセプト</h3>
        <p>最小限のクリック数でサクサク遊べるようにしています。</p>
        <ul>
          <li><strong>自動捨て札</strong>：露店使用時に手札枚数がピッタリなら、手札選択をスキップします。</li>
          <li><strong>自動建物選択</strong>：大工で建てられる建物が1つだけなら、手札選択をスキップします。</li>
          <li><strong>自動売却</strong>：ラウンド終了時の建物売却が1パターンしかない場合、自動で売却します。</li>
          <li><strong>自動保存</strong>：ゲーム状況をブラウザに自動保存しており、次回表示時に続きから表示されます。</li>
          <li><strong>戻る、進む</strong>：操作前まで戻ることができます。</li>
        </ul>
      </div>
    </div>
  </div>
</template>
