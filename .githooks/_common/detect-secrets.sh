#!/bin/bash
# Secret detection script for Git Hooks
# Detects API keys, passwords, and tokens before committing

set -e

# Output colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SECRETS_FOUND=0

# Dangerous secret patterns
PATTERNS=(
    'PRIVATE_KEY\|private_key\|privateKey'
    'API_KEY\|api_key\|apiKey'
    'AWS_SECRET\|aws_secret'
    'PASSWORD\|password\|passwd'
    'SECRET\|secret'
    'TOKEN\|token'
    'BEARER\|bearer'
    'DATABASE_URL'
    'oauth_token'
    '-----BEGIN RSA\|-----BEGIN PRIVATE'
)

# Fetch staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED_FILES" ]; then
    exit 0
fi

echo -e "${YELLOW}🔍 Scanning for secrets in staged files...${NC}"

for file in $STAGED_FILES; do
    # Saute les fichiers binaires
    if file "$file" | grep -q binary; then
        continue
    fi

    # Vérifie chaque pattern
    for pattern in "${PATTERNS[@]}"; do
        if git show ":$file" 2>/dev/null | grep -i -- "$pattern" | grep -v "^#" >/dev/null 2>&1; then
            echo -e "${RED}❌ SECURITY: Potential secret detected in $file${NC}"
            echo -e "${RED}   Pattern: $pattern${NC}"
            git show ":$file" | grep -in -- "$pattern" | head -3 | sed 's/^/   /'
            SECRETS_FOUND=1
        fi
    done
done

if [ $SECRETS_FOUND -eq 1 ]; then
    echo -e "${RED}❌ Commit aborted: Secrets detected${NC}"
    echo -e "${YELLOW}ℹ️  Corrigez le contenu indexé ; --no-verify ne doit être utilisé qu’en urgence documentée.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ No secrets detected${NC}"
exit 0
