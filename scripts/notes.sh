#!/usr/bin/env bash
# notes.sh — git-notes-backed knowledge store
# Attach rough, informal notes to the repository via git notes.
# No dependencies beyond bash and git.
set -euo pipefail

NOTES_REF="explainers"
NOTES_FULL_REF="refs/notes/$NOTES_REF"

# --- helpers ---

die() {
  echo "Error: $*" >&2
  exit 1
}

# Resolve a key string to a blob OID.
# With -w: writes the blob to the object database.
# Without -w: computes the hash only (for lookups).
key_to_oid() {
  local key="$1" write="${2:-}"
  if [[ "$write" == "-w" ]]; then
    printf '%s\n' "$key" | git hash-object -w --stdin
  else
    printf '%s\n' "$key" | git hash-object --stdin
  fi
}

# Check whether a note exists for the given OID.
note_exists() {
  local oid="$1"
  git notes --ref="$NOTES_REF" show "$oid" >/dev/null 2>&1
}

# Resolve a key string to a blob OID (hash only, no write).
resolve_key() {
  local input="$1"
  key_to_oid "$input"
}

# Rebuild synthetic key blobs after a fresh clone.
# Reads every note's hashed-string field and ensures the
# corresponding blob exists in the local object database.
rebuild_key_blobs() {
  local note_list
  note_list=$(git notes --ref="$NOTES_REF" list 2>/dev/null || true)
  [[ -z "$note_list" ]] && return 0

  echo "$note_list" | while read -r note_blob target_oid; do
    # Check whether the target blob exists locally.
    if ! git cat-file -e "$target_oid" 2>/dev/null; then
      # Read the note content to find the hashed-string field.
      local note_content
      note_content=$(git cat-file -p "$note_blob")
      local hashed_string
      hashed_string=$(echo "$note_content" | sed -n 's/^hashed-string: *//p' | head -1)
      if [[ -n "$hashed_string" ]]; then
        printf '%s\n' "$hashed_string" | git hash-object -w --stdin >/dev/null
      fi
    fi
  done
}

# Extract frontmatter from note content (first --- to second --- only).
extract_frontmatter() {
  local content="$1"
  echo "$content" | awk '/^---$/ { count++; print; if (count == 2) exit; next } count == 1 { print }'
}

# Extract body from note content (everything after the second ---).
extract_body() {
  local content="$1"
  echo "$content" | awk '
    /^---$/ { count++; next }
    count >= 2 { print }
  '
}

# Extract a single field value from note content.
extract_field() {
  local content="$1" field="$2"
  echo "$content" | sed -n "s/^${field}: *//p" | head -1
}

# Extract paths list from note content (handles YAML list format).
extract_paths() {
  local content="$1"
  # Capture lines between "paths:" and the next non-list-item line.
  echo "$content" | awk '
    /^paths:/ { reading=1; next }
    reading && /^  - / { gsub(/^  - /, ""); print; next }
    reading { exit }
  '
}

# Build YAML frontmatter from arguments.
build_frontmatter() {
  local key="$1" topic="$2" paths="$3" description="$4"
  local date
  date=$(date +%Y-%m-%d)

  echo "---"
  echo "hashed-string: $key"
  if [[ -n "$topic" ]]; then
    echo "topic: $topic"
  fi
  if [[ -n "$paths" ]]; then
    echo "paths:"
    # Split comma-separated paths into YAML list items.
    IFS=',' read -ra path_array <<< "$paths"
    for p in "${path_array[@]}"; do
      # Trim leading/trailing whitespace.
      p=$(echo "$p" | sed 's/^ *//; s/ *$//')
      echo "  - $p"
    done
  fi
  if [[ -n "$description" ]]; then
    echo "description: $description"
  fi
  echo "date: $date"
  echo "---"
}

# Format a note's frontmatter for the list command.
format_list_entry() {
  local note_content="$1"
  local key topic paths_raw description date

  key=$(extract_field "$note_content" "hashed-string")
  topic=$(extract_field "$note_content" "topic")
  description=$(extract_field "$note_content" "description")
  date=$(extract_field "$note_content" "date")

  # Collect paths into a comma-separated string.
  local paths_list
  paths_list=$(extract_paths "$note_content" | paste -sd ',' - | sed 's/,/, /g')

  echo "$key"
  [[ -n "$topic" ]]       && echo "  topic: $topic"
  [[ -n "$paths_list" ]]  && echo "  paths: $paths_list"
  [[ -n "$description" ]] && echo "  description: $description"
  [[ -n "$date" ]]        && echo "  date: $date"
}

# --- commands ---

