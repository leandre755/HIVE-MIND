#!/bin/bash
# Multi-language script to lint staged files
# Automatically detects language and applies appropriate linter

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

LINT_ERRORS=0

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED_FILES" ]; then
    exit 0
fi

echo -e "${BLUE}📋 Running linters on staged files...${NC}"

for file in $STAGED_FILES; do
    # Skip binary files
    if file "$file" 2>/dev/null | grep -q binary; then
        continue
    fi

    # JavaScript/TypeScript
    if [[ "$file" =~ \.(js|jsx|ts|tsx|mjs)$ ]]; then
        if command -v eslint &> /dev/null; then
            if eslint "$file" > /dev/null 2>&1; then
                echo -e "${GREEN}✅ Lint passed: $file (ESLint)${NC}"
            else
                echo -e "${RED}❌ Lint failed: $file (ESLint)${NC}"
                eslint "$file" 2>&1 | head -10
                ((LINT_ERRORS++))
            fi
        else
            echo -e "${YELLOW}⚠️  ESLint not found, skipping $file${NC}"
        fi

    # Python
    elif [[ "$file" =~ \.py$ ]]; then
        if command -v pylint &> /dev/null; then
            if pylint "$file" --disable=all --enable=E,F > /dev/null 2>&1; then
                echo -e "${GREEN}✅ Lint passed: $file (Pylint)${NC}"
            else
                echo -e "${RED}❌ Lint failed: $file (Pylint)${NC}"
                pylint "$file" --disable=all --enable=E,F 2>&1 | head -10
                ((LINT_ERRORS++))
            fi
        elif command -v flake8 &> /dev/null; then
            if flake8 "$file" --select=E,F > /dev/null 2>&1; then
                echo -e "${GREEN}✅ Lint passed: $file (Flake8)${NC}"
            else
                echo -e "${RED}❌ Lint failed: $file (Flake8)${NC}"
                flake8 "$file" --select=E,F 2>&1 | head -10
                ((LINT_ERRORS++))
            fi
        else
            echo -e "${YELLOW}⚠️  Python linter not found, skipping $file${NC}"
        fi

    # Java
    elif [[ "$file" =~ \.java$ ]]; then
        if command -v checkstyle &> /dev/null; then
            if checkstyle -c /sun_checks.xml "$file" > /dev/null 2>&1; then
                echo -e "${GREEN}✅ Lint passed: $file (Checkstyle)${NC}"
            else
                echo -e "${YELLOW}⚠️  Checkstyle warning: $file${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  Checkstyle not found, skipping $file${NC}"
        fi

    # C/C++
    elif [[ "$file" =~ \.(c|cpp|cc|cxx|h|hpp)$ ]]; then
        if command -v cppcheck &> /dev/null; then
            if cppcheck "$file" > /dev/null 2>&1; then
                echo -e "${GREEN}✅ Lint passed: $file (cppcheck)${NC}"
            else
                echo -e "${YELLOW}⚠️  cppcheck warning: $file${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  cppcheck not found, skipping $file${NC}"
        fi

    # Go
    elif [[ "$file" =~ \.go$ ]]; then
        if command -v golint &> /dev/null; then
            if golint "$file" > /dev/null 2>&1; then
                echo -e "${GREEN}✅ Lint passed: $file (golint)${NC}"
            else
                echo -e "${YELLOW}⚠️  golint warning: $file${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  golint not found, skipping $file${NC}"
        fi

    # Rust
    elif [[ "$file" =~ \.rs$ ]]; then
        if command -v rustfmt &> /dev/null; then
            if rustfmt --check "$file" > /dev/null 2>&1; then
                echo -e "${GREEN}✅ Lint passed: $file (rustfmt)${NC}"
            else
                echo -e "${RED}❌ Lint failed: $file (rustfmt)${NC}"
                ((LINT_ERRORS++))
            fi
        else
            echo -e "${YELLOW}⚠️  rustfmt not found, skipping $file${NC}"
        fi

    # PHP
    elif [[ "$file" =~ \.php$ ]]; then
        if command -v php &> /dev/null; then
            if php -l "$file" > /dev/null 2>&1; then
                echo -e "${GREEN}✅ Lint passed: $file (PHP)${NC}"
            else
                echo -e "${RED}❌ Lint failed: $file (PHP)${NC}"
                php -l "$file" 2>&1 | head -10
                ((LINT_ERRORS++))
            fi
        else
            echo -e "${YELLOW}⚠️  PHP not found, skipping $file${NC}"
        fi

    # C#
    elif [[ "$file" =~ \.cs$ ]]; then
        echo -e "${YELLOW}⚠️  C# linting requires IDE integration, skipping $file${NC}"

    # Markdown
    elif [[ "$file" =~ \.md$ ]]; then
        if command -v markdownlint &> /dev/null; then
            if markdownlint "$file" > /dev/null 2>&1; then
                echo -e "${GREEN}✅ Lint passed: $file (markdownlint)${NC}"
            else
                echo -e "${YELLOW}⚠️  markdownlint warning: $file${NC}"
            fi
        fi

    fi
done

if [ $LINT_ERRORS -gt 0 ]; then
    echo -e "${RED}❌ Linting failed for $LINT_ERRORS file(s)${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All lints passed${NC}"
exit 0
