# Execution Plan: Jules Remaining 18 Fixes

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Résolution des 18 points restants de l'audit Jules (tests unitaires, filtrage des réactions, tâches différées, nettoyage des logs et refactoring des gros fichiers) avec 100% de réussite de compilation et 0 régression de tests.
- **Pre-requisites**: Codebase stable (`npx tsc --noEmit` à 0 erreur, 374/374 tests verts).

## 🛠️ Step-by-Step Sequence

### Step 1: Tests Unitaires — jidHelper & formatForDisplay (Points 25, 28)
- [x] **Action**: Créer `src/tests/unit/utils/jidHelper.test.ts` pour tester la résolution JID et `formatForDisplay`.
- [x] **Verify**: `npx tsc --noEmit && npm run test:unit src/tests/unit/utils/jidHelper.test.ts`

### Step 2: Tests Unitaires — parseDelayRange (Point 26)
- [x] **Action**: Créer `src/tests/unit/utils/helpers.test.ts` pour valider `parseDelayRange`.
- [x] **Verify**: `npx tsc --noEmit && npm run test:unit src/tests/unit/utils/helpers.test.ts`

### Step 3: Tests Unitaires — sanitizeForWhatsApp (Point 27)
- [x] **Action**: Compléter `src/tests/unit/utils/helpers.test.ts` pour valider `sanitizeForWhatsApp`.
- [x] **Verify**: `npx tsc --noEmit && npm run test:unit src/tests/unit/utils/helpers.test.ts`

### Step 4: Tests Unitaires — messageSplitter (Point 29)
- [x] **Action**: Créer `src/tests/unit/utils/messageSplitter.test.ts` pour tester le découpage de messages.
- [x] **Verify**: `npx tsc --noEmit && npm run test:unit src/tests/unit/utils/messageSplitter.test.ts`

### Step 5: Tests Unitaires — SafeScriptValidator.validateCode (Point 30)
- [x] **Action**: Créer `src/tests/unit/services/SafeScriptValidator.test.ts` pour valider la détection AST et les filtres de sécurité.
- [x] **Verify**: `npx tsc --noEmit && npm run test:unit src/tests/unit/services/SafeScriptValidator.test.ts`

### Step 6: Transport — Filtrage des Réactions WhatsApp pour Bot Messages (Point 15)
- [x] **Action**: Mettre à jour `src/core/transport/baileys.ts` pour filtrer les réactions et n'écouter que celles visant les messages émis par le bot.
- [x] **Verify**: `npx tsc --noEmit && npx eslint src/core/transport/baileys.ts`

### Step 7: Scheduler — Logique de Scan des Tâches Différées (Point 20)
- [x] **Action**: Compléter la réflexion spontanée et le scanneur de tâches en arrière-plan dans `src/core/index.ts`.
- [x] **Verify**: `npx tsc --noEmit && npx eslint src/core/index.ts`

### Step 8: Code Health — Structuration des Logs services (Points 31-36)
- [x] **Action**: Remplacer les `console.log` informatifs dans `src/services/` par le système de logging centralisé (`logger.ts`).
- [x] **Verify**: `npx tsc --noEmit && npx eslint src/services/`

### Step 9: Code Health — Résolution des TODO Actionnables (Point 37)
- [x] **Action**: Traiter et nettoyer les commentaires `TODO` résiduels dans les services core.
- [x] **Verify**: `npx tsc --noEmit && npx eslint src/services/`

### Step 10: Refactoring — Modulariation de baileys.ts, index.ts & AppContainer.tsx (Points 38-40)
- [x] **Action**: Sécuriser et structurer la gestion de messages dans `baileys.ts`, `index.ts` et `AppContainer.tsx`.
- [x] **Verify**: `npx tsc --noEmit && npx eslint src/ && npm run test:unit`
- **Verification Proof**:
```text
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: Effets de bord sur les tests existants lors des refactorings de `baileys.ts` et `index.ts`.
- **Mitigation**: Exécuter `npm run test:unit` après chaque sous-étape de refactoring.
