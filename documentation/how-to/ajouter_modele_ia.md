# 🧠 Guide : Ajouter un Modèle IA

Ce guide explique comment ajouter un nouveau modèle (ex: GPT-5, Claude sonnet/opus) à une famille existante dans votre bot WhatsApp.

## 📂 Fichier de Configuration

Toute la configuration des modèles se trouve dans :
`V2/config/models_config.json`

## 📝 Structure d'une Famille

Chaque famille (openai, anthropic, gemini, etc.) possède une liste de `modeles`.

```json
"anthropic": {
    "nom_affiche": "Anthropic Claude",
    "modeles": [
        {
            "id": "claude-3-5-sonnet-20240620",  <-- ID technique (API)
            "description": "Modèle le plus intelligent.",
            "types": ["chat", "vision", "coding"]
        }
    ]
}
```

## ➕ Comment ajouter un modèle ?

1.  Ouvrez `V2/config/models_config.json`.
2.  Repérez la famille souhaitée (ex: `"openai"`).
3.  Ajoutez un nouvel objet dans le tableau `modeles`.

### Exemple : Ajouter GPT-4o

```json
{
  "id": "gpt-4o",
  "description": "Nouveau modèle omnimodal rapide.",
  "types": ["chat", "vision", "function_calling"]
}
```

### Exemple : Ajouter un modèle local (Ollama/Mistral)

Si vous utilisez une famille compatible OpenAI (comme Mistral ou Moonshot), ajoutez simplement l'ID du modèle supporté par le fournisseur.

```json
{
  "id": "open-mixtral-8x22b",
  "description": "Modèle open-source puissant via Mistral API.",
  "types": ["chat", "coding"]
}
```

## ⚠️ Important

- **ID Exact** : L'`id` doit correspondre exactement au nom du modèle attendu par l'API du fournisseur (ex: regardez la doc OpenAI ou Anthropic).
- **Redémarrage** : Vous devez redémarrer le bot (`npm start`) pour que le nouveau modèle soit pris en compte.
- **Capacités** : Ajoutez les tags appropriés dans `types` (`vision` si le modèle voit des images, `coding` s'il est bon en code).
