# ----------------------------------------------------------------------------
# Shell Options
# ----------------------------------------------------------------------------
setopt AUTO_CD              # cd by typing directory name
setopt AUTO_PUSHD           # Push directories onto stack
setopt PUSHD_IGNORE_DUPS    # Don't push duplicates
unsetopt CORRECT
unsetopt CORRECT_ALL
setopt NO_BEEP              # No beep on errors

# ----------------------------------------------------------------------------
# History
# ----------------------------------------------------------------------------
HISTSIZE=50000
SAVEHIST=50000
HISTFILE=~/.zsh_history
setopt SHARE_HISTORY        # Share history between sessions
setopt HIST_IGNORE_ALL_DUPS # Don't record duplicates
setopt HIST_IGNORE_SPACE    # Don't record commands starting with space
setopt HIST_REDUCE_BLANKS   # Remove superfluous blanks
setopt HIST_VERIFY          # Show command before executing from history

# ----------------------------------------------------------------------------
# Environment
# ----------------------------------------------------------------------------
export EDITOR="cursor"
export VISUAL="cursor"

# Bun
export BUN_INSTALL="$HOME/.bun"

# NVM (lazy-loaded below for performance)
export NVM_DIR="$HOME/.nvm"

# ----------------------------------------------------------------------------
# PATH (consolidated, deduped)
# ----------------------------------------------------------------------------
typeset -U PATH  # Automatically remove duplicates

path=(
  $BUN_INSTALL/bin
  ./node_modules/.bin
  $path
)

# ----------------------------------------------------------------------------
# Completions & Plugins
# ----------------------------------------------------------------------------
# Bun completions
[[ -f ~/.bun-completions.sh ]] && source ~/.bun-completions.sh

# ----------------------------------------------------------------------------
# Prompt (starship)
# ----------------------------------------------------------------------------
eval "$(starship init zsh)"

# ----------------------------------------------------------------------------
# Aliases - General
# ----------------------------------------------------------------------------
alias cat="bat"
alias c="clear"
alias rl="source ~/.zshrc && echo 'Reloaded!'"
alias flushdns="sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder"

# ----------------------------------------------------------------------------
# Aliases - Navigation
# ----------------------------------------------------------------------------
alias ..="cd .."
alias ...="cd ../.."
alias ....="cd ../../.."

# ----------------------------------------------------------------------------
# Aliases - Git
# ----------------------------------------------------------------------------
alias gs="git status"
alias gb="git branch -a"
alias gl="git log --oneline -20"
alias gd="git diff"
alias gds="git diff --staged"
alias gco="git checkout"
alias gcb="git checkout -b"
alias gac="git add -A && git commit --amend --no-edit"
alias gp="git pull --rebase"
alias gps="git push"
alias gpsf="git push --force-with-lease"
alias grh="git reset --hard"
alias grs="git reset --soft HEAD~1"
alias gst="git stash"
alias gstp="git stash pop"
alias gcp="git cherry-pick"

# ----------------------------------------------------------------------------
# Aliases - Bun/Dev
# ----------------------------------------------------------------------------
alias b="bun"
alias br="bun run"
alias bt="bun test"
alias bi="bun install"

# ----------------------------------------------------------------------------
# Aliases - Modern CLI Tools
# ----------------------------------------------------------------------------
# eza (better ls)
alias ls="eza --icons --group-directories-first"
alias ll="eza -la --icons --group-directories-first"
alias lt="eza --tree --level=2 --icons"
alias lta="eza --tree --level=2 --icons -a"

# btop (better top)
alias top="btop"

# fd (better find)
alias find="fd"

# ripgrep (better grep)
alias grep="rg"

# FZF configuration
export FZF_DEFAULT_COMMAND='fd --type f --hidden --follow --exclude .git'
export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
export FZF_ALT_C_COMMAND='fd --type d --hidden --follow --exclude .git'

# Load fzf keybindings (Ctrl+R for history, Ctrl+T for files)
source <(fzf --zsh)

# Interactive git branch checkout
gbs() {
  git branch -a | fzf --height 40% --reverse | xargs git checkout
}

# Interactive git log browser
glo() {
  git log --oneline --color=always | fzf --ansi --preview 'git show --color=always {1}' | cut -d' ' -f1 | xargs git show
}

# Interactive process killer
fkill() {
  ps aux | fzf --height 40% --reverse --header-lines=1 | awk '{print $2}' | xargs kill -9
}

# Interactive file opener
fo() {
  fd --type f | fzf --preview 'bat --color=always {}' | xargs -r cursor
}

# ----------------------------------------------------------------------------
# Functions
# ----------------------------------------------------------------------------

# Kill processes on a specific port
killport() {
  if [[ -z "$1" ]]; then
    echo "Usage: killport <port>"
    return 1
  fi
  local pids=$(lsof -ti tcp:"$1")
  if [[ -z "$pids" ]]; then
    echo "No process on port $1"
    return 1
  fi
  echo "Killing processes on port $1: $pids"
  echo "$pids" | xargs kill -9
}

# Show what's listening on a port
port() {
  if [[ -z "$1" ]]; then
    lsof -iTCP -sTCP:LISTEN -n -P
  else
    lsof -i tcp:"$1"
  fi
}

# Make directory and cd into it
mkcd() {
  mkdir -p "$1" && cd "$1"
}

# Quick file search
ff() {
  find . -name "*$1*" 2>/dev/null
}

# Extract any archive
extract() {
  if [[ ! -f "$1" ]]; then
    echo "'$1' is not a valid file"
    return 1
  fi
  case "$1" in
    *.tar.bz2) tar xjf "$1" ;;
    *.tar.gz)  tar xzf "$1" ;;
    *.tar.xz)  tar xJf "$1" ;;
    *.tar)     tar xf "$1" ;;
    *.tbz2)    tar xjf "$1" ;;
    *.tgz)     tar xzf "$1" ;;
    *.zip)     unzip "$1" ;;
    *.gz)      gunzip "$1" ;;
    *.bz2)     bunzip2 "$1" ;;
    *.rar)     unrar x "$1" ;;
    *.7z)      7z x "$1" ;;
    *)         echo "'$1' cannot be extracted" ;;
  esac
}

# Quick backup of a file
backup() {
  cp "$1" "$1.bak.$(date +%Y%m%d%H%M%S)"
}

# Open current directory in Finder
finder() {
  open "${1:-.}"
}

alias vps="ssh dev@vps.ibex-halibut.ts.net"

# bun completions
[ -s "/Users/dpeek/.bun/_bun" ] && source "/Users/dpeek/.bun/_bun"
