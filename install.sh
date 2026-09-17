#!/usr/bin/env bash
#
# Convenience wrapper around `make install`.
# `make install` 的便捷入口。
#
# SPDX-License-Identifier: GPL-2.0-or-later
#
set -euo pipefail

cd "$(dirname "$0")"
exec make install
