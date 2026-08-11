# Plugin Updates - Jan 2026

## New Plugin: crawlfire_web

Integration with **Firecrawl v2** for advanced web crawling and scraping.

### Features

- `firecrawl_scrape`: Transforme une URL en Markdown propre.
- `firecrawl_crawl`: Explore tout un site web.
- `firecrawl_map`: Liste toutes les URLs d'un domaine.
- `firecrawl_search`: Recherche web + scraping combinés.
- `firecrawl_extract`: Extraction de données structurées par IA.

### Configuration

Ajoutez votre clé API dans `.env` :

```env
FIRECRAWL_API_KEY=fc-your-key
```

---

## Renamed: duckduck_search

Le plugin `web_search` a été renommé en `duckduck_search` pour plus de clarté.

### Migration

- Le nom du plugin est maintenant `duckduck_search`.
- L'outil associé est `duckduck_search`.
- Les agents `shopping` et `deep_research` ont été mis à jour automatiquement.
