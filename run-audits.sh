#!/bin/sh
# All three audit rounds. Run from the repo root.
set -e
echo "── Round 1: behaviour, security, Windows, native ──"
node tests/audit.mjs
echo "── Round 2: credential shape coverage ──"
node tests/shapes.mjs
echo "── Round 3: value round-trip through both .env parsers ──"
node tests/roundtrip.mjs
echo "── Round 4: messy human input ──"
node tests/messy.mjs
