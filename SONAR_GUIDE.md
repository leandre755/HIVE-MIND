# Guide Complet SonarCloud : CI/CD, Règles d'analyse et Utilisation Locale

Ce guide explique pas à pas le fonctionnement de SonarCloud pour **HIVE-MIND**, comment bloquer les fusions (merge) de Pull Requests non conformes, comment ajuster les règles d'analyse et comment lancer des analyses directement sur votre machine.

---

## Sommaire
1. [Fonctionnement Global & Architecture](#1-fonctionnement-global--architecture)
2. [Bloquer les Pull Requests en CI/CD (GitHub Actions)](#2-bloquer-les-pull-requests-en-cicd-github-actions)
3. [Configurer et Personnaliser les Règles d'Analyse (Quality Profiles)](#3-configurer-et-personnaliser-les-règles-danalyse-quality-profiles)
4. [Configurer les Seuils de Qualité (Quality Gates)](#4-configurer-les-seuils-de-qualité-quality-gates)
5. [Lancer une Analyse en Local sur sa Machine](#5-lancer-une-analyse-en-local-sur-sa-machine)

---

## 1. Fonctionnement Global & Architecture

SonarCloud fonctionne selon le principe du **Clean as You Code** :
- **Nouveau Code (New Code)** : SonarCloud se concentre principalement sur les lignes modifiées ou ajoutées dans vos branches et Pull Requests.
- **Quality Gate** : Un ensemble de conditions strictes que le nouveau code doit impérativement respecter (ex: zéro vulnérabilité, zéro bug critique, couverture de test minimale, duplication limitée).
- **GitHub App & Actions** : Le workflow GitHub Actions (`.github/workflows/sonarcloud.yml`) analyse le code, envoie les métriques à SonarCloud, et attend le verdict du Quality Gate.

---

## 2. Bloquer les Pull Requests en CI/CD (GitHub Actions)

Pour empêcher physiquement le merge d'une Pull Request si le Quality Gate SonarCloud échoue, suivez ces étapes sur GitHub :

### Étape 1 : S'assurer que le secret est présent
Le secret `SONAR_TOKEN` a déjà été configuré sur le dépôt `leandre755/HIVE-MIND`.
Vous pouvez le vérifier dans :
👉 `https://github.com/leandre755/HIVE-MIND/settings/secrets/actions`

### Étape 2 : Activer la protection de branche sur GitHub
1. Allez sur votre dépôt GitHub : **Settings** > **Branches** (ou directement : `https://github.com/leandre755/HIVE-MIND/settings/branches`).
2. Cliquez sur **Add branch ruleset** (ou **Add branch protection rule**).
3. Dans **Branch name pattern**, saisissez : `main`.
4. Cochez impérativement les cases suivantes :
   - ✅ **Require a pull request before merging**
   - ✅ **Require status checks to pass before merging**
   - ✅ **Require branches to be up to date before merging**
5. Dans la barre de recherche des status checks requis, recherchez et sélectionnez :
   - `SonarCloud Analysis & Quality Gate` (le nom du job défini dans votre workflow)
   - et/ou `SonarCloud Quality Gate Check`
6. Cliquez sur **Create** (ou **Save changes**).

> [!IMPORTANT]
> Dès que cette règle est activée, le bouton **Merge pull request** sera grisé et désactivé sur GitHub tant que le workflow SonarCloud n'aura pas validé le Quality Gate.

---

## 3. Configurer et Personnaliser les Règles d'Analyse (Quality Profiles)

SonarCloud analyse le code TypeScript/JavaScript selon un catalogue de règles classées en :
- **Bugs** : Erreurs de logique ou de runtime.
- **Vulnerabilities** & **Security Hotspots** : Failles de sécurité potentielles.
- **Code Smells** : Problèmes de maintenabilité et dette technique.

### Comment modifier ou désactiver une règle ?
Par défaut, SonarCloud applique le profil **Sonar way** (géré par SonarSource et en lecture seule). Pour personnaliser les règles :

1. Connectez-vous sur [SonarCloud.io](https://sonarcloud.io) avec votre compte GitHub `leandre755`.
2. Accédez à votre organisation : `leandre755`.
3. Cliquez sur l'onglet **Quality Profiles** en haut.
4. Repérez le langage **TypeScript** :
   - Cliquez sur la roue dentée / menu à droite de **Sonar way** > **Copy** (Dupliquer).
   - Nommez votre profil (ex: `HIVE-MIND TypeScript`).
5. Définissez ce nouveau profil comme profil par défaut (**Set as Default**) pour votre organisation ou associez-le spécifiquement à `leandre755_HIVE-MIND` dans les paramètres du projet.
6. Cliquez sur le profil dupliqué :
   - Vous pouvez maintenant cliquer sur n'importe quelle règle pour la **Désactiver** (Deactivate) ou changer sa sévérité (Info, Minor, Major, Critical, Blocker).
   - Vous pouvez également cliquer sur **Activate More** pour rechercher et activer des règles optionnelles plus strictes.

---

## 4. Configurer les Seuils de Qualité (Quality Gates)

Le Quality Gate décide si une PR passe (Pass) ou échoue (Fail).

### Conditions par défaut ("Sonar way") :
- **Coverage on New Code** : $\ge 80\%$
- **Duplicated Lines on New Code** : $\le 3\%$
- **Maintainability Rating on New Code** : A
- **Reliability Rating on New Code** : A (0 bug)
- **Security Rating on New Code** : A (0 faille)
- **Security Hotspots Reviewed** : $100\%$

### Comment ajuster ou assouplir les seuils ?
Si par exemple un seuil de 80% de couverture de test est trop élevé pour votre projet en cours de développement :
1. Sur SonarCloud, allez dans l'onglet **Quality Gates** (menu supérieur).
2. Cliquez sur **Copy** à côté de **Sonar way**, et nommez-le (ex: `HIVE-MIND Quality Gate`).
3. Modifiez les conditions souhaitées :
   - Par exemple, ajustez le seuil de couverture (`Coverage`) à 60% ou supprimez temporairement cette condition.
   - Ajustez le taux de duplication accepté.
4. En haut à droite, cliquez sur **Set as Default** ou allez dans les paramètres de votre projet (`Administration` > `Quality Gate`) pour lui assigner ce Quality Gate.

---

## 5. Lancer une Analyse en Local sur sa Machine

Vous pouvez analyser le code sur votre machine avant même de créer une Pull Request.

### Prérequis
Le token est enregistré dans votre fichier d'environnement local (`~/.env`).

### Commande rapide (npm)
Depuis le dossier `/home/omni/Code/HIVE-MIND` :

1. Générer le rapport de couverture de tests :
   ```bash
   npm run test:coverage
   ```

2. Lancer l'analyse SonarCloud :
   ```bash
   npm run sonar
   ```

### Commande CLI directe (via npx)
```bash
SONAR_TOKEN=$(grep "^SONAR_TOKEN=" ~/.env | cut -d '=' -f2) npx sonarqube-scanner -Dsonar.host.url=https://sonarcloud.io
```

### Méthode alternative via Docker (sans dépendance Node locale)
Si vous préférez exécuter l'image officielle SonarSource :
```bash
docker run --rm \
  -e SONAR_TOKEN=$(grep "^SONAR_TOKEN=" ~/.env | cut -d '=' -f2) \
  -v "/home/omni/Code/HIVE-MIND:/usr/src" \
  sonarsource/sonar-scanner-cli \
  -Dsonar.host.url=https://sonarcloud.io
```

### Analyse en direct dans votre éditeur (SonarLint)
Pour voir les alertes Sonar en direct pendant que vous codez (sans attendre le scan) :
1. Installez l'extension **SonarLint** dans votre IDE (VS Code / Antigravity).
2. Ouvrez les paramètres SonarLint > **Connected Mode**.
3. Liez votre compte SonarCloud `leandre755` et sélectionnez le projet `leandre755_HIVE-MIND`.
4. SonarLint appliquera instantanément les mêmes règles que votre CI directement sous votre curseur.

---

Une fois l'analyse terminée, retrouvez le rapport complet en ligne sur :
👉 [Tableau de bord SonarCloud HIVE-MIND](https://sonarcloud.io/dashboard?id=leandre755_HIVE-MIND)

