# Contributing

1. Node 20+ とRust stableを用意し、`npm install` を実行する。
2. 変更前に責務境界を確認する。UIからSQLite/OpenAI/秘密情報へ直接アクセスしない。
3. `npm run lint && npm run typecheck && npm run test && cargo test --manifest-path src-tauri/Cargo.toml` を通す。
4. UIフロー変更時は `npm run test:e2e`、配布変更時は `npm run tauri build` も実行する。

秘密情報、実ノート、AI入出力をfixtureやログへ入れないでください。DB変更は既存SQLを書き換えるのではなく、番号を増やしたmigrationとして追加します。AIプロンプトの意味変更ではprompt versionを増やし、低品質な一般論を防ぐfixtureを追加します。
