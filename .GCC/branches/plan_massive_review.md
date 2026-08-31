# Execution Plan: Massive Code Review & Node LTS Migration

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Le projet compile (TSC 0 erreur), ESLint 0 erreur, tous les tests Jest passent. Les dépendances sont à jour. Le code est compatible Node.js v22+ LTS.
- **Pre-requisites**: Node.js v26.2.0 (déjà installé), npm, accès complet au dépôt.

## 🛠️ Step-by-Step Sequence

### Step 1: État des lieux — Compilation & Linter actuels
- [ ] **Action**: `npx tsc --noEmit 2>&1 | tail -20` et `npx eslint . --ext .js,.ts 2>&1 | tail -20`
- [ ] **Verify**: Identifier le nombre d'erreurs de départ
- **Verification Proof**: [à remplir]

### Step 2: Audit npm — Vulnérabilités & Dépendances obsolètes
- [ ] **Action**: `npm audit` et `npm outdated`
- [ ] **Verify**: Identifier les CVEs et versions obsolètes
- **Verification Proof**: [à remplir]

### Step 3: Mise à jour des dépendances majeures
- [ ] **Action**: Mise à jour ciblée des packages (hors baileys v6)
- [ ] **Verify**: `npx tsc --noEmit` après chaque mise à jour
- **Verification Proof**: [à remplir]

### Step 4: Migration Node LTS — engines field + scripts
- [ ] **Action**: Ajouter `"engines": {"node": ">=22.0.0"}` dans package.json
- [ ] **Verify**: Compilation propre
- **Verification Proof**: [à remplir]

### Step 5: Audit sécurité code source
- [ ] **Action**: Recherche de patterns dangereux (path traversal, secrets dans logs, etc.)
- [ ] **Verify**: Corrections appliquées et compilateur propre
- **Verification Proof**: [à remplir]

### Step 6: Validation finale
- [ ] **Action**: `npx tsc --noEmit && npx eslint . --ext .js,.ts && npm test`
- [ ] **Verify**: 0 erreur, 0 avertissement, tous les tests verts
- **Verification Proof**: [à remplir]

## ⚠️ Mitigations & Edge Cases
- **Risk**: `@whiskeysockets/baileys` v6 → v7 breaking changes
- **Mitigation**: Geler baileys sur v6.7.x, ne pas le mettre à jour
