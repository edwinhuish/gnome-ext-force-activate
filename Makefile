# Force Activate — GNOME Shell extension
# SPDX-License-Identifier: GPL-2.0-or-later

UUID       := force-activate
SRC        := $(UUID)
SCHEMA_DIR := $(SRC)/schemas
EXTENSIONS := $(HOME)/.local/share/gnome-shell/extensions
TARGET     := $(EXTENSIONS)/$(UUID)
BUILD      := build

.PHONY: all schemas validate check install uninstall enable disable zip release clean

all: validate

# Compile the GSettings schema inside the source tree.
schemas:
	glib-compile-schemas --strict --targetdir=$(SCHEMA_DIR) $(SCHEMA_DIR)

# Cheap checks that do not need a running shell.
validate: schemas
	python3 -c "import json; json.load(open('$(SRC)/metadata.json'))"
	@echo "OK: metadata.json parses, GSettings schema compiles"

# Copy the extension into the user's extension directory.
install: schemas
	mkdir -p $(TARGET)/schemas
	cp $(SRC)/metadata.json $(SRC)/extension.js $(SRC)/prefs.js $(TARGET)/
	cp $(SCHEMA_DIR)/*.xml $(TARGET)/schemas/
	glib-compile-schemas --strict --targetdir=$(TARGET)/schemas $(TARGET)/schemas
	@echo "Installed to $(TARGET)"
	@echo "On Wayland, log out and back in before running 'make enable'."

uninstall:
	rm -rf $(TARGET)
	@echo "Removed $(TARGET)"

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

# Build a bundle for extensions.gnome.org.
#
# `gnome-extensions pack` ships schemas/*.gschema.xml but not the compiled
# gschemas.compiled: the installer (GNOME 44+), the extensions website and
# Extension Manager all compile the schema themselves, and a stale compiled
# copy would shadow later edits to the XML.
zip: validate
	mkdir -p $(BUILD)
	gnome-extensions pack --force --out-dir $(BUILD) $(SRC)
	@echo "Built $(BUILD)/$(UUID).shell-extension.zip"

# Format check only, no artefacts: ./release.sh --no-build
check:
	./release.sh --no-build

# Check, bump version-name, build the bundle and verify its contents.
# Usage: make release VERSION=1.1.0 [TAG=1]
release:
	./release.sh $(VERSION) $(if $(TAG),--tag,)

clean:
	rm -rf $(BUILD) $(SCHEMA_DIR)/gschemas.compiled
