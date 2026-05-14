#!/bin/bash
# Push xG-Vantage to GitHub
# Run this script from your local machine after cloning/copying the project

set -e

REPO_URL="https://github.com/Heisdawrld/XG-VANTAGE"
BRANCH="main"

echo "=== xG-Vantage GitHub Push Script ==="
echo ""
echo "This will force-push the main branch to $REPO_URL"
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "Error: git is not installed"
    exit 1
fi

# Add remote if not exists
if ! git remote | grep -q origin; then
    git remote add origin $REPO_URL
    echo "Added remote: origin -> $REPO_URL"
else
    git remote set-url origin $REPO_URL
    echo "Updated remote: origin -> $REPO_URL"
fi

# Stage all changes
git add -A

# Commit if there are changes
if git diff --cached --quiet; then
    echo "No changes to commit"
else
    git commit -m "feat: xG-Vantage - Monster prediction engine + Premium UI + Turso DB"
    echo "Changes committed"
fi

# Push
echo "Pushing to $BRANCH..."
git push origin $BRANCH --force

echo ""
echo "=== Push complete! ==="
echo "View your repo at: $REPO_URL"
