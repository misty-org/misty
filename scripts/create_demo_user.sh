#!/usr/bin/env bash

set -euo pipefail

usage() {
    cat <<'EOF'
Create a curated demo user folder and a symlink-based virtual view for Misty.

Usage:
  ./scripts/create_demo_user.sh [options]

Options:
  --name NAME       Demo user name. Default: demo-user
  --root PATH       Cache root to use. Default: $HOME/misty/.cache
  --reset           Remove any existing demo tree for this user before creating it
  --no-seed         Skip placeholder files and only create folders
  -h, --help        Show this help text

Output layout:
  <root>/demo-users/<safe-name>/
    user/           Real demo folders and files
    virtual/        Curated symlink folders you can mount or record from

Examples:
  ./scripts/create_demo_user.sh --name "Video Demo"
  ./scripts/create_demo_user.sh --name "Sales Demo" --reset
  ./scripts/create_demo_user.sh --root /tmp/misty-cache --name "QA Demo"
EOF
}

die() {
    printf 'error: %s\n' "$1" >&2
    exit 1
}

safe_slug() {
    local value
    value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
    value="$(printf '%s' "$value" | tr -cs 'a-z0-9._-' '-')"
    value="${value#-}"
    value="${value%-}"

    if [[ -z "$value" ]]; then
        value="demo-user"
    fi

    printf '%s' "$value"
}

write_file() {
    local path="$1"
    shift
    mkdir -p "$(dirname "$path")"
    cat >"$path" <<EOF
$*
EOF
}

create_seed_content() {
    local user_root="$1"

    mkdir -p \
        "$user_root/Desktop" \
        "$user_root/Documents" \
        "$user_root/Downloads" \
        "$user_root/Pictures/Screenshots" \
        "$user_root/Projects/Misty Demo" \
        "$user_root/Projects/Client Pilot" \
        "$user_root/Shared/Brand Assets" \
        "$user_root/Archives/2026"

    write_file "$user_root/Desktop/Today.txt" \
"Demo tasks

- Record workspace tour
- Show search flow
- Open shared assets folder"

    write_file "$user_root/Documents/Launch Checklist.md" \
"# Launch Checklist

- Confirm demo account is signed in
- Verify sample folders are visible
- Keep personal files outside the recording path"

    write_file "$user_root/Documents/team-notes.txt" \
"Misty demo notes

Use the virtual folder view for recordings.
Avoid browsing outside the demo workspace."

    write_file "$user_root/Downloads/demo-assets.csv" \
"name,type
misty-logo.png,image
walkthrough-outline.txt,document
customer-feedback.csv,data"

    write_file "$user_root/Projects/Misty Demo/README.md" \
"# Misty Demo

This folder exists only for product videos and screenshots."

    write_file "$user_root/Projects/Client Pilot/next-steps.txt" \
"Client Pilot

1. Review folder layout
2. Validate search results
3. Capture UI walkthrough"

    write_file "$user_root/Shared/Brand Assets/asset-list.txt" \
"Brand Assets

- logo-dark.png
- logo-light.png
- app-icon-1024.png"

    write_file "$user_root/Pictures/Screenshots/shot-list.txt" \
"Screenshots to capture

- workspace overview
- file explorer
- search results"

    write_file "$user_root/Archives/2026/keep.txt" \
"Archived demo material"
}

create_empty_structure() {
    local user_root="$1"
    mkdir -p \
        "$user_root/Desktop" \
        "$user_root/Documents" \
        "$user_root/Downloads" \
        "$user_root/Pictures" \
        "$user_root/Projects" \
        "$user_root/Shared" \
        "$user_root/Archives"
}

link_folder() {
    local target="$1"
    local link_path="$2"
    ln -sfn "$target" "$link_path"
}

DEMO_NAME="demo-user"
CACHE_ROOT="${HOME}/misty/.cache"
RESET=0
SEED=1

while [[ $# -gt 0 ]]; do
    case "$1" in
        --name)
            [[ $# -ge 2 ]] || die "--name requires a value"
            DEMO_NAME="$2"
            shift 2
            ;;
        --root)
            [[ $# -ge 2 ]] || die "--root requires a value"
            CACHE_ROOT="$2"
            shift 2
            ;;
        --reset)
            RESET=1
            shift
            ;;
        --no-seed)
            SEED=0
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

SAFE_NAME="$(safe_slug "$DEMO_NAME")"
BASE_DIR="$CACHE_ROOT/demo-users/$SAFE_NAME"
USER_DIR="$BASE_DIR/user"
VIRTUAL_DIR="$BASE_DIR/virtual"

if [[ "$RESET" -eq 1 && -e "$BASE_DIR" ]]; then
    rm -rf "$BASE_DIR"
fi

mkdir -p "$USER_DIR" "$VIRTUAL_DIR"

if [[ "$SEED" -eq 1 ]]; then
    create_seed_content "$USER_DIR"
else
    create_empty_structure "$USER_DIR"
fi

link_folder "$USER_DIR/Desktop" "$VIRTUAL_DIR/01-Desktop"
link_folder "$USER_DIR/Documents" "$VIRTUAL_DIR/02-Documents"
link_folder "$USER_DIR/Projects" "$VIRTUAL_DIR/03-Projects"
link_folder "$USER_DIR/Shared" "$VIRTUAL_DIR/04-Shared"
link_folder "$USER_DIR/Pictures" "$VIRTUAL_DIR/05-Pictures"
link_folder "$USER_DIR/Downloads" "$VIRTUAL_DIR/06-Downloads"

write_file "$BASE_DIR/README.txt" \
"Demo user: $DEMO_NAME
Safe name: $SAFE_NAME

Real demo files:
$USER_DIR

Curated virtual view:
$VIRTUAL_DIR

Use the virtual path in recordings if you want a shorter, cleaner folder list."

printf 'Created demo user tree\n'
printf '  user:    %s\n' "$USER_DIR"
printf '  virtual: %s\n' "$VIRTUAL_DIR"
