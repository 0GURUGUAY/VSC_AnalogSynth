#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backup_dir="$project_root/backup"

mkdir -p "$backup_dir"

rsync -a \
  --exclude='/backup/***' \
  --exclude='/.git/***' \
  --exclude='/node_modules/***' \
  --exclude='/dist/***' \
  --exclude='/server-dist/***' \
  --exclude='/android/.gradle/***' \
  --exclude='/android/app/build/***' \
  --exclude='/android/build/***' \
  --exclude='/facades/***' \
  --exclude='/.DS_Store' \
  --exclude='/.env.local' \
  --exclude='/.env.mobile-local' \
  "$project_root/" "$backup_dir/"
