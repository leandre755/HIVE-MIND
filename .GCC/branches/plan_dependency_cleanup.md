# Execution Plan: Nettoyage des Dépendances et Migration Node LTS (Session 17)

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Le projet doit compiler sans erreur TypeScript (`npx tsc --noEmit`) et passer tous les tests unitaires et d'intégration avec succès. Les dépendances obsolètes ou dépréciées doivent être supprimées ou mises à jour. Le projet doit exploiter pleinement les fonctionnalités natives de Node.js `v26.2.0` déjà actif sur le système (comme le chargement natif de fichier `.env` via `--env-file` et `fetch` global natif).
- **Pre-requisites**: Node.js `v26.2.0` (déjà installé) et npm.

## 🛠️ Step-by-Step Sequence

### Step 1: Migration vers le chargement natif `.env` de Node.js
- [ ] **Action**:
  - Supprimer les imports de `dotenv` et `dotenv/config` (ex: dans `src/bin/hive-mind.ts`, `src/tui/index.tsx`, etc.).
  - Remplacer l'usage de `dotenv` par l'option native `--env-file=.env` de Node.js dans les scripts de démarrage de `package.json`.
  - Mettre à jour `package.json` pour utiliser :
    - `"start": "tsx --env-file=.env src/bin/hive-mind.ts start"`
    - `"dev": "tsx --env-file=.env --watch src/bin/hive-mind.ts start"`
    - `"tui": "APP_ENV=local tsx --env-file=.env src/tui/index.tsx"`
  - Supprimer la dépendance `dotenv` du `package.json` (`npm uninstall dotenv`).
- [ ] **Verify**: `npx tsc --noEmit && npm run build`
- **Verification Proof**:
```text
```

### Step 2: Mise à jour sélective des dépendances clés
- [ ] **Action**:
  - Mettre à jour les dépendances principales pour s'aligner sur les versions stables récentes (sans introduire de breaking changes sur les types et les tests) :
    - `@google/genai` (v1.52.0 -> v2.x)
    - `@supabase/supabase-js` (v2.106.2 -> v2.110.0)
    - `redis` (v4.7.1 -> v6.x ou dernière v4 stable)
    - `pino` (v8.21.0 -> v10.x ou dernière v9/10 stable)
  - Mettre à jour les dépendances de développement (`@types/node`, `typescript`, `tsx`, `typescript-eslint`).
- [ ] **Verify**: `npm update` / `npm install` et compilation TypeScript propre.
- **Verification Proof**:
```text
```

### Step 3: Remplacement de `undici` par le `fetch` natif
- [ ] **Action**:
  - Inspecter les fichiers utilisant la dépendance `undici` pour s'assurer que nous pouvons la retirer et s'appuyer uniquement sur le `fetch` global natif de Node `v26.2.0`.
  - Supprimer la dépendance `undici` (`npm uninstall undici`) si elle n'est plus requise pour les tests ou des configurations spécifiques de pooling HTTP.
- [ ] **Verify**: `npx tsc --noEmit && npm test`
- **Verification Proof**:
```text
```

### Step 4: Valider le bon fonctionnement général (Tests complets)
- [ ] **Action**:
  - Exécuter la suite complète de tests pour s'assurer qu'aucune régression n'a été introduite par la mise à jour ou le nettoyage des dépendances.
- [ ] **Verify**: `npm test` (0 erreur, 0 warning)
- **Verification Proof**:
```text
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: Les paquets très liés au protocole WhatsApp comme `@whiskeysockets/baileys` sont sensibles aux montées de version majeures (de v6.7.x à v7.0.0-rc).
- **Mitigation**: Geler `@whiskeysockets/baileys` sur sa version v6 stable actuelle pour éviter les ruptures de protocole WhatsApp Baileys, et ne mettre à jour que les dépendances utilitaires standards.
