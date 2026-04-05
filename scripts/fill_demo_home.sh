#!/usr/bin/env bash

set -euo pipefail

usage() {
    cat <<'EOF'
Populate a real home directory with believable demo folders and sample files.

Usage:
  ./scripts/fill_demo_home.sh [options]

Options:
  --target PATH     Home directory to populate. Default: /Users/Guest
  --reset           Remove only folders created by this script before repopulating
  -h, --help        Show help

Notes:
  - The script is additive by default and will not overwrite existing files.
  - --reset only removes the demo folders managed by this script.
EOF
}

die() {
    printf 'error: %s\n' "$1" >&2
    exit 1
}

write_if_missing() {
    local path="$1"
    shift

    if [[ -e "$path" ]]; then
        return 0
    fi

    mkdir -p "$(dirname "$path")"
    cat >"$path" <<EOF
$*
EOF
}

touch_if_missing() {
    local path="$1"
    if [[ -e "$path" ]]; then
        return 0
    fi

    mkdir -p "$(dirname "$path")"
    : >"$path"
}

TARGET_HOME="/Users/Guest"
RESET=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)
            [[ $# -ge 2 ]] || die "--target requires a value"
            TARGET_HOME="$2"
            shift 2
            ;;
        --reset)
            RESET=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            die "unknown argument: $1"
            ;;
    esac
done

if [[ ! -d "$TARGET_HOME" ]]; then
    die "target home does not exist: $TARGET_HOME"
fi

managed_dirs=(
    "$TARGET_HOME/Desktop"
    "$TARGET_HOME/Music"
    "$TARGET_HOME/Movies"
    "$TARGET_HOME/Projects"
    "$TARGET_HOME/Projects/Client Portal"
    "$TARGET_HOME/Projects/Mobile Redesign"
    "$TARGET_HOME/Projects/Misty Demo"
    "$TARGET_HOME/Work"
    "$TARGET_HOME/Work/Q2 Planning"
    "$TARGET_HOME/Work/Expenses"
    "$TARGET_HOME/Archive"
    "$TARGET_HOME/Archive/2024"
    "$TARGET_HOME/Notes"
    "$TARGET_HOME/Pictures/Screenshots"
    "$TARGET_HOME/Pictures/Vacation"
)

if [[ "$RESET" -eq 1 ]]; then
    for dir in "${managed_dirs[@]}"; do
        if [[ -d "$dir" ]]; then
            rm -rf "$dir"
        fi
    done
fi

for dir in "${managed_dirs[@]}"; do
    mkdir -p "$dir"
done

write_if_missing "$TARGET_HOME/Desktop/Read Me First.txt" \
"Demo account notes

- Use this account for recordings only
- Keep the Finder window inside /Users/Guest
- Avoid opening personal folders from other accounts"

write_if_missing "$TARGET_HOME/Desktop/Meeting Agenda.md" \
"# Meeting Agenda

1. Product walkthrough
2. Search and sync demo
3. Wrap-up and next steps"

write_if_missing "$TARGET_HOME/Documents/travel ideas.txt" \
"Weekend ideas

- San Diego
- Portland
- Vancouver"

write_if_missing "$TARGET_HOME/Documents/home-budget-2026.csv" \
"month,category,amount
January,Rent,2450
January,Groceries,610
January,Utilities,190
January,Travel,340"

write_if_missing "$TARGET_HOME/Documents/quick-links.md" \
"# Quick Links

- onboarding notes
- shared assets
- project screenshots"

write_if_missing "$TARGET_HOME/Downloads/invoice-1038.pdf" \
"Placeholder invoice for demo recordings."

write_if_missing "$TARGET_HOME/Downloads/client-export.zip" \
"Placeholder archive for demo recordings."

write_if_missing "$TARGET_HOME/Downloads/roadmap-draft.pptx" \
"Placeholder slide deck for demo recordings."

write_if_missing "$TARGET_HOME/Projects/Client Portal/README.md" \
"# Client Portal

Internal notes and mock deliverables for the portal project."

write_if_missing "$TARGET_HOME/Projects/Client Portal/tasks.txt" \
"- polish settings page
- update export labels
- capture final screenshots"

write_if_missing "$TARGET_HOME/Projects/Mobile Redesign/feedback.md" \
"# Feedback

- tighten header spacing
- reduce empty states
- improve contrast on buttons"

write_if_missing "$TARGET_HOME/Projects/Mobile Redesign/wireframe-notes.txt" \
"Wireframe notes

Keep navigation shallow and searchable."

write_if_missing "$TARGET_HOME/Projects/Misty Demo/demo-outline.md" \
"# Demo Outline

1. Open workspace
2. Browse files
3. Show search
4. Open shared folder"

write_if_missing "$TARGET_HOME/Work/Q2 Planning/objectives.md" \
"# Q2 Objectives

- finish onboarding pass
- improve search relevance
- simplify demo setup"

write_if_missing "$TARGET_HOME/Work/Expenses/march-expenses.csv" \
"date,merchant,total
2026-03-02,Cafe Verde,18.40
2026-03-08,Office Supply,42.17
2026-03-19,Rideshare,23.95"

write_if_missing "$TARGET_HOME/Archive/2024/account-cleanup.txt" \
"Old cleanup notes kept for archive testing."

write_if_missing "$TARGET_HOME/Notes/ideas.md" \
"# Ideas

- shared folders by client
- bulk preview mode
- recording-safe workspace preset"

write_if_missing "$TARGET_HOME/Pictures/Screenshots/shot-list.txt" \
"- home view
- explorer state
- results panel"

write_if_missing "$TARGET_HOME/Pictures/Vacation/photo-index.txt" \
"IMG_1842.jpg
IMG_1849.jpg
IMG_1854.jpg"

write_if_missing "$TARGET_HOME/Music/playlist.txt" \
"Morning Focus
Weekend Drive
Late Night Build"

write_if_missing "$TARGET_HOME/Movies/watchlist.txt" \
"- The Grand Budapest Hotel
- Arrival
- Spider-Man: Into the Spider-Verse"

touch_if_missing "$TARGET_HOME/Pictures/Vacation/IMG_1842.jpg"
touch_if_missing "$TARGET_HOME/Pictures/Vacation/IMG_1849.jpg"
touch_if_missing "$TARGET_HOME/Pictures/Vacation/IMG_1854.jpg"
touch_if_missing "$TARGET_HOME/Pictures/Screenshots/app-home.png"
touch_if_missing "$TARGET_HOME/Pictures/Screenshots/search-results.png"
touch_if_missing "$TARGET_HOME/Movies/demo-cut.mov"
touch_if_missing "$TARGET_HOME/Music/favorite-track.mp3"

printf 'Populated demo home at %s\n' "$TARGET_HOME"
