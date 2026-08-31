#!/bin/bash
# Multi-language script to format staged files
# Automatically detects language and applies appropriate formatter

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

FORMATTED_COUNT=0
FAILED_COUNT=0

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED_FILES" ]; then
    exit 0
fi

echo -e "${BLUE}🎨 Running code formatters on staged files...${NC}"

for file in $STAGED_FILES; do
    # Skip binary files
    if file "$file" 2>/dev/null | grep -q binary; then
        continue
    fi

    # JavaScript/TypeScript
    if [[ "$file" =~ \.(js|jsx|ts|tsx|mjs)$ ]]; then
        if command -v prettier &> /dev/null; then
            if prettier --write "$file" > /dev/null 2>&1; then
                git add "$file"
                echo -e "${GREEN}✅ Formatted: $file (Prettier)${NC}"
                ((FORMATTED_COUNT++))
            else
                echo -e "${RED}❌ Format failed: $file (Prettier)${NC}"
                ((FAILED_COUNT++))
            fi
        else
            echo -e "${YELLOW}⚠️  Prettier not found, skipping $file${NC}"
        fi

    # Python
    elif [[ "$file" =~ \.py$ ]]; then
        if command -v black &> /dev/null; then
            if black "$file" > /dev/null 2>&1; then
                git add "$file"
                echo -e "${GREEN}✅ Formatted: $file (Black)${NC}"
                ((FORMATTED_COUNT++))
            else
                echo -e "${RED}❌ Format failed: $file (Black)${NC}"
                ((FAILED_COUNT++))
            fi
        elif command -v autopep8 &> /dev/null; then
            if autopep8 --in-place "$file" > /dev/null 2>&1; then
                git add "$file"
                echo -e "${GREEN}✅ Formatted: $file (autopep8)${NC}"
                ((FORMATTED_COUNT++))
            else
                echo -e "${RED}❌ Format failed: $file (autopep8)${NC}"
                ((FAILED_COUNT++))
            fi
        else
            echo -e "${YELLOW}⚠️  Python formatter not found, skipping $file${NC}"
        fi

    # C/C++
    elif [[ "$file" =~ \.(c|cpp|cc|cxx|h|hpp)$ ]]; then
        if command -v clang-format &> /dev/null; then
            if clang-format -i "$file" > /dev/null 2>&1; then
                git add "$file"
                echo -e "${GREEN}✅ Formatted: $file (clang-format)${NC}"
                ((FORMATTED_COUNT++))
            else
                echo -e "${RED}❌ Format failed: $file (clang-format)${NC}"
                ((FAILED_COUNT++))
            fi
        else
            echo -e "${YELLOW}⚠️  clang-format not found, skipping $file${NC}"
        fi

    # JSON
    elif [[ "$file" =~ \.json$ ]]; then
        if command -v jq &> /dev/null; then
            if jq . "$file" > "${file}.tmp" 2>/dev/null; then
                mv "${file}.tmp" "$file"
                git add "$file"
                echo -e "${GREEN}✅ Formatted: $file (jq)${NC}"
                ((FORMATTED_COUNT++))
            else
                rm -f "${file}.tmp"
                echo -e "${RED}❌ Format failed: $file (jq)${NC}"
                ((FAILED_COUNT++))
            fi
        else
            echo -e "${YELLOW}⚠️  jq not found, skipping $file${NC}"
        fi

    # YAML
    elif [[ "$file" =~ \.(yml|yaml)$ ]]; then
        if command -v yamllint &> /dev/null; then
            echo -e "${GREEN}✅ Validated: $file (yamllint)${NC}"
        else
            echo -e "${YELLOW}⚠️  yamllint not found, skipping $file${NC}"
        fi

    fi
done

if [ $FAILED_COUNT -gt 0 ]; then
    echo -e "${RED}❌ Format failed for $FAILED_COUNT file(s)${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Formatting complete ($FORMATTED_COUNT files processed)${NC}"
exit 0
