# Configuration
NAME="David Peek"
EMAIL="mail@dpeek.com"
USER="dpeek"
MACHINE=$(system_profiler SPHardwareDataType | rg -i -o 'Model Name:.*(mini|air)' | rg -i -o 'mini|air' | tr '[:upper:]' '[:lower:]')
HOSTNAME="$USER-$MACHINE"

# Link .zshrc to home directory
ln -sf /Users/dpeek/code/home/zsh/rc.sh ~/.zshrc

# Ask for admin password
sudo -v

# Configure git
git config --global user.name $NAME
git config --global user.email $EMAIL
git config --global --add --bool push.ignorecase false
git config --global --add --bool push.autoSetupRemote true

# Host / computer name
sudo scutil --set ComputerName $HOSTNAME
sudo scutil --set HostName $HOSTNAME
sudo scutil --set LocalHostName $HOSTNAME

# Only show running apps in the Dock
defaults write com.apple.dock static-only -bool true

# Auto-hide the Dock
defaults write com.apple.dock autohide -bool true

# Allow opening executables from outside the App Store
defaults write com.apple.LaunchServices LSQuaratine -bool false

# Quit printer app once print jobs finished
defaults write com.apple.print.PrintingPrefs "Quit When Finished" -bool true

# Show all file extensions
defaults write NSGlobalDomain AppleShowAllExtensions -bool true

# Don't warn on changing file extensions
defaults write com.apple.finder FXEnableExtensionChangeWarning -bool false

# Default to column view in Finder
defaults write com.apple.Finder FXPreferredViewStyle clmv

# Don't auto-correct words
defaults write -g NSAutomaticSpellingCorrectionEnabled -bool false

# Restart configured apps
killall Dock
killall Finder
