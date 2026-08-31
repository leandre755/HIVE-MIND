#!/bin/bash
# Script to run fast unit tests
# Automatically detects project type and executes appropriate test runner
# Timeout: 5 minutes max to prevent hanging processes

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TEST_TIMEOUT=300  # 5 minutes

echo -e "${BLUE}🧪 Running unit tests (timeout: 5 min)...${NC}"

# Detect project type based on files present
if [ -f "package.json" ]; then
    echo -e "${BLUE}Detected: Node.js/JavaScript project${NC}"
    if command -v npm &> /dev/null; then
        if [ -f "package-lock.json" ] || [ -f "yarn.lock" ]; then
            if npm run | grep -q "test:unit"; then
                TEST_CMD="npm run test:unit"
            else
                TEST_CMD="npm test"
            fi
            timeout $TEST_TIMEOUT $TEST_CMD 2>&1 || {
                EXIT_CODE=$?
                if [ $EXIT_CODE -eq 124 ]; then
                    echo -e "${RED}❌ Tests timed out (>5 min)${NC}"
                    exit 1
                else
                    echo -e "${RED}❌ Tests failed${NC}"
                    exit 1
                fi
            }
        else
            echo -e "${YELLOW}⚠️  No lock file found, skipping tests${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  npm not found${NC}"
        exit 0
    fi

elif [ -f "pyproject.toml" ] || [ -f "setup.py" ] || [ -f "requirements.txt" ]; then
    echo -e "${BLUE}Detected: Python project${NC}"
    if command -v pytest &> /dev/null; then
        timeout $TEST_TIMEOUT pytest -x --tb=short 2>&1 || {
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo -e "${RED}❌ Tests timed out (>5 min)${NC}"
                exit 1
            else
                echo -e "${RED}❌ Tests failed${NC}"
                exit 1
            fi
        }
    elif command -v python -m unittest &> /dev/null; then
        timeout $TEST_TIMEOUT python -m unittest discover -s . -p "test_*.py" 2>&1 || {
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo -e "${RED}❌ Tests timed out (>5 min)${NC}"
                exit 1
            else
                echo -e "${RED}❌ Tests failed${NC}"
                exit 1
            fi
        }
    else
        echo -e "${YELLOW}⚠️  No Python test runner found (pytest/unittest)${NC}"
        exit 0
    fi

elif [ -f "pom.xml" ]; then
    echo -e "${BLUE}Detected: Maven/Java project${NC}"
    if command -v mvn &> /dev/null; then
        timeout $TEST_TIMEOUT mvn test -q 2>&1 || {
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo -e "${RED}❌ Tests timed out (>5 min)${NC}"
                exit 1
            else
                echo -e "${RED}❌ Tests failed${NC}"
                exit 1
            fi
        }
    else
        echo -e "${YELLOW}⚠️  mvn not found${NC}"
        exit 0
    fi

elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    echo -e "${BLUE}Detected: Gradle/Java project${NC}"
    if command -v gradle &> /dev/null; then
        timeout $TEST_TIMEOUT gradle test 2>&1 || {
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo -e "${RED}❌ Tests timed out (>5 min)${NC}"
                exit 1
            else
                echo -e "${RED}❌ Tests failed${NC}"
                exit 1
            fi
        }
    else
        echo -e "${YELLOW}⚠️  gradle not found${NC}"
        exit 0
    fi

elif [ -f "go.mod" ]; then
    echo -e "${BLUE}Detected: Go project${NC}"
    if command -v go &> /dev/null; then
        timeout $TEST_TIMEOUT go test ./... 2>&1 || {
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo -e "${RED}❌ Tests timed out (>5 min)${NC}"
                exit 1
            else
                echo -e "${RED}❌ Tests failed${NC}"
                exit 1
            fi
        }
    else
        echo -e "${YELLOW}⚠️  go not found${NC}"
        exit 0
    fi

elif [ -f "Cargo.toml" ]; then
    echo -e "${BLUE}Detected: Rust project${NC}"
    if command -v cargo &> /dev/null; then
        timeout $TEST_TIMEOUT cargo test 2>&1 || {
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo -e "${RED}❌ Tests timed out (>5 min)${NC}"
                exit 1
            else
                echo -e "${RED}❌ Tests failed${NC}"
                exit 1
            fi
        }
    else
        echo -e "${YELLOW}⚠️  cargo not found${NC}"
        exit 0
    fi

elif [ -f ".sln" ]; then
    echo -e "${BLUE}Detected: .NET/C# project${NC}"
    if command -v dotnet &> /dev/null; then
        timeout $TEST_TIMEOUT dotnet test 2>&1 || {
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo -e "${RED}❌ Tests timed out (>5 min)${NC}"
                exit 1
            else
                echo -e "${RED}❌ Tests failed${NC}"
                exit 1
            fi
        }
    else
        echo -e "${YELLOW}⚠️  dotnet not found${NC}"
        exit 0
    fi

elif [ -f "composer.json" ]; then
    echo -e "${BLUE}Detected: PHP/Composer project${NC}"
    if command -v php &> /dev/null && command -v phpunit &> /dev/null; then
        timeout $TEST_TIMEOUT phpunit 2>&1 || {
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo -e "${RED}❌ Tests timed out (>5 min)${NC}"
                exit 1
            else
                echo -e "${RED}❌ Tests failed${NC}"
                exit 1
            fi
        }
    else
        echo -e "${YELLOW}⚠️  PHP/PHPUnit not found${NC}"
        exit 0
    fi

else
    echo -e "${YELLOW}⚠️  No recognized project type found, skipping tests${NC}"
    exit 0
fi

echo -e "${GREEN}✅ All tests passed${NC}"
exit 0
