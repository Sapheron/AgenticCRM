#!/bin/bash

# Open Agent CRM — Uninstaller v1.0
# This script will remove all containers, volumes, and files associated with the CRM.

set -e

# Setup colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║       Open Agent CRM — Uninstaller v1.0         ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Please run as root (use sudo)${NC}"
  exit 1
fi

# Confirmation
echo -e "${RED}WARNING: This will permanently DELETE all CRM data, including:${NC}"
echo " - All Docker containers"
echo " - All Database volumes (Messages, Contacts, Leads)"
echo " - All WhatsApp session data"
echo " - The installation directory (/opt/openagentcrm)"
echo ""
read -p "Are you sure you want to proceed? [y/N]: " confirm </dev/tty
if [[ ! $confirm =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
fi

INSTALL_DIR="/opt/openagentcrm"

# 1. Stop and remove containers + volumes
if [ -d "$INSTALL_DIR/deploy" ]; then
    echo -e "${BLUE}Stopping and removing Docker containers...${NC}"
    cd "$INSTALL_DIR/deploy"
    docker compose down -v || true
else
    echo -e "${BLUE}Install directory not found, skipping container removal.${NC}"
fi

# 2. Remove Docker images (optional but keeps things clean)
echo -e "${BLUE}Cleaning up Docker images...${NC}"
docker images -q "openagentcrm-*" | xargs -r docker rmi || true

# 3. Remove the installation directory
echo -e "${BLUE}Removing files from $INSTALL_DIR...${NC}"
rm -rf "$INSTALL_DIR"

echo -e "${GREEN}"
echo "  ✔ Uninstall complete."
echo "  Open Agent CRM has been removed from your system."
echo -e "${NC}"
