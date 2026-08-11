/**
 * Fonctions utilitaires défensives injectées dans le sandbox VM
 * Inspiré de programmatic-tool-calling/lib/sandbox.ts
 *
 * WHY: Les résultats des tools sont imprévisibles (objets, arrays, strings, null).
 * Ces helpers permettent au code généré par le LLM de manipuler les données
 * sans crasher sur des cas limites.
 */

export const SANDBOX_HELPERS_SOURCE = `
// ============= DEFENSIVE HELPER FUNCTIONS =============

/**
 * Convertit toute valeur en array de manière sûre.
 * null/undefined → [], objet avec .items/.data/.results → extrait, valeur → [valeur]
 */
const toArray = (value) => {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') {
        if (Array.isArray(value.items)) return value.items;
        if (Array.isArray(value.data)) return value.data;
        if (Array.isArray(value.results)) return value.results;
        if (Array.isArray(value.content)) return value.content;
    }
    return [value];
};

/**
 * Accès sûr à une propriété imbriquée.
 * safeGet(obj, 'a.b.c', defaultValue)
 */
const safeGet = (obj, path, defaultValue = undefined) => {
    if (obj === null || obj === undefined) return defaultValue;
    const keys = typeof path === 'string' ? path.split('.') : [path];
    let result = obj;
    for (const key of keys) {
        if (result === null || result === undefined) return defaultValue;
        result = result[key];
    }
    return result === undefined ? defaultValue : result;
};

/** Map sûr sur n'importe quelle valeur (convertit en array d'abord) */
const safeMap = (value, fn) => toArray(value).map(fn);

/** Filter sûr sur n'importe quelle valeur */
const safeFilter = (value, fn) => toArray(value).filter(fn);

/** Premier élément de n'importe quelle valeur */
const first = (value) => {
    const arr = toArray(value);
    return arr.length > 0 ? arr[0] : null;
};

/** Longueur sûre de n'importe quelle valeur */
const len = (value) => toArray(value).length;

/** Vérifie si une réponse indique un succès */
const isSuccess = (response) => {
    if (!response) return false;
    if (response.success === false) return false;
    if (response.error) return false;
    if (response.isError) return false;
    return true;
};

/** Extrait les données d'une réponse (gère différents formats) */
const extractData = (response) => {
    if (!response) return null;
    if (response.data !== undefined) return response.data;
    if (response.result !== undefined) return response.result;
    if (response.results !== undefined) return response.results;
    if (response.items !== undefined) return response.items;
    if (response.content !== undefined && !response.markdown) return response.content;
    return response;
};

/** Extrait du texte d'une réponse (pour commandes, scraping, etc.) */
const extractText = (response, defaultValue = '') => {
    if (!response) return defaultValue;
    if (typeof response === 'string') return response;
    const textProps = ['llmOutput', 'userOutput', 'text', 'output', 'stdout', 'content', 'markdown', 'result', 'data', 'value', 'message'];
    for (const prop of textProps) {
        if (typeof response[prop] === 'string' && response[prop]) {
            return response[prop];
        }
    }
    if (typeof response === 'object') {
        try { return JSON.stringify(response); } catch { return defaultValue; }
    }
    return String(response) || defaultValue;
};

/** Parse la sortie d'une commande { success, output, error } */
const getCommandOutput = (response) => {
    if (!response) return { success: false, output: '', error: 'No response' };
    return {
        success: isSuccess(response),
        output: extractText(response, ''),
        error: response.error || response.stderr || ''
    };
};

// ============= END HELPER FUNCTIONS =============
`;
