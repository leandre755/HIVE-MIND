#!/bin/bash
# Détection de secrets par gitleaks pour la Quality Gate.
# Usage : detect-secrets.sh [staged|history]
#   staged  : scanne l'index Git   — appelé par .githooks/pre-commit
#   history : scanne l'historique  — appelé par .githooks/pre-push
# Sortie : 0 = rien détecté, 1 = secrets détectés ou gitleaks absent, 2 = mode invalide.
# gitleaks lit la configuration du dépôt (.gitleaks.toml) qui étend ses règles natives.

set -e

MODE="${1:-staged}"

HOOK_SOURCE="${BASH_SOURCE[0]}"
while [ -L "$HOOK_SOURCE" ]; do
    HOOK_TARGET="$(readlink "$HOOK_SOURCE")"
    case "$HOOK_TARGET" in
        /*) HOOK_SOURCE="$HOOK_TARGET" ;;
        *) HOOK_SOURCE="$(dirname "$HOOK_SOURCE")/$HOOK_TARGET" ;;
    esac
done
REPO_ROOT="$(cd "$(dirname "$HOOK_SOURCE")/../.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ~/.local/bin : cible d'installation sans droits root, présente dans le PATH de la session.
PATH="$HOME/.local/bin:$PATH"
export PATH

if ! command -v gitleaks >/dev/null 2>&1; then
    echo -e "${RED}❌ gitleaks est introuvable : le contrôle anti-fuite ne peut pas s'exécuter.${NC}"
    echo -e "${YELLOW}   La gate ne se dégrade pas silencieusement. Installation sans root :${NC}"
    echo "     VERSION=8.30.1; OS=linux; ARCH=x64; cd \"\$(mktemp -d)\" \\"
    echo "     && curl -sSfL -O \"https://github.com/gitleaks/gitleaks/releases/download/v\${VERSION}/gitleaks_\${VERSION}_\${OS}_\${ARCH}.tar.gz\" \\"
    echo "     && curl -sSfL \"https://github.com/gitleaks/gitleaks/releases/download/v\${VERSION}/gitleaks_\${VERSION}_checksums.txt\" | grep \"\${OS}_\${ARCH}.tar.gz\" | sha256sum -c - \\"
    echo "     && tar -xzf gitleaks_\${VERSION}_\${OS}_\${ARCH}.tar.gz gitleaks \\"
    echo "     && install -m 755 gitleaks \"\$HOME/.local/bin/gitleaks\""
    exit 1
fi

cd "$REPO_ROOT"

case "$MODE" in
    staged)
        echo -e "${BLUE}🔍 gitleaks $(gitleaks version) — index stagé...${NC}"
        SCAN_ARGS=(protect --staged)
        ;;
    history)
        echo -e "${BLUE}🔍 gitleaks $(gitleaks version) — historique du dépôt...${NC}"
        SCAN_ARGS=(git .)
        ;;
    *)
        echo -e "${RED}❌ Mode inconnu : '$MODE' (attendu : staged|history)${NC}"
        exit 2
        ;;
esac

if gitleaks "${SCAN_ARGS[@]}" --config "$REPO_ROOT/.gitleaks.toml" --redact --verbose --no-banner; then
    echo -e "${GREEN}✅ Aucun secret détecté${NC}"
    exit 0
fi

echo -e "${RED}❌ gitleaks a détecté du matériel sensible — opération bloquée.${NC}"
echo -e "${YELLOW}   Les valeurs sont masquées (--redact) : l'outil indique le fichier et la ligne.${NC}"
echo "   1. Traitez la valeur comme compromise si elle a déjà été poussée ailleurs."
echo "   2. Retirez-la du contenu visé (jamais de --no-verify pour ce contrôle)."
echo "   3. Un faux positif purement documentaire s'excipe dans .gitleaks.toml, §[allowlist]."
exit 1
