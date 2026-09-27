# 🧠 Guide : Ajouter un Modèle IA

Ce guide explique comment ajouter un nouveau modèle (ex: GPT-5, Claude sonnet/opus, Gemini 2.5) à une famille existante dans votre bot HIVE-MIND.

## 📂 Résolution du Fichier de Configuration

La configuration des modèles est gérée par le `ConfigPathResolver` (`src/config/ConfigPathResolver.ts`), qui applique une hiérarchie stricte en 5 paliers :

1. **Variables d'environnement** : `HIVE_CONFIG_MODELS_CONFIG_JSON` ou dossier `HIVE_CONFIG_DIR`.
2. **Configuration Projet (`./config/models_config.json`)** :
   > [!WARNING]
   > Pour prévenir les risques d'exfiltration vers des endpoints malveillants lors de l'exécution sur un dépôt tiers, la lecture de `models_config.json` au niveau projet est sanctuarisée. Elle requiert l'opt-in explicite `HIVE_TRUST_PROJECT_CONFIG=true` (ou `1`). Sans cette variable, le projet local est ignoré par sécurité.
3. **Configuration Utilisateur Globale (Recommandé en production/distribution)** :
   `~/.hivemind/config/models_config.json`
   3.bis **Surcharge de defaults opérateur (Optionnel)** :
   Si la variable `HIVE_DEFAULTS_CONFIG_DIR` est définie sur un dossier de defaults personnalisé, celui-ci est inspecté en priorité avant le repli hérité.
4. **Repli hérité (Développement)** : `src/config/models_config.json` (émet un avertissement de dépréciation).
5. **Template par défaut embarqué (Lecture seule)** :
   `src/config/defaults/models_config.json` (utilisé automatiquement si aucun fichier utilisateur n'est présent).

## 📝 Structure d'une Famille

Chaque famille (`openai`, `anthropic`, `gemini`, `groq`, etc.) possède une liste de `modeles` dans `models_config.json` :

```json
"anthropic": {
    "nom_affiche": "Anthropic Claude",
    "modeles": [
        {
            "id": "claude-3-5-sonnet-20240620",  <-- ID technique (API wire)
            "description": "Modèle le plus intelligent.",
            "types": ["chat", "vision", "coding"]
        }
    ]
}
```

## ➕ Comment ajouter un modèle ?

1. Ouvrez votre fichier de configuration utilisateur :
   ```bash
   # Créer le répertoire utilisateur s'il n'existe pas encore
   mkdir -p ~/.hivemind/config
   # Si le fichier n'existe pas encore, copier le template par défaut :
   cp src/config/defaults/models_config.json ~/.hivemind/config/models_config.json
   # Ouvrir le fichier
   nano ~/.hivemind/config/models_config.json
   ```
2. Repérez la famille souhaitée (ex: `"openai"` ou `"gemini"`).
3. Ajoutez un nouvel objet dans le tableau `modeles`.

### Exemple : Ajouter GPT-4o

```json
{
  "id": "gpt-4o",
  "description": "Nouveau modèle omnimodal rapide.",
  "types": ["chat", "vision", "function_calling"]
}
```

### Exemple : Ajouter un modèle local (Ollama/Mistral)

Si vous utilisez une famille compatible OpenAI (comme Mistral ou Ollama), ajoutez simplement l'ID du modèle supporté par le fournisseur :

```json
{
  "id": "open-mixtral-8x22b",
  "description": "Modèle open-source puissant via Mistral API.",
  "types": ["chat", "coding"]
}
```

## ⚠️ Précautions Importantes

- **ID Exact** : L'`id` doit correspondre exactement au nom du modèle attendu par l'API du fournisseur (ex: documentation OpenAI, Google AI Studio ou Anthropic).
- **Redémarrage** : Redémarrez le démon pour charger la nouvelle configuration en mémoire.
- **Sécurité des dépôts tiers** : Si vous placez un `models_config.json` dans `./config/` au sein du workspace de développement, exportez `export HIVE_TRUST_PROJECT_CONFIG=1` pour que le résolveur l'autorise.
- **Capacités** : Ajoutez les tags appropriés dans `types` (`vision` si le modèle accepte des images, `coding` s'il est spécialisé en code).
- **Plafonds de Quota et Rate-Limiting (`QuotaManager`)** : Le routeur résout les modèles déclarés dans `~/.hivemind/config/models_config.json`, mais le gestionnaire de quotas (`QuotaManager` dans `src/services/quotaManager.ts`) lit actuellement les plafonds RPM/TPM/RPD depuis le fichier hérité `src/config/models_config.json`. Si vous associez un objet `quota` à votre modèle, reportez également ce bloc dans `src/config/models_config.json` afin que les gardes de taux soient actives (migration complète de `QuotaManager` prévue en #135).