cmd_create() {
  local key="" topic="" paths="" description=""

  # Parse arguments.
  [[ $# -lt 1 ]] && die "Usage: notes.sh create <key> [--topic ...] [--paths ...] [--description ...]"
  key="$1"; shift

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --topic)       [[ $# -ge 2 ]] || die "--topic requires a value"; topic="$2"; shift 2 ;;
      --paths)       [[ $# -ge 2 ]] || die "--paths requires a value"; paths="$2"; shift 2 ;;
      --description) [[ $# -ge 2 ]] || die "--description requires a value"; description="$2"; shift 2 ;;
      *) die "Unknown flag: $1" ;;
    esac
  done

  [[ -z "$key" ]] && die "Key cannot be empty."

  # Keys and metadata must be single-line (stored as YAML scalars).
  if [[ "$key" == *$'\n'* ]]; then
    die "Key cannot contain newlines."
  fi
  if [[ "$topic" == *$'\n'* ]]; then
    die "Topic cannot contain newlines."
  fi
  if [[ "$description" == *$'\n'* ]]; then
    die "Description cannot contain newlines."
  fi
  if [[ "$paths" == *$'\n'* ]]; then
    die "Paths cannot contain newlines."
  fi

  # Check for duplicates.
  local oid
  oid=$(key_to_oid "$key" -w)
  if note_exists "$oid"; then
    die "Note with key '$key' already exists. Use 'update' to modify it."
  fi

  # Read body from stdin.
  local body=""
  if [[ ! -t 0 ]]; then
    body=$(cat)
  fi

  # Build the full note.
  local frontmatter
  frontmatter=$(build_frontmatter "$key" "$topic" "$paths" "$description")
  local full_note="$frontmatter"
  if [[ -n "$body" ]]; then
    full_note="$frontmatter
$body"
  fi

  git notes --ref="$NOTES_REF" add -m "$full_note" "$oid"
  echo "Created note: $key"
}

cmd_update() {
  local key="" topic="" paths="" description=""

  # Parse arguments.
  [[ $# -lt 1 ]] && die "Usage: notes.sh update <key> [--topic ...] [--paths ...] [--description ...]"
  key="$1"; shift

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --topic)       [[ $# -ge 2 ]] || die "--topic requires a value"; topic="$2"; shift 2 ;;
      --paths)       [[ $# -ge 2 ]] || die "--paths requires a value"; paths="$2"; shift 2 ;;
      --description) [[ $# -ge 2 ]] || die "--description requires a value"; description="$2"; shift 2 ;;
      *) die "Unknown flag: $1" ;;
    esac
  done

  [[ -z "$key" ]] && die "Key cannot be empty."

  # Key must be single-line (stored as a YAML scalar in frontmatter).
  if [[ "$key" == *$'\n'* ]]; then
    die "Key cannot contain newlines."
  fi

  # Metadata must be single-line (stored as YAML scalars).
  if [[ "$topic" == *$'\n'* ]]; then
    die "Topic cannot contain newlines."
  fi
  if [[ "$description" == *$'\n'* ]]; then
    die "Description cannot contain newlines."
  fi
  if [[ "$paths" == *$'\n'* ]]; then
    die "Paths cannot contain newlines."
  fi

  # Must exist.
  # Rebuild key blobs in case this is a fresh clone.
  rebuild_key_blobs

  local oid
  oid=$(resolve_key "$key")
  if ! note_exists "$oid"; then
    die "Note with key '$key' does not exist. Use 'create' to make a new one."
  fi

  # Ensure the blob exists locally.
  key_to_oid "$key" -w >/dev/null

  # Read body from stdin.
  local body=""
  if [[ ! -t 0 ]]; then
    body=$(cat)
  fi

  # Build the full note.
  local frontmatter
  frontmatter=$(build_frontmatter "$key" "$topic" "$paths" "$description")
  local full_note="$frontmatter"
  if [[ -n "$body" ]]; then
    full_note="$frontmatter
$body"
  fi

  git notes --ref="$NOTES_REF" add -f -m "$full_note" "$oid"
  echo "Updated note: $key"
}

cmd_delete() {
  [[ $# -lt 1 ]] && die "Usage: notes.sh delete <key>"
  [[ $# -gt 1 ]] && die "Too many arguments. Usage: notes.sh delete <key>"
  local key="$1"

  # Rebuild key blobs in case this is a fresh clone.
  rebuild_key_blobs

  local oid
  oid=$(resolve_key "$key")
  if ! note_exists "$oid"; then
    die "Note with key '$key' does not exist."
  fi

  git notes --ref="$NOTES_REF" remove "$oid"
  echo "Deleted note: $key"
}

cmd_list() {
  local filter_path="" filter_topic=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --path)  [[ $# -ge 2 ]] || die "--path requires a value"; filter_path="$2"; shift 2 ;;
      --topic) [[ $# -ge 2 ]] || die "--topic requires a value"; filter_topic="$2"; shift 2 ;;
      *) die "Unknown flag: $1" ;;
    esac
  done

  # Rebuild key blobs if needed (fresh clone).
  rebuild_key_blobs

  local note_list
  note_list=$(git notes --ref="$NOTES_REF" list 2>/dev/null || true)
  [[ -z "$note_list" ]] && return 0

  local first=true
  echo "$note_list" | while read -r note_blob target_oid; do
    local note_content
    note_content=$(git cat-file -p "$note_blob")

    # Apply path filter (substring match).
    if [[ -n "$filter_path" ]]; then
      local paths_text
      paths_text=$(extract_paths "$note_content" | tr '\n' ' ')
      if [[ "$paths_text" != *"$filter_path"* ]]; then
        continue
      fi
    fi

    # Apply topic filter (substring match).
    if [[ -n "$filter_topic" ]]; then
      local topic
      topic=$(extract_field "$note_content" "topic")
      if [[ "$topic" != *"$filter_topic"* ]]; then
        continue
      fi
    fi

    if [[ "$first" == true ]]; then
      first=false
    else
      echo ""
    fi

    format_list_entry "$note_content"
  done
}

cmd_show() {
  [[ $# -lt 1 ]] && die "Usage: notes.sh show <key>"
  [[ $# -gt 1 ]] && die "Too many arguments. Usage: notes.sh show <key>"
  local key="$1"

  # Rebuild key blobs in case this is a fresh clone.
  rebuild_key_blobs

  local oid
  oid=$(resolve_key "$key")
  if ! note_exists "$oid"; then
    die "Note with key '$key' does not exist."
  fi

  local note_content
  note_content=$(git notes --ref="$NOTES_REF" show "$oid")
  extract_frontmatter "$note_content"
}

cmd_show_detailed() {
  [[ $# -lt 1 ]] && die "Usage: notes.sh show-detailed <key>"
  [[ $# -gt 1 ]] && die "Too many arguments. Usage: notes.sh show-detailed <key>"
  local key="$1"

  # Rebuild key blobs in case this is a fresh clone.
  rebuild_key_blobs

  local oid
  oid=$(resolve_key "$key")
  if ! note_exists "$oid"; then
    die "Note with key '$key' does not exist."
  fi

  git notes --ref="$NOTES_REF" show "$oid"
}

cmd_sync_init() {
  [[ $# -gt 1 ]] && die "Too many arguments. Usage: notes.sh sync-init [remote]"
  local remote="${1:-origin}"

  # Validate remote exists.
  if ! git remote get-url "$remote" >/dev/null 2>&1; then
    die "Remote '$remote' does not exist."
  fi

  # Add fetch refspec if not already present (exact match).
  local fetch_spec="+${NOTES_FULL_REF}:${NOTES_FULL_REF}"
  if git config --get-all "remote.${remote}.fetch" 2>/dev/null | grep -qFx "$fetch_spec"; then
    echo "Fetch refspec for $NOTES_FULL_REF already configured on $remote."
  else
    git config --add "remote.${remote}.fetch" "$fetch_spec"
    echo "Added fetch refspec for $NOTES_FULL_REF on $remote."
  fi

  # Add push refspec if not already present (exact match).
  if git config --get-all "remote.${remote}.push" 2>/dev/null | grep -qFx "$NOTES_FULL_REF"; then
    echo "Push refspec for $NOTES_FULL_REF already configured on $remote."
  else
    git config --add "remote.${remote}.push" "$NOTES_FULL_REF"
    echo "Added push refspec for $NOTES_FULL_REF on $remote."
  fi
}

cmd_help() {
  cat <<'USAGE'
notes.sh — git-notes-backed knowledge store

Commands:
  create <key> [flags]      Create a new note (body from stdin)
  update <key> [flags]      Replace an existing note (body from stdin)
  delete <key>              Remove a note
  list [filters]            List all notes (frontmatter only)
  show <key>                Show a note's frontmatter
  show-detailed <key>       Show a note's frontmatter and body
  sync-init [remote]        Configure push/pull for notes (default: origin)
  help                      Show this message

Flags for create/update:
  --topic <topic>           Topic label
  --paths <p1,p2,...>       Comma-separated file paths
  --description <text>      Short description

Flags for list:
  --path <substring>        Filter to notes mentioning this path
  --topic <substring>       Filter to notes with this topic

Examples:
  notes.sh create "ipc-bridge" \
    --topic "IPC" \
    --paths "src/preload/bridge.ts,src/modes/ipc-handlers.ts" \
    --description "How main-renderer IPC works" <<'EOF'
  The preload script exposes a typed API...
  EOF

  notes.sh list --path src/preload/
  notes.sh show-detailed "ipc-bridge"
  notes.sh delete "ipc-bridge"
USAGE
}

# --- dispatch ---

[[ $# -lt 1 ]] && { cmd_help; exit 0; }

command="$1"; shift
case "$command" in
  create)        cmd_create "$@" ;;
  update)        cmd_update "$@" ;;
  delete)        cmd_delete "$@" ;;
  list)          cmd_list "$@" ;;
  show)          cmd_show "$@" ;;
  show-detailed) cmd_show_detailed "$@" ;;
  sync-init)     cmd_sync_init "$@" ;;
  help|--help|-h) cmd_help ;;
  *) die "Unknown command: $command. Run 'notes.sh help' for usage." ;;
esac
